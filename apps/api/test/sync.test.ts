// The sync endpoint end to end: real WebSockets through the Worker into WorkspaceDO.
import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { newId } from "@freecorps/brigade-schema";
import { PROTOCOL_VERSION } from "@freecorps/brigade-sync/protocol";
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

/** Opens a sync socket and collects what the shard sends. */
async function connect(ws: string) {
  const response = await exports.default.fetch(`http://api.test/sync/${ws}`, {
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
      client.send({ type: "unsubscribe", subId: "drain" });
      client.send({ type: "subscribe", subId: "drain", query: "nope", args: {} });
      const rest: Frame[] = [];
      for (;;) {
        const frame = await client.next();
        if (frame.subId === "drain" && frame.type === "error") return rest;
        rest.push(frame);
      }
    },
    hello(clientId = `client-${names}-${Math.random().toString(36).slice(2)}`) {
      client.send({ type: "hello", protocol: PROTOCOL_VERSION, clientId, lastVersions: {} });
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

describe("GET /sync/:workspaceId", () => {
  test("refuses a request that is not a WebSocket upgrade, a bad id or another method", async () => {
    const plain = await exports.default.fetch("http://api.test/sync/acme");
    expect(plain.status).toBe(426);
    expect(plain.headers.get("Upgrade")).toBe("websocket");
    const bad = await exports.default.fetch("http://api.test/sync/ACME", {
      headers: { Upgrade: "websocket" },
    });
    expect(bad.status).toBe(400);
    const post = await exports.default.fetch("http://api.test/sync/acme", { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("Allow")).toBe("GET");
    expect((await exports.default.fetch("http://api.test/sync/acme/x")).status).toBe(404);
  });

  test("a client subscribes and gets a snapshot at the shard version", async () => {
    const a = (await connect(workspace())).hello();
    a.send({ type: "subscribe", subId: "s1", query: "incidents.active", args: {} });
    expect(await a.next()).toEqual({ type: "snapshot", subId: "s1", version: 0, rows: [] });
  });

  test("A declares: A gets the result before the patch, B gets the patch", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello();
    const b = (await connect(ws)).hello();
    for (const client of [a, b]) {
      client.send({ type: "subscribe", subId: "active", query: "incidents.active", args: {} });
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
    await a.next();
    a.send({ type: "subscribe", subId: "active", query: "incidents.active", args: {} });
    a.send({ type: "subscribe", subId: "one", query: "incident.byId", args: { id } });
    a.send({
      type: "subscribe",
      subId: "other",
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
      version: 2,
      subs: {
        active: { upserts: [], deletes: [id] },
        one: { upserts: [expect.objectContaining({ id, status: "resolved" })], deletes: [] },
      },
    });
  });

  test("a resent mutation gets the stored result and runs once", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello("client-dedup");
    const id = incidentId();
    a.send(declare(id));
    const first = await a.next();
    a.socket.close(1000, "reconnect");

    const again = (await connect(ws)).hello("client-dedup");
    again.send(declare(id));
    expect(await again.next()).toEqual(first);
    again.send({ type: "subscribe", subId: "active", query: "incidents.active", args: {} });
    const snapshot = await again.next();
    expect(snapshot).toMatchObject({ type: "snapshot", version: 1 });
    expect(snapshot.rows).toHaveLength(1);

    // Another client with the same mutation id is another mutation (here, a conflict).
    const other = (await connect(ws)).hello("client-other");
    other.send(declare(id));
    expect(await other.next()).toMatchObject({ ok: false, error: { code: "conflict" } });
  });

  test("resume from a version gets a patch of what changed since", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello();
    const [kept, resolved, added] = [incidentId(), incidentId(), incidentId()];
    a.send(declare(kept));
    a.send(declare(resolved));
    await a.next();
    expect(await a.next()).toMatchObject({ version: 2 });

    a.send({
      type: "mutate",
      mutationId: "r",
      name: "incident.setStatus",
      args: { id: resolved, status: "resolved" },
    });
    a.send(declare(added));
    await a.next();
    expect(await a.next()).toMatchObject({ version: 4 });

    const b = (await connect(ws)).hello();
    b.send({ type: "subscribe", subId: "active", query: "incidents.active", args: {}, version: 2 });
    expect(await b.next()).toEqual({
      type: "patch",
      version: 4,
      subs: { active: { upserts: [expect.objectContaining({ id: added })], deletes: [resolved] } },
    });
    b.send({ type: "subscribe", subId: "now", query: "incidents.active", args: {}, version: 4 });
    expect(await b.next()).toEqual({
      type: "patch",
      version: 4,
      subs: { now: { upserts: [], deletes: [] } },
    });
  });

  test("resume from a compacted version, or one ahead of the shard, gets a snapshot", async () => {
    const ws = workspace();
    const a = (await connect(ws)).hello();
    const ids = [incidentId(), incidentId()];
    for (const id of ids) a.send(declare(id));
    await a.next();
    await a.next();
    // Compact the log as if more than CHANGE_LOG_VERSIONS versions had passed.
    await runInDurableObject(env.WORKSPACE.getByName(ws), (_instance, state) => {
      state.storage.sql.exec("delete from change_log where version <= 1");
      state.storage.sql.exec("insert into shard_meta (key, value) values ('log_start', 1)");
    });
    a.send({ type: "subscribe", subId: "old", query: "incidents.active", args: {}, version: 0 });
    expect(await a.next()).toMatchObject({ type: "snapshot", subId: "old", version: 2 });
    a.send({ type: "subscribe", subId: "ok", query: "incidents.active", args: {}, version: 1 });
    expect(await a.next()).toMatchObject({ type: "patch", version: 2 });
    a.send({ type: "subscribe", subId: "future", query: "incidents.active", args: {}, version: 9 });
    expect(await a.next()).toMatchObject({ type: "snapshot", subId: "future", version: 2 });
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
        subs: { one: { query: "incident.byId", args: { id }, version: 1 } },
      });
    });
    a.send({ type: "unsubscribe", subId: "one" });
    await a.drain();
    await runInDurableObject(env.WORKSPACE.getByName(ws), (_instance, state) => {
      expect((state.getWebSockets()[0]!.deserializeAttachment() as SocketState).subs).toEqual({});
    });
  });

  test("refused subscriptions are errors with their subId; the socket stays open", async () => {
    const a = (await connect(workspace())).hello();
    a.send({ type: "subscribe", subId: "q", query: "nope", args: {} });
    expect(await a.next()).toMatchObject({ type: "error", subId: "q", code: "unknown_query" });
    a.send({ type: "subscribe", subId: "q", query: "incident.byId", args: { id: "x" } });
    expect(await a.next()).toMatchObject({ type: "error", subId: "q", code: "invalid_args" });
    for (let i = 0; i < MAX_SUBSCRIPTIONS; i++) {
      a.send({ type: "subscribe", subId: `s${i}`, query: "incidents.active", args: {} });
    }
    a.send({ type: "subscribe", subId: "one-too-many", query: "incidents.active", args: {} });
    const frames = [];
    for (let i = 0; i <= MAX_SUBSCRIPTIONS; i++) frames.push(await a.next());
    expect(frames.at(-1)).toMatchObject({ type: "error", subId: "one-too-many", code: "limit" });
    a.send({ type: "mutate", mutationId: "bad", name: "incident.nope", args: {} });
    expect(await a.next()).toMatchObject({ ok: false, error: { code: "unknown_mutation" } });
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
    [
      "another protocol",
      { type: "hello", protocol: 99, clientId: "c", lastVersions: {} },
      "Unsupported protocol",
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
