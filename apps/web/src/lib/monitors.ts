// Pure helpers for the Monitors card: how a monitor reads, how the create form turns into a mutation's args (checked
// with the mutation's own validator, so a value the shard would refuse is caught in its field), and heartbeat URLs.
import { formatNumber, m, type Locale } from "@freecorps/brigade-i18n";
import { mutationErrorReason } from "@freecorps/brigade-i18n/incident";
import {
  can,
  createHeartbeatMonitor,
  createHttpMonitor,
  heartbeatToken,
  isFresh,
  monitorSources,
  newHeartbeatSecret,
  PROBE_REGIONS,
  type ArgsOf,
  type CheckSource,
  type HttpMethod,
  type MonitorCheck,
  type MonitorRow,
  type ProbeRegion,
  type Role,
  type updateHeartbeatMonitor,
  type updateHttpMonitor,
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

/** `142 ms`, `1,284 ms`. */
export function formatLatency(ms: number, locale: Locale): string {
  return formatNumber(ms, locale, { style: "unit", unit: "millisecond", unitDisplay: "short" });
}

/** The create form as typed: every value a string (or the chosen regions), checked only on submit. */
export type MonitorDraft = {
  kind: "http" | "heartbeat";
  name: string;
  url: string;
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
  | { ok: true; kind: "heartbeat"; args: ArgsOf<typeof createHeartbeatMonitor> }
  | { ok: false; fields: DraftField[] };

/**
 * The mutation's args for `draft` with a new monitor id, or the fields to fix: the validator the shard runs, plus
 * its one cross-field rule a form can break (a timeout longer than the interval). A keyword is dropped for HEAD,
 * whose response has no body; the form hides the field then.
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
  const result = createHttpMonitor.args({
    ...common,
    url: draft.url.trim(),
    method: draft.method,
    expectedStatus: optionalNumber(draft.expectedStatus),
    keyword: draft.method === "HEAD" ? null : optionalText(draft.keyword),
    timeoutSeconds: wholeNumber(draft.timeoutSeconds),
    regions: draft.regions,
  });
  if (!result.ok) {
    const fields = refused(result.issues);
    // The cross-field rule too, when both numbers are fine on their own.
    const timeout = wholeNumber(draft.timeoutSeconds);
    if (!fields.ok && timeout > wholeNumber(draft.intervalSeconds)) {
      fields.fields = [...new Set([...fields.fields, "timeoutSeconds" as const])];
    }
    return fields;
  }
  if (result.value.timeoutSeconds > result.value.intervalSeconds) {
    return { ok: false, fields: ["timeoutSeconds"] };
  }
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
  "expectedStatus",
  "keyword",
  "intervalSeconds",
  "timeoutSeconds",
  "graceSeconds",
  "regions",
];

/** What an owner or admin can do to a monitor from its row; everyone else reads it (`monitor:manage`). */
export type MonitorAction = "edit" | "pause" | "resume" | "delete";

export function monitorActions(role: Role, row: Pick<MonitorRow, "paused">): MonitorAction[] {
  if (!can(role, "monitor:manage")) return [];
  return ["edit", row.paused ? "resume" : "pause", "delete"];
}

/** The edit form as it opens: the monitor's own values, typed back into strings. */
export function draftFromRow(row: MonitorRow): MonitorDraft {
  const number = (value: number | null, fallback: string) =>
    value === null ? fallback : String(value);
  return {
    kind: row.kind,
    name: row.name,
    url: row.url ?? "",
    method: row.method ?? "GET",
    expectedStatus: number(row.expectedStatus, ""),
    keyword: row.keyword ?? "",
    intervalSeconds: String(row.intervalSeconds),
    timeoutSeconds: number(row.timeoutSeconds, EMPTY_DRAFT.timeoutSeconds),
    graceSeconds: number(row.graceSeconds, EMPTY_DRAFT.graceSeconds),
    regions: row.kind === "http" ? [...row.regions] : EMPTY_DRAFT.regions,
  };
}

export type CheckedEdit =
  | { ok: true; kind: "http"; args: ArgsOf<typeof updateHttpMonitor>; changed: boolean }
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
  const args = {
    ...checked.args,
    // The shard keeps them in `PROBE_REGIONS` order, so the comparison does too.
    regions: PROBE_REGIONS.filter((region) => checked.args.regions.includes(region)),
  };
  const changed = (["name", "intervalSeconds", ...TARGET_FIELDS] as const).some(
    (key) => JSON.stringify(args[key]) !== JSON.stringify(row[key]),
  );
  return { ok: true, kind: "http", args, changed };
}

/**
 * Whether saving `draft` starts the monitor's checks over, as `monitor.updateHttp` does: a change to what is
 * checked (anything but the name and the interval) on a running HTTP monitor. Its results are dropped and it
 * waits for its regions again. A heartbeat's edit never restarts it.
 */
export function editRestarts(draft: MonitorDraft, row: MonitorRow): boolean {
  if (row.kind !== "http" || row.paused) return false;
  const checked = checkEdit(draft, row);
  if (!checked.ok || checked.kind !== "http") return false;
  const { args } = checked;
  return TARGET_FIELDS.some((key) => JSON.stringify(args[key]) !== JSON.stringify(row[key]));
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
