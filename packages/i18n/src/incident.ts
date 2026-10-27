// How incidents read in a UI, shared by the web dashboard and the mobile app (issue #20): who did something, how a
// timeline entry and a refused change are worded, and how old something is. Pure: the current locale for the
// messages, an explicit one for times. The string-free parts (checks, links, busy counts) are in
// `@freecorps/brigade-sync`.
import {
  formatIncidentNumber,
  ALERTS_ACTOR,
  isBuiltinRole,
  MONITOR_ACTOR,
  type ApiTokenRow,
  type IncidentStatus,
  type MemberRow,
  type PageFailure,
  type Severity,
  type TimelineRow,
} from "@freecorps/brigade-schema";
import { formatDateTime, formatNumber, formatRelativeTime } from "./format.ts";
import { incidentStatusLabels, severityLabels } from "./labels.ts";
import { m } from "./paraglide/messages.js";
import { getLocale, type Locale } from "./paraglide/runtime.js";

/** "SEV2 High", as the badges say it. */
export function severityName(severity: Severity): string {
  return m.severity_named({ code: severity.toUpperCase(), name: severityLabels[severity]() });
}

/**
 * An incident role's name (RFC 0003 "Role definitions"): the workspace's (`name`), else a built-in's own in the
 * reader's language, else "deleted role" for a workspace role that is gone. `sentence` is the lower-case form a
 * sentence takes; a workspace's names read as written.
 */
export function roleLabel(
  id: string,
  name: string | null | undefined,
  form: "sentence" | "title" = "title",
): string {
  if (name) return name;
  return m.incident_role({ role: isBuiltinRole(id) ? id : "deleted", form });
}

/** "just now" under a minute, then the shared relative format; never a future time (the shard's clock may lead). */
export function formatAge(at: number, now: number, locale: Locale): string {
  if (now - Math.min(at, now) < 60_000) return m.time_just_now({}, { locale });
  return formatRelativeTime(at, locale, now);
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

/** Names for ids, from the shard's member list; `self` is the signed-in member. */
/** `tokens`: the workspace's API tokens (RFC 0014), so what one did reads "API token CI (by Ana)". */
export type People = {
  self: string;
  members: ReadonlyMap<string, MemberRow>;
  tokens?: ReadonlyMap<string, Pick<ApiTokenRow, "name" | "createdBy">>;
};

export function people(
  self: string,
  members: readonly MemberRow[],
  tokens: readonly Pick<ApiTokenRow, "id" | "name" | "createdBy">[] = [],
): People {
  return {
    self,
    members: new Map(members.map((member) => [member.id, member])),
    tokens: new Map(tokens.map((token) => [token.id, token])),
  };
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
  if (id === ALERTS_ACTOR.id) return m.incident_page({ part: "alerts" });
  if (id.startsWith("tok_")) {
    const token = who.tokens?.get(id);
    if (!token) return m.incident_page({ part: "api_token" });
    return m.api_token_actor({ name: token.name, by: personName(token.createdBy, who, "object") });
  }
  const member = who.members.get(id);
  if (!member) return m.incident_page({ part: "teammate" });
  return member.name ?? m.incident_page({ part: "unnamed" });
}

/** Whoever declared it, reached without a push: "you (declared it)", "Ana (declared it)". */
function declarer(id: string, who: People): string {
  const text = (part: "declarer" | "declarer_you_object", name = "") =>
    m.escalation_text({ text: part, name, time: "", level: "", reason: "", who: "" });
  return id === who.self ? text("declarer_you_object") : text("declarer", personName(id, who));
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
      const role = roleLabel(entry.role, entry.roleName, "sentence");
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
    case "alerts_resolved":
      return say("alerts_resolved");
    case "page_failed":
      // Written by the notifier: the sentence is about who was not paged, not who wrote it.
      // A dead-lettered page is about the page, whoever it was for.
      if (entry.reason === "dead_lettered") return say("page_dead_lettered");
      // An escalation level's schedule: by the name it had then.
      if (entry.reason === "nobody_on_call")
        return say("page_nobody_on_call", entry.schedule ?? "");
      if (entry.reason === "schedule_missing") return say("page_schedule_missing");
      if (entry.reason === "escalation_stalled") return say("page_escalation_stalled");
      if (entry.reason === "nobody_else") return say("page_nobody_else");
      if (entry.userId === null) return say("page_nobody");
      return say(`page_failed_${entry.reason}`, personName(entry.userId, who, "object"));
    case "escalated": {
      if (entry.level === null) {
        // A page made again because its event was lost: about the page, not why it went to everyone.
        if (entry.again) return say("escalated_everyone_again");
        if (entry.reason === "stalled") return say("escalated_everyone_stalled");
        if (entry.reason === "manual") return say("escalated_everyone_manual");
        return say(entry.later ? "escalated_everyone_later" : "escalated_everyone");
      }
      const level = m.escalation_level_round({
        level: String(entry.level),
        round: String(entry.round),
      });
      // Whoever caused the run's first page is reached without a push: "Level 1: you (declared it)", not "Paged".
      const aware = (id: string) => id === entry.causedBy;
      const names = entry.userIds
        .map((id) => (aware(id) ? declarer(id, who) : personName(id, who)))
        .join(", ");
      if (entry.again) return say("escalated_again", level);
      if (entry.userIds.length > 0 && entry.userIds.every(aware)) {
        return say("escalated_started_aware", level, names);
      }
      // Every push of a level failed, so the next one was paged before its timeout.
      if (entry.reason === "undelivered" && entry.unreached !== undefined) {
        return m.escalation_early({ from: String(entry.unreached), level, who: names });
      }
      // A reason this client has no words for (a newer server's) reads as a plain page of the level, never as
      // "changed the incident".
      const known = ["started", "timeout", "unreachable", "undelivered", "manual"].includes(
        entry.reason,
      );
      return say(known ? `escalated_${entry.reason}` : "escalated_started", level, names);
    }
    case "paged_again":
      // Brigade's own, for a lost declaration: about the page, not who ran it.
      if (entry.auto) return say("paged_again_auto");
      if (entry.everyone || entry.userIds.length === 0) return say("paged_again_everyone");
      return say(
        "paged_again",
        entry.userIds.map((id) => personName(id, who, "object")).join(", "),
      );
    case "escalation_exhausted":
      return say("escalation_exhausted");
    case "email_failed":
      // Written by the notifier, like a failed page: about who was not emailed.
      return say(
        entry.reason === "capped" ? "email_capped" : `email_failed_${entry.about}`,
        personName(entry.userId, who, "object"),
      );
    case "slack_failed":
      // Written by the notifier: about the channel message, not who wrote it.
      return say(`slack_failed_${entry.reason}`);
    // Catalog changes read by the names they had then (RFC 0003 "Incident types", "Custom fields").
    case "type_changed":
      if (entry.to === null) {
        return entry.from === null ? say("type_cleared_deleted") : say("type_cleared", entry.from);
      }
      if (entry.fromDeleted) return say("type_changed_deleted", entry.to);
      return entry.from === null
        ? say("type_set", entry.to)
        : say("type_changed", entry.from, entry.to);
    case "services_changed": {
      const added = entry.added.join(", ");
      const removed = entry.removed.join(", ");
      if (added && removed) return say("services_changed", added, removed);
      if (added) return say("services_added", added);
      return removed ? say("services_removed", removed) : say("services_updated");
    }
    case "field_changed":
      return entry.value === null && !entry.labels?.length
        ? say("field_cleared", entry.field)
        : say("field_set", entry.field, fieldText(entry.value, entry.labels));
    case "status_published":
      return say(
        "status_published",
        m.status_text({ part: `public_${entry.status}`, time: "", list: "" }),
      );
    case "status_corrected":
      return say(`status_corrected_${entry.change}`);
    // Follow-ups and the postmortem (RFC 0013), by the follow-up's title then.
    case "follow_up":
      return say(`follow_up_${entry.change}`, entry.title);
    case "postmortem":
      return say(`postmortem_${entry.change}`);
    default:
      // A kind a newer shard wrote that this build does not know: a line saying something changed, never a blank.
      return say("unknown");
  }
}

