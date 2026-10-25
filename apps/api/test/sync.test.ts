// The sync endpoint end to end: real WebSockets through the Worker into WorkspaceDO.
import { env, exports } from "cloudflare:workers";
import { createExecutionContext, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { isId, newId } from "@freecorps/brigade-schema";
import { MAX_CLIENT_MESSAGE_LENGTH, PROTOCOL_VERSION } from "@freecorps/brigade-sync/protocol";
import worker from "../src/index.ts";
import { MAX_SUBSCRIPTIONS, type SocketState } from "../src/workspace.ts";

type Frame = { type: string; [key: string]: unknown };

const open: WebSocket[] = [];
afterEach(() => {
  for (const ws of open.splice(0)) {
    try {
      ws.close(1000, "done");
    } catch {
      // Already closed.
    }
  }
});

let names = 0;
const workspace = () => `sync-${++names}`;
const incidentId = () => newId("inc", Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n)));

/** The shard's epoch, read from its storage. */
const epochOf = (ws: string) =>
  runInDurableObject(
    env.WORKSPACE.getByName(ws),
    (_instance, state) =>
      state.storage.sql
        .exec<{ value: string }>("select value from shard_meta where key = 'epoch'")
        .one().value,
  );

/** Opens a sync socket and collects what the shard sends. */
async function connect(ws: string) {
  const response = await exports.default.fetch(`http://localhost/sync/${ws}`, {
    headers: { Upgrade: "websocket" },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  open.push(socket);
  const frames: Frame[] = [];
  const waiting: (() => void)[] = [];
  let read = 0;
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    socket.addEventListener("close", (event) =>
      resolve({ code: event.code, reason: event.reason }),
    ),
  );
  socket.addEventListener("message", (event) => {
    frames.push(JSON.parse(event.data as string) as Frame);
    waiting.splice(0).forEach((wake) => wake());
  });
  const client = {
    socket,
    frames,
    closed,
    send(frame: unknown) {
      socket.send(typeof frame === "string" ? frame : JSON.stringify(frame));
    },
    /** The next frame not read yet. */
    async next(): Promise<Frame> {
      while (frames.length <= read) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`no frame after ${JSON.stringify(frames)}`)),
            2000,
          );
          waiting.push(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      return frames[read++]!;
    },
    /** Waits for in-flight frames by round-tripping a harmless message. */
    async drain(): Promise<Frame[]> {
      client.send({ type: "subscribe", subId: "drain", query: "nope", args: {} });
      const rest: Frame[] = [];
      for (;;) {
        const frame = await client.next();
        if (frame.subId === "drain" && frame.type === "error") return rest;
        rest.push(frame);
      }
    },
    hello(clientId = `client-${names}-${Math.random().toString(36).slice(2)}`) {
      client.send({ type: "hello", protocol: PROTOCOL_VERSION, clientId });
      return client;
    },
  };
  return client;
}

const declare = (id: string, title = "Checkout down") => ({
  type: "mutate",
  mutationId: `m-${id}`,
  name: "incident.declare",
  args: { id, title, severity: "sev2" },
});

/** The patch a mutating socket always gets after an ok result, here with nothing it subscribed to. */
const emptyPatch = (version: number) => ({
  type: "patch",
  epoch: expect.any(String),
  version,
  subs: {},
});

const active = (subId: string, resume?: { version: number; epoch: string }) => ({
  type: "subscribe",
  subId,
  query: "incidents.active",
  args: {},
  ...resume,
});

