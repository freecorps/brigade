// Pure helpers for the incident page: who did something, how a timeline entry reads, who may hold a role, and how to
// check an update before sending it.
import { formatDateTime, m, type Locale } from "@freecorps/brigade-i18n";
import { incidentStatusLabels, severityLabels } from "@freecorps/brigade-i18n/labels";
import { formatAge } from "@/lib/incidents";
import {
  lookup,
  MONITOR_ACTOR,
  mutations,
  trimSpace,
  UPDATE_BODY_MAX,
  type MemberRow,
  type Severity,
  type TimelineRow,
} from "@freecorps/brigade-schema";

/** Names for ids, from the shard's member list; `self` is the signed-in member. */
export type People = { self: string; members: ReadonlyMap<string, MemberRow> };

export function people(self: string, members: readonly MemberRow[]): People {
  return { self, members: new Map(members.map((member) => [member.id, member])) };
}

/**
 * Who an id is, as a sentence's subject ("You", "A monitor", the member's name) or object ("you"). Someone the
 * shard has no name for yet (they never opened Brigade) is "A teammate", never a raw id; a member whose name the
 * shard could not keep (`name: null`) is "Unnamed member".
 */
export function personName(
  id: string,
  who: People,
  place: "subject" | "object" = "subject",
): string {
  if (id === who.self) return m.incident_page({ part: place === "subject" ? "you" : "you_object" });
  if (id === MONITOR_ACTOR.id) return m.incident_page({ part: "monitors" });
  const member = who.members.get(id);
  if (!member) return m.incident_page({ part: "teammate" });
  return member.name ?? m.incident_page({ part: "unnamed" });
}

/** "SEV1 Critical", as the badges say it. */
export function severityName(severity: Severity): string {
  return m.severity_named({ code: severity.toUpperCase(), name: severityLabels[severity]() });
}

/** One line saying what an entry recorded; an update's text is drawn under it, not in it. */
export function entryText(entry: TimelineRow, who: People): string {
  const actor = personName(entry.actor, who);
  const say = (kind: string, a = "", b = "") => m.timeline_entry({ kind, actor, a, b });
  switch (entry.kind) {
    case "declared":
      return say("declared", severityName(entry.severity));
    case "status_changed":
      return say(
        "status_changed",
        incidentStatusLabels[entry.from](),
        incidentStatusLabels[entry.to](),
      );
    case "severity_changed":
      return say("severity_changed", severityName(entry.from), severityName(entry.to));
    case "acknowledged":
      return say("acknowledged");
    case "role_assigned": {
      const role = m.incident_role({ role: entry.role, form: "sentence" });
      // Taking or leaving a role yourself reads as that, not "You made you…".
      if (entry.to === entry.actor) return say("role_taken", role);
      if (entry.to === null && entry.from === entry.actor) return say("role_left", role);
      return entry.to === null
        ? say("role_unassigned", role, entry.from ? personName(entry.from, who, "object") : "")
        : say("role_assigned", role, personName(entry.to, who, "object"));
    }
    case "update":
      return say("update");
    case "alert_resolved":
      return say(`alert_${entry.reason}`, entry.monitor);
  }
}

/** Members who may hold an incident role (the shard refuses viewers), by name. */
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
const URL = /https?:\/\/[^\s<>"]+/g;
const TRAILING = ".,;:!?')]}";

const count = (text: string, char: string) => text.split(char).length - 1;

/**
 * An update's text split into plain text and `http(s)` links, so links render as links (as React nodes: the text
 * is never HTML). A closing bracket stays in the link when the link opened one, as Wikipedia URLs do.
 */
export function bodyParts(body: string): BodyPart[] {
  const parts: BodyPart[] = [];
  let last = 0;
  for (const match of body.matchAll(URL)) {
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When an entry happened, as a timeline reads it: the clock time and how long ago ("14:05 · 6 min ago") for the
 * last day, then the date and time ("Oct 24, 2026, 14:05"), when "3 days ago" no longer says enough.
 */
export function entryTime(at: number, now: number, locale: Locale, timeZone: string): string {
  const shown = Math.min(at, now);
  if (now - shown >= DAY_MS) return formatDateTime(shown, locale, timeZone);
  const clock = formatDateTime(shown, locale, timeZone, { timeStyle: "short" });
  return `${clock} · ${formatAge(shown, now, locale)}`;
}
