// One HTTP check (RFC 0007 "Check types"): status, latency and an optional keyword, with the target rules of
// `targetProblem` applied again right before the request, no redirects followed and a bounded body read.

import { targetProblem, type HttpMethod } from "@freecorps/brigade-schema";

/** What a probe needs to run one monitor's check; pushed by the workspace shard. */
export type HttpCheckConfig = {
  id: string;
  url: string;
  method: HttpMethod;
  expectedStatus: number | null;
  keyword: string | null;
  intervalSeconds: number;
  timeoutSeconds: number;
};

/** One check's outcome. `error` names why it failed; null when it passed. */
export type CheckResult = {
  ok: boolean;
  latencyMs: number | null;
  httpStatus: number | null;
  error: "blocked" | "timeout" | "network" | "status" | "keyword" | null;
};

/** At most this much of a body is searched for the keyword; the rest is never read. */
export const MAX_BODY_BYTES = 64 * 1024;
export const USER_AGENT = "Brigade-Monitor/1 (+https://github.com/freecorps/brigade)";

/** Never throws: every failure is a failed result. */
export async function httpCheck(
  fetcher: typeof fetch,
  config: HttpCheckConfig,
): Promise<CheckResult> {
  // The shard validated the URL when it was saved; checked again in case the rules got stricter since.
  if (targetProblem(config.url) !== null) {
    return { ok: false, latencyMs: null, httpStatus: null, error: "blocked" };
  }
  const signal = AbortSignal.timeout(config.timeoutSeconds * 1000);
  // Workers clocks advance only across I/O, which is exactly what is timed here.
  const start = Date.now();
  let response: Response;
  try {
    response = await fetcher(config.url, {
      method: config.method,
      // A redirect is the answer: following it could lead to a host the rules refuse.
      redirect: "manual",
      cache: "no-store",
      headers: { "User-Agent": USER_AGENT },
      signal,
    });
  } catch (error) {
    const timedOut = signal.aborted || (error instanceof Error && error.name === "TimeoutError");
    return {
      ok: false,
      latencyMs: null,
      httpStatus: null,
      error: timedOut ? "timeout" : "network",
    };
  }
  const latencyMs = Math.max(0, Date.now() - start);
  const httpStatus = response.status;
  const expected =
    config.expectedStatus === null
      ? httpStatus >= 200 && httpStatus < 400
      : httpStatus === config.expectedStatus;
  if (!expected || config.keyword === null) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: expected, latencyMs, httpStatus, error: expected ? null : "status" };
  }
  let found: boolean;
  try {
    found = (await readPrefix(response, MAX_BODY_BYTES)).includes(config.keyword);
  } catch {
    // The body stopped (or the timeout hit) mid-read.
    return { ok: false, latencyMs, httpStatus, error: signal.aborted ? "timeout" : "network" };
  }
  return { ok: found, latencyMs, httpStatus, error: found ? null : "keyword" };
}

/** The first `max` bytes of the body as text; the rest is cancelled unread. */
export async function readPrefix(response: Response, max: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let length = 0;
  while (length < max) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    const chunk = value.byteLength > max - length ? value.subarray(0, max - length) : value;
    length += chunk.byteLength;
    text += decoder.decode(chunk, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  return text + decoder.decode();
}

/**
 * A Cloudflare-proxied page whose `/cdn-cgi/trace` names the colo the subrequest entered from: where this probe
 * really runs (spike S2; Cloudflare has no API that tells an object where it is).
 */
export const TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace";

/** The colo this object's subrequests leave from, or null if the trace did not say. Never throws. */
export async function observedColo(fetcher: typeof fetch): Promise<string | null> {
  try {
    const response = await fetcher(TRACE_URL, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const body = await readPrefix(response, 4096);
    const colo =
      /^colo=([A-Z]{3})$/m.exec(body)?.[1] ?? response.headers.get("cf-ray")?.split("-").at(-1);
    return colo && /^[A-Z]{3}$/.test(colo) ? colo : null;
  } catch {
    return null;
  }
}
