// Escalation policies and runs (RFC 0003 "Escalation policies", "Escalation run"; RFC 0006 "Who is paged"): who
// manages policies, what they may point at, references that go away, and how a run starts, skips unreachable
// levels, falls back to everyone who can respond, times out, repeats, and stops on an ack or a resolve.
import { describe, expect, test } from "vite-plus/test";
import {
  createMemoryStore,
  ESCALATION_ACTOR,
  MAX_ESCALATION_PAGES,
  MAX_PAGE_MISSES,
  MEMBERS_ACTOR,
  answeredEntries,
  mutations,
  PAGE_AGAIN_CONFLICTS,
  runMutation,
  serverMutations,
  type BrigadeTables,
  type EscalationLevel,
  type MutationContext,
  type MutationStore,
  type Role,
} from "../src/index.ts";

const MINUTE = 60_000;
const T = Date.UTC(2026, 9, 26, 12, 0, 0);

const ESC = "esc_01JB0000000000000000000001";
const ESC2 = "esc_01JB0000000000000000000002";
const LVL1 = "lvl_01JB0000000000000000000001";
const LVL2 = "lvl_01JB0000000000000000000002";
const LVL3 = "lvl_01JB0000000000000000000003";
const SCH = "sch_01JB0000000000000000000001";
const INC = "inc_01JB0000000000000000000001";
const EVT = "evt_01JB0000000000000000000001";
/** A page's event the Queue gave up on. */
const LOST = "evt_01JB0000000000000000000009";

const ctx = (
  id: string,
  role: Role,
  now = T,
  kind: "user" | "system" = "user",
): MutationContext => ({ actor: { kind, id, role }, now, server: true });
const system = (now = T): MutationContext => ({ actor: ESCALATION_ACTOR, now, server: true });

/**
 * A shard with members, a schedule whose only layer has Caio on call around `T` (a weekly rotation of one), Eva's
 * device and Caio's, and an incident Ana declared.
 */
function shard() {
  const store = createMemoryStore<BrigadeTables>();
  for (const [id, role] of [
    ["usr_ana", "owner"],
    ["usr_bia", "admin"],
    ["usr_caio", "responder"],
    ["usr_duda", "viewer"],
    ["usr_eva", "responder"],
  ] as const) {
    store.insert("members", { id, name: id.slice(4), role, updatedAt: 0 });
  }
  store.insert("schedules", {
    id: SCH,
    name: "Primary",
    timeZone: "UTC",
    layers: [
      {
        id: "lyr_01JB0000000000000000000001",
        name: "",
        members: ["usr_caio"],
        startDate: "2026-10-01",
        handoffTime: "09:00",
        unit: "weeks",
        count: 1,
      },
    ],
    createdAt: 0,
    createdBy: "usr_ana",
    updatedAt: 0,
  });
  for (const userId of ["usr_caio", "usr_eva", "usr_ana"]) device(store, userId);
  store.insert("incidents", {
    id: INC,
    number: 1,
    title: "Checkout is down",
    severity: "sev1",
    status: "triage",
    declaredAt: T,
    declaredBy: "usr_ana",
    acknowledgedAt: null,
    acknowledgedBy: null,
    roles: {},
    timelineSeq: 0,
    updatedAt: T,
  });
  return store;
}

let devices = 0;
function device(store: MutationStore, userId: string) {
  store.insert("devices", {
    id: `dev_01JB00000000000000000000${String(++devices).padStart(2, "0")}`,
    userId,
    platform: "ios",
    environment: "sandbox",
    pushToken: "a".repeat(64),
    voipToken: null,
    publicKey: "key",
    registeredAt: 0,
    updatedAt: 0,
  });
}

const level = (id: string, targets: EscalationLevel["targets"], timeoutMinutes = 5) => ({
  id,
  targets,
  timeoutMinutes,
});

const policyArgs = (patch: Record<string, unknown> = {}) => ({
  id: ESC,
  name: "Checkout",
  levels: [
    level(LVL1, [{ kind: "schedule", id: SCH }]),
    level(LVL2, [{ kind: "member", id: "usr_eva" }], 10),
  ],
  repeat: 0,
  isDefault: true,
  ...patch,
});

/** A level whose targets all went away (removals leave it empty; the editor never saves one). */
const EMPTIED = "usr_eva";

function withPolicy(patch: Record<string, unknown> = {}, emptied = false) {
  const store = shard();
  const created = runMutation(
    mutations,
    "escalation.createPolicy",
    policyArgs(patch),
    store,
    ctx("usr_ana", "owner"),
  );
  expect(created).toMatchObject({ ok: true });
  if (emptied) {
    const row = store.get("escalation_policies", ESC)!;
    store.update("escalation_policies", ESC, {
      levels: row.levels.map((one) => ({
        ...one,
        targets: one.targets.filter((target) => target.id !== EMPTIED),
      })),
    });
  }
  return store;
}

const start = (store: MutationStore, causedBy = "usr_ana", now = T) =>
  runMutation(
    serverMutations,
    "escalation.start",
    { incidentId: INC, eventId: EVT, causedBy },
    store,
    system(now),
  );
const advance = (store: MutationStore, now: number) =>
  runMutation(
    serverMutations,
    "escalation.advance",
    { incidentId: INC, step: store.get("incidents", INC)!.escalation!.paged },
    store,
    system(now),
  );
const run = (store: MutationStore) => store.get("incidents", INC)!.escalation!;
const timeline = (store: MutationStore) =>
  store.scan("timeline").map((row) => {
    const { id: _id, incidentId: _incident, seq: _seq, at: _at, ...entry } = row;
    return entry;
  });

