import { describe, expect, test, vi } from "vite-plus/test";
import {
  createMemoryStore,
  defineMutation,
  defineRegistry,
  formatIncidentNumber,
  ID_CLOCK_SKEW_MS,
  INCIDENT_STATUSES,
  MAX_ECHO,
  MAX_ISSUES,
  mutations,
  newId,
  ok,
  ROLES,
  runMutation,
  v,
  type BrigadeTables,
  type IncidentRow,
  type IncidentStatus,
  type MutationContext,
  type Role,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 24, 12, 0, 0);
const byte = (seed: number) => (n: number) => new Uint8Array(n).fill(seed);
const ID = newId("inc", T, byte(1));
const OTHER = newId("inc", T, byte(2));

const ctx = ({
  role = "responder",
  ...overrides
}: Partial<MutationContext> & { role?: Role } = {}): MutationContext => ({
  actor: { kind: "user", id: "usr_ana", role },
  now: T,
  server: true,
  ...overrides,
});

const incident = (overrides: Partial<IncidentRow> = {}): IncidentRow => ({
  id: ID,
  number: 7,
  title: "Checkout is down",
  severity: "sev2",
  status: "triage",
  declaredAt: T - 60_000,
  declaredBy: "usr_bia",
  acknowledgedAt: null,
  acknowledgedBy: null,
  updatedAt: T - 60_000,
  ...overrides,
});

const storeWith = (...rows: IncidentRow[]) => createMemoryStore<BrigadeTables>({ incidents: rows });
const run = (
  store: ReturnType<typeof storeWith>,
  name: string,
  args: unknown,
  context: MutationContext = ctx(),
) => runMutation(mutations, name, args, store, context);

