// The dashboard's side of escalation policies: the editor's checks, dropping targets that went away, what a run
// fires next and whom it would page, how its status reads, whose push failed, and how its timeline entries read in
// both languages.
import { setLocale } from "@freecorps/brigade-i18n";
import { entryText, people } from "@freecorps/brigade-i18n/incident";
import type {
  Escalation,
  EscalationPage,
  MemberRow,
  OverrideRow,
  ScheduleRow,
  TimelineRow,
} from "@freecorps/brigade-schema";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  checkPolicy,
  draftTargets,
  emptyPolicy,
  failedDeliveries,
  forecast,
  nextStep,
  runStatus,
  timeoutKind,
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
    paged: pages.length,
    pages,
  });
  const page = (level: number | null, round = 0, fields: Partial<EscalationPage> = {}) => ({
    level,
    round,
    at: 0,
    userIds: [],
    missed: [],
    missedCount: 0,
    reason: "timeout" as const,
    ...fields,
  });

  test("says what fires next: the next level, level 1 again, or the end", () => {
    expect(nextStep(run([page(1)]))).toEqual({ kind: "level", level: 2 });
    expect(nextStep(run([page(1), page(2)], 1))).toEqual({ kind: "repeat", level: 1 });
    expect(nextStep(run([page(1), page(2)]))).toEqual({ kind: "end", level: 2 });
  });

  test("forecasts the next level: its people, and each schedule with whoever is on call now", () => {
    const schedule = {
      id: SCH,
      name: "Primary",
      timeZone: "UTC",
      layers: [
        {
          id: "lyr_01JB0000000000000000000001",
          name: "",
          members: ["usr_caio"],
          startDate: "2026-01-01",
          handoffTime: "09:00",
          unit: "weeks",
          count: 1,
        },
      ],
      createdAt: 0,
      createdBy: "usr_ana",
      updatedAt: 0,
    } as ScheduleRow;
    const now = Date.UTC(2026, 9, 26, 12);
    const withTargets = run([page(1)]);
    withTargets.levels[1] = {
      ...withTargets.levels[1]!,
      targets: [
        { kind: "member", id: "usr_eva" },
        { kind: "schedule", id: SCH },
        { kind: "schedule", id: "sch_01JB0000000000000000000009" },
      ],
    };
    expect(forecast(withTargets, [schedule], [] as OverrideRow[], now)).toEqual([
      { kind: "member", id: "usr_eva" },
      { kind: "schedule", id: SCH, name: "Primary", onCall: "usr_caio" },
      { kind: "schedule", id: "sch_01JB0000000000000000000009", name: null, onCall: null },
    ]);
    // The end of the run pages everyone who can respond: nothing to forecast by name.
    expect(forecast(run([page(1), page(2)]), [schedule], [], now)).toEqual([]);
  });

  test("an ack reads first whatever the run's status; a fallback says why it paged everyone", () => {
    const acked = { acknowledgedAt: 50, acknowledgedBy: "usr_ana" };
    const open = { acknowledgedAt: null, acknowledgedBy: null };
    const ended = (reason: EscalationPage["reason"]): Escalation => ({
      ...run([page(1), page(null, 0, { reason })]),
      status: "exhausted",
      endedAt: 40,
    });
    expect(runStatus(ended("exhausted"), acked)).toEqual({
      kind: "acknowledged",
      by: "usr_ana",
      at: 50,
    });
    expect(runStatus(run([page(1)]), open)).toEqual({ kind: "running" });
    for (const reason of ["unreachable", "exhausted", "stalled"] as const) {
      expect(runStatus(ended(reason), open)).toEqual({ kind: "fallback", reason, at: 40 });
    }
  });

  test("a reached member whose push failed is marked on the page that reached them", () => {
    const failed = (at: number, userId: string, reason: string) =>
      ({ kind: "page_failed", at, userId, reason }) as TimelineRow;
    const pages = [
      page(1, 0, { at: 10, userIds: ["usr_ana", "usr_bia"] }),
      page(2, 0, { at: 20, userIds: ["usr_eva"] }),
    ];
    const marked = failedDeliveries(pages, [
      failed(12, "usr_ana", "undelivered"),
      // A member a level could not page at all is the page's miss, not a failed push.
      failed(12, "usr_bia", "no_devices"),
      failed(25, "usr_eva", "not_configured"),
      failed(26, "usr_ana", "undelivered"),
    ]);
    expect(marked.map((set) => [...set])).toEqual([["usr_ana"], ["usr_eva"]]);
  });

  test("a level's timeout says what comes after it", () => {
    expect(timeoutKind(0, 2, 0)).toBe("timeout");
    expect(timeoutKind(1, 2, 1)).toBe("timeout_repeat");
    expect(timeoutKind(1, 2, 0)).toBe("timeout_end");
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
      "Ninguém confirmou depois de todos os níveis, então todos que podem responder foram chamados",
    );
  });
});
