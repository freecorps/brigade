// Pure helpers for the Monitors card: how a monitor reads, how the create form turns into a mutation's args (checked
// with the mutation's own validator, so a value the shard would refuse is caught in its field), and heartbeat URLs.
import { formatNumber, m, type Locale } from "@freecorps/brigade-i18n";
import { mutationErrorReason } from "@freecorps/brigade-i18n/incident";
import {
  can,
  CONSECUTIVE_CHECKS,
  createHeartbeatMonitor,
  createHttpMonitor,
  createTcpMonitor,
  heartbeatToken,
  isCheckError,
  isCloudflareAddress,
  isFresh,
  MAX_CONSECUTIVE_CHECKS,
  MAX_MONITORS_PER_WORKSPACE,
  MIN_INTERVAL_SECONDS,
  MONITOR_INCIDENT_SEVERITY,
  monitorCap,
  monitorSettings,
  monitorSources,
  newHeartbeatSecret,
  headerProblem,
  MONITOR_HEADER_NAME_MAX,
  MONITOR_HEADER_VALUE_MAX,
  normalizeTcpHost,
  PATTERN_TOO_COMPLEX,
  PATTERN_TOO_SLOW,
  patternProblem,
  PROBE_REGIONS,
  staleAfterMs,
  TCP_BLOCKED_PORTS,
  tcpTargetProblems,
  type ArgsOf,
  type CheckSource,
  type EscalationPolicyRow,
  type HttpMethod,
  type KeywordMode,
  type MemberRow,
  type MonitorCheck,
  type MonitorHeader,
  type MonitorKind,
  type MonitorRow,
  type ProbeRegion,
  type Role,
  type Severity,
  type StatusRange,
  type updateHeartbeatMonitor,
  type updateHttpMonitor,
  type updateTcpMonitor,
} from "@freecorps/brigade-schema";

/** What the status badge says: a paused monitor is paused, whatever its last status. */
export type MonitorBadge = MonitorRow["status"] | "paused";

export function monitorBadge(row: Pick<MonitorRow, "paused" | "status">): MonitorBadge {
  return row.paused ? "paused" : row.status;
}

/** `30 s`, `5 min`, `2 h`, `1 day`: the largest unit that divides it, in the locale's short unit style. */
export function formatSeconds(seconds: number, locale: Locale): string {
  const [unit, size] =
    UNITS.find(([, size]) => seconds >= size && seconds % size === 0) ?? (["second", 1] as const);
  return formatNumber(seconds / size, locale, { style: "unit", unit, unitDisplay: "short" });
}

const UNITS = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
] as const;

/**
 * One chip per source the monitor checks from, in its order: the last result if it is still fresh, `stale` if it
 * is too old to count (`isFresh`), or `waiting` if the source never reported since the monitor (re)started.
 */
export type SourceChip =
  | { source: CheckSource; state: "fresh" | "stale"; check: MonitorCheck }
  | { source: CheckSource; state: "waiting" };

export function sourceChips(
  row: Pick<MonitorRow, "kind" | "regions" | "intervalSeconds" | "checks">,
  now: number,
): SourceChip[] {
  return monitorSources(row).map((source) => {
    const check = row.checks.find((c) => c.source === source);
    if (!check) return { source, state: "waiting" };
    return { source, state: isFresh(row, check, now) ? "fresh" : "stale", check };
  });
}

/**
 * The regions whose probe stopped reporting (RFC 0007 "Watching the watcher"): every running HTTP or TCP monitor
 * checked from there has gone past its stale window (`staleAfterMs`) since its last result from there, or since it
 * started over without one. One quiet monitor is not a stalled probe; all of a region's going quiet together is.
 * In `PROBE_REGIONS` order.
 */
export function stalledRegions(
  rows: readonly Pick<
    MonitorRow,
    "kind" | "paused" | "regions" | "intervalSeconds" | "checks" | "restartedAt"
  >[],
  now: number,
): ProbeRegion[] {
  return PROBE_REGIONS.filter((region) => {
    const watching = rows.filter(
      (row) => row.kind !== "heartbeat" && !row.paused && row.regions.includes(region),
    );
    return (
      watching.length > 0 &&
      watching.every((row) => {
        const last = row.checks.find((check) => check.source === region)?.at ?? row.restartedAt;
        return now - last > staleAfterMs(row);
      })
    );
  });
}