describe("incident.declare", () => {
  const args = { id: ID, title: "  Checkout is down ", severity: "sev1" };

  test("the server numbers the incident and emits incident.declared", () => {
    const store = storeWith();
    const result = run(store, "incident.declare", args);
    expect(result).toEqual({
      ok: true,
      events: [
        {
          type: "incident.declared",
          subject: ID,
          data: {
            id: ID,
            number: 1,
            title: "Checkout is down",
            severity: "sev1",
            status: "triage",
          },
        },
      ],
    });
    expect(store.get("incidents", ID)).toEqual({
      id: ID,
      number: 1,
      title: "Checkout is down",
      severity: "sev1",
      status: "triage",
      declaredAt: T,
      declaredBy: "usr_ana",
      acknowledgedAt: null,
      acknowledgedBy: null,
      updatedAt: T,
    });
    expect(formatIncidentNumber(store.get("incidents", ID)!.number)).toBe("INC-1");
  });

  test("numbers increase per workspace store", () => {
    const store = storeWith();
    run(store, "incident.declare", args);
    run(store, "incident.declare", { ...args, id: OTHER });
    expect(store.get("incidents", OTHER)?.number).toBe(2);
    expect(store.get("counters", "incident")).toEqual({ id: "incident", value: 2 });
  });

  test("a client leaves the number empty and touches no counter", () => {
    const store = storeWith();
    const result = run(store, "incident.declare", args, ctx({ server: false }));
    expect(result.ok).toBe(true);
    expect(store.get("incidents", ID)?.number).toBeNull();
    expect(formatIncidentNumber(null)).toBeNull();
    expect(store.scan("counters")).toEqual([]);
  });

  test("client and server rows share the client's id", () => {
    const client = storeWith();
    const server = storeWith();
    run(client, "incident.declare", args, ctx({ server: false }));
    run(server, "incident.declare", args);
    expect(client.get("incidents", ID)).toEqual({ ...server.get("incidents", ID), number: null });
  });

  test.each([
    [{ ...args, id: "inc_123" }, "id"],
    [{ ...args, id: newId("svc", T, byte(1)) }, "id"],
    [{ ...args, title: "   " }, "title"],
    [{ ...args, title: "x".repeat(201) }, "title"],
    [{ ...args, severity: "sev0" }, "severity"],
    [{ ...args, status: "resolved" }, "status"],
    [{ title: "t", severity: "sev1" }, "id"],
  ])("invalid args %# are rejected at %s without writes", (bad, path) => {
    const store = storeWith();
    const result = run(store, "incident.declare", bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_args");
    expect(result.error.issues?.map((issue) => issue.path)).toContain(path);
    expect(store.dump()).toEqual({});
  });

  test("non-object args are invalid", () => {
    for (const bad of [undefined, null, "x", [args]]) {
      const result = run(storeWith(), "incident.declare", bad);
      expect(!result.ok && result.error.code).toBe("invalid_args");
    }
  });

  test("viewers cannot declare", () => {
    const store = storeWith();
    const result = run(store, "incident.declare", args, ctx({ role: "viewer" }));
    expect(result).toEqual({
      ok: false,
      error: { code: "forbidden", message: "Not allowed to run incident.declare" },
    });
    expect(store.dump()).toEqual({});
  });

  test("an existing id is a conflict and changes nothing", () => {
    const store = storeWith(incident());
    const before = store.dump();
    const result = run(store, "incident.declare", args);
    expect(!result.ok && result.error.code).toBe("conflict");
    expect(store.dump()).toEqual(before);
  });
});

describe("incident.setStatus", () => {
  test("a valid transition updates the row and emits incident.status_changed", () => {
    const store = storeWith(incident());
    const result = run(store, "incident.setStatus", { id: ID, status: "investigating" });
    expect(result).toEqual({
      ok: true,
      events: [
        {
          type: "incident.status_changed",
          subject: ID,
          data: { from: "triage", to: "investigating" },
        },
      ],
    });
    expect(store.get("incidents", ID)).toEqual(incident({ status: "investigating", updatedAt: T }));
  });

  test("every pair follows the lifecycle", () => {
    const allowed: Record<IncidentStatus, IncidentStatus[]> = {
      triage: ["investigating", "fixing", "monitoring", "resolved", "declined"],
      investigating: ["fixing", "monitoring", "resolved"],
      fixing: ["investigating", "monitoring", "resolved"],
      monitoring: ["investigating", "fixing", "resolved"],
      resolved: ["investigating"],
      declined: [],
    };
    for (const from of INCIDENT_STATUSES) {
      for (const to of INCIDENT_STATUSES) {
        const store = storeWith(incident({ status: from }));
        const result = run(store, "incident.setStatus", { id: ID, status: to });
        expect(result.ok, `${from} → ${to}`).toBe(allowed[from].includes(to));
        if (!result.ok) {
          // Staying put is "no change" (conflict), like setting the current severity.
          expect(result.error.code).toBe(from === to ? "conflict" : "invalid_transition");
          expect(store.get("incidents", ID)).toEqual(incident({ status: from }));
        }
      }
    }
  });

  test("unknown incidents are not found", () => {
    const result = run(storeWith(incident()), "incident.setStatus", {
      id: OTHER,
      status: "fixing",
    });
    expect(!result.ok && result.error.code).toBe("not_found");
  });

  test("invalid args", () => {
    const store = storeWith(incident());
    for (const bad of [{ id: ID, status: "done" }, { id: ID }, { id: "nope", status: "fixing" }]) {
      const result = run(store, "incident.setStatus", bad);
      expect(!result.ok && result.error.code).toBe("invalid_args");
    }
  });

  test("viewers cannot change status", () => {
    const store = storeWith(incident());
    const result = run(
      store,
      "incident.setStatus",
      { id: ID, status: "fixing" },
      ctx({ role: "viewer" }),
    );
    expect(!result.ok && result.error.code).toBe("forbidden");
    expect(store.get("incidents", ID)).toEqual(incident());
  });
});

describe("incident.setSeverity", () => {
  test("changes severity and emits incident.severity_changed", () => {
    const store = storeWith(incident({ status: "resolved" }));
    const result = run(store, "incident.setSeverity", { id: ID, severity: "sev1" });
    expect(result).toEqual({
      ok: true,
      events: [
        { type: "incident.severity_changed", subject: ID, data: { from: "sev2", to: "sev1" } },
      ],
    });
    expect(store.get("incidents", ID)).toEqual(
      incident({ status: "resolved", severity: "sev1", updatedAt: T }),
    );
  });

  test("setting the current severity is a conflict", () => {
    const store = storeWith(incident());
    const result = run(store, "incident.setSeverity", { id: ID, severity: "sev2" });
    expect(!result.ok && result.error.code).toBe("conflict");
    expect(store.get("incidents", ID)).toEqual(incident());
  });

  test("not found, invalid args and forbidden", () => {
    const store = storeWith(incident());
    const missing = run(store, "incident.setSeverity", { id: OTHER, severity: "sev1" });
    expect(!missing.ok && missing.error.code).toBe("not_found");
    const invalid = run(store, "incident.setSeverity", { id: ID, severity: 1 });
    expect(!invalid.ok && invalid.error.code).toBe("invalid_args");
    const viewer = run(
      store,
      "incident.setSeverity",
      { id: ID, severity: "sev1" },
      ctx({ role: "viewer" }),
    );
    expect(!viewer.ok && viewer.error.code).toBe("forbidden");
    expect(store.get("incidents", ID)).toEqual(incident());
  });
});

describe("incident.ack", () => {
  test("records who acknowledged and when, and emits incident.acknowledged", () => {
    const store = storeWith(incident({ status: "investigating" }));
    const result = run(store, "incident.ack", { id: ID });
    expect(result).toEqual({
      ok: true,
      events: [{ type: "incident.acknowledged", subject: ID, data: { by: "usr_ana" } }],
    });
    expect(store.get("incidents", ID)).toEqual(
      incident({
        status: "investigating",
        acknowledgedAt: T,
        acknowledgedBy: "usr_ana",
        updatedAt: T,
      }),
    );
  });

  test("the first ack wins; a second is a conflict and changes nothing", () => {
    const store = storeWith(incident());
    expect(run(store, "incident.ack", { id: ID }).ok).toBe(true);
    const before = store.dump();
    const second = run(
      store,
      "incident.ack",
      { id: ID },
      ctx({ actor: { kind: "user", id: "usr_bia", role: "responder" }, now: T + 5 }),
    );
    expect(!second.ok && second.error.code).toBe("conflict");
    expect(store.dump()).toEqual(before);
  });

  test("a row stored before acknowledgements existed can be acknowledged", () => {
    const { acknowledgedAt: _, acknowledgedBy: __, ...legacy } = incident();
    const store = storeWith(legacy as IncidentRow);
    expect(run(store, "incident.ack", { id: ID }).ok).toBe(true);
    expect(store.get("incidents", ID)?.acknowledgedBy).toBe("usr_ana");
  });

  test("resolved and declined incidents cannot be acknowledged", () => {
    for (const status of ["resolved", "declined"] as const) {
      const store = storeWith(incident({ status }));
      const result = run(store, "incident.ack", { id: ID });
      expect(!result.ok && result.error.code, status).toBe("invalid_transition");
      expect(store.get("incidents", ID)).toEqual(incident({ status }));
    }
  });

  test("not found, invalid args and forbidden", () => {
    const store = storeWith(incident());
    const missing = run(store, "incident.ack", { id: OTHER });
    expect(!missing.ok && missing.error.code).toBe("not_found");
    for (const bad of [{}, { id: "inc_1" }, null]) {
      const invalid = run(store, "incident.ack", bad);
      expect(!invalid.ok && invalid.error.code).toBe("invalid_args");
    }
    const viewer = run(store, "incident.ack", { id: ID }, ctx({ role: "viewer" }));
    expect(!viewer.ok && viewer.error.code).toBe("forbidden");
    expect(store.get("incidents", ID)).toEqual(incident());
  });

  test("a client's optimistic ack matches the server's", () => {
    const client = storeWith(incident());
    const server = storeWith(incident());
    run(client, "incident.ack", { id: ID }, ctx({ server: false }));
    run(server, "incident.ack", { id: ID });
    expect(client.dump()).toEqual(server.dump());
  });
});

describe("runMutation", () => {
  test("every role except viewer may run every incident mutation", () => {
    for (const role of ROLES) {
      const store = storeWith();
      const results = [
        run(store, "incident.declare", { id: ID, title: "t", severity: "sev3" }, ctx({ role })),
        run(store, "incident.setStatus", { id: ID, status: "fixing" }, ctx({ role })),
        run(store, "incident.setSeverity", { id: ID, severity: "sev1" }, ctx({ role })),
        run(store, "incident.ack", { id: ID }, ctx({ role })),
      ];
      for (const result of results) {
        if (role === "viewer") expect(!result.ok && result.error.code).toBe("forbidden");
        else expect(result.ok).toBe(true);
      }
    }
  });

  test("system and integration actors go through the same checks", () => {
    const args = { id: ID, title: "t", severity: "sev1" };
    const system = ctx({ actor: { kind: "system", id: "sys_escalation", role: "owner" } });
    expect(run(storeWith(), "incident.declare", args, system).ok).toBe(true);
    const integration = ctx({ actor: { kind: "integration", id: "int_slack", role: "viewer" } });
    const result = run(storeWith(), "incident.declare", args, integration);
    expect(!result.ok && result.error.code).toBe("forbidden");
  });

  test("an unknown role is forbidden", () => {
    const actor = {
      kind: "user",
      id: "usr_x",
      role: "root",
    } as unknown as MutationContext["actor"];
    const args = { id: ID, title: "t", severity: "sev1" };
    const result = run(storeWith(), "incident.declare", args, ctx({ actor }));
    expect(!result.ok && result.error.code).toBe("forbidden");
  });

  test("unknown names, including prototype keys, are unknown mutations", () => {
    for (const name of ["incident.delete", "toString", "__proto__", "constructor"]) {
      const result = run(storeWith(), name, {});
      expect(!result.ok && result.error.code, name).toBe("unknown_mutation");
    }
  });

  test("the forbidden check runs before argument validation", () => {
    const result = run(storeWith(), "incident.declare", { junk: true }, ctx({ role: "viewer" }));
    expect(!result.ok && result.error.code).toBe("forbidden");
  });

  test("the same inputs give the same store and events", () => {
    const script = (server: boolean) => {
      const store = storeWith(incident({ id: OTHER, number: 3 }));
      const at = (now: number) => ({ ...ctx({ server }), now });
      const results = [
        run(store, "incident.declare", { id: ID, title: "API errors", severity: "sev2" }, at(T)),
        run(store, "incident.setStatus", { id: ID, status: "investigating" }, at(T + 1)),
        run(store, "incident.setSeverity", { id: ID, severity: "sev1" }, at(T + 2)),
        run(store, "incident.setStatus", { id: OTHER, status: "declined" }, at(T + 3)),
      ];
      return { results, rows: store.dump() };
    };
    for (const server of [true, false]) {
      const first = script(server);
      expect(first.results.every((result) => result.ok)).toBe(true);
      expect(script(server)).toEqual(first);
      // Rows and events survive a JSON round trip (they go over the wire and into SQLite).
      expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    }
  });

  test("apply never sees or mutates the caller's args", () => {
    const args = Object.freeze({ id: ID, title: " t ", severity: "sev1" });
    expect(run(storeWith(), "incident.declare", args).ok).toBe(true);
    expect(args.title).toBe(" t ");
  });

  test("a failing apply rolls back its earlier writes", () => {
    const partial = defineMutation({
      name: "test.partial",
      args: v.object({}),
      permission: "incident:declare",
      apply(store) {
        store.insert("counters", { id: "x", value: 1 });
        return { ok: false, error: { code: "conflict", message: "no" } };
      },
    });
    const store = storeWith();
    const result = runMutation(defineRegistry([partial]), "test.partial", {}, store, ctx());
    expect(!result.ok && result.error.code).toBe("conflict");
    expect(store.dump()).toEqual({});
  });

  test("an exception becomes an internal error that leaks nothing and writes nothing", () => {
    const broken = defineMutation({
      name: "test.broken",
      args: v.object({}),
      permission: "incident:declare",
      apply(store) {
        store.insert("counters", { id: "x", value: 1 });
        store.insert("counters", { id: "x", value: 1 }); // duplicate → StoreError
        return ok();
      },
    });
    const store = storeWith();
    const result = runMutation(defineRegistry([broken]), "test.broken", {}, store, ctx());
    expect(result).toEqual({
      ok: false,
      error: { code: "internal", message: "test.broken failed" },
    });
    expect(store.dump()).toEqual({});
  });

  test("duplicate names are rejected when the registry is built", () => {
    const declare = mutations["incident.declare"];
    expect(() => defineRegistry([declare, declare])).toThrow(
      "Duplicate definition incident.declare",
    );
  });
});

describe("runMutation options and guards", () => {
  const args = { id: ID, title: "t", severity: "sev1" };

  test("commit runs inside the transaction with the events", () => {
    const store = storeWith();
    const seen: unknown[] = [];
    const result = runMutation(mutations, "incident.declare", args, store, ctx(), {
      commit(events) {
        // The mutation's rows are visible: the outbox write shares their transaction.
        seen.push(
          store.get("incidents", ID)?.number,
          events.map((event) => event.type),
        );
      },
    });
    expect(result.ok).toBe(true);
    expect(seen).toEqual([1, ["incident.declared"]]);
  });

  test("a throwing commit rolls everything back and reports the cause only to onError", () => {
    const store = storeWith();
    const onError = vi.fn();
    const cause = new Error("outbox is full: secret detail");
    const result = runMutation(mutations, "incident.declare", args, store, ctx(), {
      commit() {
        throw cause;
      },
      onError,
    });
    expect(result).toEqual({
      ok: false,
      error: { code: "internal", message: "incident.declare failed" },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(onError).toHaveBeenCalledExactlyOnceWith(cause, "incident.declare");
    expect(store.dump()).toEqual({});
  });

  test("commit is not called when apply fails", () => {
    const commit = vi.fn();
    const result = runMutation(mutations, "incident.declare", args, storeWith(incident()), ctx(), {
      commit,
    });
    expect(!result.ok && result.error.code).toBe("conflict");
    expect(commit).not.toHaveBeenCalled();
  });

  test("a throwing onError does not escape", () => {
    const result = runMutation(mutations, "incident.declare", args, storeWith(), ctx(), {
      commit() {
        throw new Error("commit");
      },
      onError() {
        throw new Error("logger");
      },
    });
    expect(!result.ok && result.error.code).toBe("internal");
  });

  test("ctx.now must be a safe non-negative integer", () => {
    for (const now of [-1, 1.5, Number.NaN, Infinity, 2 ** 53, "1" as unknown as number]) {
      const store = storeWith();
      const onError = vi.fn();
      const result = runMutation(mutations, "incident.declare", args, store, ctx({ now }), {
        onError,
      });
      expect(result, String(now)).toEqual({
        ok: false,
        error: { code: "internal", message: "incident.declare failed" },
      });
      expect(onError.mock.calls[0]![0]).toBeInstanceOf(RangeError);
      expect(store.dump()).toEqual({});
    }
    expect(run(storeWith(), "incident.declare", args, ctx({ now: 0, server: false })).ok).toBe(
      true,
    );
  });

  test("the server accepts ids from any past time, so an offline declare never fails", () => {
    const at = (offset: number) => ({ ...args, id: newId("inc", T + offset, byte(3)) });
    const DAY = 24 * 60 * 60 * 1000;
    for (const offset of [-T, -30 * DAY, -DAY, -ID_CLOCK_SKEW_MS - 1, 0, ID_CLOCK_SKEW_MS]) {
      const store = storeWith();
      expect(run(store, "incident.declare", at(offset)).ok, String(offset)).toBe(true);
      // The row is dated by the server's clock, not the id's.
      expect(store.get("incidents", at(offset).id)?.declaredAt).toBe(T);
    }
  });

  test("the server rejects ids dated more than the skew into its future", () => {
    const at = (offset: number) => ({ ...args, id: newId("inc", T + offset, byte(3)) });
    for (const offset of [ID_CLOCK_SKEW_MS + 1, 365 * 24 * 60 * 60 * 1000]) {
      const store = storeWith();
      const result = run(store, "incident.declare", at(offset));
      expect(!result.ok && result.error.code, String(offset)).toBe("invalid_args");
      expect(!result.ok && result.error.issues).toEqual([
        { path: "id", message: "Id time is too far in the future" },
      ]);
      expect(store.dump()).toEqual({});
    }
    // Clients do not check: the server decides.
    const ahead = run(
      storeWith(),
      "incident.declare",
      at(ID_CLOCK_SKEW_MS + 1),
      ctx({ server: false }),
    );
    expect(ahead.ok).toBe(true);
  });

  test("echoed names are clipped and issues capped", () => {
    const name = "x".repeat(10_000);
    const unknown = run(storeWith(), name, {});
    expect(!unknown.ok && unknown.error.code).toBe("unknown_mutation");
    expect(!unknown.ok && unknown.error.message.length).toBe("Unknown mutation ".length + MAX_ECHO);

    const junk = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i]));
    const invalid = run(storeWith(), "incident.declare", junk);
    expect(!invalid.ok && invalid.error.issues?.length).toBe(MAX_ISSUES);
  });

  test("inside an outer transaction, a rejected mutation undoes only its own writes", () => {
    const store = storeWith(incident({ status: "declined" }));
    store.transaction(() => {
      store.insert("counters", { id: "outer", value: 1 });
      const result = run(store, "incident.setStatus", { id: ID, status: "fixing" });
      expect(!result.ok && result.error.code).toBe("invalid_transition");
    });
    expect(store.get("counters", "outer")).toEqual({ id: "outer", value: 1 });
    expect(store.get("incidents", ID)).toEqual(incident({ status: "declined" }));
  });

  test("an outer rollback also undoes a mutation that succeeded inside it", () => {
    const store = storeWith();
    expect(() =>
      store.transaction(() => {
        expect(run(store, "incident.declare", args).ok).toBe(true);
        throw new Error("outer");
      }),
    ).toThrow("outer");
    expect(store.dump()).toEqual({});
  });
});

