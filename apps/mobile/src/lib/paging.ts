// Keeping this phone paged (RFC 0006 "A handed-over phone"): first finish any sign-out kept from offline, so the
// phone is off the last member's shard, then register it for whoever is signed in, in every workspace they opened on
// it; and while either is left undone (a kept sign-out still pending, or registering `taken`, `limit` or `failed` in
// any workspace), try again on a backoff and whenever the app asks (back online, back in the foreground, a new push or
// VoIP token, Try again). Pure, so it is tested in Node; src/components/session.tsx runs it with the native pieces.
import type { Registrations } from "@/lib/device";
import type { FinishResult } from "@/lib/sign-out";

/** Waits between tries: 5 s, 30 s, 2 min, 10 min, then every 10 min; each give or take `RETRY_JITTER`. */
export const RETRY_DELAYS = [5_000, 30_000, 120_000, 600_000] as const;

/** How far a wait may stray from its step, either way, so phones that failed together do not retry together. */
export const RETRY_JITTER = 0.2;

/**
 * The least time between two tries the app starts on its own (back online, the foreground, a new token): `POST
 * /devices/register` takes 30 a minute per user (apps/api `DEVICE_REGISTER_LIMIT`), and these stay well under it
 * however often they fire. Try again is the member asking, so it never waits.
 */
export const MIN_TRY_GAP_MS = 5_000;

/** The wait before try `attempt + 1`; `random` in [0, 1), 0.5 for the step itself. */
export function retryDelay(attempt: number, random = 0.5): number {
  const step = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]!;
  return Math.round(step * (1 + RETRY_JITTER * (2 * random - 1)));
}

/** The slowest step: what a phone `taken` by another member settles at between tries. */
const SLOWEST = RETRY_DELAYS.length - 1;

export type PagingDeps = {
  /** `finishSignOut` for every kept sign-out. */
  finish: () => Promise<FinishResult>;
  /**
   * Registers the phone for the signed-in member; null when nobody is signed in. It calls `proceed` right before
   * sending `device.register` and sends nothing when that says false (the cycle was stopped meanwhile).
   */
  register: ((proceed: () => boolean) => Promise<Registrations>) | null;
  /** Each registration's result, per workspace. */
  onPaging: (registrations: Registrations) => void;
  /** Runs `run` after `ms`; returns what cancels it. */
  setTimer: (run: () => void, ms: number) => () => void;
  /** The time now, in ms. */
  now: () => number;
  /** In [0, 1): how each wait strays from its step. */
  random: () => number;
};

export type PagingCycle = {
  /** Try again: tries now (dropping the pending wait); resolves once that try is done. */
  retry: () => Promise<void>;
  /**
   * Something the app noticed may need a registration (back online, the foreground, a new token): tries now, or once
   * `MIN_TRY_GAP_MS` has passed since the last try started, whichever is later. Never sooner than a wait already set
   * would.
   */
  nudge: () => void;
  /**
   * Stops trying, at once: from here no registration sends `device.register`. A try still asking for the key,
   * permission or token sends nothing when it gets them (`proceed` says false), and one that already sent it is
   * queued on the sync client ahead of anything sent after (`mutate` queues in the same tick `proceed` answers, so
   * signing out unregisters after it on the same socket and the shard drops what it registered). It never waits
   * for the try: a push token can take forever to come without APNs.
   */
  stop: () => Promise<void>;
};

/**
 * When to try again after a try, as a step of the backoff: `failed` or a kept sign-out still pending from the next
 * step; `taken` the same backoff, held at its `SLOWEST` step, since only the other member's session ending frees the
 * phone (RFC 0006 "A handed-over phone") and that may happen right after signing in; `limit` not on its own, since only the member can free a place (signing out on another phone).
 * Undefined: nothing to try again on a timer.
 */
export function nextTry(
  finished: FinishResult,
  registrations: Registrations | null,
): "next" | "slowest" | undefined {
  const paging = Object.values(registrations ?? {});
  if (finished === "pending" || paging.includes("failed")) return "next";
  if (paging.includes("taken")) return "slowest";
  return undefined;
}