/** A custom field's value in a sentence: a select's labels, a number in the reader's locale, or the text. */
export function fieldText(
  value: string | number | string[] | null,
  labels?: readonly string[],
): string {
  if (labels?.length) return labels.join(", ");
  if (typeof value === "number") return formatNumber(value, getLocale());
  if (Array.isArray(value)) return value.join(", ");
  return value ?? "";
}

/** Pages that failed together, as `timelineItems` groups them (only what the wording needs). */
type PagesFailed = {
  kind: "pages_failed";
  reason: PageFailure;
  entries: readonly { id: string; userId: string }[];
};

/**
 * A timeline line from `timelineItems` (`@freecorps/brigade-sync`): an entry's sentence, or for pages that failed
 * together, "Couldn't page 21 people: no registered device" (who they were is `pagesFailedNames`).
 */
export function itemText(
  item: { kind: "entry"; entry: TimelineRow } | PagesFailed,
  who: People,
): string {
  if (item.kind === "entry") return entryText(item.entry, who);
  return m.timeline_pages_failed({ reason: item.reason, count: item.entries.length });
}

/**
 * Who a group of failed pages was for, by name in `locale`'s alphabetical order (`Intl.Collator`), so a long list
 * can be scanned for someone; `id` is the entry's, for a list key.
 */
export function pagesFailedNames(
  item: PagesFailed,
  who: People,
  locale: Locale,
): { id: string; name: string }[] {
  const collator = new Intl.Collator(locale, { sensitivity: "base" });
  return item.entries
    .map((entry) => ({ id: entry.id, name: personName(entry.userId, who) }))
    .sort((a, b) => collator.compare(a.name, b.name));
}

/**
 * Why a change was refused: a mutation error code of the shard or the sync client (`SyncErrorCode` in
 * `@freecorps/brigade-sync`), or `clock_skew` for a declare refused for the device's clock. An unknown code reads
 * as a server problem.
 */
