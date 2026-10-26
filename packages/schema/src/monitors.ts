// Monitors (RFC 0007): HTTP and TCP checks run by one `ProbeDO` per workspace and region, and heartbeats pushed by the
// monitored system. The workspace shard keeps each monitor's config and its last result per source; a monitor is
// down when a quorum of its sources is down, which fires one alert per monitor and opens an incident through
// `incident.declare`, run as the monitors' system actor (RFC 0003 "Alert → incident flow", RFC 0004).

import type { Actor } from "./mutation.ts";
import { idTime, isId } from "./id.ts";
import { declareIncident, ID_CLOCK_SKEW_MS, INCIDENT_TITLE_MAX } from "./incidents.ts";
import type { Severity } from "./lifecycle.ts";
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
import { defineQuery } from "./query.ts";
import type { MonitorCheck, MonitorRow } from "./tables.ts";
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
export type MonitorKind = (typeof MONITOR_KINDS)[number];
/**
 * `pending` until a quorum of sources agrees, after creation, a resume or a change of target. `unknown` ("no
 * data") when too few sources reported recently to tell (`monitorStatus`): never shown as up.
 */
export const MONITOR_STATUSES = ["pending", "up", "down", "unknown"] as const;
export type MonitorStatus = (typeof MONITOR_STATUSES)[number];
export const HTTP_METHODS = ["GET", "HEAD"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];
export const ALERT_STATUSES = ["firing", "resolved"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const MONITOR_NAME_MAX = 80;
export const MONITOR_URL_MAX = 2048;
/** A DNS name is at most 253 characters (RFC 1035). */
export const MONITOR_HOST_MAX = 253;
export const MONITOR_KEYWORD_MAX = 200;
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
/** The severity of the incident a monitor opens. */
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
 * The monitor's status at `now` from its sources' results. Only fresh results count (`isFresh`), and at least
 * `freshFloor` sources must have one; otherwise the status is `unknown` (or still `pending`, within the stale
 * window after a restart). Among the fresh results it is down when a majority of them is down, up when a majority
 * is up (recovery uses the same rule), and otherwise unchanged.
 */
export function monitorStatus(
  monitor: Pick<MonitorRow, "kind" | "regions" | "intervalSeconds" | "status" | "restartedAt">,
  checks: readonly MonitorCheck[],
  now: number,
): MonitorStatus {
  const sources = monitorSources(monitor);
  const fresh = checks.filter(
    (check) => sources.includes(check.source) && isFresh(monitor, check, now),
  );
  if (fresh.length < freshFloor(sources.length)) {
    const starting =
      monitor.status === "pending" && now - monitor.restartedAt <= staleAfterMs(monitor);
    return starting ? "pending" : "unknown";
  }
  const needed = quorum(fresh.length);
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
  const value = ipv4(address);
  return BLOCKED_IPV4.some(([base, bits]) => {
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
 * name. The one host rule for every kind of check, HTTP (`targetProblem`) and TCP (`tcpTargetProblem`).
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
 * `host` as a TCP check connects to it: lower case, an IPv4 address in dotted decimal (any spelling the URL parser
 * takes), an IPv6 address without brackets. Undefined if it is not a bare host name or address (a scheme, a port,
 * a path, credentials or spaces are no host).
 */
export function normalizeTcpHost(host: string): string | undefined {
  const ipv6 = /^\[?([0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*)\]?$/.exec(host)?.[1];
  if (ipv6 === undefined && !/^[A-Za-z0-9.-]+$/.test(host)) return undefined;
  let url: ParsedUrl;
  try {
    url = new URL_PARSER(`http://${ipv6 === undefined ? host : `[${ipv6}]`}`);
  } catch {
    return undefined;
  }
  const hostname = url.hostname.replace(/\.$/, "");
  if (hostname === "") return undefined;
  return hostname.startsWith("[") ? hostname.slice(1, -1) : hostname.toLowerCase();
}

/**
 * Why a TCP check may not connect to `host` and `port`, or null if it may: the host rules of HTTP checks
 * (`hostProblem`) and a port from 1 to 65535 other than `TCP_BLOCKED_PORTS`. Unlike an HTTP check, any other port
 * is allowed, since whether something listens there is the whole answer (RFC 0007 "Check types"). Checked when a
 * monitor is saved and again by the probe before every connection.
 */
export function tcpTargetProblem(host: string, port: number): Issue | null {
  const hostname = normalizeTcpHost(host);
  if (hostname === undefined) return { path: "host", message: "Expected a host name or an IP address" };
  const problem = hostProblem(hostname.includes(":") ? `[${hostname}]` : hostname);
  if (problem !== null) return { path: "host", message: problem };
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { path: "port", message: "Expected a port from 1 to 65535" };
  }
  if (TCP_BLOCKED_PORTS.includes(port)) {
    return { path: "port", message: "Cloudflare blocks connections to this port" };
  }
  return null;
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

/** A SHA-256 digest in lower-case hex: the heartbeat token's hash, never the token. */
/** A host a TCP check may connect to, normalised (`normalizeTcpHost`); the port is checked with it. */
const tcpHost: Validator<string> = (input, path = "") => {
  const text = v.string({ min: 1, max: MONITOR_HOST_MAX })(input, path);
  if (!text.ok) return text;
  const host = normalizeTcpHost(text.value);
  return host === undefined
    ? { ok: false, issues: [{ path, message: "Expected a host name or an IP address" }] }
    : { ok: true, value: host };
};

const sha256Hex: Validator<string> = (input, path = "") =>
  typeof input === "string" && /^[0-9a-f]{64}$/.test(input)
    ? { ok: true, value: input }
    : { ok: false, issues: [{ path, message: "Expected a SHA-256 digest in hex" }] };

// ---- Mutations -------------------------------------------------------------------------------------------------

export type MonitorCreated = DomainEvent<
  "monitor.created",
  Pick<MonitorRow, "id" | "name" | "kind">
>;
export type MonitorUpdated = DomainEvent<
  "monitor.updated",
  Pick<MonitorRow, "id" | "name" | "kind">
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

const httpFields = {
  name: monitorName,
  url: monitorUrl,
  method: v.picklist(HTTP_METHODS),
  expectedStatus: v.nullable(v.integer({ min: 100, max: 599 })),
  keyword: v.nullable(v.string({ min: 1, max: MONITOR_KEYWORD_MAX })),
  intervalSeconds,
  timeoutSeconds: v.integer({ min: 1, max: MAX_TIMEOUT_SECONDS }),
  regions: v.array(v.picklist(PROBE_REGIONS), { min: 1, max: PROBE_REGIONS.length, unique: true }),
};
const tcpFields = {
  name: monitorName,
  host: tcpHost,
  port: v.integer({ min: 1, max: 65535 }),
  intervalSeconds,
  timeoutSeconds: v.integer({ min: 1, max: MAX_TIMEOUT_SECONDS }),
  regions: v.array(v.picklist(PROBE_REGIONS), { min: 1, max: PROBE_REGIONS.length, unique: true }),
};
const heartbeatFields = {
  name: monitorName,
  intervalSeconds,
  graceSeconds: v.integer({ min: 0, max: MAX_GRACE_SECONDS }),
};

type HttpFields = {
  name: string;
  url: string;
  method: HttpMethod;
  expectedStatus: number | null;
  keyword: string | null;
  intervalSeconds: number;
  timeoutSeconds: number;
  regions: ProbeRegion[];
};

/** Cross-field rules the validators cannot express; the regions come back in `PROBE_REGIONS` order. */
function checkHttp(args: HttpFields): { issues: Issue[]; regions: ProbeRegion[] } {
  const issues: Issue[] = [];
  if (args.method === "HEAD" && args.keyword !== null) {
    issues.push({ path: "keyword", message: "A HEAD response has no body to search" });
  }
  if (args.timeoutSeconds > args.intervalSeconds) {
    issues.push({ path: "timeoutSeconds", message: "Expected at most the interval" });
  }
  return { issues, regions: PROBE_REGIONS.filter((region) => args.regions.includes(region)) };
}

type TcpFields = {
  host: string;
  port: number;
  intervalSeconds: number;
  timeoutSeconds: number;
  regions: ProbeRegion[];
};

/** The target rules (`tcpTargetProblem`) and the timeout; the regions come back in `PROBE_REGIONS` order. */
function checkTcp(args: TcpFields): { issues: Issue[]; regions: ProbeRegion[] } {
  const issues: Issue[] = [];
  const problem = tcpTargetProblem(args.host, args.port);
  if (problem !== null) issues.push(problem);
  if (args.timeoutSeconds > args.intervalSeconds) {
    issues.push({ path: "timeoutSeconds", message: "Expected at most the interval" });
  }
  return { issues, regions: PROBE_REGIONS.filter((region) => args.regions.includes(region)) };
}

function checkNewId(id: string, ctx: MutationContext): MutationResult | undefined {
  if (ctx.server && idTime(id) - ctx.now > ID_CLOCK_SKEW_MS) {
    return fail("invalid_args", "Monitor id time is ahead of the server clock", [
      { path: "id", message: "Id time is too far in the future" },
    ]);
  }
  return undefined;
}

function created(row: MonitorRow): MonitorCreated {
  return {
    type: "monitor.created",
    subject: row.id,
    data: { id: row.id, name: row.name, kind: row.kind },
  };
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
    const { issues, regions } = checkHttp(args);
    if (issues.length)
      return fail("invalid_args", "Invalid arguments for monitor.createHttp", issues);
    if (store.get("monitors", args.id)) return fail("conflict", "Monitor already exists");
    const row: MonitorRow = {
      id: args.id,
      name: args.name,
      kind: "http",
      url: args.url,
      method: args.method,
      expectedStatus: args.expectedStatus,
      keyword: args.keyword,
      host: null,
      port: null,
      timeoutSeconds: args.timeoutSeconds,
      regions,
      intervalSeconds: args.intervalSeconds,
      graceSeconds: null,
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
    const { issues, regions } = checkTcp(args);
    if (issues.length) return fail("invalid_args", "Invalid arguments for monitor.createTcp", issues);
    if (store.get("monitors", args.id)) return fail("conflict", "Monitor already exists");
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
    if (store.get("monitors", args.id)) return fail("conflict", "Monitor already exists");
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

export const updateHttpMonitor = defineMutation({
  name: "monitor.updateHttp",
  args: v.object({ id: monitorId, ...httpFields }),
  permission: "monitor:manage",
  apply(store, args, ctx) {
    const monitor = store.get("monitors", args.id);
    if (!monitor) return fail("not_found", "Monitor not found");
    if (monitor.kind !== "http") return fail("invalid_args", "Not an HTTP monitor");
    const { issues, regions } = checkHttp(args);
    if (issues.length)
      return fail("invalid_args", "Invalid arguments for monitor.updateHttp", issues);
    const next = {
      name: args.name,
      url: args.url,
      method: args.method,
      expectedStatus: args.expectedStatus,
      keyword: args.keyword,
      intervalSeconds: args.intervalSeconds,
      timeoutSeconds: args.timeoutSeconds,
      regions,
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
      (key) => JSON.stringify(monitor[key]) !== JSON.stringify(next[key]),
    );
    if (changed.length === 0) return fail("conflict", "Nothing to change");
    const retarget = changed.some((key) => key !== "name" && key !== "intervalSeconds");
    const restarted = retarget && !monitor.paused ? restart(ctx) : {};
    store.update("monitors", args.id, { ...next, ...restarted, updatedAt: ctx.now });
    const event: MonitorUpdated = {
      type: "monitor.updated",
      subject: args.id,
      data: { id: args.id, name: args.name, kind: "http" },
    };
    return ok(event);
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
    const { issues, regions } = checkTcp(args);
    if (issues.length) return fail("invalid_args", "Invalid arguments for monitor.updateTcp", issues);
    const next = {
      name: args.name,
      host: args.host,
      port: args.port,
      intervalSeconds: args.intervalSeconds,
      timeoutSeconds: args.timeoutSeconds,
      regions,
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
      (key) => JSON.stringify(monitor[key]) !== JSON.stringify(next[key]),
    );
    if (changed.length === 0) return fail("conflict", "Nothing to change");
    const retarget = changed.some((key) => key !== "name" && key !== "intervalSeconds");
    const restarted = retarget && !monitor.paused ? restart(ctx) : {};
    store.update("monitors", args.id, { ...next, ...restarted, updatedAt: ctx.now });
    const event: MonitorUpdated = {
      type: "monitor.updated",
      subject: args.id,
      data: { id: args.id, name: args.name, kind: "tcp" },
    };
    return ok(event);
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
    if (
      monitor.name === args.name &&
      monitor.intervalSeconds === args.intervalSeconds &&
      monitor.graceSeconds === args.graceSeconds
    ) {
      return fail("conflict", "Nothing to change");
    }
    store.update("monitors", args.id, {
      name: args.name,
      intervalSeconds: args.intervalSeconds,
      graceSeconds: args.graceSeconds,
      updatedAt: ctx.now,
    });
    const event: MonitorUpdated = {
      type: "monitor.updated",
      subject: args.id,
      data: { id: args.id, name: args.name, kind: "heartbeat" },
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
    const event: MonitorDeleted = {
      type: "monitor.deleted",
      subject: args.id,
      data: { id: args.id },
    };
    return ok(event, ...resolved);
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
      { id: open.incidentId, title: open.title, severity: MONITOR_INCIDENT_SEVERITY },
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

/** What members may send. */
export const monitorMutations = [
  createHttpMonitor,
  createTcpMonitor,
  createHeartbeatMonitor,
  updateHttpMonitor,
  updateTcpMonitor,
  updateHeartbeatMonitor,
  setMonitorPaused,
  deleteMonitor,
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
