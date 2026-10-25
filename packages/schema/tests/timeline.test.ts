import { describe, expect, test } from "vite-plus/test";
import {
  createMemoryStore,
  evaluateQuery,
  incidentByNumber,
  incidentTimeline,
  allMembers,
  mutations,
  newId,
  runMutation,
  runQuery,
  queries,
  serverMutations,
  UPDATE_BODY_MAX,
  type BrigadeTables,
  type IncidentRow,
  type MemberRow,
  type MutationContext,
  type Role,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 25, 12, 0, 0);
const byte = (seed: number) => (n: number) => new Uint8Array(n).fill(seed);
const ID = newId("inc", T, byte(1));
const OTHER = newId("inc", T, byte(2));

const ctx = (
  role: Role = "responder",
  now = T,
  server = true,
  id = "usr_ana",
): MutationContext => ({
  actor: { kind: "user", id, role },
  now,
  server,
});

const member = (id: string, name: string, role: Role = "responder"): MemberRow => ({
  id,
  name,
  role,
  updatedAt: T - 1,
});
const MEMBERS = [
  member("usr_ana", "Ana"),
  member("usr_bia", "Bia", "admin"),
  member("usr_cid", "Cid", "viewer"),
];

/** An incident stored before timelines and roles existed: no `timelineSeq`, no `roles`. */
const legacy = (overrides: Partial<IncidentRow> = {}): IncidentRow => ({
  id: ID,
  number: 7,
  title: "Checkout is down",
  severity: "sev2",
  status: "investigating",
  declaredAt: T - 60_000,
  declaredBy: "usr_bia",
  acknowledgedAt: null,
  acknowledgedBy: null,
  updatedAt: T - 60_000,
  ...overrides,
});

const storeWith = (incidents: IncidentRow[] = [], members: MemberRow[] = MEMBERS) =>
  createMemoryStore<BrigadeTables>({ incidents, members });
const run = (
  store: ReturnType<typeof storeWith>,
  name: string,
  args: unknown,
  context: MutationContext = ctx(),
) => runMutation(mutations, name, args, store, context);

