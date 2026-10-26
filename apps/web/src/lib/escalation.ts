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
  type MemberRow,
  type OverrideRow,
  type ScheduleRow,
} from "@freecorps/brigade-schema";

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));

export { MAX_LEVEL_TARGETS, MAX_POLICY_REPEAT, POLICY_NAME_MAX };

export type LevelDraft = { id: string; targets: EscalationTarget[]; timeout: string };
export type PolicyDraft = {
  name: string;
  levels: LevelDraft[];
  repeat: number;
  isDefault: boolean;
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
  return { name: "", levels: [newLevel(now)], repeat: 0, isDefault: !hasDefault };
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
  };
}

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
    },
  };
}

/** `escalation_text` without the inputs a part does not use. */
export function escalationText(
  part: Parameters<typeof m.escalation_text>[0]["text"],
  inputs: { name?: string; time?: string; level?: string; reason?: string } = {},
): string {
  return m.escalation_text({ name: "", time: "", level: "", reason: "", ...inputs, text: part });
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