export type NoticeReason = string;

const REASONS = {
  forbidden: m.sync_error_forbidden,
  not_found: m.sync_error_not_found,
  conflict: m.sync_error_conflict,
  invalid_transition: m.sync_error_invalid_transition,
  invalid_args: m.sync_error_invalid_args,
  expired: m.sync_error_expired,
  too_many_pending: m.sync_error_too_many_pending,
  closed: m.sync_error_closed,
  internal: m.sync_error_internal,
  // A mutation this client knows but the deployed API does not: a version skew, worded as a server problem.
  unknown_mutation: m.sync_error_internal,
  limit_reached: m.sync_error_limit_reached,
  clock_skew: m.sync_error_clock_skew,
} satisfies Record<string, () => string>;

/**
 * The reasons with their own wording. `NoticeReason` stays a string (a newer server can send a code this build
 * does not know), so apps/web/test/incidents.test.ts checks every `SyncErrorCode` is one of these.
 */
export type WordedReason = keyof typeof REASONS;

/** A translated reason for a refused mutation; never the server's English message. */
export function mutationErrorReason(code: NoticeReason): string {
  return (Object.hasOwn(REASONS, code) ? REASONS[code as WordedReason] : m.sync_error_internal)();
}

/**
 * Why the shard refused a query itself (a query error code, a plain string on the wire). `closed` is this client
 * having stopped, not a server fault.
 */
export function queryErrorReason(code: string | undefined): string {
  if (code === "forbidden") return m.sync_error_read_forbidden();
  if (code === "closed") return m.sync_error_closed();
  return m.sync_error_internal();
}

/** A refused change, kept as data and worded at render, so it follows a language switch. */
export type Notice = {
  key: string;
  kind: "declare" | "status" | "severity" | "update" | "role";
  reason: NoticeReason;
  incidentId: string;
  number: number | null;
  title: string;
  /** The status or severity it tried to set. */
  to?: IncidentStatus | Severity;
  /** The incident role it tried to change: its id, and the workspace's name for it when it has one. */
  role?: string;
  roleName?: string | null;
};

export type NoticeTarget = Omit<Notice, "key" | "reason">;

/** A sync client's `MutationOutcome` (`@freecorps/brigade-sync`), as far as a notice reads it. */
export type Outcome =
  | { ok: true; version?: number }
  | {
      ok: false;
      error: {
        code: string;
        message?: string;
        issues?: readonly { path: string; message?: string }[];
      };
    };

/**
 * The notice a mutation's outcome leaves, if it failed. An `invalid_args` naming the `id` means the id's time
 * (the device clock) is more than 10 minutes ahead of the shard's: the title itself was fine.
 */
export function noticeFor(outcome: Outcome, target: NoticeTarget, key: string): Notice | undefined {
  if (outcome.ok) return undefined;
  const { code, issues } = outcome.error;
  const skew = code === "invalid_args" && issues?.some((issue) => issue.path === "id") === true;
  return { ...target, key, reason: skew ? "clock_skew" : code };
}

/**
 * How a notice is worded. `card`: one sentence naming the incident and the change, for a live region and tests.
 * `row`: only the change ("Couldn't move it to Fixing."); the row, the incident's page or a subject line drawn
 * above it (`noticeSubject`) says which incident.
 */
export type NoticePlace = "row" | "card";

export function noticeText(notice: Notice, place: NoticePlace): string {
  const reason = mutationErrorReason(notice.reason);
  if (notice.kind === "declare") {
    return place === "row"
      ? m.incident_declare_failed_here({ reason })
      : m.incident_declare_failed({ title: notice.title, reason });
  }
  // Made on the incident's own page, which says which incident: only the change.
  if (notice.kind === "update" || notice.kind === "role") {
    const role = notice.role ? roleLabel(notice.role, notice.roleName, "sentence") : "";
    return m.incident_change_failed({ kind: notice.kind, role, reason });
  }
  // The order of number and title is the message's, not the code's.
  const number = formatIncidentNumber(notice.number);
  const incident = number
    ? m.incident_label({ number, title: notice.title })
    : m.incident_quoted_title({ title: notice.title });
  // `to` is optional on the type; without it there is no status or severity to name, only the reason.
  if (notice.to === undefined) return reason;
  if (notice.kind === "status") {
    const status = incidentStatusLabels[notice.to as IncidentStatus]();
    return place === "row"
      ? m.incident_move_failed_here({ status, reason })
      : m.incident_move_failed({ incident, status, reason });
  }
  const severity = severityName(notice.to as Severity);
  return place === "row"
    ? m.incident_severity_failed_here({ severity, reason })
    : m.incident_severity_failed({ incident, severity, reason });
}

/** Which incident a notice is about, as separate parts: `INC-5` (or null) and the quoted title. */
export function noticeSubject(notice: Notice): { number: string | null; title: string } {
  return {
    number: formatIncidentNumber(notice.number),
    title: m.incident_quoted_title({ title: notice.title }),
  };
}
