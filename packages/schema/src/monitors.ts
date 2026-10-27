// Monitors (RFC 0007): HTTP and TCP checks run by one `ProbeDO` per workspace and region, and heartbeats pushed by the
// monitored system. The workspace shard keeps each monitor's config and its last result per source; a monitor is
// down when a quorum of its sources is down, which fires one alert per monitor and opens an incident through
// `incident.declare`, run as the monitors' system actor (RFC 0003 "Alert → incident flow", RFC 0004).

import type { Actor } from "./mutation.ts";
import { ACCOUNT_ACTOR } from "./devices.ts";
import { idTime, isId } from "./id.ts";
import { declareIncident, ID_CLOCK_SKEW_MS, INCIDENT_TITLE_MAX } from "./incidents.ts";
import { SEVERITIES, type Severity } from "./lifecycle.ts";
import {
  defineMutation,
  defineRegistry,
  fail,
  ok,
  runMutation,
  type DomainEvent,
  type MutationContext,
  type MutationResult,
  type MutationStore,
} from "./mutation.ts";
import { MONITOR_PATTERN_MAX, patternProblem } from "./pattern.ts";
import { defineQuery } from "./query.ts";
import type {
  MonitorCheck,
  MonitorHeader,
  MonitorRow,
  StatusRange,
  WorkspaceRow,
} from "./tables.ts";
import { appendTimeline } from "./timeline.ts";
import { v, type Issue, type Validator } from "./validate.ts";

/**
 * The regions a monitor may check from: the Durable Object `locationHint`s whose objects spawn in their region
 * (spike S2). `sam`, `afr` and `me` are left out: Cloudflare places those objects in Miami, London and Warsaw, so a
 * "São Paulo" check would really run from Miami. Results carry the colo each check ran from.
 */
export const PROBE_REGIONS = ["wnam", "enam", "weur", "eeur", "apac", "oc"] as const;
export type ProbeRegion = (typeof PROBE_REGIONS)[number];
/** Where a result comes from: a probe region, or the heartbeat endpoint. */
export type CheckSource = ProbeRegion | "heartbeat";

export const MONITOR_KINDS = ["http", "tcp", "heartbeat"] as const;
/**
 * Monitors one workspace may have, of every kind together, unless the instance's operator sets another cap
 * (`MAX_MONITORS` in the API's env, passed as `ctx.limits.monitors`): with the per-monitor limits (one host and port,
 * one check per region every 30 s), what bounds how many targets a workspace can probe (RFC 0007 "Limits"). An owner
 * may set a lower cap for their workspace (`monitor.setCap`).
 */
export const MAX_MONITORS_PER_WORKSPACE = 100;
export type MonitorKind = (typeof MONITOR_KINDS)[number];
/**
 * `pending` until a quorum of sources agrees, after creation, a resume or a change of target. `unknown` ("no
 * data") when too few sources reported recently to tell (`monitorStatus`): never shown as up.
 */
export const MONITOR_STATUSES = ["pending", "up", "down", "unknown"] as const;
export type MonitorStatus = (typeof MONITOR_STATUSES)[number];
export const HTTP_METHODS = ["GET", "HEAD"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];
/** How an HTTP check's `keyword` is matched: plain text, or a pattern in the restricted syntax of `pattern.ts`. */
export const KEYWORD_MODES = ["text", "regex"] as const;
export type KeywordMode = (typeof KEYWORD_MODES)[number];
export const ALERT_STATUSES = ["firing", "resolved"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const MONITOR_NAME_MAX = 80;
export const MONITOR_URL_MAX = 2048;
/** A DNS name is at most 253 characters (RFC 1035). */
export const MONITOR_HOST_MAX = 253;
export const MONITOR_KEYWORD_MAX = MONITOR_PATTERN_MAX;
/** Request headers per HTTP check, and their sizes. */
export const MAX_MONITOR_HEADERS = 10;
export const MONITOR_HEADER_NAME_MAX = 64;
export const MONITOR_HEADER_VALUE_MAX = 512;
/** Status ranges per HTTP check. */
export const MAX_STATUS_RANGES = 10;
/** The most alike checks in a row a monitor may need before a region's verdict flips. */
export const MAX_CONSECUTIVE_CHECKS = 10;
/** RFC 0007: no check more often than every 30 s. */
export const MIN_INTERVAL_SECONDS = 30;
export const MAX_INTERVAL_SECONDS = 24 * 60 * 60;
export const MAX_TIMEOUT_SECONDS = 30;
export const MAX_GRACE_SECONDS = 24 * 60 * 60;
/** A probe region changes its verdict only after this many alike checks in a row (RFC 0007 "Quorum and flapping"). */
export const CONSECUTIVE_CHECKS = 2;
/**
 * A probe reports a source to the shard when its verdict changes, and otherwise at most this often, so the
 * dashboard's latency and colo stay fresh without a shard version per check. Heartbeats refresh alike.
 */
export const REPORT_EVERY_MS = 5 * 60 * 1000;
/** The severity of the incident a monitor opens, unless it names its own (`MonitorRow.severity`). */
export const MONITOR_INCIDENT_SEVERITY: Severity = "sev2";

/**
 * Who runs monitor reports and the incidents they open (RFC 0004 "Server-side writes"): a system actor that
 * carries a role like any other, here `admin` (manage monitors, declare incidents). Server-only mutations are
 * reachable only from the shard's own code, never from a socket, so the role grants a member nothing new.
 */
export const MONITOR_ACTOR: Actor = { kind: "system", id: "sys_monitors", role: "admin" };

/** Majority of the sources: 1 of 1, 2 of 2, 2 of 3, 3 of 4 … (RFC 0007's default, 2 of 3). */
export function quorum(sources: number): number {
  return Math.floor(sources / 2) + 1;
}

/**
 * At least this many of a monitor's sources must have reported recently for its status to be known: half of
 * them, rounded up. Below that, a majority of the fresh ones could be a single region speaking for three.
 */
export function freshFloor(sources: number): number {
  return Math.ceil(sources / 2);
}

/** The sources a monitor's results come from. */
export function monitorSources(monitor: Pick<MonitorRow, "kind" | "regions">): CheckSource[] {
  return monitor.kind === "heartbeat" ? ["heartbeat"] : [...monitor.regions];
}

/**
 * How old a source's result may be and still count (RFC 0007 "Quorum and flapping"): three intervals, and never
 * less than two refresh periods, since an unchanged verdict is reported only every `REPORT_EVERY_MS`. A
 * heartbeat's result never goes stale: the shard itself reports a missed ping once its deadline passes.
 */
export function staleAfterMs(monitor: Pick<MonitorRow, "kind" | "intervalSeconds">): number {
  if (monitor.kind === "heartbeat") return Number.POSITIVE_INFINITY;
  return Math.max(3 * monitor.intervalSeconds * 1000, 2 * REPORT_EVERY_MS);
}

/** Whether `check` still counts at `now`. */
export function isFresh(
  monitor: Pick<MonitorRow, "kind" | "intervalSeconds">,
  check: Pick<MonitorCheck, "at">,
  now: number,
): boolean {
  return now - check.at <= staleAfterMs(monitor);
}

/**
 * The regions that must agree for a monitor's status to change: its own `quorum` (K of its regions), or with none a
 * majority of the `fresh` results. A heartbeat has one source, which is always its quorum.
 */
export function neededAgreeing(
  monitor: Pick<MonitorRow, "kind" | "quorum">,
  fresh: number,
): number {
  if (monitor.kind === "heartbeat" || monitor.quorum == null) return quorum(fresh);
  return monitor.quorum;
}

/** Alike checks in a row before a region's verdict flips (the probe's streak rule): the monitor's own, or 2. */
export function consecutiveChecks(monitor: Pick<MonitorRow, "consecutiveChecks">): number {
  return monitor.consecutiveChecks ?? CONSECUTIVE_CHECKS;
}

/**
 * The monitor's status at `now` from its sources' results. Only fresh results count (`isFresh`), and at least
 * `freshFloor` sources must have one, and at least its `quorum` when it has one; otherwise the status is `unknown`
 * (or still `pending`, within the stale window after a restart). Among the fresh results it is down when the needed
 * number of them is down (`neededAgreeing`: a majority, or the monitor's quorum), up when that many are up and
 * fewer are down (recovery uses the same rule), and otherwise unchanged. With a quorum of at most half the regions
 * both can hold at once: down wins, so a monitor that pages on one region in three stays down while any is down.
 */
export function monitorStatus(
  monitor: Pick<
    MonitorRow,
    "kind" | "regions" | "intervalSeconds" | "status" | "restartedAt" | "quorum"
  >,
  checks: readonly MonitorCheck[],
  now: number,
): MonitorStatus {
  const sources = monitorSources(monitor);
  const fresh = checks.filter(
    (check) => sources.includes(check.source) && isFresh(monitor, check, now),
  );
  const own = monitor.kind === "heartbeat" ? 0 : (monitor.quorum ?? 0);
  if (fresh.length < Math.max(freshFloor(sources.length), own)) {
    const starting =
      monitor.status === "pending" && now - monitor.restartedAt <= staleAfterMs(monitor);
    return starting ? "pending" : "unknown";
  }
  const needed = neededAgreeing(monitor, fresh.length);
  if (fresh.filter((check) => !check.up).length >= needed) return "down";
  if (fresh.filter((check) => check.up).length >= needed) return "up";
  return monitor.status;
}

// ---- Targets (SSRF) --------------------------------------------------------------------------------------------

/** IPv4 ranges a check never targets: this network, private, shared, loopback, link-local, reserved, multicast. */
const BLOCKED_IPV4: readonly [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
];
/** Names that only resolve inside a network (or to this machine). */
const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet"];

const ipv4 = (address: string): number =>
  address.split(".").reduce((value, part) => value * 256 + Number(part), 0);

function blockedIpv4(address: string): boolean {
  return inIpv4Ranges(address, BLOCKED_IPV4);
}

function inIpv4Ranges(address: string, ranges: readonly [string, number][]): boolean {
  const value = ipv4(address);
  return ranges.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    return Math.floor(value / size) === Math.floor(ipv4(base) / size);
  });
}

