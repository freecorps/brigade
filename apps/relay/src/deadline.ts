/** `send(request)`, aborted after `ms` with a `TimeoutError`; the timer is cleared once it answers. */
export async function sendWithin(
  send: (request: Request) => Promise<Response>,
  request: Request,
  ms: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException(`no answer in ${ms} ms`, "TimeoutError")),
    ms,
  );
  try {
    return await send(new Request(request, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}