/** Whether a try left something to do again later, on a timer. */
export function needsRetry(finished: FinishResult, registrations: Registrations | null): boolean {
  return nextTry(finished, registrations) !== undefined;
}

/**
 * Starts trying right away. One try runs at a time; Try again asked for during one runs right after it, and a nudge
 * once `MIN_TRY_GAP_MS` has passed since it started.
 */
export function pagingCycle(deps: PagingDeps): PagingCycle {
  let attempt = 0;
  let stopped = false;
  let again = false;
  let nudged = false;
  let cancel: (() => void) | null = null;
  /** When the wait set now runs out. */
  let dueAt = Infinity;
  let running: Promise<void> | null = null;
  let startedAt = -Infinity;

  const wait = () => {
    cancel?.();
    cancel = null;
    dueAt = Infinity;
  };

  /** Tries again in `ms`, unless a wait set already runs out sooner. */
  const schedule = (ms: number) => {
    if (stopped || deps.now() + ms >= dueAt) return;
    wait();
    dueAt = deps.now() + ms;
    cancel = deps.setTimer(() => {
      cancel = null;
      dueAt = Infinity;
      void retry();
    }, ms);
  };

  const once = async () => {
    startedAt = deps.now();
    const finished = await deps.finish().catch(() => "pending" as const);
    if (stopped) return;
    let paging: Registrations | null = null;
    if (deps.register) {
      paging = await deps.register(() => !stopped).catch(() => ({ "": "failed" as const }));
      if (stopped) return;
      deps.onPaging(paging);
    }
    const next = nextTry(finished, paging);
    if (next === undefined) {
      attempt = 0;
      return;
    }
    // `taken`: the normal backoff, held at its slowest step, so a phone freed soon after is picked up in minutes.
    const ms = retryDelay(next === "slowest" ? Math.min(attempt, SLOWEST) : attempt, deps.random());
    attempt += 1;
    schedule(ms);
  };

  const retry = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        nudged = false;
        wait();
        await once();
      } while (again && !stopped);
    })().finally(() => {
      running = null;
      // A nudge during the try: once the gap since it started has passed.
      if (nudged) {
        nudged = false;
        nudge();
      }
    });
    return running;
  };

  const nudge = () => {
    if (stopped) return;
    if (running) {
      nudged = true;
      return;
    }
    const gap = startedAt + MIN_TRY_GAP_MS - deps.now();
    if (gap > 0) schedule(gap);
    else void retry();
  };

  void retry();
  return {
    retry,
    nudge,
    stop: () => {
      stopped = true;
      wait();
      return Promise.resolve();
    },
  };
}

/** How many registrations the phone's device disappearing from the shard starts within `REMOVAL_WINDOW_MS`. */
export const REMOVAL_TRIES = 3;

/** The window `REMOVAL_TRIES` counts in. */
export const REMOVAL_WINDOW_MS = 60 * 60_000;

/**
 * What to do when the open workspace's synced device summaries (`member_devices`) change. `again`: the phone's own
 * device was there and is gone while the app holds it registered (evicted as `replaced`, removed from the dashboard,
 * dropped by the server), so it registers again now (a nudge, so never within `MIN_TRY_GAP_MS` of the last try):
 * while the member is signed in on this phone that is the only way it gets their pages. `gave_up`: it went
 * `REMOVAL_TRIES` times within `REMOVAL_WINDOW_MS`, so something keeps removing it (another of the member's phones
 * evicting it over the limit, say); the app stops chasing it and says the phone is not paged. The count starts over
 * when the member taps Try again (`reset`) or the phone registers again on its own after the watch gave up (coming
 * back to the app, back online, a new token): the member is back in the loop, so it is chased again.
 */
export type RemovalVerdict = "again" | "gave_up" | undefined;

/**
 * Watches for the phone's device leaving the shard (RFC 0006 "Device registration"). `see` takes whether its row is
 * in the synced summaries (undefined while they load, `devicePresent`) and whether the last registration said it is
 * on; only a row seen while registered and then gone counts, so a registration answered before its row arrived is not
 * a removal.
 */