describe("timeline", () => {
  test("every incident change appends one entry, numbered in order, by its actor", () => {
    const store = storeWith();
    const steps: [string, unknown, number][] = [
      ["incident.declare", { id: ID, title: "Checkout is down", severity: "sev2" }, T],
      ["incident.setSeverity", { id: ID, severity: "sev1" }, T + 1],
      ["incident.ack", { id: ID }, T + 2],
      ["incident.setStatus", { id: ID, status: "investigating" }, T + 3],
      ["incident.assignRole", { id: ID, role: "commander", userId: "usr_bia" }, T + 4],
      ["incident.postUpdate", { id: ID, body: "Rolling back.\n\nETA 10 min." }, T + 5],
    ];
    for (const [name, args, now] of steps) {
      expect(run(store, name, args, ctx("responder", now)).ok, name).toBe(true);
    }
    const entries = evaluateQuery(incidentTimeline, { id: ID }, store);
    expect(entries).toEqual(
      [
        { kind: "declared", title: "Checkout is down", severity: "sev2" },
        { kind: "severity_changed", from: "sev2", to: "sev1" },
        { kind: "acknowledged" },
        { kind: "status_changed", from: "triage", to: "investigating" },
        { kind: "role_assigned", role: "commander", from: null, to: "usr_bia" },
        { kind: "update", body: "Rolling back.\n\nETA 10 min." },
      ].map((entry, index) => ({
        id: `${ID}:${index + 1}`,
        incidentId: ID,
        seq: index + 1,
        at: T + index,
        actor: "usr_ana",
        ...entry,
      })),
    );
    expect(store.get("incidents", ID)?.timelineSeq).toBe(6);
  });

  test("a refused change appends nothing", () => {
    const store = storeWith([legacy()]);
    const before = store.dump();
    expect(run(store, "incident.setStatus", { id: ID, status: "investigating" }).ok).toBe(false);
    expect(run(store, "incident.setStatus", { id: ID, status: "declined" }).ok).toBe(false);
    expect(store.dump()).toEqual(before);
  });

  test("an incident stored before timelines starts its timeline at 1", () => {
    const store = storeWith([legacy()]);
    expect(run(store, "incident.setStatus", { id: ID, status: "fixing" }).ok).toBe(true);
    expect(evaluateQuery(incidentTimeline, { id: ID }, store)).toMatchObject([
      { id: `${ID}:1`, seq: 1, kind: "status_changed" },
    ]);
  });

  test("the query holds only the incident's entries, oldest first, past entry 9", () => {
    const store = storeWith([legacy(), legacy({ id: OTHER, number: 8 })]);
    for (let i = 0; i < 11; i++) {
      run(store, "incident.postUpdate", { id: ID, body: `Update ${i + 1}` });
      if (i < 2) run(store, "incident.postUpdate", { id: OTHER, body: "Elsewhere" });
    }
    const entries = evaluateQuery(incidentTimeline, { id: ID }, store);
    expect(entries.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(entries.every((entry) => entry.incidentId === ID)).toBe(true);
  });

  test("a client's optimistic entries match the server's", () => {
    const client = storeWith([legacy()]);
    const server = storeWith([legacy()]);
    const changes: [string, unknown][] = [
      ["incident.postUpdate", { id: ID, body: "Looking" }],
      ["incident.assignRole", { id: ID, role: "communications", userId: "usr_ana" }],
      ["incident.setStatus", { id: ID, status: "monitoring" }],
    ];
    for (const [name, args] of changes) {
      run(client, name, args, ctx("responder", T, false));
      run(server, name, args);
    }
    expect(client.dump()).toEqual(server.dump());
  });
});

describe("incident.postUpdate", () => {
  test("appends the trimmed text and emits incident.update_posted", () => {
    const store = storeWith([legacy()]);
    const result = run(store, "incident.postUpdate", { id: ID, body: "  Fixed the cache.\n" });
    expect(result).toEqual({
      ok: true,
      events: [
        {
          type: "incident.update_posted",
          subject: ID,
          data: { entryId: `${ID}:1`, body: "Fixed the cache." },
        },
      ],
    });
    expect(store.get("incidents", ID)?.updatedAt).toBe(T);
  });

  test("works on resolved and declined incidents too (closing notes)", () => {
    for (const status of ["resolved", "declined"] as const) {
      const store = storeWith([legacy({ status })]);
      expect(run(store, "incident.postUpdate", { id: ID, body: "Postmortem next week" }).ok).toBe(
        true,
      );
    }
  });

  test.each([
    ["empty", ""],
    ["only spaces and newlines", "  \n\t "],
    ["too long", "x".repeat(UPDATE_BODY_MAX + 1)],
    ["a bidi override", `ok ${String.fromCodePoint(0x202e)} ok`],
    ["a zero-width space", `ok${String.fromCodePoint(0x200b)}`],
    ["not a string", 42],
  ])("refuses %s without writes", (_label, body) => {
    const store = storeWith([legacy()]);
    const before = store.dump();
    const result = run(store, "incident.postUpdate", { id: ID, body });
    expect(!result.ok && result.error.code).toBe("invalid_args");
    expect(store.dump()).toEqual(before);
  });

  test("takes exactly the longest body", () => {
    const store = storeWith([legacy()]);
    expect(
      run(store, "incident.postUpdate", { id: ID, body: "x".repeat(UPDATE_BODY_MAX) }).ok,
    ).toBe(true);
  });

  test("not found and forbidden", () => {
    const store = storeWith([legacy()]);
    const missing = run(store, "incident.postUpdate", { id: OTHER, body: "Hi" });
    expect(!missing.ok && missing.error.code).toBe("not_found");
    const viewer = run(store, "incident.postUpdate", { id: ID, body: "Hi" }, ctx("viewer"));
    expect(!viewer.ok && viewer.error.code).toBe("forbidden");
  });
});

describe("incident.assignRole", () => {
  test("assigns, hands over and unassigns, each with an event and an entry", () => {
    const store = storeWith([legacy()]);
    const assign = (userId: string | null) =>
      run(store, "incident.assignRole", { id: ID, role: "commander", userId });
    expect(assign("usr_ana")).toEqual({
      ok: true,
      events: [
        {
          type: "incident.role_assigned",
          subject: ID,
          data: { role: "commander", from: null, to: "usr_ana" },
        },
      ],
    });
    expect(store.get("incidents", ID)?.roles).toEqual({ commander: "usr_ana" });
    expect(assign("usr_bia")).toMatchObject({
      ok: true,
      events: [{ data: { role: "commander", from: "usr_ana", to: "usr_bia" } }],
    });
    expect(
      run(store, "incident.assignRole", { id: ID, role: "operations", userId: "usr_bia" }).ok,
    ).toBe(true);
    expect(store.get("incidents", ID)?.roles).toEqual({
      commander: "usr_bia",
      operations: "usr_bia",
    });
    expect(assign(null)).toMatchObject({
      ok: true,
      events: [{ data: { role: "commander", from: "usr_bia", to: null } }],
    });
    expect(store.get("incidents", ID)?.roles).toEqual({ operations: "usr_bia" });
    expect(evaluateQuery(incidentTimeline, { id: ID }, store).map((entry) => entry.kind)).toEqual([
      "role_assigned",
      "role_assigned",
      "role_assigned",
      "role_assigned",
    ]);
  });

  test("no change is a conflict", () => {
    const store = storeWith([legacy({ roles: { commander: "usr_ana" } })]);
    const same = run(store, "incident.assignRole", {
      id: ID,
      role: "commander",
      userId: "usr_ana",
    });
    expect(!same.ok && same.error.code).toBe("conflict");
    const empty = run(store, "incident.assignRole", { id: ID, role: "operations", userId: null });
    expect(!empty.ok && empty.error.code).toBe("conflict");
  });

  test("the assignee must be a member who may run incidents", () => {
    const store = storeWith([legacy()]);
    const before = store.dump();
    for (const userId of ["usr_zed", "usr_cid"]) {
      const result = run(store, "incident.assignRole", { id: ID, role: "commander", userId });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("invalid_args");
      expect(result.error.issues?.[0]?.path).toBe("userId");
    }
    expect(store.dump()).toEqual(before);
  });

  test("not found, invalid args and forbidden", () => {
    const store = storeWith([legacy()]);
    const missing = run(store, "incident.assignRole", {
      id: OTHER,
      role: "commander",
      userId: "usr_ana",
    });
    expect(!missing.ok && missing.error.code).toBe("not_found");
    for (const bad of [
      { id: ID, role: "scribe", userId: "usr_ana" },
      { id: ID, role: "commander" },
      { id: ID, role: "commander", userId: "" },
    ]) {
      const result = run(store, "incident.assignRole", bad);
      expect(!result.ok && result.error.code).toBe("invalid_args");
    }
    const viewer = run(
      store,
      "incident.assignRole",
      { id: ID, role: "commander", userId: "usr_ana" },
      ctx("viewer"),
    );
    expect(!viewer.ok && viewer.error.code).toBe("forbidden");
  });
});

describe("member.sync", () => {
  const sync = (store: ReturnType<typeof storeWith>, args: unknown, context = ctx()) =>
    runMutation(serverMutations, "member.sync", args, store, context);

  test("copies the socket's member, silently, and refreshes a change", () => {
    const store = storeWith([], []);
    expect(sync(store, { id: "usr_ana", name: " Ana Souza ", role: "responder" })).toEqual({
      ok: true,
      events: [],
    });
    expect(store.get("members", "usr_ana")).toEqual({
      id: "usr_ana",
      name: "Ana Souza",
      role: "responder",
      updatedAt: T,
    });
    const same = sync(store, { id: "usr_ana", name: "Ana Souza", role: "responder" });
    expect(!same.ok && same.error.code).toBe("conflict");
    const renamed = sync(store, { id: "usr_ana", name: "Ana", role: "admin" }, ctx("admin", T + 1));
    expect(renamed.ok).toBe(true);
    expect(store.get("members", "usr_ana")).toMatchObject({ name: "Ana", role: "admin" });
  });

  test("copies only the actor itself, with its own role", () => {
    const store = storeWith([], []);
    for (const args of [
      { id: "usr_bia", name: "Bia", role: "responder" },
      { id: "usr_ana", name: "Ana", role: "owner" },
    ]) {
      const result = sync(store, args);
      expect(!result.ok && result.error.code).toBe("forbidden");
    }
    const system = sync(
      store,
      { id: "sys_monitors", name: "Monitors", role: "admin" },
      {
        actor: { kind: "system", id: "sys_monitors", role: "admin" },
        now: T,
        server: true,
      },
    );
    expect(!system.ok && system.error.code).toBe("forbidden");
    expect(store.scan("members")).toEqual([]);
  });

  test("is server only", () => {
    const result = runMutation(
      mutations,
      "member.sync",
      { id: "usr_ana", name: "Ana", role: "responder" },
      storeWith([], []),
      ctx(),
    );
    expect(!result.ok && result.error.code).toBe("unknown_mutation");
  });
});

describe("queries", () => {
  test("incident.byNumber finds the numbered incident only", () => {
    const store = storeWith([legacy(), legacy({ id: OTHER, number: null })]);
    expect(evaluateQuery(incidentByNumber, { number: 7 }, store).map((row) => row.id)).toEqual([
      ID,
    ]);
    expect(evaluateQuery(incidentByNumber, { number: 8 }, store)).toEqual([]);
    for (const number of [0, -1, 1.5, "7", null]) {
      const result = runQuery(queries, "incident.byNumber", { number }, store, "viewer");
      expect(!result.ok && result.error.code).toBe("invalid_args");
    }
  });

  test("members.all is sorted by name, and every role reads it", () => {
    const store = storeWith(
      [],
      [member("usr_z", "Zoe"), member("usr_a", "Ana"), member("usr_b", "Ana")],
    );
    expect(evaluateQuery(allMembers, {}, store).map((row) => row.id)).toEqual([
      "usr_a",
      "usr_b",
      "usr_z",
    ]);
    expect(runQuery(queries, "members.all", {}, store, "viewer").ok).toBe(true);
    expect(runQuery(queries, "incident.timeline", { id: ID }, store, "viewer").ok).toBe(true);
  });
});
