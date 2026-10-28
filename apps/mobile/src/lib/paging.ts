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

/** The slowest step: what a phone `taken` by another member waits between tries. */
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
 * step; `taken` only every `SLOWEST` step, since only the other member's session ending frees the phone (RFC 0006 "A
 * handed-over phone"); `limit` not on its own, since only the member can free a place (signing out on another phone).
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
    const ms = retryDelay(next === "slowest" ? SLOWEST : attempt, deps.random());
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

/**
 * Which push tokens the app already knows, so only a new one asks for a registration. Fetching the token
 * (`getDevicePushTokenAsync`) also fires expo-notifications' token listener with it, on iOS and Android alike: taken
 * as new, every registration asked for the next one, about once a second, for as long as the app was open.
 */
export function knownTokens() {
  let known: string | undefined;
  return {
    /** A token the app fetched itself to register. */
    fetched(token: string): void {
      known = token;
    },
    /** A token the listener reported: true when it is not the one known (a new one, worth registering). */
    changed(token: string): boolean {
      if (token === known) return false;
      known = token;
      return true;
    },
  };
}
