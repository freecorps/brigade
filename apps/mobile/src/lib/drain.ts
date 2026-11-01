// Switching workspaces with changes not sent yet (RFC 0004 "Switching workspaces"): the workspace switched away from
// keeps its sync client open in the background until its queue is empty, so an ack made while the socket was
// reconnecting still reaches the shard (and stops the escalation) instead of waiting for the member to switch back.
// Switching back takes the same client again: one client per queue file. Pure, so it is tested in Node;
// src/components/session.tsx keeps one for the app.

/** How often a draining client is checked, and how long it is kept at most before it is closed with changes left. */
export const DRAIN_CHECK_MS = 1000;
export const DRAIN_MAX_MS = 10 * 60 * 1000;

export type Drainable = {
  /** Whether it still has changes the shard has not confirmed. */
  unsent: () => boolean;
  close: () => void;
};

export function drainer<T extends Drainable>(deps: {
  setTimer: (run: () => void, ms: number) => () => void;
  now: () => number;
}) {
  const draining = new Map<string, { item: T; cancel: () => void }>();
  const stop = (key: string) => {
    const entry = draining.get(key);
    if (!entry) return undefined;
    entry.cancel();
    draining.delete(key);
    return entry.item;
  };
  return {
    /**
     * `item`, which the app no longer shows: closed now with nothing left to send, else once the shard confirmed
     * everything or `DRAIN_MAX_MS` passed (its changes stay on the phone and go out when the workspace is opened again).
     */
    keep(key: string, item: T): void {
      stop(key)?.close();
      if (!item.unsent()) {
        item.close();
        return;
      }
      const until = deps.now() + DRAIN_MAX_MS;
      const check = () => {
        if (item.unsent() && deps.now() < until) {
          draining.set(key, { item, cancel: deps.setTimer(check, DRAIN_CHECK_MS) });
          return;
        }
        draining.delete(key);
        item.close();
      };
      draining.set(key, { item, cancel: deps.setTimer(check, DRAIN_CHECK_MS) });
    },
    /** The client still draining under `key`, taken back (switching back to it), or undefined. */
    take(key: string): T | undefined {
      return stop(key);
    },
    /**
     * Signing out: every draining client closed at once, or only those whose key starts with `prefix` (one instance's,
     * src/components/session.tsx); nothing they queued is sent after.
     */
    closeAll(prefix = ""): void {
      // Deleting the entry being visited is safe while iterating a Map.
      for (const key of draining.keys()) if (key.startsWith(prefix)) stop(key)?.close();
    },
    size: () => draining.size,
  };
}
