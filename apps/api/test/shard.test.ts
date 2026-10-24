// The shard's storage side: versions, the change log, the outbox and stored results, all in one transaction.
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, test } from "vite-plus/test";
import { isId, newId, type Actor } from "@freecorps/brigade-schema";
import { RESULT_RETENTION_MS, Shard } from "../src/shard.ts";

const ana: Actor = { kind: "user", id: "usr_ana", role: "responder" };
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
      // The counter is server-only: changed, but not in the change log or the patches.
      expect(changes.map((change) => [change.table, change.id])).toEqual([["incidents", id]]);
      expect(shard.store.get("incidents", id)?.number).toBe(1);
      expect(sql.exec("select version, tbl, id from change_log").toArray()).toEqual([
        { version: 1, tbl: "incidents", id },
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
      expect(shard.storedResult("c1", "m-missing", NOW)).toEqual(outcome.result);
    });
  });

  test("an outbox failure rolls back the rows, the counter and the version, and logs the cause", async () => {
    await withShard((shard, sql, logs) => {
      sql.exec("drop table outbox");
      const id = incidentId();
      const { result } = declare(shard, id);
      expect(result).toMatchObject({ ok: false, error: { code: "internal" } });
      expect(shard.store.get("incidents", id)).toBeUndefined();
      expect(shard.store.get("counters", "incident")).toBeUndefined();
      expect(shard.version()).toBe(0);
      expect(count(sql, "change_log")).toBe(0);
      expect(logs).toEqual([
        expect.objectContaining({ message: "mutation failed", mutation: "incident.declare" }),
      ]);
    });
  });

  test("stored results expire after the retention window", async () => {
    await withShard((shard, sql) => {
      const { result } = declare(shard);
      const { mutationId } = result;
      expect(shard.storedResult("c1", mutationId, NOW + RESULT_RETENTION_MS)).toEqual(result);
      expect(shard.storedResult("c1", mutationId, NOW + RESULT_RETENTION_MS + 1)).toBeUndefined();
      expect(shard.storedResult("c2", mutationId, NOW)).toBeUndefined();
      // The next mutation prunes them.
      declare(shard, incidentId(), NOW + RESULT_RETENTION_MS + 1);
      expect(count(sql, "mutation_results")).toBe(1);
    });
  });

  test("the change log keeps the last N versions; older resumes need a snapshot", async () => {
    await withShard((shard, sql) => {
      const query = { name: "incidents.active", table: "incidents" } as never;
      const ids = [incidentId(), incidentId(), incidentId(), incidentId()];
      for (const id of ids) declare(shard, id);
      expect(shard.version()).toBe(4);
      expect(shard.logStart()).toBe(2);
      expect(sql.exec("select version from change_log order by version").toArray()).toEqual([
        { version: 3 },
        { version: 4 },
      ]);
      expect(shard.resume(query, [], 1)).toBeUndefined();
      expect(shard.resume(query, [], 5)).toBeUndefined();
      expect(shard.resume(query, [], 4)).toEqual({ upserts: [], deletes: [] });
      const rows = [{ id: ids[3]! }];
      expect(shard.resume(query, rows, 2)).toEqual({
        upserts: rows,
        deletes: [ids[2]!],
      });
    }, 2);
  });
});
