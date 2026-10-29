// A sheet closes as soon as it sends (the change shows at once and settles later, RFC 0004); the screen under it,
// which stays mounted, follows the outcome and says so if the shard refuses it. One channel per kind of change.

export type Channel<T> = {
  send: (message: T) => void;
  /** Starts listening; returns the function that stops. */
  listen: (listener: (message: T) => void) => () => void;
};

/**
 * Messages sent while nobody listens (the screen not mounted yet) are handed, once, to the next listener, so a
 * refusal is never dropped between a sheet closing and the screen under it subscribing.
 */
export function channel<T>(): Channel<T> {
  const listeners = new Set<(message: T) => void>();
  let unheard: T[] = [];
  return {
    send(message) {
      if (listeners.size === 0) {
        unheard.push(message);
        return;
      }
      for (const listener of listeners) listener(message);
    },
    listen(listener) {
      listeners.add(listener);
      const waiting = unheard;
      unheard = [];
      for (const message of waiting) listener(message);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
