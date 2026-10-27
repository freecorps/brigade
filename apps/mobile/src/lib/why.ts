// "Why wasn't I paged?" on the phone (RFC 0006 "Delivery receipts"): who the incident screen lists and whom the
// member picker offers, from `whyPaged` in packages/sync, as the dashboard's `?why=<member>` does. Pure, so it is
// tested without React Native; the wording is `@freecorps/brigade-i18n/why-paged`.
import { memberName, pagingMembers, byUrgency } from "@freecorps/brigade-i18n/why-paged";
import type { People } from "@freecorps/brigade-i18n/incident";
import {
  can,
  isActive,
  type DeliveryRow,
  type DeviceSummaryRow,
  type EmailSettings,
  type IncidentRow,
  type MemberRow,
  type MemberSettingsRow,
  type Role,
  type ScheduleRow,
  type TimelineRow,
} from "@freecorps/brigade-schema";
import { whyPaged, type WhyCall, type WhyVerdict } from "@freecorps/brigade-sync";

/** What every why-wasn't-I-paged view reads: the incident's rows and the workspace's. */
export type PagingData = {
  incident: IncidentRow;
  members: readonly MemberRow[];
  devices: readonly DeviceSummaryRow[];
  deliveries: readonly DeliveryRow[];
  timeline: readonly TimelineRow[];
  schedules: readonly ScheduleRow[];
  email?: EmailSettings;
  /** Members' own paging settings (which pages ring them as a call); absent: the defaults. */
  settings?: readonly MemberSettingsRow[];
  now: number;
};

export type PagingListRow = { id: string; verdict: WhyVerdict; call: WhyCall | null };

/**
 * The incident screen's list: everyone who can respond, and anyone else a page touched, with what paging did with
 * them in a word, whoever needs a look first.
 */
export function pagingList(data: PagingData): PagingListRow[] {
  const touched = data.timeline.flatMap((entry) =>
    entry.kind === "page_failed" && entry.userId !== null ? [entry.userId] : [],
  );
  return byUrgency(
    pagingMembers(data.members, data.deliveries, touched).map((id) => {
      const why = whyPaged({ ...data, userId: id });
      return { id, verdict: why.verdict, call: why.call };
    }),
  );
}

/**
 * Whom the explanation's member picker offers, by name with numbers in order ("Ana 2" before "Ana 10"): the list's
 * members, plus the one shown (someone no longer listed stays pickable).
 */
export function memberChoices(
  data: Pick<PagingData, "members" | "deliveries">,
  shown: string,
  who: People,
  locale: string,
): { id: string; name: string }[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return pagingMembers(data.members, data.deliveries, [shown])
    .map((id) => ({ id, name: memberName(id, who) }))
    .sort((a, b) => collator.compare(a.name, b.name));
}

/**
 * Whether the member may page a failed page again (`incident.pageAgain`), as the dashboard offers it: owners and
 * admins, while the incident is active and nobody has acknowledged it (RFC 0005 "Notifiers").
 */
export function canPageAgain(
  role: Role,
  row: Pick<IncidentRow, "status" | "acknowledgedAt" | "acknowledgedBy">,
): boolean {
  const acked = row.acknowledgedAt != null && row.acknowledgedBy != null;
  return can(role, "escalation:manage") && isActive(row.status) && !acked;
}
