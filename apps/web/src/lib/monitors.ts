// Pure helpers for the Monitors card: how a monitor reads, how the create form turns into a mutation's args (checked
// with the mutation's own validator, so a value the shard would refuse is caught in its field), and heartbeat URLs.
import { formatNumber, type Locale } from "@freecorps/brigade-i18n";
import {
  createHeartbeatMonitor,
  createHttpMonitor,
  heartbeatToken,
  newHeartbeatSecret,
  type ArgsOf,
  type HttpMethod,
  type MonitorRow,
  type ProbeRegion,
} from "@freecorps/brigade-schema";

/** What the status badge says: a paused monitor is paused, whatever its last status. */
export type MonitorBadge = "up" | "down" | "pending" | "paused";

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
  if (!result.ok) return refused(result.issues);
  if (result.value.timeoutSeconds > result.value.intervalSeconds) {
    return { ok: false, fields: ["timeoutSeconds"] };
  }
  return { ok: true, kind: "http", args: result.value };
}

/** The draft fields an issue list names (`regions[2]` is `regions`). */
function refused(issues: readonly { path: string }[]): CheckedDraft {
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
