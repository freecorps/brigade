// Pure, string-free helpers an incident list and page need on any client: which moves to offer, how to check a
// declare or an update before sending it, who may hold a role, how to find links in an update, and how to count
// changes in flight. Shared by the web dashboard and the mobile app (issue #20); their wording is in
// `@freecorps/brigade-i18n/incident`.
import {
  canTransition,
  INCIDENT_STATUSES,
  lookup,
  mutations,
  trimSpace,
  UPDATE_BODY_MAX,
  type IncidentRow,
  type IncidentStatus,
  type MemberRow,
  type PageFailure,
  type Severity,
  type TimelineRow,
} from "@freecorps/brigade-schema";

/** The statuses `from` may move to, in lifecycle order (never `from` itself). */
export function nextStatuses(from: IncidentStatus): IncidentStatus[] {
  return INCIDENT_STATUSES.filter((to) => canTransition(from, to));
}

/**
 * The row a pick still applies to, looked up again when the pick happens: a sheet or menu stays open while the
 * rows move. Undefined when the incident is gone, already has that value, or can no longer move there.
 */
export function pickTarget(
  rows: readonly IncidentRow[],
  id: string,
  change: { kind: "status"; to: IncidentStatus } | { kind: "severity"; to: Severity },
): IncidentRow | undefined {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) return undefined;
  if (change.kind === "severity") return row.severity === change.to ? undefined : row;
  return canTransition(row.status, change.to) ? row : undefined;
}

/** In-flight mutations by key (an incident id, a field, a role…); a key with none left is removed. */
export function adjustBusy(
  busy: ReadonlyMap<string, number>,
  keys: readonly string[],
  by: number,
): ReadonlyMap<string, number> {
  const next = new Map(busy);
  for (const key of keys) {
    const count = (next.get(key) ?? 0) + by;
    if (count > 0) next.set(key, count);
    else next.delete(key);
  }
  return next;
}

const declare = lookup(mutations, "incident.declare")!;

/**
 * Runs the declare's own validator before sending, so a title the shard would refuse (empty once trimmed, only
 * invisible or bidi characters) is caught in the field and the text stays. Returns the args as validated.
 */
export function checkDeclare(
  id: string,
  title: string,
  severity: Severity,
): { ok: true; args: { id: string; title: string; severity: Severity } } | { ok: false } {
  const result = declare.args({ id, title, severity });
  // Only what was given: the type and services the validator reads as null are left out, not sent as null.
  return result.ok
    ? { ok: true, args: { id: result.value.id, title: result.value.title, severity } }
    : { ok: false };
}

/** Members who may hold an incident role (the shard refuses viewers). */
export function assignable(members: readonly MemberRow[]): MemberRow[] {
  return members.filter((member) => member.role !== "viewer");
}

const postUpdate = lookup(mutations, "incident.postUpdate")!;

export type UpdateProblem = "empty" | "invalid" | "long";

/**
 * Runs the update's own validator before sending, so text the shard would refuse stays in the field with a reason:
 * `empty` (nothing visible once trimmed), `long` (over `UPDATE_BODY_MAX` once trimmed) or `invalid` (hidden
 * characters).
 */
export function checkUpdate(
  id: string,
  body: string,
): { ok: true; args: { id: string; body: string } } | { ok: false; reason: UpdateProblem } {
  if (updateLength(body) > UPDATE_BODY_MAX) return { ok: false, reason: "long" };
  const result = postUpdate.args({ id, body });
  if (result.ok) return { ok: true, args: result.value as { id: string; body: string } };
  const blank = Array.from(body).every((char) => /\s/u.test(char));
  return { ok: false, reason: blank ? "empty" : "invalid" };
}

/** The update's length as the shard counts it: UTF-16 code units, after trimming. */
export function updateLength(body: string): number {
  return trimSpace(body).length;
}

/** The field counts the text from here on, so a long update sees its limit coming. */
export const UPDATE_COUNT_FROM = 3600;

export type BodyPart = { text: string } | { url: string };

// Up to the first space, quote or angle bracket; punctuation that usually ends a sentence is left out of the link.
const URL_PATTERN = /https?:\/\/[^\s<>"]+/g;
const TRAILING = ".,;:!?')]}";

const count = (text: string, char: string) => text.split(char).length - 1;

/**
 * An update's text split into plain text and `http(s)` links, so links render as links (as UI nodes: the text is
 * never markup). A closing bracket stays in the link when the link opened one, as Wikipedia URLs do.
 */
export function bodyParts(body: string): BodyPart[] {
  const parts: BodyPart[] = [];
  let last = 0;
  for (const match of body.matchAll(URL_PATTERN)) {
    let url = match[0];
    while (url.length > 0 && TRAILING.includes(url.at(-1)!)) {
      if (url.endsWith(")") && count(url, "(") >= count(url, ")")) break;
      url = url.slice(0, -1);
    }
    // A scheme with no host ("https://.") is no link.
    if (!/^https?:\/\/[^/.]/.test(url)) continue;
    if (match.index > last) parts.push({ text: body.slice(last, match.index) });
    parts.push({ url });
    last = match.index + url.length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

type PageFailed = Extract<TimelineRow, { kind: "page_failed" }> & { userId: string };

/**
 * A timeline line: one entry, or the pages one notifier run could not send for the same reason (consecutive
 * `page_failed` entries for members, at the same time), so a SEV1 that reached nobody in a large workspace is one
 * line, not one per member above the first update.
 */
export type TimelineItem =
  | { kind: "entry"; entry: TimelineRow }
  | {
      kind: "pages_failed";
      key: string;
      at: number;
      reason: PageFailure;
      entries: [PageFailed, ...PageFailed[]];
    };

const forMember = (entry: TimelineRow): entry is PageFailed =>
  entry.kind === "page_failed" && entry.userId !== null && entry.reason !== "dead_lettered";

/** `entries` in the order given, with runs of two or more of the same page failure grouped. */
export function timelineItems(entries: readonly TimelineRow[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let run: PageFailed[] = [];
  const flush = () => {
    const [first, ...rest] = run;
    if (first && rest.length === 0) items.push({ kind: "entry", entry: first });
    else if (first) {
      items.push({
        kind: "pages_failed",
        key: first.id,
        at: first.at,
        reason: first.reason,
        entries: [first, ...rest],
      });
    }
    run = [];
  };
  for (const entry of entries) {
    const first = run[0];
    if (forMember(entry) && (!first || (first.at === entry.at && first.reason === entry.reason))) {
      run.push(entry);
      continue;
    }
    flush();
    if (forMember(entry)) run.push(entry);
    else items.push({ kind: "entry", entry });
  }
  flush();
  return items;
}
