// Escalation policies on the dashboard (RFC 0003 "Escalation policies"): the editor's draft, its checks before a
// mutation is sent, and how a run on an incident reads (RFC 0003 "Escalation run"). String-free except labels.

import { m } from "@freecorps/brigade-i18n";
import { mutationErrorReason } from "@freecorps/brigade-i18n/incident";
import {
  MAX_LEVEL_TARGETS,
  MAX_LEVEL_TIMEOUT,
  MAX_POLICIES_PER_WORKSPACE,
  MAX_POLICY_LEVELS,
  MAX_POLICY_REPEAT,
  MIN_LEVEL_TIMEOUT,
  newId,
  onCallAt,
  POLICY_NAME_MAX,
  type Escalation,
  type EscalationPolicyRow,
  type EscalationTarget,
  type IncidentRow,
  type MemberRow,
  type OverrideRow,
  type PageFailure,
  type ScheduleRow,
  type Severity,
  type TimelineRow,
} from "@freecorps/brigade-schema";

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));

export { MAX_LEVEL_TARGETS, MAX_POLICY_REPEAT, POLICY_NAME_MAX };

export type LevelDraft = { id: string; targets: EscalationTarget[]; timeout: string };
export type PolicyDraft = {
  name: string;
  levels: LevelDraft[];
  repeat: number;
  isDefault: boolean;
  /** From which severity it escalates; null: every severity. */
  minSeverity: Severity | null;
};
export type PolicyErrors = {
  name: boolean;
  levels: { timeout: boolean; targets: boolean }[];
};
export type PolicyArgs = {
  id: string;
  name: string;
  levels: { id: string; targets: EscalationTarget[]; timeoutMinutes: number }[];
  repeat: number;
  isDefault: boolean;
  minSeverity: Severity | null;
};
export type CheckedPolicy = { ok: true; args: PolicyArgs } | { ok: false; errors: PolicyErrors };

export const newPolicyId = (now: number) => newId("esc", now, random);
export const newLevel = (now: number): LevelDraft => ({
  id: newId("lvl", now, random),
  targets: [],
  timeout: "15",
});
export const canAddPolicy = (count: number) => count < MAX_POLICIES_PER_WORKSPACE;
export const canAddLevel = (count: number) => count < MAX_POLICY_LEVELS;

/** A new policy: one level, the default when the workspace has none yet. */
export function emptyPolicy(now: number, hasDefault: boolean): PolicyDraft {
  return {
    name: "",
    levels: [newLevel(now)],
    repeat: 0,
    isDefault: !hasDefault,
    minSeverity: null,
  };
}

export function draftFromPolicy(row: EscalationPolicyRow): PolicyDraft {
  return {
    name: row.name,
    levels: row.levels.map((level) => ({
      id: level.id,
      targets: level.targets.map((target) => ({ ...target })),
      timeout: String(level.timeoutMinutes),
    })),
    repeat: row.repeat,
    isDefault: row.isDefault,
    // SEV4 reads as "every severity", so saving it back stores what the editor shows.
    minSeverity: minSeverityOf(minSeverityChoice(row.minSeverity ?? null)),
  };
}

/**
 * The choices for "Escalate from": every severity, or SEV1, SEV2 or SEV3 and anything more severe. SEV4 would mean
 * every severity, so it is not offered.
 */
export const MIN_SEVERITY_CHOICES = ["every", "sev1", "sev2", "sev3"] as const;
export type MinSeverityChoice = (typeof MIN_SEVERITY_CHOICES)[number];

export const minSeverityChoice = (minSeverity: Severity | null): MinSeverityChoice =>
  minSeverity === null || minSeverity === "sev4" ? "every" : minSeverity;

export const minSeverityOf = (choice: MinSeverityChoice): Severity | null =>
  choice === "every" ? null : choice;

/**
 * Drops targets that can no longer be saved (a deleted schedule, a member who left or became a viewer), so the save
 * does not fail on them; `dropped` says the editor should tell. Only once the lists are loaded.
 */
export function draftTargets(
  draft: PolicyDraft,
  schedules: readonly ScheduleRow[],
  members: readonly MemberRow[],
): { draft: PolicyDraft; dropped: boolean } {
  let dropped = false;
  const levels = draft.levels.map((level) => {
    const targets = level.targets.filter((target) => {
      const ok =
        target.kind === "schedule"
          ? schedules.some((row) => row.id === target.id)
          : members.some((row) => row.id === target.id && row.role !== "viewer");
      if (!ok) dropped = true;
      return ok;
    });
    return { ...level, targets };
  });
  return { draft: { ...draft, levels }, dropped };
}

