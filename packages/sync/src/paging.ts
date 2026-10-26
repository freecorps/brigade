// "Why wasn't I paged?" (RFC 0006 "Delivery receipts"): for one incident and one member, what paging did with them,
// step by step, from what every member already holds (the incident and its escalation run, the timeline, the
// delivery rows and the device summaries). Pure and string-free; the dashboard words it.
import {
  deliveryStage,
  type DeliveryRow,
  type DeliveryStage,
  type DeviceSummaryRow,
  type EmailSettings,
  type EscalationPage,
  type EscalationReason,
  type IncidentRow,
  type MemberRow,
  type PageFailure,
  type Role,
  type ScheduleRow,
  type TimelineRow,
} from "@freecorps/brigade-schema";

/**
 * The answer in a word, best outcome first: a phone said it opened a page (`delivered`); APNs took one but no phone
 * said so yet (`accepted`, not proof it was not shown: receipts are best effort); a page is on its way (`sending`);
 * every push failed (`failed`); a page was for them but reached no device (`missed`); they declared it, so nobody
 * pushed them (`declarer`); they cannot be paged (`excluded`: a viewer, or no longer a member); paging went to others
 * (`not_targeted`); or nothing paged at all yet (`none`).
 */
export type WhyVerdict =
  | "delivered"
  | "accepted"
  | "sending"
  | "failed"
  | "missed"
  | "declarer"
  | "excluded"
  | "not_targeted"
  | "none";

/** Whether one page was for the member, and if not, why. */
export type WhyTargeted =
  /** It was for them: see its deliveries and misses. */
  | "paged"
  /** They caused it (declared the incident): counted as reached, not pushed. */
  | "declarer"
  /** The level pages schedules, and someone else was on call. */
  | "not_on_call"
  /** The level names neither them nor a schedule they could be on call for. */
  | "not_in_level"
  /** Everyone who can respond was paged, and they could not respond (a viewer, or not a member then). */
  | "excluded"
  /** The interim rule paged the incident's commander alone. */
  | "commander_only";

export type WhyMiss = { reason: PageFailure; at: number; schedule: string | null };

/** One page of the incident, as it concerned the member. */
export type WhyPage = {
  /** The escalation run's step (1-based); null without a run (the interim rule). */
  step: number | null;
  /** The level paged; null for everyone who can respond (or the interim rule). */
  level: number | null;
  round: number;
  at: number;
  /** Why this level fired; null without a run. */
  reason: EscalationReason | null;
  again: boolean;
  targeted: WhyTargeted;
  /** The level's schedules, by name (a deleted one is null), to say whose rotation it followed. */
  schedules: (string | null)[];
  /** Who the level reached (member ids), to say who was on call instead. */
  reached: string[];
  /** The member's devices this page went to, each with its stages. */
  deliveries: WhyDelivery[];
  /** Why it did not reach them, as the timeline recorded it. */
  misses: WhyMiss[];
};

export type WhyDelivery = { row: DeliveryRow; stage: DeliveryStage };

/** What became of the email Brigade sends a member a SEV1 or SEV2 page missed (RFC 0005 "Email"). */
export type WhyEmail = "expected" | "failed" | "capped" | "off";

export type WhyPaged = {
  verdict: WhyVerdict;
  /** Their place in the workspace now: a member who can respond, a viewer, or gone. */
  member: { status: "responder" | "viewer" | "gone"; role: Role | null };
  rule: { kind: "policy"; name: string } | { kind: "interim"; commander: string | null };
  pages: WhyPage[];
  /** Their devices registered now. */
  devices: DeviceSummaryRow[];
  email: WhyEmail | null;
  acknowledged: { by: string; at: number } | null;
};

export type WhyInput = {
  incident: IncidentRow;
  userId: string;
  members: readonly MemberRow[];
  devices: readonly DeviceSummaryRow[];
  /** The incident's delivery rows (`incident.deliveries`). */
  deliveries: readonly DeliveryRow[];
  /** The incident's timeline (`incident.timeline`). */
  timeline: readonly TimelineRow[];
  schedules: readonly ScheduleRow[];
  /** The workspace's email settings; absent: on. */
  email?: EmailSettings;
};

const PAGING_SEVERITIES = new Set(["sev1", "sev2"]);
/** Misses the member-a-page-missed email is about (RFC 0005 "Email"). */
const EMAILED: ReadonlySet<PageFailure> = new Set([
  "no_devices",
  "undelivered",
  "unsupported",
  "not_configured",
  "over_limit",
]);
const STAGE_RANK: Record<DeliveryStage, number> = {
  planned: 0,
  sent: 1,
  accepted: 2,
  delivered: 3,
};

