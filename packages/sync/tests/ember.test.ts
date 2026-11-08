// `EmberSyncClient` (RFC 0016 step 4) against Ember's in-process fake server, which runs Brigade's own queries and
// mutations as `workspace:query` / `workspace:mutate` over its rows, as the shard does (apps/api/ember/workspace.ts).
import { describe, expect, test, vi } from "vite-plus/test";
import { FakeEmberServer } from "@freecorps/ember-client/testing";
import {
  createMemoryStore,
  mutations,
  newId,
  queries,
  runMutation,
  runQuery,
  type Actor,
  type BrigadeTables,
  type Row,
} from "@freecorps/brigade-schema";
import {
  createEmberSyncClient,
  emberShard,
  IDLE_CLOSE_MS,
  type EmberSyncClient,
} from "../src/ember.ts";
import type { FakeDb } from "@freecorps/ember-client/testing";
import type { PendingMutationRecord, PendingStorage } from "@freecorps/ember-client";
import type { MutationOutcome } from "../src/client.ts";

const WORKSPACE = "org_acme";
const ana: Actor = { kind: "user", id: "usr_ana", role: "responder" };
const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

/** Brigade's rows as the fake keeps them: one fake table, each row `{ t, rowId, data }`. */
function load(db: FakeDb) {
  const seed: Record<string, Row[]> = {};
  const index = new Map<string, string>();
  for (const doc of db.all<{ _id: string; t: string; rowId: string; data: string }>("rows")) {
    (seed[doc.t] ??= []).push(JSON.parse(doc.data) as Row);
    index.set(`${doc.t}/${doc.rowId}`, doc._id);
  }
  return { store: createMemoryStore<BrigadeTables>(seed as never), index };
}

function server() {
  return new FakeEmberServer({
    queries: {
      "workspace:query": (db, { name, args }) =>
        runQuery(queries, name, args, load(db).store, "responder"),
    },
    mutations: {
      "workspace:mutate": (db, { name, args }, ctx) => {
        const { store, index } = load(db);
        const actor: Actor = { kind: "user", id: ctx.identity!.subject, role: "responder" };
        const out = runMutation(mutations, name, args, store, {
          actor,
          now: Date.now(),
          server: true,
        });
        if (!out.ok) return out;
        const after = store.dump() as Record<string, Row[]>;
        const kept = new Set<string>();
        for (const [t, rows] of Object.entries(after)) {
          for (const row of rows) {
            const key = `${t}/${row.id}`;
            kept.add(key);
            const id = index.get(key);
            if (id) db.patch("rows", id, { data: JSON.stringify(row) });
            else db.insert("rows", { t, rowId: row.id, data: JSON.stringify(row) });
          }
        }
        for (const [key, id] of index) if (!kept.has(key)) db.delete("rows", id);
        return { ok: true };
      },
    },
  });
}

function client(
  fake: FakeEmberServer,
  extra: Partial<Parameters<typeof createEmberSyncClient>[0]> = {},
): EmberSyncClient {
  return createEmberSyncClient({
    ...extra,
    url: "https://brigade.test/api/ember",
    token: (workspaceId) => (workspaceId === WORKSPACE ? `user:${ana.id}` : null),
    actor: ana,
    WebSocket: fake.WebSocket,
    connectivity: null,
    randomBytes,
    onWarning: () => {},
  });
}

/** Subscribes like `useSyncExternalStore` and records every state. */
function watch(sync: EmberSyncClient, name: "incidents.active") {
  const handle = sync.query(WORKSPACE, name, {});
  const states = [handle.getSnapshot()];
  const off = handle.subscribe(() => states.push(handle.getSnapshot()));
  return { handle, states, off };
}

