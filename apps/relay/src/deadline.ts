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