describe("escalation policies", () => {
  test("owners and admins manage policies; responders and viewers only read", () => {
    for (const role of ["responder", "viewer"] as const) {
      expect(
        runMutation(
          mutations,
          "escalation.createPolicy",
          policyArgs(),
          shard(),
          ctx("usr_x", role),
        ),
      ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    }
    const store = shard();
    expect(
      runMutation(
        mutations,
        "escalation.createPolicy",
        policyArgs(),
        store,
        ctx("usr_bia", "admin"),
      ),
    ).toEqual({
      ok: true,
      events: [
        {
          type: "escalation_policy.created",
          subject: ESC,
          data: { id: ESC, name: "Checkout", levels: 2, repeat: 0, isDefault: true },
        },
      ],
    });
    expect(
      runMutation(
        mutations,
        "escalation.updatePolicy",
        policyArgs(),
        store,
        ctx("usr_ana", "owner"),
      ),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(
      runMutation(
        mutations,
        "escalation.updatePolicy",
        policyArgs({ repeat: 2 }),
        store,
        ctx("usr_ana", "owner"),
      ),
    ).toMatchObject({
      ok: true,
      events: [{ type: "escalation_policy.updated", data: { repeat: 2, reason: "edited" } }],
    });
    expect(
      runMutation(
        mutations,
        "escalation.deletePolicy",
        { id: ESC },
        store,
        ctx("usr_bia", "admin"),
      ),
    ).toEqual({
      ok: true,
      events: [
        {
          type: "escalation_policy.deleted",
          subject: ESC,
          data: { id: ESC, wasDefault: true },
        },
      ],
    });
  });

  test("targets must exist and be able to respond; levels and targets are listed once", () => {
    const paths = (patch: Record<string, unknown>) => {
      const result = runMutation(
        mutations,
        "escalation.createPolicy",
        policyArgs(patch),
        shard(),
        ctx("usr_ana", "owner"),
      );
      return result.ok ? [] : (result.error.issues ?? []).map((issue) => issue.path);
    };
    expect(
      paths({
        levels: [
          level(LVL1, [
            { kind: "schedule", id: "sch_01JB0000000000000000000009" },
            { kind: "member", id: "usr_duda" },
            { kind: "member", id: "usr_zoe" },
            { kind: "member", id: "usr_eva" },
            { kind: "member", id: "usr_eva" },
          ]),
          level(LVL1, [{ kind: "member", id: "usr_eva" }]),
        ],
      }),
    ).toEqual([
      "levels[0].targets[0]",
      "levels[0].targets[1]",
      "levels[0].targets[2]",
      "levels[0].targets[4]",
      "levels[1].id",
    ]);
    expect(paths({ levels: [] })).toEqual(["levels"]);
    expect(paths({ levels: [level(LVL1, [])] })).toEqual(["levels[0].targets"]);
    expect(paths({ levels: [level(LVL1, [{ kind: "member", id: "usr_eva" }], 0)] })).toEqual([
      "levels[0].timeoutMinutes",
    ]);
    expect(paths({ repeat: 10 })).toEqual(["repeat"]);
  });

  test("one default per workspace: a new default takes the flag from the previous one", () => {
    const store = withPolicy();
    const second = runMutation(
      mutations,
      "escalation.createPolicy",
      policyArgs({ id: ESC2, name: "Payments" }),
      store,
      ctx("usr_ana", "owner"),
    );
    expect(second).toMatchObject({
      ok: true,
      events: [
        { type: "escalation_policy.created", subject: ESC2, data: { isDefault: true } },
        {
          type: "escalation_policy.updated",
          subject: ESC,
          data: { isDefault: false, reason: "default_changed" },
        },
      ],
    });
    expect(store.scan("escalation_policies").map((row) => [row.id, row.isDefault])).toEqual([
      [ESC, false],
      [ESC2, true],
    ]);
  });

  test("a deleted schedule and a removed member are taken out of every level, visibly", () => {
    const store = withPolicy({
      levels: [
        level(LVL1, [
          { kind: "schedule", id: SCH },
          { kind: "member", id: "usr_caio" },
        ]),
        level(LVL2, [{ kind: "member", id: "usr_eva" }]),
      ],
    });
    expect(
      runMutation(mutations, "schedule.delete", { id: SCH }, store, ctx("usr_ana", "owner")),
    ).toMatchObject({
      ok: true,
      events: [
        { type: "schedule.deleted" },
        {
          type: "escalation_policy.updated",
          subject: ESC,
          data: { reason: "schedule_deleted", scheduleId: SCH, userId: null },
        },
      ],
    });
    const removed = runMutation(
      serverMutations,
      "member.remove",
      { id: "usr_eva", role: "responder", reason: "removed" },
      store,
      ctx("usr_ana", "owner"),
    );
    expect(removed).toMatchObject({ ok: true });
    expect(removed.ok && removed.events.map((event) => event.type)).toContain(
      "escalation_policy.updated",
    );
    // Level 2 is left with nobody: a gap the dashboard shows, skipped when it fires.
    expect(store.get("escalation_policies", ESC)!.levels.map((one) => one.targets)).toEqual([
      [{ kind: "member", id: "usr_caio" }],
      [],
    ]);
  });

  test("a member made a viewer by a copy from D1 leaves the policies too", () => {
    const store = withPolicy();
    const result = runMutation(
      serverMutations,
      "member.changeRole",
      { id: "usr_eva", from: "responder", to: "viewer" },
      store,
      { ...ctx("usr_ana", "owner"), actor: MEMBERS_ACTOR },
    );
    expect(result).toMatchObject({ ok: true });
    expect(store.get("escalation_policies", ESC)!.levels[1].targets).toEqual([]);
  });
});

describe("escalation runs", () => {
  test("without a default policy nothing starts: the interim rule pages", () => {
    const store = withPolicy({ isDefault: false });
    expect(start(store)).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(store.get("incidents", INC)!.escalation).toBeUndefined();
  });

  test("starts on level 1, resolving the schedule to whoever is on call, and arms its timer", () => {
    const store = withPolicy();
    expect(start(store)).toEqual({
      ok: true,
      events: [
        {
          type: "escalation.paged",
          subject: INC,
          data: {
            incidentId: INC,
            policyId: ESC,
            level: 1,
            round: 0,
            userIds: ["usr_caio"],
            missed: [],
            reason: "started",
            started: true,
            run: EVT,
            step: 1,
          },
        },
      ],
    });
    expect(run(store)).toMatchObject({
      policyId: ESC,
      policyName: "Checkout",
      status: "running",
      eventId: EVT,
      nextAt: T + 5 * MINUTE,
      paged: 1,
      pages: [
        {
          level: 1,
          round: 0,
          at: T,
          userIds: ["usr_caio"],
          missed: [],
          missedCount: 0,
          reason: "started",
        },
      ],
    });
    expect(store.get("escalation_timers", INC)).toEqual({ id: INC, at: T + 5 * MINUTE });
    expect(timeline(store)).toEqual([
      {
        kind: "escalated",
        actor: "sys_escalation",
        level: 1,
        round: 0,
        userIds: ["usr_caio"],
        reason: "started",
      },
    ]);
    // A second start while it runs is refused: a redelivery pages the same level, never a new run.
    expect(start(store)).toMatchObject({ ok: false, error: { code: "conflict" } });
  });

  test("a timeout fires the next level, then repeats, then everyone who can respond is paged and the run ends", () => {
    const store = withPolicy({ repeat: 1 });
    start(store);
    // Not due yet: nothing fires.
    expect(advance(store, T + 4 * MINUTE)).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(advance(store, T + 5 * MINUTE)).toMatchObject({
      ok: true,
      events: [{ type: "escalation.paged", data: { level: 2, round: 0, reason: "timeout" } }],
    });
    expect(run(store).nextAt).toBe(T + 15 * MINUTE);
    expect(advance(store, T + 15 * MINUTE)).toMatchObject({
      ok: true,
      events: [{ type: "escalation.paged", data: { level: 1, round: 1, started: false } }],
    });
    advance(store, T + 20 * MINUTE);
    expect(advance(store, T + 30 * MINUTE)).toEqual({
      ok: true,
      events: [
        {
          type: "escalation.paged",
          subject: INC,
          data: {
            incidentId: INC,
            policyId: ESC,
            level: null,
            round: 1,
            userIds: [],
            missed: [],
            reason: "exhausted",
            started: false,
            run: EVT,
            step: 5,
          },
        },
        {
          type: "escalation.exhausted",
          subject: INC,
          data: { incidentId: INC, policyId: ESC, levels: 2, rounds: 2 },
        },
      ],
    });
    expect(run(store)).toMatchObject({
      status: "exhausted",
      nextAt: null,
      endedAt: T + 30 * MINUTE,
    });
    expect(store.get("escalation_timers", INC)).toBeUndefined();
    expect(timeline(store).at(-1)).toEqual({
      kind: "escalation_exhausted",
      actor: "sys_escalation",
      levels: 2,
      rounds: 2,
    });
  });

  test("a repeated alarm fires a level once", () => {
    const store = withPolicy();
    start(store);
    const step = run(store).paged;
    const again = () =>
      runMutation(
        serverMutations,
        "escalation.advance",
        { incidentId: INC, step },
        store,
        system(T + 5 * MINUTE),
      );
    expect(again()).toMatchObject({ ok: true });
    expect(again()).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(run(store).pages).toHaveLength(2);
  });

  test("a level nobody can be reached at is skipped at once, and says why", () => {
    const store = withPolicy({
      levels: [
        level(LVL1, [
          { kind: "member", id: "usr_bia" },
          { kind: "schedule", id: SCH },
        ]),
        level(LVL2, [{ kind: "member", id: "usr_eva" }], 10),
      ],
    });
    // Caio (on call) has no device any more; Bia never had one.
    for (const row of store.scan("devices"))
      if (row.userId === "usr_caio") store.delete("devices", row.id);
    expect(start(store)).toMatchObject({
      ok: true,
      events: [
        {
          type: "escalation.paged",
          data: {
            level: 2,
            userIds: ["usr_eva"],
            reason: "unreachable",
            started: true,
            missed: [
              { userId: "usr_bia", reason: "no_devices", scheduleId: null, schedule: null },
              { userId: "usr_caio", reason: "no_devices", scheduleId: SCH, schedule: "Primary" },
            ],
          },
        },
      ],
    });
    expect(run(store)).toMatchObject({ nextAt: T + 10 * MINUTE });
  });

  test("a schedule with nobody on call, a deleted one and a removed member are skipped too", () => {
    const store = withPolicy({
      levels: [
        level(LVL1, [{ kind: "schedule", id: SCH }]),
        level(LVL2, [{ kind: "member", id: "usr_caio" }]),
        level(LVL3, [{ kind: "member", id: "usr_eva" }]),
      ],
    });
    // A gap in the rotation now, and Caio no longer in the workspace (the snapshot still names them).
    store.update("schedules", SCH, {
      layers: [{ ...store.get("schedules", SCH)!.layers[0], startDate: "2027-01-01" }],
    });
    store.delete("members", "usr_caio");
    expect(start(store)).toMatchObject({
      ok: true,
      events: [
        {
          data: {
            level: 3,
            missed: [
              { userId: null, reason: "nobody_on_call", scheduleId: SCH, schedule: "Primary" },
              { userId: "usr_caio", reason: "not_a_member" },
            ],
          },
        },
      ],
    });
    const deleted = withPolicy();
    deleted.delete("schedules", SCH);
    expect(start(deleted)).toMatchObject({
      events: [
        {
          data: {
            level: 2,
            missed: [{ userId: null, reason: "schedule_missing", scheduleId: SCH }],
          },
        },
      ],
    });
  });

  test("when no level is left to reach anyone, everyone who can respond is paged and the run ends", () => {
    const store = withPolicy(
      {
        levels: [
          level(LVL1, [{ kind: "member", id: "usr_bia" }]),
          level(LVL2, [{ kind: "member", id: EMPTIED }]),
        ],
      },
      true,
    );
    expect(start(store)).toMatchObject({
      ok: true,
      events: [
        {
          type: "escalation.paged",
          data: {
            level: null,
            userIds: [],
            reason: "unreachable",
            missed: [{ userId: "usr_bia", reason: "no_devices" }],
          },
        },
      ],
    });
    expect(run(store)).toMatchObject({ status: "exhausted", nextAt: null });
    expect(store.get("escalation_timers", INC)).toBeUndefined();
  });

  test("whoever caused the page counts as reached without a device, so the next level waits", () => {
    const store = withPolicy({
      levels: [
        level(LVL1, [{ kind: "member", id: "usr_bia" }]),
        level(LVL2, [{ kind: "member", id: "usr_eva" }]),
      ],
    });
    expect(start(store, "usr_bia")).toMatchObject({
      events: [{ data: { level: 1, userIds: ["usr_bia"], missed: [] } }],
    });
  });

  test("a one-level policy whose only reach was the declarer falls back to everyone at its timeout", () => {
    const store = withPolicy({ levels: [level(LVL1, [{ kind: "schedule", id: SCH }])] });
    // Caio is on call and declared it: nobody is pushed for level 1.
    start(store, "usr_caio");
    expect(run(store).pages[0]).toMatchObject({ level: 1, userIds: ["usr_caio"] });
    expect(advance(store, T + 5 * MINUTE)).toMatchObject({
      ok: true,
      events: [
        { type: "escalation.paged", data: { level: null, reason: "exhausted", started: false } },
        { type: "escalation.exhausted" },
      ],
    });
    expect(run(store)).toMatchObject({ status: "exhausted", causedBy: "usr_caio", paged: 2 });
  });

  test("escalation.fallback pages everyone who can respond for a level that keeps failing, once", () => {
    const store = withPolicy();
    start(store);
    const fallback = (step: number) =>
      runMutation(
        serverMutations,
        "escalation.fallback",
        { incidentId: INC, step, lost: null },
        store,
        system(T + 9 * MINUTE),
      );
    expect(fallback(2)).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(fallback(1)).toMatchObject({
      ok: true,
      events: [{ type: "escalation.paged", data: { level: null, reason: "stalled", step: 2 } }],
    });
    expect(run(store)).toMatchObject({ status: "exhausted", nextAt: null });
    expect(store.get("escalation_timers", INC)).toBeUndefined();
    expect(timeline(store).at(-1)).toMatchObject({
      kind: "escalated",
      level: null,
      reason: "stalled",
    });
    expect(fallback(1)).toMatchObject({ ok: false, error: { code: "not_found" } });
    // Server only: no socket sends it.
    expect(
      runMutation(
        mutations,
        "escalation.fallback",
        { incidentId: INC, step: 1, lost: null },
        store,
        ctx("usr_ana", "owner"),
      ),
    ).toMatchObject({ ok: false, error: { code: "unknown_mutation" } });
  });

  test("escalation.fallback pages a lost end page again, at any step, as that page would have", () => {
    const store = withPolicy({ levels: [level(LVL1, [{ kind: "member", id: "usr_eva" }])] });
    start(store);
    expect(advance(store, T + 5 * MINUTE)).toMatchObject({ ok: true });
    const ended = run(store);
    expect(ended).toMatchObject({ status: "exhausted", paged: 2, endedAt: T + 5 * MINUTE });
    const fallback = (step: number, lost: string | null = LOST) =>
      runMutation(
        serverMutations,
        "escalation.fallback",
        { incidentId: INC, step, lost },
        store,
        system(T + 9 * MINUTE),
      );
    // An earlier step is not the lost end page, nor is the alarm's fallback (no lost event) for an ended run.
    expect(fallback(1)).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(fallback(2, null)).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(fallback(2)).toMatchObject({
      ok: true,
      events: [
        {
          type: "escalation.paged",
          data: {
            level: null,
            reason: "exhausted",
            round: 0,
            step: 3,
            started: false,
            lost: LOST,
          },
        },
      ],
    });
    // Paged again: the run still ended when it did, and the timeline says it was paged again, not exhausted twice.
    expect(run(store)).toMatchObject({ status: "exhausted", paged: 3, endedAt: ended.endedAt });
    expect(run(store).pages.at(-1)).toMatchObject({ level: null, again: true });
    expect(timeline(store).filter((row) => row.kind === "escalation_exhausted")).toHaveLength(1);
    expect(timeline(store).at(-1)).toMatchObject({
      kind: "escalated",
      level: null,
      reason: "exhausted",
      again: true,
    });
    expect(fallback(2)).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("escalation.repage pages a lost level again, leaving out the declarer and keeping the next level's time", () => {
    const store = withPolicy({
      levels: [
        level(LVL1, [
          { kind: "schedule", id: SCH },
          { kind: "member", id: "usr_ana" },
        ]),
        level(LVL2, [{ kind: "member", id: "usr_eva" }], 10),
      ],
    });
    start(store);
    const before = run(store);
    expect(before.pages[0]).toMatchObject({ level: 1, userIds: ["usr_caio", "usr_ana"] });
    const repage = (step: number) =>
      runMutation(
        serverMutations,
        "escalation.repage",
        { incidentId: INC, step, lost: LOST },
        store,
        system(T + 2 * MINUTE),
      );
    expect(repage(2)).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(repage(1)).toMatchObject({
      ok: true,
      events: [
        {
          type: "escalation.paged",
          data: {
            level: 1,
            round: 0,
            userIds: ["usr_caio"],
            reason: "started",
            step: 2,
            lost: LOST,
          },
        },
      ],
    });
    expect(run(store)).toMatchObject({ status: "running", paged: 2, nextAt: before.nextAt });
    expect(timeline(store).at(-1)).toMatchObject({ kind: "escalated", level: 1, again: true });
    expect(store.get("escalation_timers", INC)).toMatchObject({ at: before.nextAt });
    expect(repage(1)).toMatchObject({ ok: false, error: { code: "conflict" } });
    // The next level still fires at its time, after the level paged again.
    expect(advance(store, before.nextAt!)).toMatchObject({
      ok: true,
      events: [{ type: "escalation.paged", data: { level: 2, step: 3 } }],
    });
  });

  test("escalation.repage has nobody to page again when the declarer was the level's only reach", () => {
    const store = withPolicy();
    start(store, "usr_caio");
    expect(
      runMutation(
        serverMutations,
        "escalation.repage",
        { incidentId: INC, step: 1, lost: LOST },
        store,
        system(T + MINUTE),
      ),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(run(store)).toMatchObject({ paged: 1 });
  });

  test("the incident row keeps the last pages and the first misses of each; the counts stay whole", () => {
    // Levels 1 to 3: nine members each with no device (skipped at once, 27 misses); levels 4 to 6: Eva. Repeated
    // 9 more times: 30 pages, then the interim rule's.
    const away = (from: number) =>
      Array.from({ length: 9 }, (_, i) => ({
        kind: "member" as const,
        id: `usr_away${String(from + i).padStart(2, "0")}`,
      }));
    const eva = [{ kind: "member" as const, id: "usr_eva" }];
    const store = shard();
    for (const { id } of [...away(0), ...away(9), ...away(18)]) {
      store.insert("members", { id, name: id, role: "responder", updatedAt: 0 });
    }
    expect(
      runMutation(
        mutations,
        "escalation.createPolicy",
        policyArgs({
          levels: [
            level(LVL1, away(0), 1),
            level(LVL2, away(9), 1),
            level(LVL3, away(18), 1),
            level("lvl_01JB0000000000000000000004", eva, 1),
            level("lvl_01JB0000000000000000000005", eva, 1),
            level("lvl_01JB0000000000000000000006", eva, 1),
          ],
          repeat: 9,
        }),
        store,
        ctx("usr_ana", "owner"),
      ),
    ).toMatchObject({ ok: true });
    const started = start(store);
    if (!started.ok) throw new Error("not started");
    // The event carries every miss; the row keeps the first ones and the count.
    expect(started.events[0].data).toMatchObject({ level: 4, reason: "unreachable" });
    expect((started.events[0].data as { missed: unknown[] }).missed).toHaveLength(27);
    expect(run(store).pages[0]).toMatchObject({ missedCount: 27 });
    expect(run(store).pages[0].missed).toHaveLength(MAX_PAGE_MISSES);
    for (let minute = 1; minute <= 30; minute++) {
      expect(advance(store, T + minute * MINUTE)).toMatchObject({ ok: true });
    }
    expect(run(store)).toMatchObject({ status: "exhausted", paged: 31 });
    expect(run(store).pages).toHaveLength(MAX_ESCALATION_PAGES);
    expect(run(store).pages.at(-1)).toMatchObject({ level: null, reason: "exhausted" });
    // The timeline keeps every page.
    expect(timeline(store).filter((entry) => entry.kind === "escalated")).toHaveLength(30);
  });

  test("a later level that times out into unreachable levels falls back as well", () => {
    const store = withPolicy(
      {
        levels: [
          level(LVL1, [{ kind: "schedule", id: SCH }]),
          level(LVL2, [{ kind: "member", id: EMPTIED }]),
        ],
      },
      true,
    );
    start(store);
    expect(advance(store, T + 5 * MINUTE)).toMatchObject({
      events: [{ data: { level: null, round: 0, reason: "unreachable", started: false } }],
    });
    expect(run(store).status).toBe("exhausted");
  });

  test("incident.ack stops the run and deletes its timer, from any responder", () => {
    const store = withPolicy();
    start(store);
    expect(
      runMutation(
        mutations,
        "incident.ack",
        { id: INC },
        store,
        ctx("usr_eva", "responder", T + MINUTE),
      ),
    ).toMatchObject({ ok: true, events: [{ type: "incident.acknowledged" }] });
    expect(run(store)).toMatchObject({
      status: "acknowledged",
      nextAt: null,
      endedAt: T + MINUTE,
    });
    expect(store.get("escalation_timers", INC)).toBeUndefined();
    expect(advance(store, T + 5 * MINUTE)).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });

  test("resolving or declining stops the run; other status changes do not", () => {
    const store = withPolicy();
    start(store);
    runMutation(
      mutations,
      "incident.setStatus",
      { id: INC, status: "investigating" },
      store,
      ctx("usr_ana", "owner"),
    );
    expect(run(store).status).toBe("running");
    runMutation(
      mutations,
      "incident.setStatus",
      { id: INC, status: "resolved" },
      store,
      ctx("usr_ana", "owner"),
    );
    expect(run(store)).toMatchObject({ status: "resolved", nextAt: null });
    expect(store.get("escalation_timers", INC)).toBeUndefined();
  });

  test("resolving or acknowledging closes a run that ended, keeping when it ended", () => {
    for (const [name, args, status] of [
      ["incident.setStatus", { id: INC, status: "resolved" }, "resolved"],
      ["incident.ack", { id: INC }, "acknowledged"],
    ] as const) {
      const store = withPolicy({ levels: [level(LVL1, [{ kind: "member", id: "usr_eva" }])] });
      start(store);
      advance(store, T + 5 * MINUTE);
      expect(run(store)).toMatchObject({ status: "exhausted", endedAt: T + 5 * MINUTE });
      runMutation(mutations, name, args, store, ctx("usr_ana", "owner", T + 9 * MINUTE));
      expect(run(store), name).toMatchObject({ status, nextAt: null, endedAt: T + 5 * MINUTE });
    }
  });

  test("an optimistic ack on a client stops the run it holds without touching server-only rows", () => {
    const store = withPolicy();
    start(store);
    store.delete("escalation_timers", INC);
    expect(
      runMutation(mutations, "incident.ack", { id: INC }, store, {
        ...ctx("usr_eva", "responder"),
        server: false,
      }),
    ).toMatchObject({ ok: true });
    expect(run(store).status).toBe("acknowledged");
  });

  test("the policy is a snapshot: editing or deleting it mid-run changes nothing for the run", () => {
    const store = withPolicy();
    start(store);
    runMutation(mutations, "escalation.deletePolicy", { id: ESC }, store, ctx("usr_ana", "owner"));
    expect(advance(store, T + 5 * MINUTE)).toMatchObject({
      ok: true,
      events: [{ data: { level: 2, userIds: ["usr_eva"] } }],
    });
  });
});

const MON = "mon_01JB0000000000000000000001";
const httpMonitor = (patch: Record<string, unknown> = {}) => ({
  id: MON,
  name: "Checkout API",
  url: "https://example.com/health",
  method: "GET",
  expectedStatus: null,
  keyword: null,
  intervalSeconds: 60,
  timeoutSeconds: 10,
  regions: ["weur"],
  ...patch,
});

/** A shard with the default policy (`ESC`) and a second one (`ESC2`, Eva only), and a monitor naming `policyId`. */
function withMonitor(policyId: string | null) {
  const store = withPolicy();
  expect(
    runMutation(
      mutations,
      "escalation.createPolicy",
      policyArgs({
        id: ESC2,
        name: "Payments",
        levels: [level(LVL3, [{ kind: "member", id: "usr_eva" }])],
        isDefault: false,
      }),
      store,
      ctx("usr_ana", "owner"),
    ),
  ).toMatchObject({ ok: true });
  expect(
    runMutation(
      mutations,
      "monitor.createHttp",
      httpMonitor({ policyId }),
      store,
      ctx("usr_bia", "admin"),
    ),
  ).toMatchObject({ ok: true, events: [{ type: "monitor.created", data: { policyId } }] });
  // The monitor opened the incident and its alert still fires.
  store.update("monitors", MON, { incidentId: INC, alertId: "alt_01JB0000000000000000000001" });
  store.insert("alerts", {
    id: "alt_01JB0000000000000000000001",
    fingerprint: `monitor:${MON}`,
    monitorId: MON,
    status: "firing",
    firedAt: T,
    resolvedAt: null,
    incidentId: INC,
  });
  return store;
}

describe("a policy per monitor", () => {
  test("an incident a monitor opened runs on the monitor's policy, and the run says so", () => {
    const store = withMonitor(ESC2);
    expect(start(store, "sys_monitors")).toMatchObject({
      ok: true,
      events: [{ data: { policyId: ESC2, level: 1, userIds: ["usr_eva"] } }],
    });
    expect(run(store)).toMatchObject({
      policyId: ESC2,
      policyName: "Payments",
      monitor: { id: MON, name: "Checkout API" },
    });
  });

  test("a monitor without a policy, or one deleted since, runs on the default", () => {
    const none = withMonitor(null);
    start(none, "sys_monitors");
    expect(run(none)).toMatchObject({ policyId: ESC, monitor: null });

    // The monitor recovered (no longer firing on it) and was deleted: its alert still names it, the row does not.
    const gone = withMonitor(ESC2);
    gone.update("monitors", MON, { incidentId: null, alertId: null });
    expect(
      runMutation(mutations, "monitor.delete", { id: MON }, gone, ctx("usr_bia", "admin")),
    ).toMatchObject({ ok: true });
    start(gone, "sys_monitors");
    expect(run(gone)).toMatchObject({ policyId: ESC, monitor: null });
  });

  test("a recovered monitor's incident still runs on its policy, found through its alert", () => {
    const store = withMonitor(ESC2);
    store.update("monitors", MON, { incidentId: null, alertId: null });
    start(store, "sys_monitors");
    expect(run(store)).toMatchObject({ policyId: ESC2, monitor: { id: MON } });
  });

  test("with no default, a monitor's own policy still pages, and one without stays on the interim rule", () => {
    const own = withMonitor(ESC2);
    own.update("escalation_policies", ESC, { isDefault: false });
    expect(start(own, "sys_monitors")).toMatchObject({ ok: true });
    expect(run(own).policyId).toBe(ESC2);

    const none = withMonitor(null);
    none.update("escalation_policies", ESC, { isDefault: false });
    expect(start(none, "sys_monitors")).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("the policy must exist; only owners and admins set it; an update can change or clear it", () => {
    const store = withPolicy();
    const missing = runMutation(
      mutations,
      "monitor.createHttp",
      httpMonitor({ policyId: ESC2 }),
      store,
      ctx("usr_bia", "admin"),
    );
    expect(missing).toMatchObject({
      ok: false,
      error: { code: "invalid_args", issues: [{ path: "policyId" }] },
    });
    expect(
      runMutation(
        mutations,
        "monitor.createHttp",
        httpMonitor({ policyId: ESC }),
        store,
        ctx("usr_caio", "responder"),
      ),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    // Left out: the default.
    expect(
      runMutation(mutations, "monitor.createHttp", httpMonitor(), store, ctx("usr_bia", "admin")),
    ).toMatchObject({ ok: true });
    expect(store.get("monitors", MON)!.policyId).toBeNull();
    const update = (policyId: string | null) =>
      runMutation(
        mutations,
        "monitor.updateHttp",
        httpMonitor({ policyId }),
        store,
        ctx("usr_bia", "admin", T + MINUTE),
      );
    expect(update(ESC)).toMatchObject({
      ok: true,
      events: [{ type: "monitor.updated", data: { id: MON, policyId: ESC } }],
    });
    // A policy change is not a new target: the checks do not start over.
    expect(store.get("monitors", MON)).toMatchObject({ policyId: ESC, restartedAt: T });
    expect(update(ESC)).toMatchObject({ ok: false, error: { code: "conflict" } });
    // Left out of an edit (a client that does not know the field): the monitor keeps its policy.
    expect(
      runMutation(
        mutations,
        "monitor.updateHttp",
        httpMonitor({ name: "Checkout" }),
        store,
        ctx("usr_bia", "admin", T + 2 * MINUTE),
      ),
    ).toMatchObject({ ok: true, events: [{ data: { name: "Checkout", policyId: ESC } }] });
    expect(store.get("monitors", MON)!.policyId).toBe(ESC);
    expect(
      runMutation(
        mutations,
        "monitor.updateHttp",
        httpMonitor({ name: "Checkout" }),
        store,
        ctx("usr_bia", "admin", T + 3 * MINUTE),
      ),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    // An explicit null: back to the default.
    expect(update(null)).toMatchObject({ ok: true });
    expect(store.get("monitors", MON)!.policyId).toBeNull();
  });

  test("a heartbeat takes a policy too", () => {
    const store = withPolicy();
    const args = {
      id: MON,
      name: "Nightly backup",
      intervalSeconds: 3600,
      graceSeconds: 300,
      tokenHash: "0".repeat(64),
      policyId: ESC,
    };
    expect(
      runMutation(mutations, "monitor.createHeartbeat", args, store, ctx("usr_bia", "admin")),
    ).toMatchObject({ ok: true });
    const { tokenHash: _hash, ...update } = args;
    // Left out: kept.
    const { policyId: _policy, ...renamed } = { ...update, name: "Nightly job" };
    expect(
      runMutation(mutations, "monitor.updateHeartbeat", renamed, store, ctx("usr_bia", "admin")),
    ).toMatchObject({ ok: true, events: [{ data: { policyId: ESC } }] });
    expect(
      runMutation(mutations, "monitor.updateHeartbeat", renamed, store, ctx("usr_bia", "admin")),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(
      runMutation(
        mutations,
        "monitor.updateHeartbeat",
        { ...update, policyId: null },
        store,
        ctx("usr_bia", "admin"),
      ),
    ).toMatchObject({ ok: true, events: [{ data: { policyId: null } }] });
  });

  test("deleting a policy a monitor names puts the monitor back on the default, and says so", () => {
    const store = withMonitor(ESC2);
    expect(
      runMutation(
        mutations,
        "escalation.deletePolicy",
        { id: ESC2 },
        store,
        ctx("usr_ana", "owner", T + MINUTE),
      ),
    ).toEqual({
      ok: true,
      events: [
        { type: "escalation_policy.deleted", subject: ESC2, data: { id: ESC2, wasDefault: false } },
        {
          type: "monitor.updated",
          subject: MON,
          data: {
            id: MON,
            name: "Checkout API",
            kind: "http",
            policyId: null,
            reason: "policy_deleted",
          },
        },
      ],
    });
    expect(store.get("monitors", MON)).toMatchObject({ policyId: null, updatedAt: T + MINUTE });
    start(store, "sys_monitors");
    expect(run(store)).toMatchObject({ policyId: ESC, monitor: null });
  });
});

const unreached = (store: MutationStore, step = run(store).paged, now = T + MINUTE) =>
  runMutation(
    serverMutations,
    "escalation.unreached",
    { incidentId: INC, step },
    store,
    system(now),
  );

describe("escalating early (every push of a level failed)", () => {
  test("the next level fires at once, saying which level nobody could be reached on", () => {
    const store = withPolicy();
    start(store);
    expect(unreached(store)).toMatchObject({
      ok: true,
      events: [
        {
          type: "escalation.paged",
          data: { level: 2, round: 0, userIds: ["usr_eva"], reason: "undelivered", step: 2 },
        },
      ],
    });
    // Level 2's own timeout, from now.
    expect(run(store)).toMatchObject({ status: "running", nextAt: T + 11 * MINUTE });
    expect(run(store).pages.at(-1)).toMatchObject({
      level: 2,
      reason: "undelivered",
      unreached: 1,
    });
    expect(store.get("escalation_timers", INC)).toMatchObject({ at: T + 11 * MINUTE });
    expect(timeline(store).at(-1)).toEqual({
      kind: "escalated",
      actor: "sys_escalation",
      level: 2,
      round: 0,
      userIds: ["usr_eva"],
      reason: "undelivered",
      unreached: 1,
    });
  });

  test("advances once per step: a repeated or stale call is refused", () => {
    const store = withPolicy({ repeat: 1 });
    start(store);
    expect(unreached(store, 1)).toMatchObject({ ok: true });
    expect(unreached(store, 1)).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(run(store).paged).toBe(2);
  });

  test("an ack or a resolve in between stops it", () => {
    const acked = withPolicy();
    start(acked);
    runMutation(mutations, "incident.ack", { id: INC }, acked, ctx("usr_caio", "responder"));
    expect(unreached(acked, 1)).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(run(acked).pages).toHaveLength(1);

    const resolved = withPolicy();
    start(resolved);
    runMutation(
      mutations,
      "incident.setStatus",
      { id: INC, status: "resolved" },
      resolved,
      ctx("usr_ana", "owner"),
    );
    expect(unreached(resolved, 1)).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("never past the round: the last level waits for its timeout, which repeats from level 1", () => {
    const store = withPolicy({ repeat: 1 });
    start(store);
    advance(store, T + 5 * MINUTE);
    expect(unreached(store, 2, T + 6 * MINUTE)).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    // Nothing moved: level 2 keeps its timeout, and the timeout starts round 2 as before.
    expect(run(store)).toMatchObject({ status: "running", paged: 2, nextAt: T + 15 * MINUTE });
    expect(store.get("escalation_timers", INC)).toMatchObject({ at: T + 15 * MINUTE });
    expect(advance(store, T + 15 * MINUTE)).toMatchObject({
      ok: true,
      events: [{ data: { level: 1, round: 1, reason: "timeout" } }],
    });
    expect(run(store).pages.at(-1)).not.toHaveProperty("unreached");
  });

  test("the last level failing does not end the run early: its timeout does, as before", () => {
    const store = withPolicy();
    start(store);
    advance(store, T + 5 * MINUTE);
    expect(unreached(store, 2, T + 6 * MINUTE)).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(run(store)).toMatchObject({ status: "running", endedAt: null });
    expect(advance(store, T + 15 * MINUTE)).toMatchObject({
      ok: true,
      events: [
        { type: "escalation.paged", data: { level: null, reason: "exhausted", step: 3 } },
        { type: "escalation.exhausted", data: { levels: 2, rounds: 1 } },
      ],
    });
    expect(timeline(store).at(-1)).toEqual({
      kind: "escalation_exhausted",
      actor: "sys_escalation",
      levels: 2,
      rounds: 1,
    });
    // An ended run takes no more.
    expect(unreached(store, 3)).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("with no later level of the round reaching anyone, it waits for the timeout too", () => {
    const store = withPolicy({
      repeat: 1,
      levels: [
        level(LVL1, [{ kind: "schedule", id: SCH }]),
        level(LVL2, [{ kind: "member", id: "usr_bia" }]),
      ],
    });
    start(store);
    expect(unreached(store)).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(run(store)).toMatchObject({ status: "running", paged: 1, nextAt: T + 5 * MINUTE });
  });

  test("levels nobody can be reached at after it are skipped, still saying why it left early", () => {
    const store = withPolicy({
      levels: [
        level(LVL1, [{ kind: "schedule", id: SCH }]),
        level(LVL2, [{ kind: "member", id: "usr_bia" }]),
        level(LVL3, [{ kind: "member", id: "usr_eva" }]),
      ],
    });
    start(store);
    expect(unreached(store)).toMatchObject({
      ok: true,
      events: [{ data: { level: 3, reason: "undelivered", missed: [{ userId: "usr_bia" }] } }],
    });
  });

  test("members may not send it", () => {
    const store = withPolicy();
    start(store);
    expect(
      runMutation(
        mutations,
        "escalation.unreached",
        { incidentId: INC, step: 1 },
        store,
        ctx("usr_ana", "owner"),
      ),
    ).toMatchObject({ ok: false });
    expect(run(store).paged).toBe(1);
  });
});

// RFC 0005 "Notifiers": "Page again" on a failed page.
describe("incident.pageAgain", () => {
  const fail = (store: MutationStore, args: Record<string, unknown>) =>
    runMutation(
      serverMutations,
      "notification.fail",
      { incidentId: INC, eventId: LOST, ...args },
      store,
      ctx("sys_notifier", "admin", T + MINUTE, "system"),
    );
  const entry = (store: MutationStore) => `${INC}:${store.get("incidents", INC)!.timelineSeq}`;
  const pageAgain = (store: MutationStore, entries: string[], role: Role = "owner") =>
    runMutation(
      mutations,
      "incident.pageAgain",
      { id: INC, entries },
      store,
      ctx("usr_bia", role, T + 2 * MINUTE),
    );

  test("a lost escalation level goes to that level's members, leaving out who declared it", () => {
    const store = withPolicy({
      levels: [
        level(LVL1, [
          { kind: "schedule", id: SCH },
          { kind: "member", id: "usr_ana" },
        ]),
        level(LVL2, [{ kind: "member", id: "usr_eva" }], 10),
      ],
    });
    start(store);
    fail(store, { userId: null, reason: "dead_lettered", page: { run: EVT, step: 1 } });
    const lost = entry(store);
    expect(pageAgain(store, [lost])).toMatchObject({
      ok: true,
      events: [
        {
          type: "incident.paged_again",
          data: { entries: [lost], userIds: ["usr_caio"], everyone: false, causedBy: "usr_bia" },
        },
      ],
    });
    // Paging again moves nothing of the run.
    expect(run(store)).toMatchObject({ status: "running", paged: 1 });
    expect(timeline(store).at(-1)).toEqual({
      kind: "paged_again",
      actor: "usr_bia",
      entries: [lost],
      userIds: ["usr_caio"],
      everyone: false,
    });
  });

  test("one entry per failed member, each once; only owners and admins; only failures paging again can change", () => {
    const store = shard();
    fail(store, { userId: "usr_caio", reason: "undelivered" });
    const caio = entry(store);
    fail(store, { userId: "usr_eva", reason: "token_invalid" });
    const eva = entry(store);
    fail(store, { userId: null, reason: "nobody_on_call", schedule: "Primary" });
    const nobody = entry(store);
    for (const role of ["responder", "viewer"] as const) {
      expect(pageAgain(store, [caio], role)).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });
    }
    expect(pageAgain(store, [nobody])).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(pageAgain(store, [`${INC}:99`])).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    expect(pageAgain(store, [caio, eva], "admin")).toMatchObject({
      ok: true,
      events: [{ data: { userIds: ["usr_caio", "usr_eva"], everyone: false } }],
    });
    expect(pageAgain(store, [eva])).toMatchObject({ ok: false, error: { code: "conflict" } });
  });

  test("refused once the incident is acknowledged or resolved, each saying which", () => {
    const store = shard();
    fail(store, { userId: "usr_caio", reason: "undelivered" });
    const caio = entry(store);
    store.update("incidents", INC, { acknowledgedAt: T, acknowledgedBy: "usr_caio" });
    expect(pageAgain(store, [caio])).toMatchObject({
      ok: false,
      error: { code: "conflict", message: PAGE_AGAIN_CONFLICTS.acknowledged },
    });
    store.update("incidents", INC, {
      acknowledgedAt: null,
      acknowledgedBy: null,
      status: "resolved",
    });
    expect(pageAgain(store, [caio])).toMatchObject({
      ok: false,
      error: { code: "conflict", message: PAGE_AGAIN_CONFLICTS.inactive },
    });
  });

  test("a lost level its run already paged again is answered: refused, and offered nowhere", () => {
    const store = withPolicy({
      levels: [
        level(LVL1, [
          { kind: "schedule", id: SCH },
          { kind: "member", id: "usr_ana" },
        ]),
        level(LVL2, [{ kind: "member", id: "usr_eva" }], 10),
      ],
    });
    start(store);
    fail(store, { userId: null, reason: "dead_lettered", page: { run: EVT, step: 1 } });
    const lost = entry(store);
    expect(answeredEntries(store.scan("timeline"))).toEqual(new Set());
    // The dead-letter consumer's own re-page of that level (RFC 0006 "A lost page").
    expect(
      runMutation(
        serverMutations,
        "escalation.repage",
        { incidentId: INC, step: 1, lost: LOST },
        store,
        system(T + MINUTE),
      ),
    ).toMatchObject({ ok: true });
    expect(timeline(store).at(-1)).toMatchObject({
      kind: "escalated",
      again: true,
      repaged: { run: EVT, step: 1 },
    });
    expect(answeredEntries(store.scan("timeline"))).toEqual(new Set([lost]));
    expect(pageAgain(store, [lost])).toMatchObject({
      ok: false,
      error: { code: "conflict", message: PAGE_AGAIN_CONFLICTS.answered },
    });
    expect(timeline(store).map((row) => row.kind)).not.toContain("paged_again");
  });

  test("a lost page leaves out who caused it, not who pages it again", () => {
    const store = shard();
    fail(store, { userId: null, reason: "dead_lettered", causedBy: "usr_ana" });
    const lost = entry(store);
    expect(store.get("timeline", lost)).toMatchObject({ causedBy: "usr_ana" });
    expect(pageAgain(store, [lost])).toMatchObject({
      ok: true,
      events: [{ data: { everyone: true, causedBy: "usr_ana" } }],
    });
    // Only a lost page keeps who caused it.
    fail(store, { userId: "usr_caio", reason: "undelivered", causedBy: "usr_ana" });
    expect(store.get("timeline", entry(store))).not.toHaveProperty("causedBy");
  });
});
