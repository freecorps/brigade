// The shard's storage side: versions, the change log, the outbox and stored results, all in one transaction.
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, test } from "vite-plus/test";
import { defineQuery, isId, newId, v, type Actor } from "@freecorps/brigade-schema";
import { RESULT_RETENTION_MS, Shard, subscriptionChanges } from "../src/shard.ts";
import { StorageFailure, type RowChange } from "../src/store.ts";

const ana: Actor = { kind: "user", id: "usr_ana", role: "responder" };
const bia: Actor = { kind: "user", id: "usr_bia", role: "responder" };
const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const incidentId = () => newId("inc", NOW, random);

let names = 0;
function withShard<R>(
  fn: (shard: Shard, sql: SqlStorage, logs: unknown[]) => R,
  changeLogVersions?: number,
) {
  return runInDurableObject(env.WORKSPACE.getByName(`shard-${++names}`), (_instance, state) => {
    const logs: unknown[] = [];
    const shard = new Shard(state.storage, {
      shard: "workspace",
      randomBytes: random,
      log: (message, fields) => logs.push({ message, ...fields }),
      changeLogVersions,
    });
    shard.claim("acme");
    return fn(shard, state.storage.sql, logs);
  });
}

let mutations = 0;
const declare = (shard: Shard, id = incidentId(), now = NOW) =>
  shard.mutate({
    clientId: "c1",
    mutationId: `m${++mutations}`,
    actor: ana,
    name: "incident.declare",
    args: { id, title: "Checkout down", severity: "sev2" },
    now,
  });

const count = (sql: SqlStorage, table: string) =>
  sql.exec<{ n: number }>(`select count(*) as n from ${table}`).one().n;