/** The draft as `escalation.createPolicy`/`updatePolicy` args, or which fields are wrong. */
export function checkPolicy(id: string, draft: PolicyDraft): CheckedPolicy {
  const name = draft.name.trim();
  const errors: PolicyErrors = {
    name: name.length === 0 || name.length > POLICY_NAME_MAX,
    levels: draft.levels.map((level) => {
      const timeout = Number(level.timeout.trim());
      return {
        timeout:
          !/^\d+$/.test(level.timeout.trim()) ||
          timeout < MIN_LEVEL_TIMEOUT ||
          timeout > MAX_LEVEL_TIMEOUT,
        targets: level.targets.length === 0 || level.targets.length > MAX_LEVEL_TARGETS,
      };
    }),
  };
  if (errors.name || errors.levels.some((level) => level.timeout || level.targets)) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    args: {
      id,
      name,
      levels: draft.levels.map((level) => ({
        id: level.id,
        targets: level.targets,
        timeoutMinutes: Number(level.timeout.trim()),
      })),
      repeat: draft.repeat,
      isDefault: draft.isDefault,
      minSeverity: draft.minSeverity,
    },
  };
}

/** `escalation_text` without the inputs a part does not use. */
export function escalationText(
  part: Parameters<typeof m.escalation_text>[0]["text"],
  inputs: { name?: string; time?: string; level?: string; reason?: string; who?: string } = {},
): string {
  return m.escalation_text({
    name: "",
    time: "",
    level: "",
    reason: "",
    who: "",
    ...inputs,
    text: part,
  });
}

export function policyRefusal(code: string): string {
  if (code === "not_found") return escalationText("gone");
  return mutationErrorReason(code);
}

/** A target's name: the schedule's or the member's, or what they became. */
export function targetLabel(
  target: EscalationTarget,
  schedules: readonly ScheduleRow[],
  members: readonly MemberRow[],
): string {
  if (target.kind === "schedule") {
    return (
      schedules.find((row) => row.id === target.id)?.name || escalationText("deleted_schedule")
    );
  }
  return members.find((row) => row.id === target.id)?.name || m.oncall_unnamed();
}

/** Who a schedule target pages right now, or null for a gap (or a deleted schedule). */
export function onCallNow(
  target: EscalationTarget,
  schedules: readonly ScheduleRow[],
  overrides: readonly OverrideRow[],
  now: number,
): string | null {
  if (target.kind !== "schedule") return null;
  const schedule = schedules.find((row) => row.id === target.id);
  return schedule ? (onCallAt(schedule, overrides, now)?.userId ?? null) : null;
}

/** What fires after the level paged last of a running run: the next level, level 1 again, or the end. */
export function nextStep(run: Escalation): { kind: "level" | "repeat" | "end"; level: number } {
  const last = run.pages[run.pages.length - 1];
  const level = last?.level ?? run.levels.length;
  if (level < run.levels.length) return { kind: "level", level: level + 1 };
  if ((last?.round ?? 0) < run.repeat) return { kind: "repeat", level: 1 };
  return { kind: "end", level };
}

/** Which timeout label a level gets: the next level, level 1 again (a repeat), or everyone who can respond. */
export function timeoutKind(
  index: number,
  levels: number,
  repeat: number,
): "timeout" | "timeout_repeat" | "timeout_end" {
  if (index < levels - 1) return "timeout";
  return repeat > 0 ? "timeout_repeat" : "timeout_end";
}

/** What a level would page right now: its people, and each schedule with whoever is on call (null: a gap). */
export type Forecast =
  | { kind: "member"; id: string }
  | { kind: "schedule"; id: string; name: string | null; onCall: string | null };

/**
 * The next level of a running run, as it would resolve now (the run's snapshot of the policy, schedules read live):
 * a forecast, since a schedule pages whoever is on call when the level fires. Empty for the end of the run (everyone
 * who can respond).
 */
export function forecast(
  run: Escalation,
  schedules: readonly ScheduleRow[],
  overrides: readonly OverrideRow[],
  now: number,
): Forecast[] {
  const next = nextStep(run);
  if (next.kind === "end") return [];
  const level = run.levels[next.level - 1];
  if (!level) return [];
  return level.targets.map((target): Forecast => {
    if (target.kind === "member") return { kind: "member", id: target.id };
    const schedule = schedules.find((row) => row.id === target.id);
    return {
      kind: "schedule",
      id: target.id,
      name: schedule?.name ?? null,
      onCall: onCallNow(target, schedules, overrides, now),
    };
  });
}