/**
 * The running monitors with a fresh check error (`CHECK_ERRORS`) from any source: checks Brigade could not judge,
 * which keep their last verdict and page nobody. In list order.
 */
export function checkErrorMonitors<
  Row extends Pick<MonitorRow, "kind" | "paused" | "intervalSeconds" | "checks">,
>(rows: readonly Row[], now: number): Row[] {
  return rows.filter(
    (row) =>
      !row.paused &&
      row.checks.some((check) => isCheckError(check.error) && isFresh(row, check, now)),
  );
}

/**
 * The `monitor_field_invalid` key for a refused pattern: one that is too large or could cost too much on a large page
 * says to use smaller repeats, anything else what is not supported.
 */
export function patternFieldReason(keyword: string): "keyword_regex" | "keyword_regex_slow" {
  const problem = patternProblem(keyword.trim());
  return problem === PATTERN_TOO_SLOW || problem === PATTERN_TOO_COMPLEX
    ? "keyword_regex_slow"
    : "keyword_regex";
}

/** The `monitor_check_error` reason for a failed check (`status_any` when any 2xx or 3xx would do). */
export function checkErrorReason(
  check: Pick<MonitorCheck, "error">,
  expected: readonly StatusRange[] | null,
): string {
  if (check.error === "status" && expected === null) return "status_any";
  return check.error ?? "unknown";
}

/** Status ranges as people type them: `200, 204, 301-302`. */
export function formatStatuses(ranges: readonly StatusRange[] | null): string {
  if (ranges === null) return "";
  return ranges
    .map((range) => (range.min === range.max ? `${range.min}` : `${range.min}-${range.max}`))
    .join(", ");
}

/**
 * `200, 204, 500-599` (commas or spaces between, a dash or an en dash in a range) as ranges; null when empty, and
 * undefined when it is not such a list, so the validator refuses the field.
 */
export function parseStatuses(text: string): StatusRange[] | null | undefined {
  const parts = text
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const ranges: StatusRange[] = [];
  for (const part of parts) {
    const found = /^(\d{3})(?:[-–](\d{3}))?$/.exec(part);
    if (!found) return undefined;
    const min = Number(found[1]);
    ranges.push({ min, max: found[2] === undefined ? min : Number(found[2]) });
  }
  return ranges;
}

/**
 * Whether the statuses typed list a 5xx: a server failure that would count as up, which the monitor then never pages
 * for. Allowed (a check may expect one on purpose), but the form warns.
 */
export function listsServerError(text: string): boolean {
  return parseStatuses(text)?.some((range) => range.max >= 500) ?? false;
}

/**
 * Whether the draft's quorum is every one of two or more regions: an outage only some regions see never pages, so
 * the form warns. (A region that stops reporting does not silence it: `monitorStatus` then needs only the fresh ones.)
 */
export function quorumIsEveryRegion(draft: Pick<MonitorDraft, "quorum" | "regions">): boolean {
  const regions = new Set(draft.regions).size;
  const quorum = optionalNumber(draft.quorum);
  return quorum !== null && regions > 1 && quorum >= regions;
}

/**
 * How long a region takes to count an outage as down: its failed checks in a row times the interval (the first
 * failure can come up to an interval after it starts). Undefined while either field is not a valid number.
 */
export function secondsToDown(
  draft: Pick<MonitorDraft, "intervalSeconds" | "consecutiveChecks">,
): number | undefined {
  const interval = wholeNumber(draft.intervalSeconds);
  const streak = optionalNumber(draft.consecutiveChecks) ?? CONSECUTIVE_CHECKS;
  if (!(interval >= MIN_INTERVAL_SECONDS) || !(streak >= 1 && streak <= MAX_CONSECUTIVE_CHECKS)) {
    return undefined;
  }
  return interval * streak;
}

/** A TCP monitor's host as it reads before `:port`: an IPv6 address in brackets (`[2001:db8::1]`). */
export function tcpHostLabel(row: Pick<MonitorRow, "host">): string {
  const host = row.host ?? "";
  return host.includes(":") ? `[${host}]` : host;
}

/** `142 ms`, `1,284 ms`. */
export function formatLatency(ms: number, locale: Locale): string {
  return formatNumber(ms, locale, { style: "unit", unit: "millisecond", unitDisplay: "short" });
}