describe("GET /sync/:workspaceId", () => {
  test("refuses a request that is not a WebSocket upgrade, a bad id or another method", async () => {
    const plain = await exports.default.fetch("http://localhost/sync/acme");
    expect(plain.status).toBe(426);
    expect(plain.headers.get("Upgrade")).toBe("websocket");
    const bad = await exports.default.fetch("http://localhost/sync/ACME", {
      headers: { Upgrade: "websocket" },
    });
    expect(bad.status).toBe(400);
    const post = await exports.default.fetch("http://localhost/sync/acme", { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("Allow")).toBe("GET");
    expect((await exports.default.fetch("http://localhost/sync/acme/x")).status).toBe(404);
  });

  test("a client subscribes and gets a snapshot at the shard's epoch and version", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello();
    a.send(active("s1"));
    const epoch = await epochOf(ws);
    expect(isId("ep", epoch)).toBe(true);
    expect(await a.next()).toEqual({ type: "snapshot", subId: "s1", epoch, version: 0, rows: [] });
  });

  test("the epoch is created once and kept for the storage's life", async () => {
    const ws = workspace();
    const epoch = await epochOf(ws);
    // A new instance over the same storage (as after eviction or hibernation) keeps it.
    await runInDurableObject(env.WORKSPACE.getByName(ws), (instance) => {
      expect(Reflect.get(instance, "shard")).toMatchObject({ epoch });
    });
    expect(await epochOf(ws)).toBe(epoch);
    expect(await epochOf(workspace())).not.toBe(epoch);
  });

  test("A declares: A gets the result before the patch, B gets the patch", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello();
    const b = (await connect(ws)).hello();
    for (const client of [a, b]) {
      client.send(active("active"));
      expect((await client.next()).type).toBe("snapshot");
    }
    const id = incidentId();
    a.send(declare(id));
    expect(await a.next()).toEqual({
      type: "mutationResult",
      mutationId: `m-${id}`,
      ok: true,
      version: 1,
    });
    const patch = {
      type: "patch",
      epoch: await epochOf(ws),
      version: 1,
      subs: {
        active: {
          upserts: [
            expect.objectContaining({ id, number: 1, status: "triage", declaredBy: "usr_dev" }),
          ],
          deletes: [],
        },
      },
    };
    expect(await a.next()).toEqual(patch);
    expect(await b.next()).toEqual(patch);
  });

  test("one patch per version covers every subscription it touched; a row that leaves is a delete", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello();
    const id = incidentId();
    a.send(declare(id));
    expect(await a.next()).toMatchObject({ type: "mutationResult", ok: true, version: 1 });
    expect(await a.next()).toEqual(emptyPatch(1));
    a.send(active("active"));
    a.send({ type: "subscribe", subId: "one", query: "incident.byId", args: { id } });
    a.send({
      type: "subscribe",
      subId: "__proto__",
      query: "incident.byId",
      args: { id: incidentId() },
    });
    for (let i = 0; i < 3; i++) expect((await a.next()).type).toBe("snapshot");

    a.send({
      type: "mutate",
      mutationId: "resolve",
      name: "incident.setStatus",
      args: { id, status: "resolved" },
    });
    expect(await a.next()).toMatchObject({ type: "mutationResult", ok: true, version: 2 });
    expect(await a.next()).toEqual({
      type: "patch",
      epoch: await epochOf(ws),
      version: 2,
      subs: {
        active: { upserts: [], deletes: [id] },
        one: { upserts: [expect.objectContaining({ id, status: "resolved" })], deletes: [] },
      },
    });
  });

  test("a subId such as __proto__ is an ordinary subscription", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello();
    a.send(active("__proto__"));
    await a.next();
    const id = incidentId();
    a.send(declare(id));
    await a.next();
    const patch = await a.next();
    expect(Object.keys(patch.subs as object)).toEqual(["__proto__"]);
  });

  test("a resent mutation gets the stored result and runs once", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello("client-dedup");
    const id = incidentId();
    a.send(declare(id));
    const first = await a.next();
    expect(await a.next()).toEqual(emptyPatch(1));
    a.socket.close(1000, "reconnect");

    // Another mutation moves the shard on.
    const b = (await connect(ws)).hello();
    b.send(declare(incidentId()));
    expect(await b.next()).toMatchObject({ ok: true, version: 2 });

    // The retry gets the stored result alone: no patch, which would claim a version this new socket has no data
    // for. The subscribe answer that follows settles it.
    const again = (await connect(ws)).hello("client-dedup");
    again.send(declare(id));
    expect(await again.next()).toEqual(first);
    again.send(active("active"));
    const snapshot = await again.next();
    expect(snapshot).toMatchObject({ type: "snapshot", version: 2 });
    expect(snapshot.rows).toHaveLength(2);

    // Another client with the same mutation id is another mutation (here, a conflict).
    const other = (await connect(ws)).hello("client-other");
    other.send(declare(id));
    expect(await other.next()).toMatchObject({ ok: false, error: { code: "conflict" } });
  });

  test("resume from a version gets a patch of what changed since, possibly empty", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello();
    const [kept, resolved, added] = [incidentId(), incidentId(), incidentId()];
    a.send(declare(kept));
    a.send(declare(resolved));
    for (const version of [1, 2]) {
      expect(await a.next()).toMatchObject({ type: "mutationResult", version });
      expect(await a.next()).toEqual(emptyPatch(version));
    }

    a.send({
      type: "mutate",
      mutationId: "r",
      name: "incident.setStatus",
      args: { id: resolved, status: "resolved" },
    });
    a.send(declare(added));
    expect(await a.drain()).toHaveLength(4);

    const epoch = await epochOf(ws);
    const b = (await connect(ws)).hello();
    b.send(active("active", { version: 2, epoch }));
    expect(await b.next()).toEqual({
      type: "patch",
      epoch,
      version: 4,
      subs: { active: { upserts: [expect.objectContaining({ id: added })], deletes: [resolved] } },
    });
    b.send(active("now", { version: 4, epoch }));
    expect(await b.next()).toEqual({
      type: "patch",
      epoch,
      version: 4,
      subs: { now: { upserts: [], deletes: [] } },
    });
  });

  test("resume gets a snapshot from another epoch, a compacted version or one ahead of the shard", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello();
    const ids = [incidentId(), incidentId()];
    for (const id of ids) a.send(declare(id));
    expect(await a.drain()).toHaveLength(4);
    const epoch = await epochOf(ws);
    // Compact the log as if more than CHANGE_LOG_VERSIONS versions had passed.
    await runInDurableObject(env.WORKSPACE.getByName(ws), (_instance, state) => {
      state.storage.sql.exec("delete from change_log where version <= 1");
      state.storage.sql.exec("insert into shard_meta (key, value) values ('log_start', 1)");
    });
    const snapshot = (subId: string) => ({
      type: "snapshot",
      subId,
      epoch,
      version: 2,
      rows: expect.any(Array),
    });
    a.send(active("old", { version: 0, epoch }));
    expect(await a.next()).toEqual(snapshot("old"));
    a.send(active("ok", { version: 1, epoch }));
    expect(await a.next()).toMatchObject({ type: "patch", epoch, version: 2 });
    a.send(active("future", { version: 9, epoch }));
    expect(await a.next()).toEqual(snapshot("future"));
    a.send(active("elsewhere", { version: 2, epoch: "ep_other" }));
    expect(await a.next()).toEqual(snapshot("elsewhere"));
    a.send(active("fresh"));
    expect(await a.next()).toEqual(snapshot("fresh"));
  });

  test("per-socket state lives in the socket's attachment", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello("client-attached");
    const id = incidentId();
    a.send({ type: "subscribe", subId: "one", query: "incident.byId", args: { id } });
    await a.next();
    a.send(declare(id));
    await a.next();
    await a.next();
    await runInDurableObject(env.WORKSPACE.getByName(ws), (_instance, state) => {
      const sockets = state.getWebSockets();
      expect(sockets).toHaveLength(1);
      expect(sockets[0]!.deserializeAttachment() as SocketState).toEqual({
        workspace: ws,
        actor: { kind: "user", id: "usr_dev", role: "responder" },
        clientId: "client-attached",
        subs: [{ subId: "one", query: "incident.byId", args: { id } }],
      });
    });
    a.send({ type: "unsubscribe", subId: "one" });
    await a.drain();
    await runInDurableObject(env.WORKSPACE.getByName(ws), (_instance, state) => {
      expect((state.getWebSockets()[0]!.deserializeAttachment() as SocketState).subs).toEqual([]);
    });
  });

  test("refused subscriptions are errors with their subId; the socket stays open", async () => {
    const a = (await connect(workspace())).hello();
    a.send({ type: "subscribe", subId: "q", query: "nope", args: {} });
    expect(await a.next()).toMatchObject({ type: "error", subId: "q", code: "unknown_query" });
    a.send({ type: "subscribe", subId: "q", query: "incident.byId", args: { id: "x" } });
    expect(await a.next()).toMatchObject({ type: "error", subId: "q", code: "invalid_args" });
    // A malformed subscribe whose subId can be read is still answered for that subscription.
    a.send({ type: "subscribe", subId: "v", query: "incidents.active", args: {}, version: 1 });
    expect(await a.next()).toEqual({
      type: "error",
      subId: "v",
      code: "invalid_args",
      message: "version and epoch go together",
    });
    for (let i = 0; i < MAX_SUBSCRIPTIONS; i++) a.send(active(`s${i}`));
    a.send(active("one-too-many"));
    const frames = [];
    for (let i = 0; i <= MAX_SUBSCRIPTIONS; i++) frames.push(await a.next());
    expect(frames.at(-1)).toMatchObject({ type: "error", subId: "one-too-many", code: "limit" });
    a.send({ type: "mutate", mutationId: "bad", name: "incident.nope", args: {} });
    expect(await a.next()).toMatchObject({ ok: false, error: { code: "unknown_mutation" } });
  });

  test("a malformed mutate with a readable id gets a failed result, not stored; the socket stays open", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello();
    const id = incidentId();
    const huge = {
      type: "mutate",
      mutationId: "too-big",
      name: "incident.declare",
      args: { id, title: "x".repeat(MAX_CLIENT_MESSAGE_LENGTH), severity: "sev2" },
    };
    a.send(huge);
    expect(await a.next()).toEqual({
      type: "mutationResult",
      mutationId: "too-big",
      ok: false,
      error: { code: "invalid_args", message: "frame too large" },
    });
    a.send({ type: "mutate", mutationId: "extra", name: "incident.declare", args: {}, x: 1 });
    expect(await a.next()).toEqual({
      type: "mutationResult",
      mutationId: "extra",
      ok: false,
      error: { code: "invalid_args", message: "unexpected field x" },
    });
    // Nothing ran, nothing was stored (the same id runs once it is well-formed), and the socket still works.
    a.send({ ...declare(id), mutationId: "extra" });
    expect(await a.next()).toMatchObject({ type: "mutationResult", ok: true, version: 1 });
    expect(await a.next()).toEqual(emptyPatch(1));
  });

  test("a mutate before hello is a protocol error and a close, so the client replays it after hello", async () => {
    const a = await connect(workspace());
    a.send({ type: "mutate", mutationId: "early", name: "incident.declare", args: {} });
    expect(await a.next()).toEqual({ type: "error", code: "protocol", message: "hello first" });
    expect(await a.closed).toMatchObject({ code: 1002 });
    const b = await connect(workspace());
    b.send({ type: "mutate", mutationId: "early-bad", name: "x", args: {}, extra: 1 });
    expect(await b.next()).toEqual({
      type: "error",
      code: "protocol",
      message: "unexpected field extra",
    });
    expect(await b.closed).toMatchObject({ code: 1002 });
  });

  test("a subscription the shard can no longer diff is refused before the patch that skips it", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello();
    a.send(active("live"));
    expect((await a.next()).type).toBe("snapshot");
    a.send({
      type: "subscribe",
      subId: "gone",
      query: "incident.byId",
      args: { id: incidentId() },
    });
    expect((await a.next()).type).toBe("snapshot");
    // As after a deploy that removed the query: the attachment names one the shard no longer has.
    await runInDurableObject(env.WORKSPACE.getByName(ws), (_instance, state) => {
      const socket = state.getWebSockets()[0]!;
      const attached = socket.deserializeAttachment() as SocketState;
      attached.subs = attached.subs.map((sub) =>
        sub.subId === "gone" ? { ...sub, query: "removed.query" } : sub,
      );
      socket.serializeAttachment(attached);
    });
    const id = incidentId();
    a.send(declare(id));
    expect(await a.next()).toMatchObject({ type: "mutationResult", ok: true, version: 1 });
    expect(await a.next()).toEqual({
      type: "error",
      subId: "gone",
      code: "internal",
      message: "Internal error",
    });
    const patch = await a.next();
    expect(patch).toMatchObject({ type: "patch", version: 1 });
    expect(Object.keys(patch.subs as object)).toEqual(["live"]);
    await runInDurableObject(env.WORKSPACE.getByName(ws), (_instance, state) => {
      const attached = state.getWebSockets()[0]!.deserializeAttachment() as SocketState;
      expect(attached.subs.map((sub) => sub.subId)).toEqual(["live"]);
    });
  });

  test("without SYNC_DEV_ACTOR an upgrade without a session is refused with 401, before the shard", async () => {
    // As in every deployed environment: the variable is unset (apps/web's config test checks wrangler.jsonc).
    // A plain object: setting a key on one whose prototype is `env` would write through to the real env.
    const bare: Env = {
      WORKSPACE: env.WORKSPACE,
      DB: env.DB,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    };
    const request = new Request(`http://localhost/sync/${workspace()}`, {
      headers: { Upgrade: "websocket" },
    }) as Parameters<typeof worker.fetch>[0];
    const response = await worker.fetch(request, bare, createExecutionContext());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  test("with SYNC_DEV_ACTOR, an upgrade without a session for a host that is not local is still refused", async () => {
    // A deployment that set the variable by mistake: its requests are for its own hostname, never localhost.
    for (const host of [
      "http://api.test",
      "https://brigade.example.com",
      "http://8.8.8.8",
      "http://172.32.0.1",
      "http://192.168.0.10.example.com",
    ]) {
      const response = await exports.default.fetch(`${host}/sync/${workspace()}`, {
        headers: { Upgrade: "websocket" },
      });
      expect(response.status, host).toBe(401);
    }
    // Local, or a private LAN address: a phone on the same Wi-Fi reaching `vp dev`.
    for (const host of [
      "http://localhost",
      "http://127.0.0.1:5173",
      "http://[::1]:8787",
      "http://192.168.0.10:5173",
      "http://10.0.2.2:5173",
      "http://172.20.1.5",
    ]) {
      const response = await exports.default.fetch(`${host}/sync/${workspace()}`, {
        headers: { Upgrade: "websocket" },
      });
      expect(response.status, host).toBe(101);
      response.webSocket!.accept();
      response.webSocket!.close(1000, "done");
    }
  });

  test(`a socket holds at most ${MAX_SUBSCRIPTIONS} subscriptions; re-subscribing one replaces it`, async () => {
    const a = (await connect(workspace())).hello();
    for (let i = 0; i < MAX_SUBSCRIPTIONS; i++) {
      a.send(active(`s${i}`));
      expect(await a.next()).toMatchObject({ type: "snapshot", subId: `s${i}` });
    }
    a.send(active("one-more"));
    expect(await a.next()).toEqual({
      type: "error",
      subId: "one-more",
      code: "limit",
      message: `At most ${MAX_SUBSCRIPTIONS} subscriptions per socket`,
    });
    a.send(active("s0"));
    expect(await a.next()).toMatchObject({ type: "snapshot", subId: "s0" });
  });

  test("rotating the epoch (the restore hook) closes sockets, and resumes from the old one get snapshots", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello("client-restore");
    a.send(active("active"));
    const before = await a.next();
    const id = incidentId();
    a.send(declare(id));
    expect(await a.next()).toMatchObject({ type: "mutationResult", ok: true, version: 1 });
    expect(await a.next()).toMatchObject({ type: "patch", version: 1 });

    const epoch = await env.WORKSPACE.getByName(ws).rotateEpoch();
    expect(epoch).not.toBe(before.epoch);
    expect(isId("ep", epoch)).toBe(true);
    expect(await epochOf(ws)).toBe(epoch);
    expect(await a.closed).toMatchObject({ code: 1012 });

    // Same version as the client holds, but another epoch: a snapshot, not an empty resume patch.
    const b = (await connect(ws)).hello("client-restore");
    b.send(active("active", { version: 1, epoch: before.epoch as string }));
    expect(await b.next()).toEqual({
      type: "snapshot",
      subId: "active",
      epoch,
      version: 1,
      rows: [expect.objectContaining({ id })],
    });
  });

  test("a failure pruning old results is only logged: the version's patches still go out", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello();
    const b = (await connect(ws)).hello();
    b.send(active("active"));
    expect((await b.next()).type).toBe("snapshot");
    // An expired result whose delete fails.
    await runInDurableObject(env.WORKSPACE.getByName(ws), (_instance, state) => {
      state.storage.sql.exec(
        "insert into mutation_results (actor_id, client_id, mutation_id, at, result) values ('usr_old', 'c', 'm', 0, '{}')",
      );
      state.storage.sql.exec(`create trigger no_prune before delete on mutation_results
                              begin select raise(abort, 'prune failed'); end`);
    });
    const id = incidentId();
    a.send(declare(id));
    expect(await a.next()).toMatchObject({ type: "mutationResult", ok: true, version: 1 });
    expect(await b.next()).toMatchObject({
      type: "patch",
      version: 1,
      subs: { active: { upserts: [expect.objectContaining({ id })], deletes: [] } },
    });
    await runInDurableObject(env.WORKSPACE.getByName(ws), (_instance, state) => {
      const rows = state.storage.sql
        .exec<{ n: number }>("select count(*) as n from mutation_results where at = 0")
        .one().n;
      expect(rows).toBe(1);
    });
  });

  test("frames queued behind a close are dropped: a dependent mutate never runs out of order", async () => {
    const ws = workspace();
    const sql = (query: string) =>
      runInDurableObject(env.WORKSPACE.getByName(ws), (_instance, state) => {
        state.storage.sql.exec(query);
      });
    await sql(`create trigger no_outbox before insert on outbox
               begin select raise(abort, 'outbox unavailable'); end`);
    const id = incidentId();
    const first = declare(id);
    const second = {
      type: "mutate",
      mutationId: `sev-${id}`,
      name: "incident.setSeverity",
      args: { id, severity: "sev1" },
    };
    // Sent back to back: the second is already queued when the first fails on storage and the shard closes.
    const a = (await connect(ws)).hello("client-queued");
    a.send(first);
    a.send(second);
    expect(await a.next()).toEqual({ type: "error", code: "internal", message: "Internal error" });
    expect(await a.closed).toMatchObject({ code: 1011 });
    expect(a.frames).toHaveLength(1);
    const results = () =>
      runInDurableObject(env.WORKSPACE.getByName(ws), (_instance, state) =>
        state.storage.sql
          .exec<{ mutation_id: string; result: string }>(
            "select mutation_id, result from mutation_results order by mutation_id",
          )
          .toArray(),
      );
    // Neither ran: the dependent one did not fail with not_found and get stored.
    expect(await results()).toEqual([]);

    await sql("drop trigger no_outbox");
    const b = (await connect(ws)).hello("client-queued");
    b.send(first);
    b.send(second);
    expect(await b.next()).toMatchObject({ type: "mutationResult", ok: true, version: 1 });
    expect(await b.next()).toEqual(emptyPatch(1));
    expect(await b.next()).toMatchObject({ type: "mutationResult", ok: true, version: 2 });
    expect(await b.next()).toEqual(emptyPatch(2));
    // The second ran exactly once: one stored result, one status event, version 2.
    expect((await results()).map((row) => row.mutation_id).sort()).toEqual(
      [first.mutationId, second.mutationId].sort(),
    );
    await runInDurableObject(env.WORKSPACE.getByName(ws), (_instance, state) => {
      const events = state.storage.sql
        .exec<{ event: string }>("select event from outbox order by seq")
        .toArray()
        .map((row) => (JSON.parse(row.event) as { type: string }).type);
      expect(events).toEqual(["incident.declared", "incident.severity_changed"]);
    });
    expect(await b.drain()).toEqual([]);
  });

  test("a failure patching one socket closes that socket alone; the others get the patch", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello("client-a");
    const b = (await connect(ws)).hello("client-b");
    const c = (await connect(ws)).hello("client-c");
    b.send(active("active"));
    expect((await b.next()).type).toBe("snapshot");
    c.send(active("active"));
    expect((await c.next()).type).toBe("snapshot");
    // B's attachment is corrupt: reading its subscriptions throws.
    await runInDurableObject(env.WORKSPACE.getByName(ws), (_instance, state) => {
      for (const socket of state.getWebSockets()) {
        const attached = socket.deserializeAttachment() as SocketState;
        if (attached.clientId === "client-b") {
          socket.serializeAttachment({ ...attached, subs: 5 });
        }
      }
    });
    const id = incidentId();
    a.send(declare(id));
    expect(await a.next()).toMatchObject({ type: "mutationResult", ok: true, version: 1 });
    expect(await a.next()).toEqual(emptyPatch(1));
    expect(await c.next()).toMatchObject({ type: "patch", version: 1 });
    expect(await b.closed).toMatchObject({ code: 1011 });
    expect(b.frames.filter((frame) => frame.type === "patch")).toEqual([]);
    // The others stay open.
    expect(await c.drain()).toEqual([]);
    expect(await a.drain()).toEqual([]);
  });

  test("a socket's subscription state is capped at 8 KiB", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello();
    a.send(active("first"));
    expect((await a.next()).type).toBe("snapshot");
    // No query's args are that large yet, so the state is grown directly.
    await runInDurableObject(env.WORKSPACE.getByName(ws), (_instance, state) => {
      const socket = state.getWebSockets()[0]!;
      const attached = socket.deserializeAttachment() as SocketState;
      attached.subs[0]!.args = { padding: "x".repeat(8000) };
      socket.serializeAttachment(attached);
    });
    a.send(active("second"));
    expect(await a.next()).toEqual({
      type: "error",
      subId: "second",
      code: "limit",
      message: "Too much subscription state on this socket",
    });
    await runInDurableObject(env.WORKSPACE.getByName(ws), (_instance, state) => {
      const attached = state.getWebSockets()[0]!.deserializeAttachment() as SocketState;
      expect(attached.subs.map((sub) => sub.subId)).toEqual(["first"]);
    });
  });

  test("a malformed subscribe replaces the subscription with its subId by nothing", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello();
    const b = (await connect(ws)).hello();
    a.send(active("live"));
    expect((await a.next()).type).toBe("snapshot");
    a.send({ ...active("live"), extra: 1 });
    expect(await a.next()).toEqual({
      type: "error",
      subId: "live",
      code: "invalid_args",
      message: "unexpected field extra",
    });
    // The old subscription is gone: a change it would have shown sends this socket nothing.
    b.send(declare(incidentId()));
    expect(await b.next()).toMatchObject({ type: "mutationResult", ok: true });
    expect(await a.drain()).toEqual([]);
  });

  test("a row enters and leaves a filtered subscription through a non-id field", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello();
    const b = (await connect(ws)).hello();
    b.send(active("active"));
    expect((await b.next()).type).toBe("snapshot");
    const id = incidentId();
    a.send(declare(id));
    expect((await b.next()).subs).toEqual({
      active: { upserts: [expect.objectContaining({ id })], deletes: [] },
    });
    const status = (to: string, n: number) => ({
      type: "mutate",
      mutationId: `status-${n}`,
      name: "incident.setStatus",
      args: { id, status: to },
    });
    // Resolved leaves the active list; reopening (resolved → investigating) brings it back as an upsert.
    a.send(status("resolved", 1));
    expect(await b.next()).toMatchObject({
      type: "patch",
      version: 2,
      subs: { active: { upserts: [], deletes: [id] } },
    });
    a.send(status("investigating", 2));
    expect(await b.next()).toMatchObject({
      type: "patch",
      version: 3,
      subs: {
        active: {
          upserts: [expect.objectContaining({ id, status: "investigating" })],
          deletes: [],
        },
      },
    });
  });

  test("other sockets get nothing for a version that touches none of their subscriptions", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello();
    const b = (await connect(ws)).hello();
    b.send({ type: "subscribe", subId: "one", query: "incident.byId", args: { id: incidentId() } });
    expect((await b.next()).type).toBe("snapshot");
    a.send(declare(incidentId()));
    expect(await a.next()).toMatchObject({ type: "mutationResult", ok: true });
    expect(await a.next()).toEqual(emptyPatch(1));
    expect(await b.drain()).toEqual([]);
  });

  test.for([
    ["not JSON", "{", "frames must be JSON"],
    ["an unknown type", { type: "nope" }, "unknown message type"],
    ["an unknown field", { type: "unsubscribe", subId: "s", extra: 1 }, "unexpected field extra"],
    [
      "too large",
      JSON.stringify({ type: "unsubscribe", subId: "x".repeat(70_000) }),
      "frame too large",
    ],
    ["a frame before hello", { type: "unsubscribe", subId: "s" }, "hello first"],
    ["another protocol", { type: "hello", protocol: 99, clientId: "c" }, "Unsupported protocol"],
    [
      "the removed lastVersions",
      { type: "hello", protocol: PROTOCOL_VERSION, clientId: "c", lastVersions: {} },
      "unexpected field lastVersions",
    ],
  ] as const)("%s is a protocol error frame, then a close", async ([, frame, message]) => {
    const a = await connect(workspace());
    a.send(frame);
    expect(await a.next()).toEqual({ type: "error", code: "protocol", message });
    expect(await a.closed).toMatchObject({ code: 1002 });
  });

  test("a binary frame or a second hello is a protocol error", async () => {
    const a = await connect(workspace());
    a.socket.send(new Uint8Array([1, 2, 3]));
    expect(await a.next()).toMatchObject({ code: "protocol", message: "frames must be text" });
    const b = (await connect(workspace())).hello();
    b.hello();
    expect(await b.next()).toMatchObject({ code: "protocol", message: "hello twice" });
    expect(await b.closed).toMatchObject({ code: 1002 });
  });
});
