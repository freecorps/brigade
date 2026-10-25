// Pure helpers for the incident page: who did something, how a timeline entry reads, who may hold a role, and how to
// check an update before sending it.
import { m } from "@freecorps/brigade-i18n";
import { incidentStatusLabels, severityLabels } from "@freecorps/brigade-i18n/labels";
import {
  lookup,
  MONITOR_ACTOR,
  mutations,
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
 * Who an id is, as a sentence's subject ("You", "Monitors", the member's name) or object ("you"). Someone the
 * shard has no name for yet (they never opened Brigade) is "A teammate", never a raw id.
 */
export function personName(
  id: string,
  who: People,
  place: "subject" | "object" = "subject",
): string {
  if (id === who.self) return m.incident_page({ part: place === "subject" ? "you" : "you_object" });
  if (id === MONITOR_ACTOR.id) return m.incident_page({ part: "monitors" });
  return who.members.get(id)?.name ?? m.incident_page({ part: "teammate" });
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
      const role = m.incident_role({ role: entry.role });
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

/**
 * Runs the update's own validator before sending, so text the shard would refuse stays in the field with a reason:
 * `empty` (nothing visible once trimmed) or `invalid` (hidden characters).
 */
export function checkUpdate(
  id: string,
  body: string,
): { ok: true; args: { id: string; body: string } } | { ok: false; reason: "empty" | "invalid" } {
  const result = postUpdate.args({ id, body });
  if (result.ok) return { ok: true, args: result.value as { id: string; body: string } };
  const blank = Array.from(body).every((char) => /\s/u.test(char));
  return { ok: false, reason: blank ? "empty" : "invalid" };
}
