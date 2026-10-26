// Keeping this phone paged (RFC 0006 "A handed-over phone"): first finish any sign-out kept from offline, so the
// phone is off the last member's shard, then register it for whoever is signed in; and while either is left undone
// (a kept sign-out still pending, or registering `taken` or `failed`), try again on a backoff and whenever the app
// asks (back online, back in the foreground, Try again). Pure, so it is tested in Node; src/components/session.tsx
// runs it with the native pieces.
import type { Paging } from "@/lib/device";
import type { FinishResult } from "@/lib/sign-out";

/** Waits between tries: 30 s, 2 min, 10 min, then every 10 min. */
export const RETRY_DELAYS = [30_000, 120_000, 600_000] as const;

export function retryDelay(attempt: number): number {
  return RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]!;
}

export type PagingDeps = {
  /** `finishSignOut` for every kept sign-out. */
  finish: () => Promise<FinishResult>;
  /** Registers the phone for the signed-in member; null when nobody is signed in. */
  register: (() => Promise<Paging>) | null;
  /** Each registration's result. */
  onPaging: (paging: Paging) => void;
  /** Runs `run` after `ms`; returns what cancels it. */
  setTimer: (run: () => void, ms: number) => () => void;
};

export type PagingCycle = {
  /** Tries now (dropping the pending wait); resolves once that try is done. */
  retry: () => Promise<void>;
  stop: () => void;
};

/** Whether a try left something to do again later. */
export function needsRetry(finished: FinishResult, paging: Paging | null): boolean {
  return finished === "pending" || paging === "taken" || paging === "failed";
}

/** Starts trying right away. One try runs at a time; a retry asked for during one runs right after it. */
export function pagingCycle(deps: PagingDeps): PagingCycle {
  let attempt = 0;
  let stopped = false;
  let again = false;
  let cancel: (() => void) | null = null;
  let running: Promise<void> | null = null;

  const wait = () => {
    cancel?.();
    cancel = null;
  };

  const once = async () => {
    const finished = await deps.finish().catch(() => "pending" as const);
    if (stopped) return;
    let paging: Paging | null = null;
    if (deps.register) {
      paging = await deps.register().catch(() => "failed" as const);
      if (stopped) return;
      deps.onPaging(paging);
    }
    if (!needsRetry(finished, paging)) {
      attempt = 0;
      return;
    }
    const ms = retryDelay(attempt);
    attempt += 1;
    cancel = deps.setTimer(() => {
      cancel = null;
      void retry();
    }, ms);
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
        wait();
        await once();
      } while (again && !stopped);
    })().finally(() => {
      running = null;
    });
    return running;
  };

  void retry();
  return {
    retry,
    stop: () => {
      stopped = true;
      wait();
    },
  };
}