/**
 * Only global unicast (2000::/3), minus documentation (2001:db8::/32 and 3fff::/20, RFC 9637), Teredo
 * (2001::/32), benchmarking (2001:2::/48), ORCHID (2001:10::/28) and ORCHIDv2 (2001:20::/28), and 6to4
 * (2002::/16), which can carry a private IPv4 address. Everything else (loopback, mapped IPv4, unique local,
 * link-local, multicast) is refused. The URL parser has already expanded `::`, so the first groups are in place.
 */
function blockedIpv6(address: string): boolean {
  const groups = expandIpv6(address);
  const [first = 0, second = 0, third = 0] = groups;
  if (first < 0x2000 || first > 0x3fff) return true;
  if (first === 0x2002) return true;
  if (first === 0x3fff) return (second & 0xf000) === 0;
  if (first !== 0x2001) return false;
  return (
    second === 0 ||
    second === 0xdb8 ||
    (second === 0x2 && third === 0) ||
    (second & 0xfff0) === 0x10 ||
    (second & 0xfff0) === 0x20
  );
}

/** The eight 16-bit groups of an IPv6 address (`::` filled with zeros). */
function expandIpv6(address: string): number[] {
  const [head = "", tail] = address.split("::");
  const parse = (part: string) =>
    part === "" ? [] : part.split(":").map((group) => Number.parseInt(group, 16) || 0);
  const start = parse(head);
  const end = tail === undefined ? [] : parse(tail);
  return [...start, ...Array<number>(Math.max(0, 8 - start.length - end.length)).fill(0), ...end];
}

/**
 * The ports a check may use (RFC 0007 "Targets"): the defaults, the common alternates 8080 and 8443, and the other
 * ports Cloudflare proxies HTTP(S) on. Not any port, so a monitor cannot be pointed at a mail, database or cache
 * port to learn from its error whether something listens there.
 */
export const MONITOR_PORTS: readonly number[] = [
  80, 443, 2052, 2053, 2082, 2083, 2086, 2087, 2095, 2096, 8080, 8443, 8880,
];

/** The WHATWG URL parser, as far as it is used here (src has no DOM or Node types). */
type ParsedUrl = {
  protocol: string;
  username: string;
  password: string;
  hostname: string;
  /** Empty for the scheme's default port. */
  port: string;
  href: string;
};
const URL_PARSER = (globalThis as unknown as { URL: new (input: string) => ParsedUrl }).URL;

/**
 * Why a check may not target `input`, or null if it may: only `http:`/`https:`, no credentials, a port from
 * `MONITOR_PORTS`, and no host that is private, loopback, link-local or local-only by name. The URL parser has already turned every IPv4 spelling
 * (`0x7f.1`, `2130706433`) into dotted decimal. A public name that resolves to a private address is not caught
 * here (Workers cannot resolve names); deployed Workers cannot reach private networks, and the probe checks the
 * URL again before every fetch and never follows redirects (RFC 0007).
 */
