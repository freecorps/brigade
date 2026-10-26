// Pure helpers for the Monitors card: how a monitor reads, how the create form turns into a mutation's args (checked
// with the mutation's own validator, so a value the shard would refuse is caught in its field), and heartbeat URLs.
import { formatNumber, m, type Locale } from "@freecorps/brigade-i18n";
import { mutationErrorReason } from "@freecorps/brigade-i18n/incident";
import {
  can,
  createHeartbeatMonitor,
  createHttpMonitor,
  createTcpMonitor,
  heartbeatToken,
  isFresh,
  monitorSources,
  newHeartbeatSecret,
  PROBE_REGIONS,
  tcpTargetProblem,
  type ArgsOf,
  type CheckSource,
  type HttpMethod,
  type MonitorCheck,
  type MonitorKind,
  type MonitorRow,
  type ProbeRegion,
  type Role,
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

/** The `monitor_check_error` reason for a failed check (`status_any` when any 2xx or 3xx would do). */
export function checkErrorReason(
  check: Pick<MonitorCheck, "error">,
  expectedStatus: number | null,
): string {
  if (check.error === "status" && expectedStatus === null) return "status_any";
  return check.error ?? "unknown";
}

/** What a TCP monitor connects to: `db.example.com:5432`, an IPv6 address in brackets (`[2001:db8::1]:22`). */
export function tcpTarget(row: Pick<MonitorRow, "host" | "port">): string {
  const host = row.host ?? "";
  return `${host.includes(":") ? `[${host}]` : host}:${row.port ?? ""}`;
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
  expectedStatus: string;
  keyword: string;
  intervalSeconds: string;
  timeoutSeconds: string;
  graceSeconds: string;
  regions: ProbeRegion[];
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
  intervalSeconds: "60",
  timeoutSeconds: "10",
  graceSeconds: "300",
  regions: ["enam", "weur"],
};

/** A field of the draft the form draws an error under. */
export type DraftField = Exclude<keyof MonitorDraft, "kind" | "method">;

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
 * `tcpTargetProblem`, which judge the host and the port together). A keyword is dropped for HEAD, whose response
 * has no body; the form hides the field then.
 */
export function checkDraft(draft: MonitorDraft, id: string): CheckedDraft {
  const common = {
    id,
    name: draft.name,
    intervalSeconds: wholeNumber(draft.intervalSeconds),
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
  if (draft.kind === "tcp") {
    const host = draft.host.trim();
    const port = wholeNumber(draft.port);
    const result = createTcpMonitor.args({
      ...common,
      host,
      port,
      timeoutSeconds,
      regions: draft.regions,
    });
    // Also when another field is refused, so every field to fix is named at once.
    const target = tcpTargetProblem(host, port);
    if (!result.ok || target || issues.length) {
      return refused([...(result.ok ? [] : result.issues), ...(target ? [target] : []), ...issues]);
    }
    return { ok: true, kind: "tcp", args: result.value };
  }
  const result = createHttpMonitor.args({
    ...common,
    url: draft.url.trim(),
    method: draft.method,
    expectedStatus: optionalNumber(draft.expectedStatus),
    keyword: draft.method === "HEAD" ? null : optionalText(draft.keyword),
    timeoutSeconds,
    regions: draft.regions,
  });
  if (!result.ok || issues.length) return refused([...(result.ok ? [] : result.issues), ...issues]);
  return { ok: true, kind: "http", args: result.value };
}

/** The draft fields an issue list names (`regions[2]` is `regions`). */
function refused(issues: readonly { path: string }[]): Extract<CheckedDraft, { ok: false }> {
  const fields = new Set<DraftField>();
  for (const issue of issues) {
    const field = issue.path.split(/[.[]/)[0];
    if (field && DRAFT_FIELDS.includes(field as DraftField)) fields.add(field as DraftField);
  }
  return { ok: false, fields: [...fields] };
}

const DRAFT_FIELDS: readonly DraftField[] = [
  "name",
  "url",
  "host",
  "port",
  "expectedStatus",
  "keyword",
  "intervalSeconds",
  "timeoutSeconds",
  "graceSeconds",
  "regions",
];

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
  return {
    kind: row.kind,
    name: row.name,
    url: row.url ?? "",
    // Rows from before TCP monitors have neither field.
    host: row.host ?? "",
    port: row.port == null ? "" : String(row.port),
    method: row.method ?? "GET",
    expectedStatus: number(row.expectedStatus, ""),
    keyword: row.keyword ?? "",
    intervalSeconds: String(row.intervalSeconds),
    timeoutSeconds: number(row.timeoutSeconds, EMPTY_DRAFT.timeoutSeconds),
    graceSeconds: number(row.graceSeconds, EMPTY_DRAFT.graceSeconds),
    regions: row.kind === "heartbeat" ? EMPTY_DRAFT.regions : [...row.regions],
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
      : draft[key] === initial[key];
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
 * just closes then. The kind never changes.
 */
export function checkEdit(draft: MonitorDraft, row: MonitorRow): CheckedEdit {
  const checked = checkDraft({ ...draft, kind: row.kind }, row.id);
  if (!checked.ok) return checked;
  if (checked.kind === "heartbeat") {
    const { id, name, intervalSeconds, graceSeconds } = checked.args;
    const args = { id, name, intervalSeconds, graceSeconds };
    const changed =
      args.name !== row.name ||
      args.intervalSeconds !== row.intervalSeconds ||
      args.graceSeconds !== row.graceSeconds;
    return { ok: true, kind: "heartbeat", args, changed };
  }
  // The shard keeps the regions in `PROBE_REGIONS` order, so the comparison does too.
  const regions = PROBE_REGIONS.filter((region) => checked.args.regions.includes(region));
  if (checked.kind === "tcp") {
    const args = { ...checked.args, regions };
    const changed = (["name", "intervalSeconds", ...TCP_TARGET_FIELDS] as const).some(
      (key) => JSON.stringify(args[key]) !== JSON.stringify(row[key]),
    );
    return { ok: true, kind: "tcp", args, changed };
  }
  const args = { ...checked.args, regions };
  const changed = (["name", "intervalSeconds", ...TARGET_FIELDS] as const).some(
    (key) => JSON.stringify(args[key]) !== JSON.stringify(row[key]),
  );
  return { ok: true, kind: "http", args, changed };
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
  const args: Partial<MonitorRow> = checked.args;
  const fields = checked.kind === "tcp" ? TCP_TARGET_FIELDS : TARGET_FIELDS;
  return fields.some((key) => JSON.stringify(args[key]) !== JSON.stringify(row[key]));
}

/** What an HTTP check is: changing any of these starts it over (`monitor.updateHttp`). */
const TARGET_FIELDS = [
  "url",
  "method",
  "expectedStatus",
  "keyword",
  "timeoutSeconds",
  "regions",
] as const;

/** What a TCP check is: changing any of these starts it over (`monitor.updateTcp`). */
const TCP_TARGET_FIELDS = ["host", "port", "timeoutSeconds", "regions"] as const;

/**
 * Why the shard refused a change to a monitor, in the shared wording (`mutationErrorReason`), except "not found",
 * whose shared sentence is about an incident.
 */
export function monitorRefusal(code: string): string {
  return code === "not_found" ? m.monitor_gone() : mutationErrorReason(code);
}

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