describe("Shard", () => {
  test("a committed mutation bumps the version once and writes rows, change log, outbox and result", async () => {
    await withShard((shard, sql) => {
      const id = incidentId();
      const { result, changes } = declare(shard, id);
      expect(result).toEqual({
        type: "mutationResult",
        mutationId: expect.any(String),
        ok: true,
        version: 1,
      });
      expect(shard.version()).toBe(1);
      // The counter is server-only: changed, but not in the change log or the patches. The timeline entry is synced.
      expect(changes.map((change) => [change.table, change.id])).toEqual([
        ["incidents", id],
        ["timeline", `${id}:1`],
      ]);
      expect(shard.store.get("incidents", id)?.number).toBe(1);
      expect(sql.exec("select version, tbl, id from change_log").toArray()).toEqual([
        { version: 1, tbl: "incidents", id },
        { version: 1, tbl: "timeline", id: `${id}:1` },
      ]);
      expect(sql.exec("select version from store_rows where tbl = 'incidents'").toArray()).toEqual([
        { version: 1 },
      ]);

      const outbox = sql
        .exec<{ id: string; version: number; event: string }>("select * from outbox")
        .toArray();
      expect(outbox).toHaveLength(1);
      const event = JSON.parse(outbox[0]!.event);
      expect(event).toEqual({
        id: outbox[0]!.id,
        type: "incident.declared",
        source: "brigade://acme/workspace",
        workspaceId: "acme",
        time: new Date(NOW).toISOString(),
        actor: { kind: "user", id: "usr_ana" },
        subject: id,
        data: { id, number: 1, title: "Checkout down", severity: "sev2", status: "triage" },
        specversion: "1.0",
      });
      expect(isId("evt", event.id)).toBe(true);
      expect(outbox[0]!.version).toBe(1);
    });
  });

  test("a rejected mutation writes nothing but its stored result", async () => {
    await withShard((shard, sql) => {
      const outcome = shard.mutate({
        clientId: "c1",
        mutationId: "m-missing",
        actor: ana,
        name: "incident.setStatus",
        args: { id: incidentId(), status: "resolved" },
        now: NOW,
      });
      expect(outcome).toEqual({
        result: {
          type: "mutationResult",
          mutationId: "m-missing",
          ok: false,
          error: { code: "not_found", message: "Incident not found" },
        },
        changes: [],
      });
      expect(shard.version()).toBe(0);
      expect(count(sql, "outbox")).toBe(0);
      expect(count(sql, "change_log")).toBe(0);
      expect(shard.storedResult(ana.id, "c1", "m-missing", NOW)).toEqual(outcome.result);
    });
  });

  test("an unknown mutation's result is not stored: a later deploy may know the name", async () => {
    await withShard((shard, sql) => {
      const outcome = shard.mutate({
        clientId: "c1",
        mutationId: "m-unknown",
        actor: ana,
        name: "incident.fromTheFuture",
        args: {},
        now: NOW,
      });
      expect(outcome.result).toMatchObject({ ok: false, error: { code: "unknown_mutation" } });
      expect(count(sql, "mutation_results")).toBe(0);
    });
  });

  test("a storage failure while committing rolls everything back, stores nothing and throws", async () => {
    await withShard((shard, sql, logs) => {
      sql.exec("drop table outbox");
      const id = incidentId();
      // Not a stored `internal`: the socket closes and the client replays the mutation.
      expect(() => declare(shard, id)).toThrow(/outbox/);
      expect(shard.store.get("incidents", id)).toBeUndefined();
      expect(shard.store.get("counters", "incident")).toBeUndefined();
      expect(shard.version()).toBe(0);
      expect(count(sql, "change_log")).toBe(0);
      expect(count(sql, "mutation_results")).toBe(0);
      // The caller (WorkspaceDO) logs it; the shard does not log it as the mutation's failure.
      expect(logs).toEqual([]);
    });
  });

  test("stored results expire after the retention window", async () => {
    await withShard((shard, sql) => {
      const { result } = declare(shard);
      const { mutationId } = result;
      expect(shard.storedResult(ana.id, "c1", mutationId, NOW + RESULT_RETENTION_MS)).toEqual(
        result,
      );
      expect(
        shard.storedResult(ana.id, "c1", mutationId, NOW + RESULT_RETENTION_MS + 1),
      ).toBeUndefined();
      // The next mutation prunes them.
      declare(shard, incidentId(), NOW + RESULT_RETENTION_MS + 1);
      expect(count(sql, "mutation_results")).toBe(1);
    });
  });

  test("a store write failing inside the mutation's apply is thrown, never stored as internal", async () => {
    await withShard((shard, sql, logs) => {
      // Every write to the row store fails, as a full or broken disk would.
      sql.exec(`create trigger no_writes before insert on store_rows
                begin select raise(abort, 'disk full'); end`);
      const id = incidentId();
      expect(() => declare(shard, id)).toThrow(StorageFailure);
      expect(() => declare(shard, id)).toThrow(/disk full/);
      expect(count(sql, "mutation_results")).toBe(0);
      expect(shard.version()).toBe(0);
      expect(count(sql, "outbox")).toBe(0);
      expect(logs).toEqual([]);
    });
  });

  test("an exception that is not a storage failure is a stored internal", async () => {
    await withShard((shard, sql) => {
      // SQLite works, but `apply` throws on what it reads (a row that is not JSON): the mutation's answer.
      const id = incidentId();
      sql.exec(
        "insert into store_rows (tbl, id, data) values ('counters', 'incident', 'not json')",
      );
      const { result } = declare(shard, id);
      expect(result).toMatchObject({ ok: false, error: { code: "internal" } });
      expect(count(sql, "mutation_results")).toBe(1);
    });
  });

  test("results are kept apart per actor and per client", async () => {
    await withShard((shard, sql) => {
      const run = (actor: Actor, clientId: string, id = incidentId()) =>
        shard.mutate({
          clientId,
          mutationId: "same",
          actor,
          name: "incident.declare",
          args: { id, title: "Checkout down", severity: "sev2" },
          now: NOW,
        }).result;
      const anaC1 = run(ana, "c1");
      expect(run(ana, "c2")).toMatchObject({ ok: true, version: 2 });
      expect(run(bia, "c1")).toMatchObject({ ok: true, version: 3 });
      expect(shard.storedResult(ana.id, "c1", "same", NOW)).toEqual(anaC1);
      expect(shard.storedResult(ana.id, "c2", "same", NOW)).toMatchObject({ version: 2 });
      expect(shard.storedResult(bia.id, "c1", "same", NOW)).toMatchObject({ version: 3 });
      expect(shard.storedResult(bia.id, "c2", "same", NOW)).toBeUndefined();
      expect(count(sql, "mutation_results")).toBe(3);
    });
  });

  test("a key query holds only its row, whatever its filter says", () => {
    const anything = defineQuery({
      name: "test.anyById",
      args: v.object({ id: v.id("inc") }),
      permission: "incident:read",
      table: "incidents",
      key: (args) => args.id,
      filter: () => true,
    });
    const row = (id: string, title: string) =>
      ({
        id,
        number: 1,
        title,
        severity: "sev2",
        status: "triage",
        declaredAt: NOW,
        declaredBy: ana.id,
        acknowledgedAt: null,
        acknowledgedBy: null,
        updatedAt: NOW,
      }) as const;
    const mine = incidentId();
    const other = incidentId();
    const changes: RowChange[] = [
      { table: "incidents", id: other, before: undefined, after: row(other, "Other") },
      { table: "incidents", id: mine, before: row(mine, "Old"), after: row(mine, "New") },
    ];
    expect(subscriptionChanges(anything, { id: mine }, changes)).toEqual({
      upserts: [row(mine, "New")],
      deletes: [],
    });
    expect(subscriptionChanges(anything, { id: incidentId() }, changes)).toBeUndefined();
  });

  test("the change log keeps the last N versions; older resumes need a snapshot", async () => {
    await withShard((shard, sql) => {
      const query = { name: "incidents.active", table: "incidents" } as never;
      const ids = [incidentId(), incidentId(), incidentId(), incidentId()];
      for (const id of ids) declare(shard, id);
      expect(shard.version()).toBe(4);
      expect(shard.logStart()).toBe(2);
      expect(
        sql.exec("select distinct version from change_log order by version").toArray(),
      ).toEqual([{ version: 3 }, { version: 4 }]);
      expect(shard.resume(query, [], { version: 1, epoch: shard.epoch })).toBeUndefined();
      expect(shard.resume(query, [], { version: 5, epoch: shard.epoch })).toBeUndefined();
      expect(shard.resume(query, [], { version: 4, epoch: shard.epoch })).toEqual({
        upserts: [],
        deletes: [],
      });
      expect(shard.resume(query, [], { version: 4, epoch: "ep_other" })).toBeUndefined();
      const rows = [{ id: ids[3]! }];
      expect(shard.resume(query, rows, { version: 2, epoch: shard.epoch })).toEqual({
        upserts: rows,
        deletes: [ids[2]!],
      });
    }, 2);
  });
});