export function whyPaged(input: WhyInput): WhyPaged {
  const { incident, userId } = input;
  const member = input.members.find((row) => row.id === userId);
  const status = !member ? "gone" : member.role === "viewer" ? "viewer" : "responder";
  const mine = input.deliveries.filter((row) => row.userId === userId);
  const failed = input.timeline.flatMap((entry) =>
    entry.kind === "page_failed" && entry.userId === userId ? [entry] : [],
  );
  const missOf = (entry: (typeof failed)[number]): WhyMiss => ({
    reason: entry.reason,
    at: entry.at,
    schedule: entry.schedule ?? null,
  });
  const run = incident.escalation ?? null;
  const declarer = run?.causedBy ?? incident.declaredBy;

  const pages: WhyPage[] = [];
  if (run) {
    const first = run.paged - run.pages.length + 1;
    run.pages.forEach((page, index) => {
      const step = first + index;
      const deliveries = mine
        .filter((row) => row.run === run.eventId && row.step === step)
        .map(withStage);
      const misses = failed
        .filter((entry) => entry.run === run.eventId && entry.step === step)
        .map(missOf);
      const level = page.level === null ? undefined : run.levels[page.level - 1];
      const schedules = (level?.targets ?? [])
        .filter((target) => target.kind === "schedule")
        .map((target) => input.schedules.find((row) => row.id === target.id)?.name ?? null);
      pages.push({
        step,
        level: page.level,
        round: page.round,
        at: page.at,
        reason: page.reason,
        again: page.again === true,
        targeted: targeted(page, step, {
          userId,
          declarer,
          member,
          commander: incident.roles?.commander ?? null,
          names:
            level?.targets.some((target) => target.kind === "member" && target.id === userId) ??
            false,
          schedules: schedules.length > 0,
          deliveries: deliveries.length,
          misses: misses.length,
        }),
        schedules,
        reached: page.userIds.filter((id) => id !== userId),
        deliveries,
        misses,
      });
    });
  }
  // Pages outside a run: the interim rule, or pages from before the run started.
  const outside = mine.filter((row) => row.run === null || row.run !== run?.eventId);
  const outsideMisses = failed.filter((entry) => entry.run === undefined).map(missOf);
  if (!run || outside.length > 0 || outsideMisses.length > 0) {
    const commander = incident.roles?.commander ?? null;
    const reachedAny = outside.length > 0 || outsideMisses.length > 0;
    pages.unshift({
      step: null,
      level: null,
      round: 0,
      at: Math.min(...outside.map((row) => row.plannedAt), incident.declaredAt),
      reason: null,
      again: false,
      targeted: reachedAny
        ? "paged"
        : userId === incident.declaredBy
          ? "declarer"
          : status !== "responder"
            ? "excluded"
            : commander !== null && commander !== userId
              ? "commander_only"
              : "not_in_level",
      schedules: [],
      reached: [],
      deliveries: outside.map(withStage),
      misses: outsideMisses,
    });
  }

  const deliveries = pages.flatMap((page) => page.deliveries);
  const misses = pages.flatMap((page) => page.misses);
  const best = deliveries.reduce<DeliveryStage | null>(
    (top, { stage }) => (top === null || STAGE_RANK[stage] > STAGE_RANK[top] ? stage : top),
    null,
  );
  let verdict: WhyVerdict;
  if (best === "delivered" || best === "accepted") verdict = best;
  else if (deliveries.some(({ row }) => row.error === null)) verdict = "sending";
  else if (deliveries.length > 0) verdict = "failed";
  else if (misses.length > 0) verdict = "missed";
  else if (pages.some((page) => page.targeted === "declarer")) verdict = "declarer";
  else if (status !== "responder") verdict = "excluded";
  else if (pages.some((page) => page.targeted !== "paged")) verdict = "not_targeted";
  else verdict = "none";

  return {
    verdict,
    member: { status, role: member?.role ?? null },
    rule: run
      ? { kind: "policy", name: run.policyName }
      : { kind: "interim", commander: incident.roles?.commander ?? null },
    pages,
    devices: input.devices.filter((device) => device.userId === userId),
    email: emailOf(input, misses),
    acknowledged:
      incident.acknowledgedAt != null && incident.acknowledgedBy != null
        ? { by: incident.acknowledgedBy, at: incident.acknowledgedAt }
        : null,
  };
}

function withStage(row: DeliveryRow): WhyDelivery {
  return { row, stage: deliveryStage(row) };
}

function targeted(
  page: EscalationPage,
  step: number,
  who: {
    userId: string;
    declarer: string;
    member: MemberRow | undefined;
    commander: string | null;
    /** The level names them as a person. */
    names: boolean;
    /** The level pages at least one schedule. */
    schedules: boolean;
    deliveries: number;
    misses: number;
  },
): WhyTargeted {
  if (who.deliveries > 0 || who.misses > 0) return "paged";
  if (page.userIds.includes(who.userId)) {
    // Reached without a push: whoever caused the run's first page.
    return who.userId === who.declarer ? "declarer" : "paged";
  }
  if (page.missed.some((miss) => miss.userId === who.userId)) return "paged";
  if (who.userId === who.declarer && (page.level === null || step === 1)) return "declarer";
  if (!who.member || who.member.role === "viewer") return "excluded";
  if (page.level === null) {
    // The interim rule as a fallback asks the commander first; after nobody acknowledged it is everyone.
    const everyone = page.reason === "exhausted" || page.reason === "stalled";
    return !everyone && who.commander !== null && who.commander !== who.userId
      ? "commander_only"
      : "paged";
  }
  if (who.names) return "excluded";
  return who.schedules ? "not_on_call" : "not_in_level";
}

function emailOf(input: WhyInput, misses: readonly WhyMiss[]): WhyEmail | null {
  const emails = input.timeline.filter(
    (entry) =>
      entry.kind === "email_failed" && entry.userId === input.userId && entry.about === "unpaged",
  );
  const last = emails[emails.length - 1];
  if (last?.kind === "email_failed") return last.reason === "capped" ? "capped" : "failed";
  if (!PAGING_SEVERITIES.has(input.incident.severity)) return null;
  if (!misses.some((miss) => EMAILED.has(miss.reason))) return null;
  return input.email?.unpaged === false ? "off" : "expected";
}
