// One HTTP or TCP check (RFC 0007 "Check types"). HTTP: status, latency and an optional keyword, with the target
// rules of `targetProblem` applied again right before the request, no redirects followed and a bounded body read.
// TCP: whether a connection opens within the timeout, with `tcpTargetProblem` applied again first.

import { connect } from "cloudflare:sockets";
import { targetProblem, tcpTargetProblem, type HttpMethod } from "@freecorps/brigade-schema";

/** What a probe needs to run one monitor's check; pushed by the workspace shard. */
export type CheckConfig = HttpCheckConfig | TcpCheckConfig;

/** An HTTP check. Configs pushed before TCP checks existed carry no `kind`; they are HTTP. */
export type HttpCheckConfig = {
  kind?: "http";
  id: string;
  url: string;
  method: HttpMethod;
  expectedStatus: number | null;
  keyword: string | null;
  intervalSeconds: number;
  timeoutSeconds: number;
};

export type TcpCheckConfig = {
  kind: "tcp";
  id: string;
  host: string;
  port: number;
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

/** Opens a TCP connection: `connect` from `cloudflare:sockets`; the tests replace it. */
export type Connector = (address: SocketAddress) => Socket;

export const defaultConnector: Connector = (address) => connect(address);

/** Runs `config` with the probe's outbound fetch or socket. Never throws. */
export function runCheck(
  fetcher: typeof fetch,
  connector: Connector,
  config: CheckConfig,
): Promise<CheckResult> {
  return config.kind === "tcp" ? tcpCheck(connector, config) : httpCheck(fetcher, config);
}

/**
 * A TCP check: up when the connection opens within the timeout, and closed at once either way; nothing is sent
 * or read. The socket is closed on every path (opened, refused, timed out), and the timeout is the check's own
 * timer, so a connection that never answers cannot hold the probe past it. Every failed connection is `network`:
 * the runtime reports a refused port, a name that does not resolve and an address Cloudflare refuses (its own IP
 * ranges) with the same error ("proxy request failed"). Never throws.
 */
export async function tcpCheck(connector: Connector, config: TcpCheckConfig): Promise<CheckResult> {
  if (tcpTargetProblem(config.host, config.port) !== null) {
    return { ok: false, latencyMs: null, httpStatus: null, error: "blocked" };
  }
  const start = Date.now();
  let socket: Socket;
  try {
    socket = connector({ hostname: config.host, port: config.port });
  } catch {
    return { ok: false, latencyMs: null, httpStatus: null, error: "network" };
  }
  // Both promises reject on a failed connection; handled here, so a rejection after the timeout won the race is
  // never unhandled.
  socket.closed.catch(() => undefined);
  const opened = socket.opened.then(
    () => ({ opened: true as const }),
    () => ({ opened: false as const }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), config.timeoutSeconds * 1000);
  });
  try {
    const outcome = await Promise.race([opened, timedOut]);
    if (outcome === "timeout") {
      return { ok: false, latencyMs: null, httpStatus: null, error: "timeout" };
    }
    if (!outcome.opened) {
      return { ok: false, latencyMs: null, httpStatus: null, error: "network" };
    }
    return { ok: true, latencyMs: Math.max(0, Date.now() - start), httpStatus: null, error: null };
  } finally {
    clearTimeout(timer);
    // Not awaited: closing is forcible and the result does not depend on it.
    socket.close().catch(() => undefined);
  }
}

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