export function targetProblem(input: string): string | null {
  let url: ParsedUrl;
  try {
    url = new URL_PARSER(input);
  } catch {
    return "Expected a URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Expected an http or https URL";
  if (url.username || url.password) return "A URL with credentials cannot be checked";
  if (url.port !== "" && !MONITOR_PORTS.includes(Number(url.port))) {
    return `Expected port 80, 443 or one of ${MONITOR_PORTS.filter((p) => p !== 80 && p !== 443).join(", ")}`;
  }
  return hostProblem(url.hostname);
}

/**
 * Why a check may not target `hostname` (as the URL parser gives it: IPv4 in dotted decimal, IPv6 in brackets),
 * or null if it may: no private, loopback, link-local, shared, reserved or multicast address, and no local-only
 * name. The one host rule for every kind of check, HTTP (`targetProblem`) and TCP (`tcpTargetProblems`).
 */
function hostProblem(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[")) {
    return blockedIpv6(host.slice(1, -1)) ? "Expected a public address" : null;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return blockedIpv4(host) ? "Expected a public address" : null;
  }
  if (!host.includes(".") || LOCAL_SUFFIXES.some((suffix) => `.${host}`.endsWith(suffix))) {
    return "Expected a public host name";
  }
  return null;
}

/**
 * Ports a TCP check never connects to: 25, which Cloudflare refuses for every Worker (outbound SMTP), so a monitor
 * on it could only ever be down.
 */
export const TCP_BLOCKED_PORTS: readonly number[] = [25];

/**
 * Cloudflare's published IP ranges, https://www.cloudflare.com/ips/ (the lists at /ips-v4/ and /ips-v6/, as of
 * October 2026). A Worker's `connect()` is refused for every address in them
 * (https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/), so a TCP check of one of them, or of a
 * host proxied by Cloudflare, could only ever be down. Only literal addresses in these lists are refused on save:
 * a proxied name is not caught (Workers cannot resolve names), and the form's hint says so. HTTP checks may
 * target them.
 */
const CLOUDFLARE_IPV4: readonly [string, number][] = [
  ["173.245.48.0", 20],
  ["103.21.244.0", 22],
  ["103.22.200.0", 22],
  ["103.31.4.0", 22],
  ["141.101.64.0", 18],
  ["108.162.192.0", 18],
  ["190.93.240.0", 20],
  ["188.114.96.0", 20],
  ["197.234.240.0", 22],
  ["198.41.128.0", 17],
  ["162.158.0.0", 15],
  ["104.16.0.0", 13],
  ["104.24.0.0", 14],
  ["172.64.0.0", 13],
  ["131.0.72.0", 22],
];
/** The IPv6 half of the list above: the first two groups of each prefix and its length (at most 32). */
const CLOUDFLARE_IPV6: readonly [number, number, number][] = [
  [0x2400, 0xcb00, 32],
  [0x2606, 0x4700, 32],
  [0x2803, 0xf800, 32],
  [0x2405, 0xb500, 32],
  [0x2405, 0x8100, 32],
  [0x2a06, 0x98c0, 29],
  [0x2c0f, 0xf248, 32],
];

/** Whether `host` (as `normalizeTcpHost` gives it) is an address in Cloudflare's published ranges. */
export function isCloudflareAddress(host: string): boolean {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return inIpv4Ranges(host, CLOUDFLARE_IPV4);
  if (!host.includes(":")) return false;
  const [first = 0, second = 0] = expandIpv6(host);
  const top = first * 0x10000 + second;
  return CLOUDFLARE_IPV6.some(([a, b, bits]) => {
    const size = 2 ** (32 - bits);
    return Math.floor(top / size) === Math.floor((a * 0x10000 + b) / size);
  });
}

/**
 * `host` as a TCP check connects to it: lower case, an internationalised name in punycode (`bücher.example` is
 * `xn--bcher-kva.example`, as the URL parser turns it for an HTTP check), an IPv4 address in dotted decimal (any
 * spelling the URL parser takes), an IPv6 address without brackets. Undefined if it is not a bare host name or
 * address (a scheme, a port, a path, credentials, a percent escape or spaces are no host), or a name DNS cannot
 * look up (an empty label, a label over 63 characters or a name over 253, counted in punycode).
 */
export function normalizeTcpHost(host: string): string | undefined {
  const ipv6 = /^\[?([0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*)\]?$/.exec(host)?.[1];
  if (ipv6 === undefined && /[\s/\\?#@:%[\]]/.test(host)) return undefined;
  let url: ParsedUrl;
  try {
    url = new URL_PARSER(`http://${ipv6 === undefined ? host : `[${ipv6}]`}`);
  } catch {
    return undefined;
  }
  const hostname = url.hostname.replace(/\.$/, "");
  if (hostname.startsWith("[")) return hostname.slice(1, -1);
  // DNS limits, on the name as it is looked up (in punycode): 253 characters, labels of 1 to 63 (no `a..b`).
  const fits =
    hostname.length <= 253 &&
    hostname.split(".").every((label) => label.length >= 1 && label.length <= 63);
  return fits && /^[a-z0-9.-]+$/.test(hostname) ? hostname : undefined;
}

/**
 * Why a TCP check may not connect to `host` and `port`, one issue per field (none if it may): the host rules of HTTP checks
 * (`hostProblem`), no address of Cloudflare's own (`isCloudflareAddress`), and a port from 1 to 65535 other than
 * `TCP_BLOCKED_PORTS`. Unlike an HTTP check, any other port
 * is allowed, since whether something listens there is the whole answer (RFC 0007 "Check types"). Checked when a
 * monitor is saved and again by the probe before every connection.
 */
export function tcpTargetProblems(host: string, port: number): Issue[] {
  const issues: Issue[] = [];
  const hostname = normalizeTcpHost(host);
  const problem =
    hostname === undefined
      ? "Expected a host name or an IP address"
      : hostProblem(hostname.includes(":") ? `[${hostname}]` : hostname);
  if (problem !== null) issues.push({ path: "host", message: problem });
  else if (hostname !== undefined && isCloudflareAddress(hostname)) {
    issues.push({
      path: "host",
      message: "Cloudflare refuses TCP connections to its own addresses",
    });
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    issues.push({ path: "port", message: "Expected a port from 1 to 65535" });
  } else if (TCP_BLOCKED_PORTS.includes(port)) {
    issues.push({ path: "port", message: "Cloudflare blocks connections to this port" });
  }
  return issues;
}

/** A URL a check may target, normalised (`new URL(…).href`). */
const monitorUrl: Validator<string> = (input, path = "") => {
  const text = v.string({ min: 1, max: MONITOR_URL_MAX })(input, path);
  if (!text.ok) return text;
  const problem = targetProblem(text.value);
  return problem
    ? { ok: false, issues: [{ path, message: problem }] }
    : { ok: true, value: new URL_PARSER(text.value).href };
};

/** A host a TCP check may connect to, normalised (`normalizeTcpHost`); the port is checked with it. */
const tcpHost: Validator<string> = (input, path = "") => {
  const text = v.string({ min: 1, max: MONITOR_HOST_MAX })(input, path);
  if (!text.ok) return text;
  const host = normalizeTcpHost(text.value);
  return host === undefined
    ? { ok: false, issues: [{ path, message: "Expected a host name or an IP address" }] }
    : { ok: true, value: host };
};

/**
 * Request headers a check never sends (RFC 0007 "Check types"). `Host` would point the request at another site than
 * the URL names; `Authorization`, `Proxy-Authorization` and `Cookie`, and any name that reads like a credential, would
 * put a secret where every member, viewers too, can read it (headers are synced like the URL, never sealed). The rest
 * are the runtime's to set (`Content-Length`, `Connection`, …), `User-Agent` names Brigade to the site, and
 * `Forwarded`, `X-Forwarded-*`, `X-Real-IP` and `CF-*` would claim to be someone else.
 */
const BLOCKED_HEADERS = new Set([
  "host",
  "authorization",
  "proxy-authorization",
  "cookie",
  "connection",
  "content-length",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "keep-alive",
  "expect",
  "user-agent",
  "forwarded",
  "x-real-ip",
]);
const CREDENTIAL_HEADER = /auth|token|secret|passw|api-?key|session|cookie|credential/i;
/** A header name as HTTP defines it (a token). */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** A header value a Worker's `fetch` takes: printable ASCII (Latin-1 bytes outside it are refused by `Headers`). */
const HEADER_VALUE = /^[ -~]*$/;

/** Why an HTTP check may not send header `name` with `value`, or null if it may. Checked on save and by the probe. */
export function headerProblem(name: string, value: string): string | null {
  if (!HEADER_NAME.test(name)) return "Expected a header name: letters, digits and - _ .";
  const lower = name.toLowerCase();
  if (
    BLOCKED_HEADERS.has(lower) ||
    lower.startsWith("x-forwarded-") ||
    lower.startsWith("cf-") ||
    lower.startsWith("proxy-")
  ) {
    return "This header can't be set on a check";
  }
  if (CREDENTIAL_HEADER.test(lower)) {
    return "Headers are visible to every member: credentials can't go in them";
  }
  if (!HEADER_VALUE.test(value)) return "Expected printable ASCII";
  return null;
}

const monitorHeader: Validator<MonitorHeader> = (input, path = "") => {
  const shape = v.object({
    name: v.string({ min: 1, max: MONITOR_HEADER_NAME_MAX }),
    value: v.string({ min: 1, max: MONITOR_HEADER_VALUE_MAX }),
  })(input, path);
  if (!shape.ok) return shape;
  const problem = headerProblem(shape.value.name, shape.value.value);
  return problem
    ? { ok: false, issues: [{ path, message: problem }] }
    : { ok: true, value: shape.value };
};

const statusRange = v.object({
  min: v.integer({ min: 100, max: 599 }),
  max: v.integer({ min: 100, max: 599 }),
});

/** Whether `status` counts as up for a check expecting `ranges` (null: any 2xx or 3xx). */
export function statusExpected(status: number, ranges: readonly StatusRange[] | null): boolean {
  if (ranges === null || ranges.length === 0) return status >= 200 && status < 400;
  return ranges.some((range) => status >= range.min && status <= range.max);
}

/**
 * The statuses a monitor counts as up: its ranges, or (rows from before ranges) its one `expectedStatus`, or null for
 * any 2xx or 3xx.
 */
export function expectedStatuses(
  row: Pick<MonitorRow, "expectedStatus" | "expectedStatuses">,
): StatusRange[] | null {
  if (row.expectedStatuses != null && row.expectedStatuses.length > 0) return row.expectedStatuses;
  return row.expectedStatus == null ? null : [{ min: row.expectedStatus, max: row.expectedStatus }];
}

/** A SHA-256 digest in lower-case hex: the heartbeat token's hash, never the token. */
const sha256Hex: Validator<string> = (input, path = "") =>
  typeof input === "string" && /^[0-9a-f]{64}$/.test(input)
    ? { ok: true, value: input }
    : { ok: false, issues: [{ path, message: "Expected a SHA-256 digest in hex" }] };

// ---- Mutations -------------------------------------------------------------------------------------------------

export type MonitorCreated = DomainEvent<
  "monitor.created",
  Pick<MonitorRow, "id" | "name" | "kind"> & { policyId: string | null }
>;
/**
 * `policy_deleted`: the escalation policy the monitor named was deleted, so its incidents page through the default
 * again (`escalation.deletePolicy`); absent for an edit.
 */
export type MonitorUpdated = DomainEvent<
  "monitor.updated",
  Pick<MonitorRow, "id" | "name" | "kind"> & {
    policyId: string | null;
    reason?: "policy_deleted";
  }
>;
export type MonitorPaused = DomainEvent<"monitor.paused" | "monitor.resumed", { id: string }>;
export type MonitorDeleted = DomainEvent<"monitor.deleted", { id: string }>;
export type MonitorChecked = DomainEvent<"monitor.checked", MonitorCheck>;
export type MonitorStatusChanged = DomainEvent<
  "monitor.status_changed",
  { from: MonitorStatus; to: MonitorStatus }
>;
export type AlertFired = DomainEvent<
  "alert.fired",
  { id: string; fingerprint: string; monitorId: string; incidentId: string }
>;
export type AlertResolved = DomainEvent<
  "alert.resolved",
  { id: string; monitorId: string; reason: "recovered" | "paused" | "deleted" }
>;

const monitorId = v.id("mon");
const monitorName = v.string({ min: 1, max: MONITOR_NAME_MAX });
const intervalSeconds = v.integer({ min: MIN_INTERVAL_SECONDS, max: MAX_INTERVAL_SECONDS });
/**
 * The escalation policy the monitor's incidents page through; null: the workspace's default. Left out, a new monitor
 * takes the default and an edit keeps the monitor's (`policyOf`), so a client that does not know the field never
 * clears it. A named one must exist (`checkPolicy`).
 */
const monitorPolicy = v.omittable(v.nullable(v.id("esc")));

/**
 * Settings every kind may leave out: a new monitor takes the default, an edit keeps the monitor's (`kept`), so a client
 * that does not know a field never resets it.
 */
const alertingFields = {
  /** The severity of the incident it opens. */
  severity: v.omittable(v.picklist(SEVERITIES)),
};
/** HTTP and TCP: how many regions must agree (null: a majority), and alike checks in a row before a region flips. */
const quorumFields = {
  quorum: v.omittable(v.nullable(v.integer({ min: 1, max: PROBE_REGIONS.length }))),
  consecutiveChecks: v.omittable(v.nullable(v.integer({ min: 1, max: MAX_CONSECUTIVE_CHECKS }))),
};

const httpFields = {
  name: monitorName,
  url: monitorUrl,
  method: v.picklist(HTTP_METHODS),
  /** One status, as clients before ranges send it; left out or null, `expectedStatuses` says. */
  expectedStatus: v.omittable(v.nullable(v.integer({ min: 100, max: 599 }))),
  expectedStatuses: v.omittable(
    v.nullable(v.array(statusRange, { min: 1, max: MAX_STATUS_RANGES })),
  ),
  keyword: v.nullable(v.string({ min: 1, max: MONITOR_KEYWORD_MAX })),
  keywordMode: v.omittable(v.picklist(KEYWORD_MODES)),
  headers: v.omittable(v.array(monitorHeader, { max: MAX_MONITOR_HEADERS })),
  intervalSeconds,
  timeoutSeconds: v.integer({ min: 1, max: MAX_TIMEOUT_SECONDS }),
  regions: v.array(v.picklist(PROBE_REGIONS), { min: 1, max: PROBE_REGIONS.length, unique: true }),
  policyId: monitorPolicy,
  ...quorumFields,
  ...alertingFields,
};
const tcpFields = {
  name: monitorName,
  host: tcpHost,
  port: v.integer({ min: 1, max: 65535 }),
  intervalSeconds,
  timeoutSeconds: v.integer({ min: 1, max: MAX_TIMEOUT_SECONDS }),
  regions: v.array(v.picklist(PROBE_REGIONS), { min: 1, max: PROBE_REGIONS.length, unique: true }),
  policyId: monitorPolicy,
  ...quorumFields,
  ...alertingFields,
};
const heartbeatFields = {
  name: monitorName,
  intervalSeconds,
  graceSeconds: v.integer({ min: 0, max: MAX_GRACE_SECONDS }),
  policyId: monitorPolicy,
  ...alertingFields,
};

/** The optional settings as a monitor has them, defaults filled in: what a left-out field keeps. */
type Settings = {
  keywordMode: KeywordMode;
  expectedStatuses: StatusRange[] | null;
  headers: MonitorHeader[];
  quorum: number | null;
  consecutiveChecks: number | null;
  severity: Severity;
};

const DEFAULT_SETTINGS: Settings = {
  keywordMode: "text",
  expectedStatuses: null,
  headers: [],
  quorum: null,
  consecutiveChecks: null,
  severity: MONITOR_INCIDENT_SEVERITY,
};

/** `row`'s optional settings, defaults filled in (rows from before them have none). */
export function monitorSettings(row: MonitorRow): Settings {
  return {
    keywordMode: row.keywordMode ?? "text",
    expectedStatuses: expectedStatuses(row),
    headers: row.headers ?? [],
    quorum: row.quorum ?? null,
    consecutiveChecks: row.consecutiveChecks ?? null,
    severity: row.severity ?? MONITOR_INCIDENT_SEVERITY,
  };
}

/** What a left-out field leaves: the monitor's own (`current`). */
const kept = <T>(value: T | undefined, current: T): T => (value === undefined ? current : value);

type HttpFields = {
  name: string;
  url: string;
  method: HttpMethod;
  expectedStatus?: number | null;
  expectedStatuses?: StatusRange[] | null;
  keyword: string | null;
  keywordMode?: KeywordMode;
  headers?: MonitorHeader[];
  intervalSeconds: number;
  timeoutSeconds: number;
  regions: ProbeRegion[];
  quorum?: number | null;
  consecutiveChecks?: number | null;
  severity?: Severity;
};

/**
 * Cross-field rules the validators cannot express, and the settings the monitor ends up with (`current`: the edited
 * monitor's, or the defaults); the regions come back in `PROBE_REGIONS` order.
 */
function checkHttp(
  args: HttpFields,
  current: Settings,
): { issues: Issue[]; regions: ProbeRegion[]; settings: Settings } {
  const issues: Issue[] = [];
  const settings = settingsOf(args, current);
  if (args.method === "HEAD" && args.keyword !== null) {
    issues.push({ path: "keyword", message: "A HEAD response has no body to search" });
  }
  if (args.keyword !== null && settings.keywordMode === "regex") {
    const problem = patternProblem(args.keyword);
    if (problem) issues.push({ path: "keyword", message: problem });
  }
  if (args.expectedStatus != null && args.expectedStatuses != null) {
    issues.push({
      path: "expectedStatuses",
      message: "Expected either expectedStatus or expectedStatuses",
    });
  }
  args.expectedStatuses?.forEach((range, index) => {
    if (range.min > range.max) {
      issues.push({ path: `expectedStatuses[${index}]`, message: "Range out of order" });
    }
  });
  const names = settings.headers.map((header) => header.name.toLowerCase());
  names.forEach((name, index) => {
    if (names.indexOf(name) !== index) {
      issues.push({ path: `headers[${index}]`, message: "Listed twice" });
    }
  });
  issues.push(...checkProbed(args, settings));
  return {
    issues,
    regions: PROBE_REGIONS.filter((region) => args.regions.includes(region)),
    settings,
  };
}

/** The settings `args` leave a monitor with: given ones replace `current`'s. */
function settingsOf(args: Partial<HttpFields>, current: Settings): Settings {
  // One status (a client from before ranges) is a range of one; with neither given, the monitor keeps its own.
  const statuses =
    args.expectedStatuses !== undefined
      ? args.expectedStatuses
      : args.expectedStatus !== undefined
        ? args.expectedStatus === null
          ? null
          : [{ min: args.expectedStatus, max: args.expectedStatus }]
        : current.expectedStatuses;
  return {
    keywordMode: kept(args.keywordMode, current.keywordMode),
    expectedStatuses: statuses,
    headers: kept(args.headers, current.headers),
    quorum: kept(args.quorum, current.quorum),
    consecutiveChecks: kept(args.consecutiveChecks, current.consecutiveChecks),
    severity: kept(args.severity, current.severity),
  };
}

/** The rules HTTP and TCP checks share: a timeout within the interval, a quorum within the regions. */
function checkProbed(
  args: { intervalSeconds: number; timeoutSeconds: number; regions: ProbeRegion[] },
  settings: Pick<Settings, "quorum">,
): Issue[] {
  const issues: Issue[] = [];
  if (args.timeoutSeconds > args.intervalSeconds) {
    issues.push({ path: "timeoutSeconds", message: "Expected at most the interval" });
  }
  if (settings.quorum !== null && settings.quorum > new Set(args.regions).size) {
    issues.push({ path: "quorum", message: "Expected at most the number of regions" });
  }
  return issues;
}

type TcpFields = {
  host: string;
  port: number;
  intervalSeconds: number;
  timeoutSeconds: number;
  regions: ProbeRegion[];
  quorum?: number | null;
  consecutiveChecks?: number | null;
  severity?: Severity;
};

/**
 * The target rules (`tcpTargetProblems`), the timeout and the quorum, and the settings the monitor ends up with; the
 * regions come back in `PROBE_REGIONS` order.
 */
function checkTcp(
  args: TcpFields,
  current: Settings,
): { issues: Issue[]; regions: ProbeRegion[]; settings: Settings } {
  const settings = settingsOf(args, current);
  const issues = [...tcpTargetProblems(args.host, args.port), ...checkProbed(args, settings)];
  return {
    issues,
    regions: PROBE_REGIONS.filter((region) => args.regions.includes(region)),
    settings,
  };
}

/** The fields a monitor row stores for `settings` (HTTP only: what it matches and sends). */
function httpColumns(settings: Settings) {
  return {
    expectedStatus: null,
    expectedStatuses: settings.expectedStatuses,
    keywordMode: settings.keywordMode,
    headers: settings.headers,
  };
}

/** The fields every probed monitor stores for `settings`. */
function probedColumns(settings: Settings) {
  return { quorum: settings.quorum, consecutiveChecks: settings.consecutiveChecks };
}

function checkNewId(id: string, ctx: MutationContext): MutationResult | undefined {
  if (ctx.server && idTime(id) - ctx.now > ID_CLOCK_SKEW_MS) {
    return fail("invalid_args", "Monitor id time is ahead of the server clock", [
      { path: "id", message: "Id time is too far in the future" },
    ]);
  }
  return undefined;
}

/** A named policy must exist in the shard (`invalid_args` on `policyId` otherwise); left out or null is the default. */
function checkPolicy(store: MutationStore, policyId: string | null | undefined): Issue[] {
  if (policyId == null || store.get("escalation_policies", policyId)) return [];
  return [{ path: "policyId", message: "Escalation policy not found" }];
}

/** The policy an edit leaves the monitor on: the one it names, or (left out) the one it had. */
const policyOf = (monitor: MonitorRow, policyId: string | null | undefined): string | null =>
  policyId === undefined ? (monitor.policyId ?? null) : policyId;

/** The instance's cap (`ctx.limits.monitors`); a client, which does not know it, leaves the check to the shard. */
function instanceCap(ctx: MutationContext): number {
  return (
    ctx.limits?.monitors ?? (ctx.server ? MAX_MONITORS_PER_WORKSPACE : Number.POSITIVE_INFINITY)
  );
}

/**
 * The most monitors a workspace may have: its owner's cap (`monitor.setCap`) when it is lower than the instance's
 * (`instance`: `MAX_MONITORS` in the API's env, or `MAX_MONITORS_PER_WORKSPACE`), else the instance's. A cap set
 * before the operator lowered the instance's counts as the instance's.
 */
export function monitorCap(
  workspace: Pick<WorkspaceRow, "monitorCap"> | undefined,
  instance: number,
): number {
  const own = workspace?.monitorCap;
  return own == null ? instance : Math.min(own, instance);
}

/** `limit_reached` when the workspace has as many monitors as `monitorCap` allows. */
function checkCap(store: MutationStore, ctx: MutationContext): MutationResult | undefined {
  const [workspace] = store.scan("workspace");
  const cap = monitorCap(workspace, instanceCap(ctx));
  if (store.scan("monitors").length < cap) return undefined;
  return fail("limit_reached", `At most ${cap} monitors in this workspace`);
}

function created(row: MonitorRow): MonitorCreated {
  return {
    type: "monitor.created",
    subject: row.id,
    data: { id: row.id, name: row.name, kind: row.kind, policyId: row.policyId ?? null },
  };
}

function updated(row: MonitorRow, reason?: "policy_deleted"): MonitorUpdated {
  return {
    type: "monitor.updated",
    subject: row.id,
    data: {
      id: row.id,
      name: row.name,
      kind: row.kind,
      policyId: row.policyId ?? null,
      ...(reason && { reason }),
    },
  };
}

/**
 * Takes a deleted escalation policy off every monitor that named it, in the transaction that deleted it: their
 * incidents page through the workspace's default again (RFC 0003 "Escalation policies"), never through nothing.
 */
export function dropPolicyFromMonitors(
  store: MutationStore,
  policyId: string,
  ctx: MutationContext,
): DomainEvent[] {
  const events: DomainEvent[] = [];
  for (const monitor of store.scan("monitors")) {
    if (monitor.policyId !== policyId) continue;
    const row = store.update("monitors", monitor.id, { policyId: null, updatedAt: ctx.now });
    events.push(updated(row, "policy_deleted"));
  }
  return events;
}

const fresh = (ctx: MutationContext) => ({
  paused: false,
  pausedBy: null,
  pausedAt: null,
  status: "pending" as const,
  since: ctx.now,
  restartedAt: ctx.now,
  checks: [],
  alertId: null,
  incidentId: null,
  createdAt: ctx.now,
  createdBy: ctx.actor.id,
  updatedAt: ctx.now,
});

export const createHttpMonitor = defineMutation({
  name: "monitor.createHttp",
  args: v.object({ id: monitorId, ...httpFields }),
  permission: "monitor:manage",
  apply(store, args, ctx) {
    const clock = checkNewId(args.id, ctx);
    if (clock) return clock;
    const { issues, regions, settings } = checkHttp(args, DEFAULT_SETTINGS);
    issues.push(...checkPolicy(store, args.policyId));
    if (issues.length)
      return fail("invalid_args", "Invalid arguments for monitor.createHttp", issues);
    if (store.get("monitors", args.id)) return fail("conflict", "Monitor already exists");
    const full = checkCap(store, ctx);
    if (full) return full;
    const row: MonitorRow = {
      id: args.id,
      name: args.name,
      kind: "http",
      url: args.url,
      method: args.method,
      keyword: args.keyword,
      ...httpColumns(settings),
      host: null,
      port: null,
      timeoutSeconds: args.timeoutSeconds,
      regions,
      intervalSeconds: args.intervalSeconds,
      graceSeconds: null,
      policyId: args.policyId ?? null,
      ...probedColumns(settings),
      severity: settings.severity,
      ...fresh(ctx),
    };
    store.insert("monitors", row);
    return ok(created(row));
  },
});

/** A TCP check: a monitor is up where a connection to `host` and `port` opens within the timeout (RFC 0007). */
export const createTcpMonitor = defineMutation({
  name: "monitor.createTcp",
  args: v.object({ id: monitorId, ...tcpFields }),
  permission: "monitor:manage",
  apply(store, args, ctx) {
    const clock = checkNewId(args.id, ctx);
    if (clock) return clock;
    const { issues, regions, settings } = checkTcp(args, DEFAULT_SETTINGS);
    issues.push(...checkPolicy(store, args.policyId));
    if (issues.length)
      return fail("invalid_args", "Invalid arguments for monitor.createTcp", issues);
    if (store.get("monitors", args.id)) return fail("conflict", "Monitor already exists");
    const full = checkCap(store, ctx);
    if (full) return full;
    const row: MonitorRow = {
      id: args.id,
      name: args.name,
      kind: "tcp",
      url: null,
      method: null,
      expectedStatus: null,
      keyword: null,
      host: args.host,
      port: args.port,
      timeoutSeconds: args.timeoutSeconds,
      regions,
      intervalSeconds: args.intervalSeconds,
      graceSeconds: null,
      policyId: args.policyId ?? null,
      ...probedColumns(settings),
      severity: settings.severity,
      ...fresh(ctx),
    };
    store.insert("monitors", row);
    return ok(created(row));
  },
});

/**
 * The client makes the token, shows it once and sends only its SHA-256: the shard can check a ping but never
 * shows the token to anyone (viewers read monitor rows too).
 */
export const createHeartbeatMonitor = defineMutation({
  name: "monitor.createHeartbeat",
  args: v.object({ id: monitorId, ...heartbeatFields, tokenHash: sha256Hex }),
  permission: "monitor:manage",
  apply(store, args, ctx) {
    const clock = checkNewId(args.id, ctx);
    if (clock) return clock;
    const issues = checkPolicy(store, args.policyId);
    if (issues.length) {
      return fail("invalid_args", "Invalid arguments for monitor.createHeartbeat", issues);
    }
    if (store.get("monitors", args.id)) return fail("conflict", "Monitor already exists");
    const full = checkCap(store, ctx);
    if (full) return full;
    const row: MonitorRow = {
      id: args.id,
      name: args.name,
      kind: "heartbeat",
      url: null,
      method: null,
      expectedStatus: null,
      keyword: null,
      host: null,
      port: null,
      timeoutSeconds: null,
      regions: [],
      intervalSeconds: args.intervalSeconds,
      graceSeconds: args.graceSeconds,
      policyId: args.policyId ?? null,
      severity: args.severity ?? MONITOR_INCIDENT_SEVERITY,
      ...fresh(ctx),
    };
    store.insert("monitors", row);
    // Server only: a client's optimistic store never holds the hash.
    if (ctx.server) {
      store.insert("heartbeats", { id: args.id, tokenHash: args.tokenHash, lastPingAt: null });
    }
    return ok(created(row));
  },
});

/**
 * A change to what is checked: the old results were about another check, so the monitor starts over. Results
 * from before `restartedAt` are refused from then on; `since` moves with every status change and is no guard.
 */
const restart = (
  ctx: MutationContext,
): Pick<MonitorRow, "status" | "checks" | "since" | "restartedAt"> => ({
  status: "pending",
  checks: [],
  since: ctx.now,
  restartedAt: ctx.now,
});

/**
 * Fields an edit may change without starting the checks over: none of them is what is checked. A new quorum applies
 * from the next evaluation (the shard's alarm runs `monitor.evaluate` within a minute when it changes the status); a
 * new streak length reaches the probes with the next push, which starts each region's streak over but keeps the
 * results the shard has.
 */
const UNTARGETED: readonly string[] = [
  "name",
  "intervalSeconds",
  "policyId",
  "quorum",
  "consecutiveChecks",
  "severity",
];

/**
 * The keys of `next` whose values differ from `monitor`'s, comparing settings with their defaults filled in, so a row
 * from before a setting and an edit that sends its default are alike.
 */
function changedKeys<T extends Record<string, unknown>>(monitor: MonitorRow, next: T): (keyof T)[] {
  const current: Record<string, unknown> = { ...monitor, ...monitorSettings(monitor) };
  return (Object.keys(next) as (keyof T)[]).filter(
    (key) => JSON.stringify(current[key as string] ?? null) !== JSON.stringify(next[key] ?? null),
  );
}

export const updateHttpMonitor = defineMutation({
  name: "monitor.updateHttp",
  args: v.object({ id: monitorId, ...httpFields }),
  permission: "monitor:manage",
  apply(store, args, ctx) {
    const monitor = store.get("monitors", args.id);
    if (!monitor) return fail("not_found", "Monitor not found");
    if (monitor.kind !== "http") return fail("invalid_args", "Not an HTTP monitor");
    const { issues, regions, settings } = checkHttp(args, monitorSettings(monitor));
    issues.push(...checkPolicy(store, args.policyId));
    if (issues.length)
      return fail("invalid_args", "Invalid arguments for monitor.updateHttp", issues);
    const next = {
      name: args.name,
      url: args.url,
      method: args.method,
      keyword: args.keyword,
      intervalSeconds: args.intervalSeconds,
      timeoutSeconds: args.timeoutSeconds,
      regions,
      policyId: policyOf(monitor, args.policyId),
      ...settings,
    };
    const changed = changedKeys(monitor, next);
    if (changed.length === 0) return fail("conflict", "Nothing to change");
    const retarget = changed.some((key) => !UNTARGETED.includes(key));
    const restarted = retarget && !monitor.paused ? restart(ctx) : {};
    // The statuses are rewritten only when they changed: a row from before ranges keeps its `expectedStatus`, so its
    // probes' config (and their streaks) stay as they were.
    const { expectedStatuses: _statuses, ...rest } = next;
    const statuses = changed.includes("expectedStatuses") ? httpColumns(settings) : {};
    const row = store.update("monitors", args.id, {
      ...rest,
      ...statuses,
      ...restarted,
      updatedAt: ctx.now,
    });
    return ok(updated(row));
  },
});

/** As `monitor.updateHttp`: a new host, port, timeout or region set starts the checks over. */
export const updateTcpMonitor = defineMutation({
  name: "monitor.updateTcp",
  args: v.object({ id: monitorId, ...tcpFields }),
  permission: "monitor:manage",
  apply(store, args, ctx) {
    const monitor = store.get("monitors", args.id);
    if (!monitor) return fail("not_found", "Monitor not found");
    if (monitor.kind !== "tcp") return fail("invalid_args", "Not a TCP monitor");
    const { issues, regions, settings } = checkTcp(args, monitorSettings(monitor));
    issues.push(...checkPolicy(store, args.policyId));
    if (issues.length)
      return fail("invalid_args", "Invalid arguments for monitor.updateTcp", issues);
    const next = {
      name: args.name,
      host: args.host,
      port: args.port,
      intervalSeconds: args.intervalSeconds,
      timeoutSeconds: args.timeoutSeconds,
      regions,
      policyId: policyOf(monitor, args.policyId),
      ...probedColumns(settings),
      severity: settings.severity,
    };
    const changed = changedKeys(monitor, next);
    if (changed.length === 0) return fail("conflict", "Nothing to change");
    const retarget = changed.some((key) => !UNTARGETED.includes(key));
    const restarted = retarget && !monitor.paused ? restart(ctx) : {};
    const row = store.update("monitors", args.id, { ...next, ...restarted, updatedAt: ctx.now });
    return ok(updated(row));
  },
});

export const updateHeartbeatMonitor = defineMutation({
  name: "monitor.updateHeartbeat",
  args: v.object({ id: monitorId, ...heartbeatFields }),
  permission: "monitor:manage",
  apply(store, args, ctx) {
    const monitor = store.get("monitors", args.id);
    if (!monitor) return fail("not_found", "Monitor not found");
    if (monitor.kind !== "heartbeat") return fail("invalid_args", "Not a heartbeat monitor");
    const issues = checkPolicy(store, args.policyId);
    if (issues.length) {
      return fail("invalid_args", "Invalid arguments for monitor.updateHeartbeat", issues);
    }
    const next = {
      name: args.name,
      intervalSeconds: args.intervalSeconds,
      graceSeconds: args.graceSeconds,
      policyId: policyOf(monitor, args.policyId),
      severity: kept(args.severity, monitorSettings(monitor).severity),
    };
    if (changedKeys(monitor, next).length === 0) return fail("conflict", "Nothing to change");
    const row = store.update("monitors", args.id, { ...next, updatedAt: ctx.now });
    return ok(updated(row));
  },
});

export type HeartbeatRotated = DomainEvent<"monitor.heartbeat_rotated", { id: string }>;

/**
 * A new URL for a heartbeat: as at create, the client makes the token, shows it once and sends only its SHA-256.
 * The old hash is replaced at once, so the old URL is refused from the next ping. The monitor starts over like a
 * changed target (RFC 0007 "Rotating a heartbeat URL"): `pending`, its last result dropped, and a full interval plus
 * grace from now before a missed ping counts, so whatever pinged the old URL going quiet does not page while the new
 * one is being set up. A firing alert stays until the new URL is pinged. A paused monitor only gets the new hash; resuming
 * starts it over anyway.
 */
export const rotateHeartbeat = defineMutation({
  name: "monitor.rotateHeartbeat",
  args: v.object({ id: monitorId, tokenHash: sha256Hex }),
  permission: "monitor:manage",
  apply(store, args, ctx) {
    const monitor = store.get("monitors", args.id);
    if (!monitor) return fail("not_found", "Monitor not found");
    if (monitor.kind !== "heartbeat") return fail("invalid_args", "Not a heartbeat monitor");
    // Server only, like at create: a client's optimistic store never holds the hash.
    if (ctx.server) {
      const heartbeat = store.get("heartbeats", args.id);
      if (heartbeat?.tokenHash === args.tokenHash) return fail("conflict", "Nothing to change");
      const row = { id: args.id, tokenHash: args.tokenHash, lastPingAt: null };
      if (heartbeat) store.update("heartbeats", args.id, row);
      else store.insert("heartbeats", row);
    }
    store.update("monitors", args.id, {
      ...(monitor.paused ? {} : restart(ctx)),
      updatedAt: ctx.now,
    });
    const event: HeartbeatRotated = {
      type: "monitor.heartbeat_rotated",
      subject: args.id,
      data: { id: args.id },
    };
    return ok(event);
  },
});

/**
 * Resolves the monitor's firing alert, if any. The incident it opened stays for people to close; its timeline
 * says why the alert ended (the monitor recovered, or someone paused or deleted it).
 */
function resolveAlert(
  store: MutationStore,
  monitor: MonitorRow,
  reason: AlertResolved["data"]["reason"],
  ctx: MutationContext,
): AlertResolved[] {
  if (monitor.alertId === null) return [];
  const alert = store.get("alerts", monitor.alertId);
  if (!alert || alert.status !== "firing") return [];
  store.update("alerts", alert.id, { status: "resolved", resolvedAt: ctx.now });
  const incident = alert.incidentId === null ? undefined : store.get("incidents", alert.incidentId);
  if (incident) {
    store.update("incidents", incident.id, { updatedAt: ctx.now });
    appendTimeline(
      store,
      incident,
      { kind: "alert_resolved", monitorId: monitor.id, monitor: monitor.name, reason },
      ctx,
    );
  }
  return [
    {
      type: "alert.resolved",
      subject: alert.id,
      data: { id: alert.id, monitorId: monitor.id, reason },
    },
  ];
}

/**
 * Pausing stops the checks and resolves a firing alert (nobody should stay paged for a monitor turned off), and
 * records who paused it and when; resuming starts over from `pending`.
 */
export const setMonitorPaused = defineMutation({
  name: "monitor.setPaused",
  args: v.object({ id: monitorId, paused: v.boolean() }),
  permission: "monitor:manage",
  apply(store, args, ctx) {
    const monitor = store.get("monitors", args.id);
    if (!monitor) return fail("not_found", "Monitor not found");
    if (monitor.paused === args.paused) {
      return fail("conflict", args.paused ? "Already paused" : "Not paused");
    }
    const resolved = args.paused ? resolveAlert(store, monitor, "paused", ctx) : [];
    store.update("monitors", args.id, {
      paused: args.paused,
      pausedBy: args.paused ? ctx.actor.id : null,
      pausedAt: args.paused ? ctx.now : null,
      ...restart(ctx),
      alertId: null,
      incidentId: null,
      updatedAt: ctx.now,
    });
    const event: MonitorPaused = {
      type: args.paused ? "monitor.paused" : "monitor.resumed",
      subject: args.id,
      data: { id: args.id },
    };
    return ok(event, ...resolved);
  },
});

export type HeartbeatRevoked = DomainEvent<"monitor.heartbeat_revoked", { id: string }>;

/**
 * Server only, as `ACCOUNT_ACTOR`: after the owner of an address took back an account someone else signed up with
 * (a password reset of an unverified account, RFC 0002 "Auth"), in a workspace where that account is the only member.
 * Whoever signed up could still page the owner through what they set up: a heartbeat whose URL they kept, or an HTTP
 * or TCP check on a host they control. So every monitor is paused (as `monitor.setPaused` would, firing alerts
 * resolved) and every heartbeat's hash becomes `tokenHash`, random bytes the shard made and nobody holds a token
 * for. The owner resumes what they want to keep and gives a heartbeat a new URL (`monitor.rotateHeartbeat`). Nothing to
 * change is a `conflict`.
 */
export const takeOverMonitors = defineMutation({
  name: "monitor.takeOver",
  args: v.object({ tokenHash: sha256Hex }),
  permission: "monitor:manage",
  apply(store, args, ctx) {
    if (ctx.actor.kind !== ACCOUNT_ACTOR.kind || ctx.actor.id !== ACCOUNT_ACTOR.id) {
      return fail("forbidden", "Only the server takes monitors over");
    }
    const events: DomainEvent[] = [];
    for (const monitor of store.scan("monitors")) {
      if (!monitor.paused) {
        const resolved = resolveAlert(store, monitor, "paused", ctx);
        store.update("monitors", monitor.id, {
          paused: true,
          pausedBy: ctx.actor.id,
          pausedAt: ctx.now,
          ...restart(ctx),
          alertId: null,
          incidentId: null,
          updatedAt: ctx.now,
        });
        const event: MonitorPaused = {
          type: "monitor.paused",
          subject: monitor.id,
          data: { id: monitor.id },
        };
        events.push(event, ...resolved);
      }
      const heartbeat =
        monitor.kind === "heartbeat" ? store.get("heartbeats", monitor.id) : undefined;
      if (heartbeat && heartbeat.tokenHash !== args.tokenHash) {
        store.update("heartbeats", monitor.id, { tokenHash: args.tokenHash });
        const event: HeartbeatRevoked = {
          type: "monitor.heartbeat_revoked",
          subject: monitor.id,
          data: { id: monitor.id },
        };
        events.push(event);
      }
    }
    if (events.length === 0) return fail("conflict", "Nothing to take over");
    return ok(...events);
  },
});

export const deleteMonitor = defineMutation({
  name: "monitor.delete",
  args: v.object({ id: monitorId }),
  permission: "monitor:manage",
  apply(store, args, ctx) {
    const monitor = store.get("monitors", args.id);
    if (!monitor) return fail("not_found", "Monitor not found");
    const resolved = resolveAlert(store, monitor, "deleted", ctx);
    store.delete("monitors", args.id);
    store.delete("heartbeats", args.id);
    // No status page uptime bar keeps pointing at it (RFC 0012 "Uptime").
    for (const component of store.scan("status_components")) {
      if (!component.monitorIds?.includes(args.id)) continue;
      store.update("status_components", component.id, {
        monitorIds: component.monitorIds.filter((id) => id !== args.id),
        updatedAt: ctx.now,
      });
    }
    const event: MonitorDeleted = {
      type: "monitor.deleted",
      subject: args.id,
      data: { id: args.id },
    };
    return ok(event, ...resolved);
  },
});

/** The highest cap an instance or a workspace may set: past it one shard's alarm and probes carry too much. */
export const MONITOR_CAP_MAX = 10_000;

export type MonitorCapChanged = DomainEvent<"monitor.cap_changed", { cap: number | null }>;

/**
 * The most monitors this workspace may have, set by an owner (RFC 0007 "Limits"): at most the instance's cap
 * (`MAX_MONITORS` in the API's env, by default `MAX_MONITORS_PER_WORKSPACE`), which only the server knows, so a client
 * leaves that check to it. Null goes back to the instance's cap. Lower than the monitors it has already: they keep
 * running, and no new one is added until enough are deleted. No change is a `conflict`.
 */
export const setMonitorCap = defineMutation({
  name: "monitor.setCap",
  args: v.object({ cap: v.nullable(v.integer({ min: 1, max: MONITOR_CAP_MAX })) }),
  permission: "workspace:manage",
  apply(store, args, ctx) {
    if (ctx.actor.role !== "owner") return fail("forbidden", "Only owners set the monitor cap");
    const [workspace] = store.scan("workspace");
    if (!workspace) return fail("not_found", "Workspace not found");
    const instance = instanceCap(ctx);
    if (args.cap !== null && args.cap > instance) {
      return fail("invalid_args", "Invalid arguments for monitor.setCap", [
        { path: "cap", message: `Expected at most ${instance}, this instance's cap` },
      ]);
    }
    if ((workspace.monitorCap ?? null) === args.cap) return fail("conflict", "Nothing to change");
    store.update("workspace", workspace.id, { monitorCap: args.cap });
    const event: MonitorCapChanged = {
      type: "monitor.cap_changed",
      subject: workspace.id,
      data: { cap: args.cap },
    };
    return ok(event);
  },
});

const declaring = defineRegistry([declareIncident]);

/** What the shard makes for a monitor that may open an incident: ids and the title (mutations make neither). */
const openArgs = v.object({
  alertId: v.id("alt"),
  incidentId: v.id("inc"),
  title: v.string({ min: 1, max: INCIDENT_TITLE_MAX }),
});
type OpenArgs = { alertId: string; incidentId: string; title: string };

/**
 * Moves `monitor` to `status` (a no-op when it already holds): `monitor.status_changed`, and the alert that goes
 * with it. Turning down fires one alert (none while one fires: deduplicated per monitor) and opens its incident
 * through `incident.declare`, with RBAC, in this same transaction. Turning up resolves it. `unknown` leaves a
 * firing alert alone: no data is no recovery. Returns the events, or the failure that must roll everything back.
 */
function moveTo(
  store: MutationStore,
  monitor: MonitorRow,
  status: MonitorStatus,
  open: OpenArgs,
  ctx: MutationContext,
  patch: Partial<Omit<MonitorRow, "id">>,
): { events: DomainEvent[] } | { failed: MutationResult } {
  if (status === monitor.status) return { events: [] };
  const { id } = monitor;
  patch.status = status;
  patch.since = ctx.now;
  const events: DomainEvent[] = [
    {
      type: "monitor.status_changed",
      subject: id,
      data: { from: monitor.status, to: status },
    } satisfies MonitorStatusChanged,
  ];
  if (status === "down" && monitor.alertId === null) {
    // `runMutation` turns any exception into `internal`; a storage failure must reach the shard as one instead
    // (it rolls back and the probe retries), so it is caught here and thrown again.
    let thrown: { error: unknown } | undefined;
    const declared = runMutation(
      declaring,
      "incident.declare",
      {
        id: open.incidentId,
        title: open.title,
        severity: monitor.severity ?? MONITOR_INCIDENT_SEVERITY,
      },
      store,
      ctx,
      { onError: (error) => (thrown = { error }) },
    );
    if (thrown) throw thrown.error;
    // Without its incident the alert would page nobody: fail the report, and the probe sends it again.
    if (!declared.ok) return { failed: declared };
    store.insert("alerts", {
      id: open.alertId,
      fingerprint: `monitor:${id}`,
      monitorId: id,
      status: "firing",
      firedAt: ctx.now,
      resolvedAt: null,
      incidentId: open.incidentId,
    });
    patch.alertId = open.alertId;
    patch.incidentId = open.incidentId;
    // The incident first: a consumer that sees the alert can already find what it points at.
    events.push(...declared.events, {
      type: "alert.fired",
      subject: open.alertId,
      data: {
        id: open.alertId,
        fingerprint: `monitor:${id}`,
        monitorId: id,
        incidentId: open.incidentId,
      },
    } satisfies AlertFired);
  } else if (status === "up") {
    events.push(...resolveAlert(store, monitor, "recovered", ctx));
    patch.alertId = null;
    patch.incidentId = null;
  }
  return { events };
}

/**
 * Server only: one source's verdict, from a probe or the heartbeat endpoint, run as `MONITOR_ACTOR`; the status
 * follows `monitorStatus` and `moveTo` raises or resolves the alert. The ids and the title come from the shard in
 * `open`, since mutations make no randomness and render no text. The incident is left for people to resolve, with
 * a note on its timeline when the monitor recovers.
 *
 * `monitor.checked` is emitted only when the source's verdict or failure reason changed: the probe re-sends an
 * unchanged verdict every `REPORT_EVERY_MS` so latency, colo and the check time stay fresh on the dashboard, and
 * those refreshes are synced but are not domain events (`silent`), so they never reach the outbox.
 */
/** How far ahead of the shard's clock a probe's check time may be (Cloudflare clocks agree far closer). */
export const REPORT_CLOCK_SKEW_MS = 60_000;

export const reportMonitorCheck = defineMutation({
  name: "monitor.report",
  args: v.object({
    id: monitorId,
    source: v.picklist([...PROBE_REGIONS, "heartbeat"] as const),
    at: v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    up: v.boolean(),
    latencyMs: v.nullable(v.integer({ min: 0, max: 10 * 60 * 1000 })),
    colo: v.nullable(v.string({ min: 1, max: 8 })),
    httpStatus: v.nullable(v.integer({ min: 100, max: 599 })),
    error: v.nullable(v.string({ min: 1, max: 32 })),
    open: openArgs,
  }),
  permission: "monitor:manage",
  silent: true,
  apply(store, args, ctx) {
    const monitor = store.get("monitors", args.id);
    if (!monitor) return fail("not_found", "Monitor not found");
    if (monitor.paused) return fail("conflict", "Monitor is paused");
    const sources = monitorSources(monitor);
    if (!sources.includes(args.source)) return fail("conflict", "Not one of the monitor's sources");
    // Probes stamp `at` when their check starts; one from the future (a skewed clock, a bug) would win every
    // later comparison below and freeze this region's result.
    if (args.at > ctx.now + REPORT_CLOCK_SKEW_MS)
      return fail("invalid_args", "Check time is in the future");
    const previous = monitor.checks.find((check) => check.source === args.source);
    // A late report (a retry overtaken by a newer one) must not undo what the newer one said.
    if (previous && previous.at > args.at) return fail("conflict", "A newer result is recorded");
    // Only a restart (create, a new target, resume) cuts results off: a report computed before another region
    // flipped the status, and delivered after, still counts.
    if (args.at < monitor.restartedAt) {
      return fail("conflict", "Reported before the monitor restarted");
    }

    const { open, id, ...result } = args;
    // An up verdict can carry the error of a single failed check that did not flip it: that is no reason, and is
    // neither stored nor sent.
    const check: MonitorCheck = { ...result, error: result.up ? null : result.error };
    const checks = [...monitor.checks.filter((c) => c.source !== args.source), check].sort(
      (a, b) => sources.indexOf(a.source) - sources.indexOf(b.source),
    );
    const events: DomainEvent[] = [];
    const reason = (c: MonitorCheck) => (c.up ? null : c.error);
    if (!previous || previous.up !== check.up || reason(previous) !== reason(check)) {
      events.push({
        type: "monitor.checked",
        subject: id,
        data: { ...check, error: reason(check) },
      } satisfies MonitorChecked);
    }
    const patch: Partial<Omit<MonitorRow, "id">> = { checks, updatedAt: ctx.now };
    const moved = moveTo(store, monitor, monitorStatus(monitor, checks, ctx.now), open, ctx, patch);
    if ("failed" in moved) return moved.failed;
    store.update("monitors", id, patch);
    return ok(...events, ...moved.events);
  },
});

/**
 * Server only: the status again at `ctx.now` with no new result, run by the shard's alarm when results went
 * stale (`monitorStatus`): a monitor whose probes stopped reporting turns `unknown` instead of staying up. A
 * `conflict` when the status holds, so nothing is written.
 */
export const evaluateMonitor = defineMutation({
  name: "monitor.evaluate",
  args: v.object({ id: monitorId, open: openArgs }),
  permission: "monitor:manage",
  apply(store, args, ctx) {
    const monitor = store.get("monitors", args.id);
    if (!monitor) return fail("not_found", "Monitor not found");
    if (monitor.paused) return fail("conflict", "Monitor is paused");
    const status = monitorStatus(monitor, monitor.checks, ctx.now);
    if (status === monitor.status) return fail("conflict", "The status holds");
    const patch: Partial<Omit<MonitorRow, "id">> = { updatedAt: ctx.now };
    const moved = moveTo(store, monitor, status, args.open, ctx, patch);
    if ("failed" in moved) return moved.failed;
    store.update("monitors", args.id, patch);
    return ok(...moved.events);
  },
});

// ---- Queries ---------------------------------------------------------------------------------------------------

/**
 * Whether a monitor needs someone: down, or still holding a firing alert (a down monitor whose probes went
 * silent is `unknown`, and its alert and incident stay until it reports up again).
 */
export function monitorAlerting(row: Pick<MonitorRow, "paused" | "status" | "alertId">): boolean {
  return !row.paused && (row.alertId !== null || row.status === "down");
}

/** Alerting first, then by name and id (code point order, the same on every replica). */
const downFirst = (a: MonitorRow, b: MonitorRow) =>
  Number(monitorAlerting(b)) - Number(monitorAlerting(a)) ||
  (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const allMonitors = defineQuery({
  name: "monitors.all",
  args: v.object({}),
  permission: "monitor:read",
  table: "monitors",
  filter: () => true,
  sort: downFirst,
});

/**
 * The workspace's own row, for its monitor cap (`monitorCap`): the dashboard says how many monitors it may still add,
 * and an owner changes it there. Every member reads it, like the monitors.
 */
export const monitorCapQuery = defineQuery({
  name: "monitors.cap",
  args: v.object({}),
  permission: "monitor:read",
  table: "workspace",
  filter: () => true,
});

/** What members may send. */
export const monitorMutations = [
  createHttpMonitor,
  createTcpMonitor,
  createHeartbeatMonitor,
  updateHttpMonitor,
  updateTcpMonitor,
  updateHeartbeatMonitor,
  rotateHeartbeat,
  setMonitorPaused,
  deleteMonitor,
  setMonitorCap,
] as const;

// ---- Heartbeat tokens ------------------------------------------------------------------------------------------

/** 32 random bytes in base64url: 256 bits, so a token cannot be guessed. */
const HEARTBEAT_SECRET = /^[A-Za-z0-9_-]{43}$/;

/** A new heartbeat secret from 32 random bytes, in base64url without padding. */
export function newHeartbeatSecret(random: (length: number) => Uint8Array): string {
  const bytes = random(32);
  if (bytes.length < 32) throw new RangeError("Need 32 random bytes");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for (let i = 0; i < 32; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = i + 2 < 32 ? 4 : 3; // 32 = 10 × 3 + 2: the last group has two bytes, three characters.
    for (let c = 0; c < chars; c++) out += alphabet[(n >> (18 - 6 * c)) & 63];
  }
  return out;
}

/**
 * The token in a heartbeat URL (`POST /heartbeat/<token>`): `<workspace id>.<monitor id>.<secret>`. The ids route
 * the ping to the shard and the monitor; only the secret's SHA-256 is stored.
 */
export function heartbeatToken(workspaceId: string, monitorId: string, secret: string): string {
  return `${workspaceId}.${monitorId}.${secret}`;
}

/** The parts of a heartbeat token, or undefined if it is not shaped like one (the workspace id is the caller's). */
export function parseHeartbeatToken(
  token: string,
): { workspaceId: string; monitorId: string; secret: string } | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const [workspaceId, monitorId, secret] = parts;
  if (!workspaceId || !isId("mon", monitorId) || !HEARTBEAT_SECRET.test(secret)) return undefined;
  return { workspaceId, monitorId, secret };
}