/** How the run's status line reads: an ack wins whatever the run's status, then the run, then why it fell back. */
export type RunStatus =
  | { kind: "acknowledged"; by: string; at: number }
  | { kind: "running" }
  | { kind: "resolved"; at: number }
  /** Below its policy's `minSeverity`: the run paged once and ended (RFC 0006 "Who is paged"). */
  | { kind: "once"; minSeverity: Severity; at: number }
  | {
      kind: "fallback";
      reason: "unreachable" | "exhausted" | "stalled";
      /** An earlier level paged someone: no later level could reach anyone. */
      later: boolean;
      /** The page to everyone who can respond reached nobody (nobody else can respond, or none could be paged). */
      nobody: boolean;
      at: number;
    };

export function runStatus(
  run: Escalation,
  incident: Pick<IncidentRow, "acknowledgedAt" | "acknowledgedBy">,
  members: readonly MemberRow[],
  timeline: readonly TimelineRow[],
): RunStatus {
  if (incident.acknowledgedAt != null && incident.acknowledgedBy != null) {
    return { kind: "acknowledged", by: incident.acknowledgedBy, at: incident.acknowledgedAt };
  }
  const at = run.endedAt ?? run.startedAt;
  if (run.status === "running") return { kind: "running" };
  if (run.status === "paged_once" && run.once) {
    return { kind: "once", minSeverity: run.once, at };
  }
  if (run.status === "exhausted") {
    const last = run.pages[run.pages.length - 1];
    const reason =
      last?.reason === "exhausted" || last?.reason === "stalled" ? last.reason : "unreachable";
    const later = run.pages.some((page) => page.level !== null) || run.paged > run.pages.length;
    const failed = pageFailures(run, timeline, run.paged);
    const everyone = everyoneWhoCanRespond(members, run.causedBy);
    // An empty list is members not loaded yet, not "nobody reached".
    const nobody =
      failed.nobody ||
      (everyone.length > 0 && everyone.every((member) => failed.users.has(member.id)));
    return { kind: "fallback", reason, later, nobody, at };
  }
  return { kind: "resolved", at };
}

/** Failures that mean a reached member's push did not arrive (as opposed to a target that could not be paged). */
const DELIVERY_FAILURES: readonly PageFailure[] = [
  "undelivered",
  "token_invalid",
  "unsupported",
  "not_configured",
  "over_limit",
];

/** Failures a page whose push was attempted can record, besides members not reached: it found nobody to page. */
const NOBODY_FAILURES: readonly PageFailure[] = ["no_devices", "nobody_else"];

/**
 * The `page_failed` entries of the run's page `step` (1-based, of every page the run made): the members it did not
 * reach, by reason, and whether it found nobody at all (an entry for no one in particular).
 */
function pageFailures(
  run: Escalation,
  timeline: readonly TimelineRow[],
  step: number,
): { users: Map<string, PageFailure>; nobody: boolean } {
  const users = new Map<string, PageFailure>();
  let nobody = false;
  for (const row of timeline) {
    if (row.kind !== "page_failed" || row.run !== run.eventId || row.step !== step) continue;
    if (row.userId !== null) users.set(row.userId, row.reason);
    else if (NOBODY_FAILURES.includes(row.reason)) nobody = true;
  }
  return { users, nobody };
}

/**
 * The members each page reached whose push then failed, from the incident's `page_failed` entries recorded for that
 * page (by the run and the page's step), so a slow failure of one page is never put on the next. Index-aligned with
 * `run.pages`.
 */
export function failedDeliveries(run: Escalation, timeline: readonly TimelineRow[]): Set<string>[] {
  // `pages` keeps the last few: page `index` is the run's step `dropped + index + 1`.
  const dropped = run.paged - run.pages.length;
  return run.pages.map((page, index) => {
    const failed = new Set<string>();
    for (const [userId, reason] of pageFailures(run, timeline, dropped + index + 1).users) {
      if (page.userIds.includes(userId) && DELIVERY_FAILURES.includes(reason)) failed.add(userId);
    }
    return failed;
  });
}

/** Who the interim rule's page was for: everyone who can respond, except whoever caused the run's first page. */
export function everyoneWhoCanRespond(
  members: readonly MemberRow[],
  causedBy: string,
): MemberRow[] {
  return members.filter((member) => member.role !== "viewer" && member.id !== causedBy);
}