describe("EmberSyncClient", () => {
  test("a query loads from the workspace's shard, a declare shows at once and is then confirmed", async () => {
    const fake = server();
    const sync = client(fake);
    const { handle } = watch(sync, "incidents.active");
    expect(handle.getSnapshot()).toMatchObject({ status: "loading", rows: [] });
    await vi.waitFor(() => expect(handle.getSnapshot().status).toBe("ready"));
    expect(handle.getSnapshot()).toMatchObject({ rows: [], pending: false });
    expect(sync.connectionState(WORKSPACE)).toBe("open");

    const id = newId("inc", Date.now(), randomBytes);
    const outcome = sync.mutate(WORKSPACE, "incident.declare", { id, title: "Checkout down" });
    // Optimistic: Brigade's `apply` ran over the loaded rows, before the shard answered.
    expect(handle.getSnapshot()).toMatchObject({
      pending: true,
      rows: [{ id, title: "Checkout down", number: null }],
    });
    expect(await outcome).toEqual({ ok: true });
    await vi.waitFor(() => expect(handle.getSnapshot().pending).toBe(false));
    expect(handle.getSnapshot().rows).toMatchObject([{ id, title: "Checkout down" }]);
    // The shard's own run: it allocates `INC-1`, which the optimistic row left empty.
    expect(handle.getSnapshot().rows[0]?.number).toBe(1);
    sync.close();
  });

  test("a change the shard refuses resolves with its error and leaves nothing behind", async () => {
    const fake = server();
    const sync = client(fake);
    const { handle } = watch(sync, "incidents.active");
    await vi.waitFor(() => expect(handle.getSnapshot().status).toBe("ready"));
    // Not an incident id: refused by the optimistic run too, so nothing shows first.
    const outcome = sync.mutate(WORKSPACE, "incident.declare", { id: "nope", title: "x" } as never);
    expect(handle.getSnapshot()).toMatchObject({ pending: false, rows: [] });
    expect(await outcome).toMatchObject({ ok: false, error: { code: "invalid_args" } });
    expect(handle.getSnapshot().rows).toEqual([]);
    sync.close();
  });

  test("a query the shard refuses is an error state", async () => {
    const sync = client(server());
    const handle = sync.query(WORKSPACE, "nothing.here" as never, {} as never);
    const off = handle.subscribe(() => {});
    await vi.waitFor(() => expect(handle.getSnapshot().status).toBe("error"));
    expect(handle.getSnapshot().error?.code).toBe("unknown_query");
    off();
    sync.close();
  });

  test("a workspace nothing uses is closed, and its queries open it again when used", async () => {
    const fake = server();
    const sync = client(fake);
    const states: string[] = [];
    sync.onConnectionChange(WORKSPACE, () => states.push(sync.connectionState(WORKSPACE)));
    const { handle, off } = watch(sync, "incidents.active");
    await vi.waitFor(() => expect(handle.getSnapshot().status).toBe("ready"));
    expect(fake.sockets.size).toBe(1);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      off();
      vi.advanceTimersByTime(1000 + IDLE_CLOSE_MS + 1);
    } finally {
      vi.useRealTimers();
    }
    // Left behind (another workspace opened): no socket, no token asked for, and the state says so.
    expect(sync.connectionState(WORKSPACE)).toBe("idle");
    expect(states.at(-1)).toBe("idle");
    await vi.waitFor(() =>
      expect([...fake.sockets].filter((s) => s.readyState === 1)).toHaveLength(0),
    );
    // The same handle, used again, opens a new client.
    const again = handle.subscribe(() => {});
    await vi.waitFor(() => expect(handle.getSnapshot().status).toBe("ready"));
    expect(sync.connectionState(WORKSPACE)).toBe("open");
    expect(states.at(-1)).toBe("open");
    again();
    sync.close();
  });

  test("connection changes are told per workspace, and a closed client refuses", async () => {
    const fake = server();
    const sync = client(fake);
    const seen: string[] = [];
    // Listening before anything opened the workspace's client.
    const off = sync.onConnectionChange(WORKSPACE, () =>
      seen.push(sync.connectionState(WORKSPACE)),
    );
    expect(sync.connectionState(WORKSPACE)).toBe("idle");
    const { handle } = watch(sync, "incidents.active");
    await vi.waitFor(() => expect(handle.getSnapshot().status).toBe("ready"));
    expect(seen).toContain("open");
    off();
    sync.close();
    // A handle from before the close opens no client again.
    const sockets = fake.history.length;
    handle.subscribe(() => {})();
    expect(sync.connectionState(WORKSPACE)).toBe("idle");
    expect(fake.history.length).toBe(sockets);
    expect(
      await sync.mutate(WORKSPACE, "incident.declare", { id: "x", title: "y" } as never),
    ).toMatchObject({
      ok: false,
      error: { code: "closed" },
    });
    expect(emberShard(WORKSPACE)).toBe("workspace:org_acme");
  });

  test("a change kept from before a restart shows again, is sent with its id and runs once", async () => {
    const fake = server();
    // The phone's kept queue: what the client stored, and its id, survive the client.
    const kept: PendingMutationRecord[] = [];
    let clientId: string | null = null;
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const storage = (wait: boolean): PendingStorage => ({
      getClientId: () => clientId,
      setClientId: (id) => {
        clientId = id;
      },
      load: async () => {
        if (wait) await gate;
        return [...kept];
      },
      put: (record) => {
        kept.push(record);
      },
      // Killed before it heard the answer: nothing is removed.
      remove: () => {},
    });
    const first = client(fake, { storage: () => storage(false) });
    const a = watch(first, "incidents.active");
    await vi.waitFor(() => expect(a.handle.getSnapshot().status).toBe("ready"));
    const id = newId("inc", Date.now(), randomBytes);
    expect(await first.mutate(WORKSPACE, "incident.declare", { id, title: "Kept" })).toEqual({
      ok: true,
    });
    first.close();
    expect(kept).toHaveLength(1);

    // Launched again: nothing loads until `load` gives the stored change back (the app waits for the member's role).
    const outcomes: MutationOutcome[] = [];
    const again = client(fake, {
      storage: () => storage(true),
      onRestoredOutcome: (workspaceId, record, outcome) => {
        expect(workspaceId).toBe(WORKSPACE);
        expect(record.mid).toBe(kept[0]!.mid);
        outcomes.push(outcome);
      },
    });
    const b = watch(again, "incidents.active");
    expect(b.handle.getSnapshot().status).toBe("loading");
    release();
    await vi.waitFor(() => expect(outcomes).toEqual([{ ok: true }]));
    await vi.waitFor(() => expect(b.handle.getSnapshot()).toMatchObject({ pending: false }));
    // Answered from the shard's record of it (same client id and mid): run again, the declare of an id that exists
    // would have been refused.
    expect(b.handle.getSnapshot().rows).toMatchObject([{ id, title: "Kept", number: 1 }]);
    again.close();
  });
});