/** The create form as typed: every value a string (or the chosen regions), checked only on submit. */
export type MonitorDraft = {
  kind: MonitorKind;
  name: string;
  url: string;
  host: string;
  port: string;
  method: HttpMethod;
  /** Statuses that count as up, as typed: `200, 500-599` (`parseStatuses`); empty: any 2xx or 3xx. */
  expectedStatus: string;
  keyword: string;
  keywordMode: KeywordMode;
  headers: MonitorHeader[];
  intervalSeconds: string;
  timeoutSeconds: string;
  graceSeconds: string;
  regions: ProbeRegion[];
  /** The escalation policy its incidents page through; empty: the workspace's default. */
  policyId: string;
  severity: Severity;
  /** Regions that must agree; empty: a majority. */
  quorum: string;
  /** Failed checks in a row before a region counts as down; empty: the default, 2. */
  consecutiveChecks: string;
};

export const EMPTY_DRAFT: MonitorDraft = {
  kind: "http",
  name: "",
  url: "",
  host: "",
  port: "",
  method: "GET",
  expectedStatus: "",
  keyword: "",
  keywordMode: "text",
  headers: [],
  intervalSeconds: "60",
  timeoutSeconds: "10",
  graceSeconds: "300",
  regions: ["enam", "weur"],
  policyId: "",
  severity: MONITOR_INCIDENT_SEVERITY,
  quorum: "",
  consecutiveChecks: "",
};

/** A field of the draft the form draws an error under. */
export type DraftField = Exclude<
  keyof MonitorDraft,
  "kind" | "method" | "keywordMode" | "severity"
>;

/** An empty optional field is null; anything else must be a whole number (the validator checks the range). */
const optionalNumber = (text: string) => (text.trim() === "" ? null : wholeNumber(text));
const wholeNumber = (text: string) => (/^\s*\d+\s*$/.test(text) ? Number(text) : Number.NaN);
const optionalText = (text: string) => (text.trim() === "" ? null : text);

/** Any valid digest: the validator checks the shape, and the real hash is made after the check passes. */
const PLACEHOLDER_HASH = "0".repeat(64);

export type CheckedDraft =
  | { ok: true; kind: "http"; args: ArgsOf<typeof createHttpMonitor> }
  | { ok: true; kind: "tcp"; args: ArgsOf<typeof createTcpMonitor> }
  | { ok: true; kind: "heartbeat"; args: ArgsOf<typeof createHeartbeatMonitor> }
  | { ok: false; fields: DraftField[] };

/**
 * The mutation's args for `draft` with a new monitor id, or the fields to fix: the validator the shard runs, plus
 * the rules it checks across fields (a timeout longer than the interval; for TCP, the target rules of
 * `tcpTargetProblems`, which judge the host and the port together). A keyword is dropped for HEAD, whose response
 * has no body; the form hides the field then.
 */
export function checkDraft(draft: MonitorDraft, id: string): CheckedDraft {
  const common = {
    id,
    name: draft.name,
    intervalSeconds: wholeNumber(draft.intervalSeconds),
    policyId: draft.policyId === "" ? null : draft.policyId,
    severity: draft.severity,
  };
  // The quorum's own rule (no more than the regions) comes from the mutation's validator, through `issues` below.
  const probed = {
    quorum: optionalNumber(draft.quorum),
    consecutiveChecks: optionalNumber(draft.consecutiveChecks),
  };
  if (draft.kind === "heartbeat") {
    const result = createHeartbeatMonitor.args({
      ...common,
      graceSeconds: wholeNumber(draft.graceSeconds),
      tokenHash: PLACEHOLDER_HASH,
    });
    return result.ok ? { ok: true, kind: "heartbeat", args: result.value } : refused(result.issues);
  }
  const timeoutSeconds = wholeNumber(draft.timeoutSeconds);
  // The cross-field rule, also when other fields are refused, if both numbers are fine on their own.
  const issues: { path: string }[] =
    timeoutSeconds > common.intervalSeconds ? [{ path: "timeoutSeconds" }] : [];
  if (probed.quorum !== null && probed.quorum > new Set(draft.regions).size) {
    issues.push({ path: "quorum" });
  }
  if (draft.kind === "tcp") {
    const host = draft.host.trim();
    const port = wholeNumber(draft.port);
    const result = createTcpMonitor.args({
      ...common,
      host,
      port,
      timeoutSeconds,
      regions: draft.regions,
      ...probed,
    });
    // Also when another field is refused, so every field to fix is named at once.
    issues.push(...tcpTargetProblems(host, port));
    if (!result.ok || issues.length)
      return refused([...(result.ok ? [] : result.issues), ...issues]);
    return { ok: true, kind: "tcp", args: result.value };
  }
  const keyword = draft.method === "HEAD" ? null : optionalText(draft.keyword);
  const statuses = parseStatuses(draft.expectedStatus);
  const result = createHttpMonitor.args({
    ...common,
    url: draft.url.trim(),
    method: draft.method,
    // Not a list of statuses: a value the validator refuses, so the field is marked.
    expectedStatuses: statuses === undefined ? "" : statuses,
    keyword,
    keywordMode: draft.keywordMode,
    // Rows left empty are dropped, so an unused "Add header" sends nothing.
    headers: draft.headers
      .map((header) => ({ name: header.name.trim(), value: header.value.trim() }))
      .filter((header) => header.name !== "" || header.value !== ""),
    timeoutSeconds,
    regions: draft.regions,
    ...probed,
  });
  statuses?.forEach((range) => range.min > range.max && issues.push({ path: "expectedStatus" }));
  if (keyword !== null && draft.keywordMode === "regex" && patternProblem(keyword) !== null) {
    issues.push({ path: "keyword" });
  }
  if (!result.ok || issues.length) return refused([...(result.ok ? [] : result.issues), ...issues]);
  return { ok: true, kind: "http", args: result.value };
}

