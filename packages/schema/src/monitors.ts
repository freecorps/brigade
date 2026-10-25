// Monitors (RFC 0007): HTTP checks run by one `ProbeDO` per workspace and region, and heartbeats pushed by the
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

export const MONITOR_KINDS = ["http", "heartbeat"] as const;
export type MonitorKind = (typeof MONITOR_KINDS)[number];
/** `pending` until a quorum of sources agrees, after creation, a resume or a change of target. */
export const MONITOR_STATUSES = ["pending", "up", "down"] as const;
export type MonitorStatus = (typeof MONITOR_STATUSES)[number];
export const HTTP_METHODS = ["GET", "HEAD"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];
export const ALERT_STATUSES = ["firing", "resolved"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const MONITOR_NAME_MAX = 80;
export const MONITOR_URL_MAX = 2048;
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

/** The sources a monitor's results come from. */
export function monitorSources(monitor: Pick<MonitorRow, "kind" | "regions">): CheckSource[] {
  return monitor.kind === "heartbeat" ? ["heartbeat"] : [...monitor.regions];
}

/**
 * The monitor's status from its sources' verdicts: down when a quorum is down, up when a quorum is up (recovery
 * uses the same rule), otherwise unchanged.
 */
export function quorumStatus(
  sources: readonly CheckSource[],
  checks: readonly MonitorCheck[],
  current: MonitorStatus,
): MonitorStatus {
  const needed = quorum(sources.length);
  const counted = checks.filter((check) => sources.includes(check.source));
  if (counted.filter((check) => !check.up).length >= needed) return "down";
  if (counted.filter((check) => check.up).length >= needed) return "up";
  return current;
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
 * Only global unicast (2000::/3), minus documentation (2001:db8::/32), Teredo (2001::/32) and 6to4 (2002::/16),
 * which can carry a private IPv4 address. Everything else (loopback, mapped IPv4, unique local, link-local,
 * multicast) is refused.
 */
function blockedIpv6(address: string): boolean {
  const groups = address.split(":");
  const first = Number.parseInt(groups[0] || "0", 16);
  const second = Number.parseInt(groups[1] || "0", 16);
  if (first < 0x2000 || first > 0x3fff) return true;
  if (first === 0x2002) return true;
  return first === 0x2001 && (second === 0 || second === 0xdb8);
}

/** The WHATWG URL parser, as far as it is used here (src has no DOM or Node types). */
type ParsedUrl = {
  protocol: string;
  username: string;
  password: string;
  hostname: string;
  href: string;
};
const URL_PARSER = (globalThis as unknown as { URL: new (input: string) => ParsedUrl }).URL;

/**
 * Why a check may not target `input`, or null if it may: only `http:`/`https:`, no credentials, and no host that
 * is private, loopback, link-local or local-only by name. The URL parser has already turned every IPv4 spelling
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
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
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
  status: "pending" as const,
  since: ctx.now,
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

/** A change to what is checked: the old results were about another check, so the monitor starts over. */
const RESTART: Pick<MonitorRow, "status" | "checks"> = { status: "pending", checks: [] };

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
    const restart = retarget && !monitor.paused ? { ...RESTART, since: ctx.now } : {};
    store.update("monitors", args.id, { ...next, ...restart, updatedAt: ctx.now });
    const event: MonitorUpdated = {
      type: "monitor.updated",
      subject: args.id,
      data: { id: args.id, name: args.name, kind: "http" },
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

/** Resolves the monitor's firing alert, if any; the incident it opened stays for people to close. */
function resolveAlert(
  store: MutationStore,
  monitor: MonitorRow,
  reason: AlertResolved["data"]["reason"],
  now: number,
): AlertResolved[] {
  if (monitor.alertId === null) return [];
  const alert = store.get("alerts", monitor.alertId);
  if (!alert || alert.status !== "firing") return [];
  store.update("alerts", alert.id, { status: "resolved", resolvedAt: now });
  return [
    {
      type: "alert.resolved",
      subject: alert.id,
      data: { id: alert.id, monitorId: monitor.id, reason },
    },
  ];
}

/**
 * Pausing stops the checks and resolves a firing alert (nobody should stay paged for a monitor turned off);
 * resuming starts over from `pending`.
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
    const resolved = args.paused ? resolveAlert(store, monitor, "paused", ctx.now) : [];
    store.update("monitors", args.id, {
      paused: args.paused,
      ...RESTART,
      since: ctx.now,
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
    const resolved = resolveAlert(store, monitor, "deleted", ctx.now);
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

/**
 * Server only: one source's verdict, from a probe or the heartbeat endpoint, run as `MONITOR_ACTOR`. When the
 * monitor turns down it fires one alert (none while one is firing: deduplicated per monitor) and opens an incident
 * through `incident.declare`, with RBAC, in this same transaction: the ids and the title come from the shard in
 * `open`, since mutations make no randomness and render no text. When it turns up again the alert resolves; the
 * incident is left for people to resolve (the incident model has no timeline yet).
 */
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
    open: v.object({
      alertId: v.id("alt"),
      incidentId: v.id("inc"),
      title: v.string({ min: 1, max: INCIDENT_TITLE_MAX }),
    }),
  }),
  permission: "monitor:manage",
  apply(store, args, ctx) {
    const monitor = store.get("monitors", args.id);
    if (!monitor) return fail("not_found", "Monitor not found");
    if (monitor.paused) return fail("conflict", "Monitor is paused");
    const sources = monitorSources(monitor);
    if (!sources.includes(args.source)) return fail("conflict", "Not one of the monitor's sources");
    const previous = monitor.checks.find((check) => check.source === args.source);
    // A late report (a retry overtaken by a newer one) must not undo what the newer one said.
    if (previous && previous.at > args.at) return fail("conflict", "A newer result is recorded");
    if (args.at < monitor.since) return fail("conflict", "Reported before the monitor restarted");

    const { open, id, ...result } = args;
    const check: MonitorCheck = result;
    const checks = [...monitor.checks.filter((c) => c.source !== args.source), check].sort(
      (a, b) => sources.indexOf(a.source) - sources.indexOf(b.source),
    );
    const status = quorumStatus(sources, checks, monitor.status);
    const events: DomainEvent[] = [
      { type: "monitor.checked", subject: id, data: check } satisfies MonitorChecked,
    ];
    const patch: Partial<Omit<MonitorRow, "id">> = { checks };
    if (status !== monitor.status) {
      patch.status = status;
      patch.since = ctx.now;
      events.push({
        type: "monitor.status_changed",
        subject: id,
        data: { from: monitor.status, to: status },
      } satisfies MonitorStatusChanged);
      if (status === "down" && monitor.alertId === null) {
        const declared = runMutation(
          declaring,
          "incident.declare",
          { id: open.incidentId, title: open.title, severity: MONITOR_INCIDENT_SEVERITY },
          store,
          ctx,
        );
        // Without its incident the alert would page nobody: fail the report, and the probe sends it again.
        if (!declared.ok) return declared;
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
        events.push(
          {
            type: "alert.fired",
            subject: open.alertId,
            data: {
              id: open.alertId,
              fingerprint: `monitor:${id}`,
              monitorId: id,
              incidentId: open.incidentId,
            },
          } satisfies AlertFired,
          ...declared.events,
        );
      } else if (status === "up") {
        events.push(...resolveAlert(store, monitor, "recovered", ctx.now));
        patch.alertId = null;
        patch.incidentId = null;
      }
    }
    store.update("monitors", id, patch);
    return ok(...events);
  },
});

// ---- Queries ---------------------------------------------------------------------------------------------------

/** Down first, then by name and id (code point order, the same on every replica). */
const downFirst = (a: MonitorRow, b: MonitorRow) =>
  Number(b.status === "down" && !b.paused) - Number(a.status === "down" && !a.paused) ||
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
  createHeartbeatMonitor,
  updateHttpMonitor,
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
