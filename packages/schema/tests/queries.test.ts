import { expect, test } from "vite-plus/test";
import {
  createMemoryStore,
  evaluateQuery,
  mutations,
  newId,
  queries,
  ROLES,
  runMutation,
  runQuery,
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
