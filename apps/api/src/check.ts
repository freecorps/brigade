// One HTTP or TCP check (RFC 0007 "Check types"). HTTP: status (one, or ranges), latency, optional request headers and
// an optional keyword or pattern (matched by `pattern.ts`, never `RegExp`), with the target and header rules applied
// again right before the request, no redirects followed and a bounded body read.
// TCP: whether a connection opens within the timeout, with `tcpTargetProblems` applied again first.

import { connect } from "cloudflare:sockets";
import {
  compilePattern,
  headerProblem,
  matchPattern,
  statusExpected,
  targetProblem,
  tcpTargetProblems,
  type HttpMethod,
  type MonitorHeader,
  type StatusRange,
} from "@freecorps/brigade-schema";

/** What a probe needs to run one monitor's check; pushed by the workspace shard. */
export type CheckConfig = HttpCheckConfig | TcpCheckConfig;

/** An HTTP check. Configs pushed before TCP checks existed carry no `kind`; they are HTTP. */
export type HttpCheckConfig = {
  kind?: "http";
  id: string;
  url: string;
  method: HttpMethod;
  /** One status; null with no `expectedStatuses`: any 2xx or 3xx. */
  expectedStatus: number | null;
  /** Ranges of statuses that count as up, when more than one status does. */
  expectedStatuses?: StatusRange[];
  keyword: string | null;
  /** Absent: `keyword` is plain text. */
  keywordMode?: "regex";
  headers?: MonitorHeader[];
  intervalSeconds: number;
  timeoutSeconds: number;
  /** Alike checks in a row before the region's verdict flips; absent: `CONSECUTIVE_CHECKS`. */
  consecutiveChecks?: number;
};

export type TcpCheckConfig = {
  kind: "tcp";
  id: string;
  host: string;
  port: number;
  intervalSeconds: number;
  timeoutSeconds: number;
  consecutiveChecks?: number;
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
 * timer, so a connection that never answers cannot hold the probe past it. A connection that fails is `network`
 * (the runtime gives one error, "proxy request failed", for a refused port, a name that does not resolve and an
 * address Cloudflare refuses); one that gets no answer is `timeout`. So a result tells a closed port from a
 * filtered one, which operators need; the workspace's monitor cap bounds what that reveals (RFC 0007). Never throws.
 */
export async function tcpCheck(connector: Connector, config: TcpCheckConfig): Promise<CheckResult> {
  if (tcpTargetProblems(config.host, config.port).length > 0) {
    return { ok: false, latencyMs: null, httpStatus: null, error: "blocked" };
  }
  const start = Date.now();
  let socket: Socket;
  try {
    // An IPv6 address is stored bare (`normalizeTcpHost`); `connect()` takes it only in brackets, and fails a bare
    // one as it fails a refused port (test/monitors.test.ts, RFC 0007).
    const hostname = config.host.includes(":") ? `[${config.host}]` : config.host;
    socket = connector({ hostname, port: config.port });
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
  // The shard validated the URL and headers when they were saved; checked again in case the rules got stricter since.
  const headers = config.headers ?? [];
  if (
    targetProblem(config.url) !== null ||
    headers.some((header) => headerProblem(header.name, header.value) !== null)
  ) {
    return { ok: false, latencyMs: null, httpStatus: null, error: "blocked" };
  }
  const pattern =
    config.keyword !== null && config.keywordMode === "regex"
      ? compilePattern(config.keyword)
      : undefined;
  // A pattern the rules no longer take cannot match: the check fails as a missing keyword would, and says so.
  if (pattern && !pattern.ok) {
    return { ok: false, latencyMs: null, httpStatus: null, error: "keyword" };
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
      // The monitor's own first, so none can replace the user agent (`headerProblem` refuses it anyway).
      headers: [
        ...headers.map((header) => [header.name, header.value]),
        ["User-Agent", USER_AGENT],
      ],
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
  const expected = statusExpected(
    httpStatus,
    config.expectedStatuses ??
      (config.expectedStatus === null
        ? null
        : [{ min: config.expectedStatus, max: config.expectedStatus }]),
  );
  if (!expected || config.keyword === null) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: expected, latencyMs, httpStatus, error: expected ? null : "status" };
  }
  let found: boolean;
  try {
    const body = await readPrefix(response, MAX_BODY_BYTES);
    found = pattern?.ok ? matchPattern(pattern.pattern, body) : body.includes(config.keyword);
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
