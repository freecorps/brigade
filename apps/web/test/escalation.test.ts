// The dashboard's side of escalation policies: the editor's checks, dropping targets that went away, what a run
// fires next, and how its timeline entries read in both languages.
import { setLocale } from "@freecorps/brigade-i18n";
import { entryText, people } from "@freecorps/brigade-i18n/incident";
import type { Escalation, MemberRow, ScheduleRow, TimelineRow } from "@freecorps/brigade-schema";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  checkPolicy,
  draftTargets,
  emptyPolicy,
  nextStep,
  type PolicyDraft,
} from "../src/lib/escalation.ts";

const ESC = "esc_01JB0000000000000000000001";
const LVL = "lvl_01JB0000000000000000000001";
const SCH = "sch_01JB0000000000000000000001";

afterEach(() => setLocale("en"));

const draft = (patch: Partial<PolicyDraft> = {}): PolicyDraft => ({
  name: " Checkout ",
  levels: [{ id: LVL, targets: [{ kind: "member", id: "usr_ana" }], timeout: "5" }],
  repeat: 1,
  isDefault: true,
  ...patch,
});

describe("the policy editor", () => {
  test("a new policy is the default only when the workspace has none", () => {
    expect(emptyPolicy(0, false).isDefault).toBe(true);
    expect(emptyPolicy(0, true).isDefault).toBe(false);
  });

  test("sends trimmed names and whole-minute timeouts; flags what is wrong", () => {
    expect(checkPolicy(ESC, draft())).toEqual({
      ok: true,
      args: {
        id: ESC,
        name: "Checkout",
        levels: [{ id: LVL, targets: [{ kind: "member", id: "usr_ana" }], timeoutMinutes: 5 }],
        repeat: 1,
        isDefault: true,
      },
    });
    for (const timeout of ["0", "1441", "2.5", "", "five"]) {
      const result = checkPolicy(
        ESC,
        draft({ name: "", levels: [{ id: LVL, targets: [], timeout }] }),
      );
      expect(result, timeout).toEqual({
        ok: false,
        errors: { name: true, levels: [{ timeout: true, targets: true }] },
      });
    }
  });

  test("targets that went away are dropped when the editor opens, and it says so", () => {
    const schedules = [{ id: SCH, name: "Primary" }] as ScheduleRow[];
    const members = [
      { id: "usr_ana", name: "Ana", role: "owner", updatedAt: 0 },
      { id: "usr_duda", name: "Duda", role: "viewer", updatedAt: 0 },
    ] satisfies MemberRow[];
    const opened = draftTargets(
      draft({
        levels: [
          {
            id: LVL,
            targets: [
              { kind: "schedule", id: SCH },
              { kind: "schedule", id: "sch_01JB0000000000000000000009" },
              { kind: "member", id: "usr_ana" },
              { kind: "member", id: "usr_duda" },
              { kind: "member", id: "usr_gone" },
            ],
            timeout: "5",
          },
        ],
      }),
      schedules,
      members,
    );
    expect(opened.dropped).toBe(true);
    expect(opened.draft.levels[0]!.targets).toEqual([
      { kind: "schedule", id: SCH },
      { kind: "member", id: "usr_ana" },
    ]);
  });
});

describe("a run on the incident page", () => {
  const run = (pages: Escalation["pages"], repeat = 0): Escalation => ({
    policyId: ESC,
    policyName: "Checkout",
    levels: [
      { id: LVL, targets: [], timeoutMinutes: 5 },
      { id: "lvl_01JB0000000000000000000002", targets: [], timeoutMinutes: 5 },
    ],
    repeat,
    eventId: "evt_01JB0000000000000000000001",
    causedBy: "sys_monitors",
    status: "running",
    startedAt: 0,
    endedAt: null,
    nextAt: 1,
    pages,
  });
  const page = (level: number, round = 0) => ({ level, round, at: 0, userIds: [], missed: [] });

  test("says what fires next: the next level, level 1 again, or the end", () => {
    expect(nextStep(run([page(1)]))).toEqual({ kind: "level", level: 2 });
    expect(nextStep(run([page(1), page(2)], 1))).toEqual({ kind: "repeat", level: 1 });
    expect(nextStep(run([page(1), page(2)]))).toEqual({ kind: "end", level: 2 });
  });

  test("escalation entries read in English and Portuguese", async () => {
    const who = people("usr_me", [{ id: "usr_ana", name: "Ana", role: "owner", updatedAt: 0 }]);
    const entry = (fields: object) =>
      ({
        id: "i:1",
        incidentId: "i",
        seq: 1,
        at: 0,
        actor: "sys_escalation",
        ...fields,
      }) as TimelineRow;
    const escalated = entry({
      kind: "escalated",
      level: 2,
      round: 1,
      userIds: ["usr_ana", "usr_me"],
      reason: "timeout",
    });
    const gap = entry({
      kind: "page_failed",
      userId: null,
      reason: "nobody_on_call",
      schedule: "Primary",
    });
    expect(entryText(escalated, who)).toBe(
      "Nobody acknowledged, so level 2 (repeat 1) was paged: Ana, You",
    );
    expect(entryText(gap, who)).toBe("Couldn't page Primary: nobody on call");
    expect(
      entryText(
        entry({ kind: "escalated", level: null, round: 0, userIds: [], reason: "unreachable" }),
        who,
      ),
    ).toBe("No level could reach anyone, so everyone who can respond was paged");
    await setLocale("pt-BR");
    expect(entryText(gap, who)).toBe("Não foi possível chamar Primary: ninguém de plantão");
    expect(entryText(entry({ kind: "escalation_exhausted", levels: 2, rounds: 1 }), who)).toBe(
      "Ninguém confirmou depois de todos os níveis da política de escalonamento",
    );
  });
});