export function removalWatch(now: () => number) {
  let seen = false;
  let tries: number[] = [];
  // `gave_up`: it stopped chasing; `off`: and the phone has since been shown as not paged.
  let gaveUp: "no" | "gave_up" | "off" = "no";
  return {
    see(present: boolean | undefined, registered: boolean): RemovalVerdict {
      if (!registered) {
        seen = false;
        if (gaveUp === "gave_up") gaveUp = "off";
        return undefined;
      }
      // Registered again after the watch gave up: not one of its own chases, so the count starts over.
      if (gaveUp === "off") {
        gaveUp = "no";
        tries = [];
      }
      if (present === undefined) return undefined;
      if (present) {
        seen = true;
        return undefined;
      }
      if (!seen) return undefined;
      seen = false;
      const at = now();
      tries = tries.filter((tried) => at - tried < REMOVAL_WINDOW_MS);
      if (tries.length >= REMOVAL_TRIES) {
        gaveUp = "gave_up";
        return "gave_up";
      }
      tries.push(at);
      return "again";
    },
    /** The member tapped Try again: the count starts over. */
    reset(): void {
      tries = [];
      gaveUp = "no";
    },
  };
}

export type RemovalWatch = ReturnType<typeof removalWatch>;

/**
 * Whether the phone's device (`deviceId`, undefined until read) is among the open workspace's synced summaries, what
 * `RemovalWatch.see` takes: undefined until both the id and the summaries are in, so a list still loading (or
 * reloading after a reconnect, or failed) is never taken as the device gone.
 */
export function devicePresent(
  deviceId: string | undefined,
  devices: { status: string; rows: readonly { id: string }[] },
): boolean | undefined {
  if (deviceId === undefined || devices.status !== "ready") return undefined;
  return devices.rows.some((row) => row.id === deviceId);
}

/**
 * How long after the app's own permission request ends a return to the foreground is still taken as the return from
 * it: on Android its answer and the app's resume come milliseconds apart.
 */
export const PERMISSION_RETURN_MS = 1_000;

/** Whether the app is asking for notification permission now, or just did; `ask` wraps each request. */
export type PermissionAsks = {
  ask: <T>(request: () => Promise<T>) => Promise<T>;
  /** A request is open. */
  asking: () => boolean;
  /** A request is open, or one ended less than `PERMISSION_RETURN_MS` ago. */
  recent: () => boolean;
};

/**
 * The app's own permission requests. On Android every request (granted already or not) shows the system's
 * permission screen over the app, if only for a moment, so the app goes to the background and comes back: taken as
 * the member coming back, every registration asked for the next one, every `MIN_TRY_GAP_MS`, for as long as the app
 * was open. `now` is the time in ms.
 */
export function permissionAsks(now: () => number = Date.now): PermissionAsks {
  let open = 0;
  let endedAt = -Infinity;
  return {
    ask: async (request) => {
      open += 1;
      try {
        return await request();
      } finally {
        open -= 1;
        endedAt = now();
      }
    },
    asking: () => open > 0,
    recent: () => open > 0 || now() - endedAt < PERMISSION_RETURN_MS,
  };
}

/** What the app hears that may need a registration, as src/components/session.tsx wires it to the cycle. */
export type PagingNudges = {
  /** AppState's `change` event. */
  appState: (state: string) => void;
  /** expo-notifications' push token listener. */
  pushToken: (token: { data: unknown }) => void;
  /** iOS: a new or withdrawn PushKit token. */
  voipToken: () => void;
};

/**
 * Nudges `cycle` when the app comes back to the foreground, unless it left only for its own permission request
 * (`asks`) and comes back as it ends; when the push token listener hears a token that is not the one fetched last
 * (`tokens`); and on every new VoIP token. `initial` is AppState's state when the listeners are added (null while
 * React Native does not know it); `os` is the platform.
 *
 * Left for a request, the app may still be left by the member: on iOS a system alert only makes the app `inactive`,
 * so `background` is always the member leaving; on Android the permission screen itself sends the app to the
 * background, so a return counts as the member's once the request ended more than `PERMISSION_RETURN_MS` before it
 * (they left from the permission screen and it was answered or dismissed while they were away).
 */
