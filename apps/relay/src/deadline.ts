/**
 * `send(request)`, aborted after `ms`, and given up then with a `TimeoutError` even if `send` does not honour the
 * abort; the timer is cleared once it answers.
 */
export async function sendWithin(
  send: (request: Request) => Promise<Response>,
  request: Request,
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new DOMException(`no answer in ${ms} ms`, "TimeoutError"));
      reject(controller.signal.reason);
    }, ms);
  });
  try {
    return await Promise.race([send(new Request(request, { signal: controller.signal })), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** `promise`, or a rejection with `late()` once `ms` passed without an answer. */
export async function within<T>(promise: Promise<T>, ms: number, late: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(late()), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
