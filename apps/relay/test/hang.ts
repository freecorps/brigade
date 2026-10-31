/** The requests `hang` holds, so a test's garbage collection cannot drop one (and its signal) before it aborts. */
const held = new Set<Request>();

/** A provider that never answers: it only gives up when the request's own signal aborts. */
export function hang(request: Request): Promise<Response> {
  held.add(request);
  return new Promise((_, reject) => {
    request.signal.addEventListener("abort", () => {
      held.delete(request);
      reject(request.signal.reason);
    });
  });
}