/** The draft field an argument is typed into, where their names differ. */
const ARG_FIELDS: Record<string, DraftField> = {
  expectedStatuses: "expectedStatus",
  keywordMode: "keyword",
};

/** The draft fields an issue list names (`regions[2]` is `regions`). */
function refused(issues: readonly { path: string }[]): Extract<CheckedDraft, { ok: false }> {
  const fields = new Set<DraftField>();
  for (const issue of issues) {
    const arg = issue.path.split(/[.[]/)[0] ?? "";
    const field = ARG_FIELDS[arg] ?? arg;
    if (DRAFT_FIELDS.includes(field as DraftField)) fields.add(field as DraftField);
  }
  return { ok: false, fields: [...fields] };
}

/**
 * The header rows the shard would refuse, by their index in the draft, so the form marks each one: a name or value
 * missing or too long, a header no check may send (`headerProblem`), or a name given twice. Empty rows are dropped
 * on submit, never refused.
 */
export function refusedHeaderRows(draft: Pick<MonitorDraft, "headers">): number[] {
  const rows: number[] = [];
  const seen = new Set<string>();
  draft.headers.forEach((header, index) => {
    const name = header.name.trim();
    const value = header.value.trim();
    if (name === "" && value === "") return;
    const fits =
      name !== "" &&
      value !== "" &&
      name.length <= MONITOR_HEADER_NAME_MAX &&
      value.length <= MONITOR_HEADER_VALUE_MAX;
    const twice = seen.has(name.toLowerCase());
    seen.add(name.toLowerCase());
    if (!fits || twice || headerProblem(name, value) !== null) rows.push(index);
  });
  return rows;
}

const DRAFT_FIELDS: readonly DraftField[] = [
  "name",
  "url",
  "host",
  "port",
  "expectedStatus",
  "keyword",
  "headers",
  "intervalSeconds",
  "timeoutSeconds",
  "graceSeconds",
  "regions",
  "quorum",
  "consecutiveChecks",
  "policyId",
];

/**
 * The `monitor_field_invalid` key for a refused TCP field when it has its own wording: a port Cloudflare blocks, an
 * address of Cloudflare's own (`tcpTargetProblems`), or a host with an underscore, which no host name may have
 * (`db_1.example.com`). Null for every other field and reason.
 */
export function tcpFieldReason(
  field: DraftField,
  draft: Pick<MonitorDraft, "kind" | "host" | "port">,
): "port_blocked" | "host_cloudflare" | "host_underscore" | null {
  if (draft.kind !== "tcp") return null;
  if (field === "port" && TCP_BLOCKED_PORTS.includes(wholeNumber(draft.port))) {
    return "port_blocked";
  }
  if (field === "host") {
    const host = normalizeTcpHost(draft.host.trim());
    if (host !== undefined && isCloudflareAddress(host)) return "host_cloudflare";
    if (draft.host.includes("_")) return "host_underscore";
  }
  return null;
}

/**
 * A pasted `host:port`, `[v6]:port` or `scheme://user:password@host:port/path` split into the TCP form's two
 * fields; the port is null when the paste has none, and the credentials of a connection string are dropped, never
 * filled in. Null when the paste is a bare host already (or not a host at all), so it pastes as typed.
 */
export function splitHostPort(text: string): { host: string; port: string | null } | null {
  const trimmed = text.trim();
  const unschemed = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const rest = (unschemed === trimmed ? unschemed : unschemed.replace(/^[^/?#]*@/, "")).replace(
    /[/?#].*$/,
    "",
  );
  const match =
    /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/i.exec(rest) ?? /^([^\s:[\]@]+):(\d{1,5})$/.exec(rest);
  if (match) return { host: match[1]!, port: match[2] ?? null };
  return rest !== trimmed && /^[^\s:[\]@]+$/.test(rest) ? { host: rest, port: null } : null;
}

/**
 * The most monitors this workspace may have (`monitorCap`): the owner's cap, within the instance's (`maxMonitors` from
 * `GET /api/features`; `MAX_MONITORS_PER_WORKSPACE` until it answers).
 */
export function workspaceMonitorCap(
  workspace: Parameters<typeof monitorCap>[0],
  instance: number | undefined,
): number {
  return monitorCap(workspace, instance ?? MAX_MONITORS_PER_WORKSPACE);
}

/**
 * Whether the workspace has as many monitors as `cap` allows, so the shard would refuse another one
 * (`limit_reached`): the form says so on submit instead of sending it.
 */
export function monitorsFull(count: number, cap: number = MAX_MONITORS_PER_WORKSPACE): boolean {
  return count >= cap;
}

/**
 * Who paused a monitor, as the row says it: you, a member by name from the shard's member list, or "a teammate"
 * for someone it has no name for (an unnamed member, someone who left, or the server pausing after a takeover).
 */
export function pausedBy(
  row: Pick<MonitorRow, "pausedBy">,
  userId: string,
  members: readonly Pick<MemberRow, "id" | "name">[],
): { state: "paused_you" | "paused_other"; name: "" } | { state: "paused_name"; name: string } {
  if (row.pausedBy === userId) return { state: "paused_you", name: "" };
  const name = members.find((member) => member.id === row.pausedBy)?.name;
  return name ? { state: "paused_name", name } : { state: "paused_other", name: "" };
}

/** What an owner or admin can do to a monitor from its row; everyone else reads it (`monitor:manage`). */
export type MonitorAction = "edit" | "pause" | "resume";

export function monitorActions(role: Role, row: Pick<MonitorRow, "paused">): MonitorAction[] {
  if (!can(role, "monitor:manage")) return [];
  return ["edit", row.paused ? "resume" : "pause"];
}

/** The edit form as it opens: the monitor's own values, typed back into strings. */
export function draftFromRow(row: MonitorRow): MonitorDraft {
  const number = (value: number | null, fallback: string) =>
    value === null ? fallback : String(value);
  // Rows from before these settings have none: the defaults.
  const settings = monitorSettings(row);
  return {
    kind: row.kind,
    name: row.name,
    url: row.url ?? "",
    // Rows from before TCP monitors have neither field.
    host: row.host ?? "",
    port: row.port == null ? "" : String(row.port),
    method: row.method ?? "GET",
    expectedStatus: formatStatuses(settings.expectedStatuses),
    keyword: row.keyword ?? "",
    keywordMode: settings.keywordMode,
    headers: settings.headers.map((header) => ({ ...header })),
    intervalSeconds: String(row.intervalSeconds),
    timeoutSeconds: number(row.timeoutSeconds, EMPTY_DRAFT.timeoutSeconds),
    graceSeconds: number(row.graceSeconds, EMPTY_DRAFT.graceSeconds),
    regions: row.kind === "heartbeat" ? EMPTY_DRAFT.regions : [...row.regions],
    // Rows from before policies per monitor have none: the default.
    policyId: row.policyId ?? "",
    severity: settings.severity,
    quorum: number(settings.quorum, ""),
    consecutiveChecks: number(settings.consecutiveChecks, ""),
  };
}

/**
 * Whether `draft` differs from the values its form opened with, so closing it would lose something. Regions compare
 * as a set: unticking one and ticking it again changes nothing.
 */
export function draftChanged(draft: MonitorDraft, initial: MonitorDraft): boolean {
  const normal = (value: MonitorDraft) => ({
    ...value,
    regions: PROBE_REGIONS.filter((region) => value.regions.includes(region)),
  });
  return JSON.stringify(normal(draft)) !== JSON.stringify(normal(initial));
}

/**
 * `draft` laid over `row` as it is now: only the fields edited since the form opened (`initial`) come from the draft,
 * the rest from the live row. A teammate's change to another field while the form was open is kept, not reverted by
 * the snapshot the form opened with (`monitor.updateHttp` takes every field).
 */
export function rebaseDraft(
  draft: MonitorDraft,
  initial: MonitorDraft,
  row: MonitorRow,
): MonitorDraft {
  const same = (key: keyof MonitorDraft) =>
    key === "regions"
      ? !draftChanged({ ...initial, regions: draft.regions }, initial)
      : JSON.stringify(draft[key]) === JSON.stringify(initial[key]);
  const live = draftFromRow(row);
  const keys = Object.keys(draft) as (keyof MonitorDraft)[];
  return Object.fromEntries(
    keys.map((key) => [key, same(key) ? live[key] : draft[key]]),
  ) as MonitorDraft;
}

export type CheckedEdit =
  | { ok: true; kind: "http"; args: ArgsOf<typeof updateHttpMonitor>; changed: boolean }
  | { ok: true; kind: "tcp"; args: ArgsOf<typeof updateTcpMonitor>; changed: boolean }
  | { ok: true; kind: "heartbeat"; args: ArgsOf<typeof updateHeartbeatMonitor>; changed: boolean }
  | { ok: false; fields: DraftField[] };

/**
 * The update mutation's args for an edited `draft` of `row`, checked like a new monitor (the same validators and
 * cross-field rule), and whether anything changed: the shard refuses an update that changes nothing, so the form
 * just closes then. The kind never changes. A policy left as the row has it is left out of the args, so the shard
 * keeps the monitor's own (already null if that policy was deleted meanwhile) instead of refusing a stale id.
 */
export function checkEdit(draft: MonitorDraft, row: MonitorRow): CheckedEdit {
  const checked = checkDraft({ ...draft, kind: row.kind }, row.id);
  if (!checked.ok) return checked;
  if (checked.kind === "heartbeat") {
    const { id, name, intervalSeconds, graceSeconds, policyId, severity } = checked.args;
    const args = { id, name, intervalSeconds, graceSeconds, policyId, severity };
    const changed = differs(args, row, ["name", "intervalSeconds", "graceSeconds", ...ALERTING]);
    return { ok: true, kind: "heartbeat", args: keptPolicy(args, row), changed };
  }
  // The shard keeps the regions in `PROBE_REGIONS` order, so the comparison does too.
  const regions = PROBE_REGIONS.filter((region) => checked.args.regions.includes(region));
  if (checked.kind === "tcp") {
    const args = { ...checked.args, regions };
    const changed = differs(args, row, [
      "name",
      "intervalSeconds",
      ...ALERTING,
      ...TCP_TARGET_FIELDS,
    ]);
    return { ok: true, kind: "tcp", args: keptPolicy(args, row), changed };
  }
  const args = { ...checked.args, regions };
  const changed = differs(args, row, ["name", "intervalSeconds", ...ALERTING, ...TARGET_FIELDS]);
  return { ok: true, kind: "http", args: keptPolicy(args, row), changed };
}

/** What an edit may change without starting the checks over, besides the name and the interval. */
const ALERTING = ["policyId", "severity", "quorum", "consecutiveChecks"] as const;

/** `row`'s values with its settings' defaults filled in, as the shard compares them (`monitorSettings`). */
function current(row: MonitorRow): Record<string, unknown> {
  return { ...row, ...monitorSettings(row), policyId: row.policyId ?? null };
}

/** Whether any of `keys` differs between `args` and `row` (settings compared with their defaults filled in). */
function differs(args: object, row: MonitorRow, keys: readonly string[]): boolean {
  const now = current(row);
  return keys.some(
    (key) => JSON.stringify(Reflect.get(args, key) ?? null) !== JSON.stringify(now[key] ?? null),
  );
}

/**
 * Whether `sent` (the draft as it goes out: an edit rebased on the live `row`, a new monitor as drafted) names a policy
 * this client no longer has, which the shard would refuse. The row's own is never sent (`checkEdit` leaves it out), so
 * an edit that leaves the policy alone is never blocked by it.
 */
export function stalePolicy(
  sent: Pick<MonitorDraft, "policyId">,
  row: Pick<MonitorRow, "policyId"> | null,
  policies: readonly Pick<EscalationPolicyRow, "id">[],
): boolean {
  if (sent.policyId === "" || (row && sent.policyId === (row.policyId ?? ""))) return false;
  return !policies.some((policy) => policy.id === sent.policyId);
}

/** `args` without `policyId` when it is the row's: an edit that leaves it out keeps the monitor's. */
function keptPolicy<T extends { policyId?: string | null }>(args: T, row: MonitorRow): T {
  if (args.policyId !== (row.policyId ?? null)) return args;
  const { policyId: _kept, ...rest } = args;
  return rest as T;
}

/**
 * Whether saving `draft` starts the monitor's checks over, as `monitor.updateHttp` and `monitor.updateTcp` do: a
 * change to what is checked (anything but the name and the interval) on a running HTTP or TCP monitor. Its results
 * are dropped and it waits for its regions again. A heartbeat's edit never restarts it.
 */
export function editRestarts(draft: MonitorDraft, row: MonitorRow): boolean {
  if (row.kind === "heartbeat" || row.paused) return false;
  const checked = checkEdit(draft, row);
  if (!checked.ok || checked.kind === "heartbeat") return false;
  return differs(checked.args, row, checked.kind === "tcp" ? TCP_TARGET_FIELDS : TARGET_FIELDS);
}

/** What an HTTP check is: changing any of these starts it over (`monitor.updateHttp`). */
const TARGET_FIELDS = [
  "url",
  "method",
  "expectedStatuses",
  "keyword",
  "keywordMode",
  "headers",
  "timeoutSeconds",
  "regions",
] as const;

/** What a TCP check is: changing any of these starts it over (`monitor.updateTcp`). */
const TCP_TARGET_FIELDS = ["host", "port", "timeoutSeconds", "regions"] as const;

/**
 * Which escalation policy a monitor's incidents page through (RFC 0003 "Escalation policies"): its own (`own`), the
 * workspace's default (`default`, also for a policy it names that this client no longer has), or none at all, so the
 * interim rule pages (`none`). `name` is the policy's.
 */
export type MonitorPolicy =
  | { kind: "own"; name: string }
  | { kind: "default"; name: string }
  | { kind: "none" };

export function monitorPolicy(
  row: Pick<MonitorRow, "policyId">,
  policies: readonly Pick<EscalationPolicyRow, "id" | "name" | "isDefault">[],
): MonitorPolicy {
  const own = row.policyId ? policies.find((policy) => policy.id === row.policyId) : undefined;
  if (own) return { kind: "own", name: own.name };
  const fallback = policies.find((policy) => policy.isDefault);
  return fallback ? { kind: "default", name: fallback.name } : { kind: "none" };
}

/**
 * Why the shard refused a change to a monitor, in the shared wording (`mutationErrorReason`), except "not found",
 * whose shared sentence is about an incident, and the monitor cap, which says what to do.
 */
export function monitorRefusal(code: string, cap: number, locale: Locale): string {
  if (code === "not_found") return m.monitor_gone();
  if (code === "limit_reached") return monitorLimitReached(cap, locale);
  return mutationErrorReason(code);
}

/** Why a new monitor cannot be added: the workspace has as many as its cap allows already. */
export const monitorLimitReached = (cap: number, locale: Locale) =>
  m.monitor_limit_reached({ max: formatNumber(cap, locale) });

/** A new heartbeat token, its SHA-256 (what the shard stores) and the URL to ping. */
export async function newHeartbeat(
  origin: string,
  workspaceId: string,
  monitorId: string,
  random: (length: number) => Uint8Array = (length) =>
    crypto.getRandomValues(new Uint8Array(length)),
): Promise<{ tokenHash: string; url: string }> {
  const secret = newHeartbeatSecret(random);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const tokenHash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  // Through the dashboard's origin: its Worker forwards /api/* to the API Worker.
  const url = `${origin}/api/heartbeat/${heartbeatToken(workspaceId, monitorId, secret)}`;
  return { tokenHash, url };
}