export function pagingNudges(
  cycle: Pick<PagingCycle, "nudge">,
  tokens: KnownTokens,
  asks: Pick<PermissionAsks, "asking" | "recent">,
  initial: string | null | undefined,
  os: string | undefined,
): PagingNudges {
  /** Why the app is out of the foreground: the member left (or it started there), or it asked for permission. */
  let away: "member" | "asked" | undefined = initial === "active" ? undefined : "member";
  return {
    appState: (state) => {
      if (state !== "active") {
        if (os === "ios" && state === "background") away = "member";
        else away ??= asks.asking() ? "asked" : "member";
        return;
      }
      const back = away === "member" || (away === "asked" && !asks.recent());
      away = undefined;
      if (back) cycle.nudge();
    },
    pushToken: (token) => {
      void tokens.changed(String(token.data)).then((changed) => {
        if (changed) cycle.nudge();
      });
    },
    voipToken: () => cycle.nudge(),
  };
}

export type KnownTokens = ReturnType<typeof knownTokens>;

/**
 * A new push token for every instance's cycle (RFC 0015 section 5): `tokens` is shared, so whichever learns a new
 * token first (the listener hearing it, or one instance's registration fetching it) nudges every cycle that joined,
 * and each instance registers it, not only the first. `listen` adds the platform's listener (expo-notifications) and
 * returns what removes it; it is added when the first cycle joins and removed when the last leaves.
 */
export function tokenFanOut(
  tokens: KnownTokens,
  listen: (heard: (token: { data: unknown }) => void) => () => void,
) {
  const cycles = new Set<Pick<PagingCycle, "nudge">>();
  let stop: (() => void) | null = null;
  const heard = (token: { data: unknown }) => {
    // Only a real token: anything else would become a made-up "known" token and nudge every instance for nothing.
    if (typeof token.data === "string" && token.data.length > 0) void tokens.changed(token.data);
  };
  tokens.onNew(() => {
    for (const cycle of cycles) cycle.nudge();
  });
  return {
    /** Joins `cycle`; returns what makes it leave. */
    add(cycle: Pick<PagingCycle, "nudge">): () => void {
      cycles.add(cycle);
      stop ??= listen(heard);
      return () => {
        cycles.delete(cycle);
        if (cycles.size === 0 && stop) {
          stop();
          stop = null;
        }
      };
    },
  };
}

/**
 * The longest a token event waits for a fetch still out before it is compared with the token known: a fetch that
 * never answers (no APNs) must not hold back every token event after it.
 */
export const TOKEN_FETCH_WAIT_MS = 5_000;

/**
 * Which push tokens the app already knows, so only a new one asks for a registration. Fetching the token
 * (`getDevicePushTokenAsync`) also fires expo-notifications' token listener with it, on iOS and Android alike: taken
 * as new, every registration asked for the next one, about once a second, for as long as the app was open. The event
 * can come before the fetch's answer does, so a token heard while a fetch is out is compared once it is back, or
 * `TOKEN_FETCH_WAIT_MS` after it started.
 */
export function knownTokens() {
  let known: string | undefined;
  let fetching: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  const tell = () => {
    for (const listener of listeners) listener();
  };
  return {
    /**
     * Fetches a token to register (`get`), and knows it. One that replaces a token known before is told to
     * `onNew`'s listeners: an instance that fetched it first must not keep it from the others.
     */
    fetch(get: () => Promise<string>): Promise<string> {
      const token = get().then((value) => {
        const replaced = known !== undefined && known !== value;
        known = value;
        if (replaced) tell();
        return value;
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, TOKEN_FETCH_WAIT_MS);
      });
      const back = token.then(
        () => clearTimeout(timer),
        () => clearTimeout(timer),
      );
      fetching = Promise.all([fetching, Promise.race([back, late])]);
      return token;
    },
    /** A token the listener reported: true when it is not the one known (a new one, worth registering). */
    async changed(token: string): Promise<boolean> {
      let settled: Promise<unknown>;
      do {
        settled = fetching;
        await settled;
      } while (settled !== fetching);
      if (token === known) return false;
      known = token;
      tell();
      return true;
    },
    /** Told whenever a new token replaces the known one (heard or fetched); returns what stops it. */
    onNew(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
