// Bounds a call that should answer in moments, so one that hangs (a Durable Object, the Queue or D1 in an incident)
// fails like any other error, down the caller's existing retry or fallback path, instead of holding the caller.

/** What a call that ran out of time rejects with. */
export class DeadlineError extends Error {
  override readonly name = "DeadlineError";
}

/**
 * `promise`, or a `DeadlineError` once `ms` passed. The call itself is not cancelled: it may still finish later, so
 * use this only where doing it again is safe.
 */
export async function within<T>(promise: PromiseLike<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DeadlineError(`${what}: no answer in ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