describe("runMutation never throws", () => {
  test("a non-string name is an unknown mutation", () => {
    for (const name of [null, undefined, [], {}, 42, Symbol("x")]) {
      const result = runMutation(mutations, name as never, {}, storeWith(), ctx());
      expect(result.ok, String(typeof name)).toBe(false);
      expect(!result.ok && result.error.code).toBe("unknown_mutation");
    }
    const result = runMutation(mutations, null as never, {}, storeWith(), ctx());
    expect(!result.ok && result.error.message).toBe("Unknown mutation <null>");
  });

  test("args that throw while being read become internal", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    const onError = vi.fn();
    const store = storeWith();
    const result = runMutation(mutations, "incident.declare", hostile, store, ctx(), { onError });
    expect(result).toEqual({
      ok: false,
      error: { code: "internal", message: "incident.declare failed" },
    });
    expect(onError).toHaveBeenCalledOnce();
    expect(store.dump()).toEqual({});
  });

  test("a success without events is internal and writes nothing", () => {
    const silent = defineMutation({
      name: "test.silent",
      args: v.object({}),
      permission: "incident:declare",
      apply(store) {
        store.insert("counters", { id: "x", value: 1 });
        return ok();
      },
    });
    const onError = vi.fn();
    const commit = vi.fn();
    const store = storeWith();
    const result = runMutation(defineRegistry([silent]), "test.silent", {}, store, ctx(), {
      commit,
      onError,
    });
    expect(result).toEqual({
      ok: false,
      error: { code: "internal", message: "test.silent failed" },
    });
    expect(onError).toHaveBeenCalledOnce();
    expect(String(onError.mock.calls[0]![0])).toContain("without events");
    expect(commit).not.toHaveBeenCalled();
    expect(store.dump()).toEqual({});
  });
});
