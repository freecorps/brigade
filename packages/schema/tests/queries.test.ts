import { expect, test, vi } from "vite-plus/test";
import {
  createMemoryStore,
  defineQuery,
  defineRegistry,
  evaluateQuery,
  MAX_ECHO,
  mutations,
  newId,
  queries,
  ROLES,
  runMutation,
  runQuery,
  v,
  type BrigadeTables,
  type IncidentRow,
  type IncidentStatus,
  type MutationContext,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 24, 12, 0, 0);
const id = (time: number, seed: number) => newId("inc", time, (n) => new Uint8Array(n).fill(seed));

const row = (id: string, declaredAt: number, status: IncidentStatus = "triage"): IncidentRow => ({
  id,
  number: null,
  title: id,
  severity: "sev3",
  status,
  declaredAt,
  declaredBy: "usr_ana",
  updatedAt: declaredAt,
});

const OLD = row(id(T - 3000, 1), T - 3000, "investigating");
const NEW = row(id(T - 1000, 2), T - 1000, "monitoring");
const RESOLVED = row(id(T - 500, 3), T - 500, "resolved");
const DECLINED = row(id(T - 200, 4), T - 200, "declined");
// Same declaredAt as NEW: ties are broken by id, newest id first.
const TIE = row(id(T - 1000, 9), T - 1000, "fixing");

const seeded = () =>
  createMemoryStore<BrigadeTables>({ incidents: [OLD, NEW, RESOLVED, DECLINED, TIE] });
const ids = (rows: unknown[]) => (rows as IncidentRow[]).map((r) => r.id);

test("incidents.active lists unresolved, undeclined incidents newest first", () => {
  const result = runQuery(queries, "incidents.active", {}, seeded(), "viewer");
  expect(result.ok && ids(result.rows)).toEqual([TIE.id, NEW.id, OLD.id]);
});

test("incident.byId returns the incident whatever its status", () => {
  const store = seeded();
  for (const incident of [OLD, RESOLVED, DECLINED]) {
    expect(runQuery(queries, "incident.byId", { id: incident.id }, store, "viewer")).toEqual({
      ok: true,
      rows: [incident],
    });
  }
  const missing = runQuery(queries, "incident.byId", { id: id(T, 7) }, store, "viewer");
  expect(missing).toEqual({ ok: true, rows: [] });
});

test("every role can read", () => {
  for (const role of ROLES) {
    expect(runQuery(queries, "incidents.active", {}, seeded(), role).ok).toBe(true);
  }
});

test("invalid args, unknown queries and unknown roles fail with typed errors", () => {
  const store = seeded();
  const code = (name: string, args: unknown, role: string = "viewer") => {
    const result = runQuery(queries, name, args, store, role as never);
    return !result.ok && result.error.code;
  };
  expect(code("incident.byId", { id: "x" })).toBe("invalid_args");
  expect(code("incidents.active", { extra: 1 })).toBe("invalid_args");
  expect(code("incidents.all", {})).toBe("unknown_query");
  expect(code("toString", {})).toBe("unknown_query");
  expect(code("incidents.active", {}, "root")).toBe("forbidden");
});

test("a client re-evaluates its queries after an optimistic declare and status change", () => {
  const client = seeded();
  const ctx: MutationContext = {
    actor: { kind: "user", id: "usr_ana", role: "responder" },
    now: T,
    server: false,
  };
  const fresh = id(T, 5);
  const active = () => ids(evaluateQuery(queries["incidents.active"], {}, client));
  const mutate = (name: string, args: unknown) => runMutation(mutations, name, args, client, ctx);

  expect(active()).not.toContain(fresh);
  expect(mutate("incident.declare", { id: fresh, title: "DB lag", severity: "sev2" }).ok).toBe(
    true,
  );
  expect(active()).toEqual([fresh, TIE.id, NEW.id, OLD.id]);
  expect(evaluateQuery(queries["incident.byId"], { id: fresh }, client)[0]?.number).toBeNull();

  expect(mutate("incident.setStatus", { id: fresh, status: "declined" }).ok).toBe(true);
  expect(active()).toEqual([TIE.id, NEW.id, OLD.id]);
});

test("filter tells which subscriptions a changed row touches", () => {
  const active = queries["incidents.active"];
  expect(active.filter(NEW, {})).toBe(true);
  expect(active.filter({ ...NEW, status: "resolved" }, {})).toBe(false);
  expect(queries["incident.byId"].filter(NEW, { id: NEW.id })).toBe(true);
  expect(queries["incident.byId"].filter(NEW, { id: OLD.id })).toBe(false);
});

test("incident.byId reads one row instead of scanning", () => {
  const store = seeded();
  const scan = vi.spyOn(store, "scan");
  const get = vi.spyOn(store, "get");
  expect(evaluateQuery(queries["incident.byId"], { id: NEW.id }, store)).toEqual([NEW]);
  expect(get).toHaveBeenCalledWith("incidents", NEW.id);
  expect(scan).not.toHaveBeenCalled();
});

test("runQuery never throws: failures become internal and the cause goes to onError", () => {
  const broken = defineQuery({
    name: "test.broken",
    args: v.object({}),
    permission: "incident:read",
    table: "incidents",
    filter: () => {
      throw new Error("secret detail");
    },
  });
  const onError = vi.fn();
  const result = runQuery(defineRegistry([broken]), "test.broken", {}, seeded(), "viewer", {
    onError,
  });
  expect(result).toEqual({ ok: false, error: { code: "internal", message: "test.broken failed" } });
  expect(onError).toHaveBeenCalledOnce();
  expect(onError.mock.calls[0]![1]).toBe("test.broken");
});

test("unknown query names are clipped", () => {
  const result = runQuery(queries, "q".repeat(5_000), {}, seeded(), "viewer");
  expect(!result.ok && result.error.message.length).toBe("Unknown query ".length + MAX_ECHO);
});

test("server-only tables cannot be queried", () => {
  expect(() =>
    defineQuery({
      name: "test.counters",
      args: v.object({}),
      permission: "incident:read",
      table: "counters" as never,
      filter: () => true,
    }),
  ).toThrow("Query test.counters reads server-only table counters");
});

test("a non-string query name is an unknown query", () => {
  for (const name of [null, undefined, [], {}, 42]) {
    const result = runQuery(queries, name as never, {}, seeded(), "viewer");
    expect(!result.ok && result.error.code, String(typeof name)).toBe("unknown_query");
  }
  const result = runQuery(queries, [] as never, {}, seeded(), "viewer");
  expect(!result.ok && result.error.message).toBe("Unknown query <object>");
});

test("query args that throw while being read become internal", () => {
  const hostile = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error("trap");
      },
    },
  );
  const result = runQuery(queries, "incident.byId", hostile, seeded(), "viewer");
  expect(!result.ok && result.error.code).toBe("internal");
});
