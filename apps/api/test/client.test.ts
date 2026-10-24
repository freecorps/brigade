// The real `SyncClient` from packages/sync over real WebSockets into WorkspaceDO.
import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, test } from "vite-plus/test";
import { newId, type IncidentRow } from "@freecorps/brigade-schema";
import { createSyncClient, type SyncSocket } from "@freecorps/brigade-sync";

type Frame = { type: string; [key: string]: unknown };

let names = 0;
const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const incidentId = () => newId("inc", Date.now(), random);

/**
 * A client whose sockets go through the Worker's fetch handler (workerd has no outbound `new WebSocket` to
 * itself), with every frame it sends and receives recorded. `drop()` loses the connection the way a network
 * would and refuses new ones until `reconnect()`; `route` maps a shard name to the workspace that serves it, so a test can point a shard at fresh storage
 * (a new epoch) between connections.
 */
function client(route: Map<string, string> = new Map()) {
  const warnings: string[] = [];
  const sent: Frame[] = [];
  const received: Frame[] = [];
  /** Close codes the server sent, per connection number. */
  const closes: { connection: number; code: number }[] = [];
  /** Open connections: losing one closes it and tells the client, once. */
  const lose: (() => void)[] = [];
  let connections = 0;
  let online = true;
  const sync = createSyncClient({
    url: (shard) => `ws://api.test/sync/${shard}`,
    actor: { kind: "user", id: "usr_dev", role: "responder" },
    // Fast retries: the test waits for reconnects.
    backoff: { initialMs: 10, maxMs: 40 },
    onWarning: (message) => warnings.push(message),
    transport: (url) => {
      let ws: WebSocket | undefined;
      let number = 0;
      let ended = false;
      type Handler = ((event: never) => void) | null;
      const fire = (handler: Handler, event: unknown) =>
        (handler as ((event: unknown) => void) | null)?.(event);
      const socket: SyncSocket = {
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        send: (data) => {
          sent.push({ ...(JSON.parse(data) as Frame), connection: number });
          ws?.send(data);
        },
        close: (code, reason) => ws?.close(code, reason),
      };
      if (!online) {
        queueMicrotask(() => fire(socket.onclose, {}));
        return socket;
      }
      const shard = url.replace(/^.*\/sync\//, "");
      const target = `http://api.test/sync/${route.get(shard) ?? shard}`;
      void exports.default.fetch(target, { headers: { Upgrade: "websocket" } }).then((response) => {
        ws = response.webSocket ?? undefined;
        if (!ws) return fire(socket.onclose, {});
        const open = ws;
        open.accept();
        number = ++connections;
        const end = () => {
          if (ended) return;
          ended = true;
          fire(socket.onclose, {});
        };
        lose.push(() => {
          // A lost connection: frames in flight are gone and the client hears of it at once.
          end();
          try {
            open.close(1001, "dropped");
          } catch {
            // Already closed.
          }
        });
        open.addEventListener("message", (event) => {
          if (ended) return;
          received.push({ ...(JSON.parse(event.data as string) as Frame), connection: number });
          fire(socket.onmessage, { data: event.data });
        });
        open.addEventListener("close", (event) => {
          closes.push({ connection: number, code: event.code });
          end();
        });
        fire(socket.onopen, {});
      });
      return socket;
    },
  });
  return {
    sync,
    warnings,
    sent,
    received,
    closes,
    /** How many sockets have opened so far. */
    connections: () => connections,
    /** Closes every open socket from this side, as a lost connection would, and refuses new ones. */
    drop() {
      online = false;
      for (const lost of lose.splice(0)) lost();
    },
    /** Lets the client's retries connect again. */
    reconnect() {
      online = true;
    },
  };
}

/** Resolves once `handle`'s state satisfies `done`. */
function until<R>(
  handle: {
    subscribe(listener: () => void): () => void;
    getSnapshot(): { rows: readonly R[]; status: string; pending: boolean };
  },
  done: (state: { rows: readonly R[]; status: string; pending: boolean }) => boolean,
) {
  return new Promise<{ rows: readonly R[]; status: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(JSON.stringify(handle.getSnapshot()))), 5000);
    const check = () => {
      const state = handle.getSnapshot();
      if (!done(state)) return;
      clearTimeout(timer);
      queueMicrotask(() => unsubscribe());
      resolve(state);
    };
    const unsubscribe = handle.subscribe(check);
    check();
  });
}

/** Resolves once `condition` holds, polling. */
async function eventually(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const ids = (rows: readonly IncidentRow[]) => rows.map((row) => row.id).sort();

describe("SyncClient against WorkspaceDO", () => {
  test("a mutation's result and a later snapshot reach real clients", async () => {
    const shard = `client-${++names}`;
    const ana = client();
    const bia = client();
    const id = incidentId();
    expect(
      await ana.sync.mutate(shard, "incident.declare", {
        id,
        title: "Checkout down",
        severity: "sev1",
      }),
    ).toEqual({ ok: true, version: 1 });
    const state = await until<IncidentRow>(
      bia.sync.query(shard, "incidents.active", {}),
      (s) => s.status === "ready",
    );
    expect(state.rows).toEqual([
      expect.objectContaining({ id, number: 1, title: "Checkout down" }),
    ]);
    ana.sync.close();
    bia.sync.close();
    expect([...ana.warnings, ...bia.warnings]).toEqual([]);
  });

  test("two clients converge through patches: declare, set severity, resolve", async () => {
    const shard = `client-${++names}`;
    const ana = client();
    const bia = client();
    const anaView = ana.sync.query(shard, "incidents.active", {});
    const biaView = bia.sync.query(shard, "incidents.active", {});
    await until(anaView, (s) => s.status === "ready");
    await until(biaView, (s) => s.status === "ready");

    const id = incidentId();
    expect(
      await ana.sync.mutate(shard, "incident.declare", {
        id,
        title: "Checkout down",
        severity: "sev1",
      }),
    ).toEqual({ ok: true, version: 1 });
    const seen = await until<IncidentRow>(biaView, (s) => s.rows.some((row) => row.id === id));
    expect(seen.rows[0]).toMatchObject({ id, number: 1, severity: "sev1" });

    expect(await bia.sync.mutate(shard, "incident.setSeverity", { id, severity: "sev3" })).toEqual({
      ok: true,
      version: 2,
    });
    // Both views converge on the same confirmed rows, with nothing left pending on either side.
    const settled = (s: { rows: readonly IncidentRow[]; pending?: boolean }) =>
      s.rows[0]?.severity === "sev3" && s.pending === false;
    const anaRows = (await until<IncidentRow>(anaView, settled)).rows;
    const biaRows = (await until<IncidentRow>(biaView, settled)).rows;
    expect(anaRows).toEqual(biaRows);
    expect(anaRows[0]).toMatchObject({ id, severity: "sev3", status: "triage" });

    expect(await bia.sync.mutate(shard, "incident.setStatus", { id, status: "resolved" })).toEqual({
      ok: true,
      version: 3,
    });
    await until<IncidentRow>(anaView, (s) => s.rows.length === 0);
    ana.sync.close();
    bia.sync.close();
    expect([...ana.warnings, ...bia.warnings]).toEqual([]);
  });

  test("a reconnect resumes from (version, epoch) with a patch of what changed meanwhile", async () => {
    const shard = `client-${++names}`;
    const ana = client();
    const bia = client();
    const anaView = ana.sync.query(shard, "incidents.active", {});
    const first = incidentId();
    expect(
      await bia.sync.mutate(shard, "incident.declare", {
        id: first,
        title: "Checkout down",
        severity: "sev1",
      }),
    ).toMatchObject({ ok: true, version: 1 });
    await until<IncidentRow>(anaView, (s) => s.rows.length === 1);
    const snapshot = ana.received.find((frame) => frame.type === "snapshot")!;

    // Ana loses her connection; Bia declares another incident before Ana is back.
    ana.drop();
    const second = incidentId();
    expect(
      await bia.sync.mutate(shard, "incident.declare", {
        id: second,
        title: "Search slow",
        severity: "sev3",
      }),
    ).toMatchObject({ ok: true, version: 2 });
    ana.reconnect();
    const caught = await until<IncidentRow>(anaView, (s) => s.rows.length === 2);
    expect(ids(caught.rows)).toEqual([first, second].sort());

    // The second connection's subscribe carried the resume point, and the shard answered with a patch, not a
    // snapshot.
    expect(ana.connections()).toBe(2);
    const resume = ana.sent.find((frame) => frame.type === "subscribe" && frame.connection === 2);
    expect(resume).toMatchObject({ version: 1, epoch: snapshot.epoch });
    const answer = ana.received.filter((frame) => frame.connection === 2);
    expect(answer).toEqual([
      expect.objectContaining({
        type: "patch",
        epoch: snapshot.epoch,
        version: 2,
        subs: {
          [resume!.subId as string]: {
            upserts: [expect.objectContaining({ id: second })],
            deletes: [],
          },
        },
      }),
    ]);
    ana.sync.close();
    bia.sync.close();
    expect([...ana.warnings, ...bia.warnings]).toEqual([]);
  });

  test("a mutation whose commit fails is replayed on the next socket and confirmed with its patch", async () => {
    const shard = `client-${++names}`;
    const ana = client();
    const bia = client();
    const anaView = ana.sync.query(shard, "incidents.active", {});
    const biaView = bia.sync.query(shard, "incidents.active", {});
    await until(anaView, (s) => s.status === "ready");
    await until(biaView, (s) => s.status === "ready");
    // The outbox write fails, so the mutation's transaction cannot commit.
    const outbox = (sql: string) =>
      runInDurableObject(env.WORKSPACE.getByName(shard), (_instance, state) => {
        state.storage.sql.exec(sql);
      });
    await outbox(`create trigger no_outbox before insert on outbox
                  begin select raise(abort, 'outbox unavailable'); end`);

    const id = incidentId();
    const declared = ana.sync.mutate(shard, "incident.declare", {
      id,
      title: "Checkout down",
      severity: "sev1",
    });
    await eventually(() => ana.closes.length > 0, "the shard to close Ana's socket");
    // The failure is about the socket: `internal` with no ids, then 1011. Nothing was stored for the mutation.
    expect(ana.received.filter((frame) => frame.connection === 1).at(-1)).toEqual({
      type: "error",
      code: "internal",
      message: "Internal error",
      connection: 1,
    });
    expect(ana.closes[0]).toEqual({ connection: 1, code: 1011 });
    await outbox("drop trigger no_outbox");

    // The client replays the same mutation id under the same client id, and this time it runs once.
    expect(await declared).toEqual({ ok: true, version: 1 });
    const mutates = ana.sent.filter((frame) => frame.type === "mutate");
    expect(new Set(mutates.map((frame) => frame.mutationId)).size).toBe(1);
    expect(mutates.length).toBeGreaterThan(1);
    const hellos = ana.sent.filter((frame) => frame.type === "hello");
    expect(new Set(hellos.map((frame) => frame.clientId)).size).toBe(1);
    const last = ana.connections();
    const on = () => ana.received.filter((frame) => frame.connection === last);
    const result = on().findIndex((frame) => frame.type === "mutationResult");
    await eventually(() => on().length > result + 1, "the patch after the result");
    const after = on();
    expect(after[result]).toMatchObject({ ok: true, version: 1 });
    // The mutation runs before this socket's subscribe arrives: its always-sent patch comes right after the result.
    expect(after[result + 1]).toMatchObject({ type: "patch", version: 1, subs: {} });
    await until<IncidentRow>(biaView, (s) => s.rows.some((row) => row.id === id));
    await eventually(() => !anaView.getSnapshot().pending, "Ana's mutation to settle");
    expect(anaView.getSnapshot().rows).toEqual([expect.objectContaining({ id, number: 1 })]);
    ana.sync.close();
    bia.sync.close();
    expect(bia.warnings).toEqual([]);
  });

  test("a client holding another epoch's data gets a snapshot that replaces it", async () => {
    const shard = `client-${++names}`;
    const route = new Map([[shard, `${shard}-old`]]);
    const ana = client(route);
    const old = incidentId();
    expect(
      await ana.sync.mutate(shard, "incident.declare", {
        id: old,
        title: "Lost with the old storage",
        severity: "sev2",
      }),
    ).toMatchObject({ ok: true, version: 1 });
    const anaView = ana.sync.query(shard, "incidents.active", {});
    await until<IncidentRow>(anaView, (s) => s.rows.length === 1);
    const before = ana.received.find((frame) => frame.type === "snapshot")!;

    // The shard's storage is re-created: same name, fresh storage with a new epoch and its own version 1.
    const fresh = client(new Map([[shard, `${shard}-new`]]));
    const kept = incidentId();
    expect(
      await fresh.sync.mutate(shard, "incident.declare", {
        id: kept,
        title: "In the new storage",
        severity: "sev1",
      }),
    ).toMatchObject({ ok: true, version: 1 });
    route.set(shard, `${shard}-new`);
    ana.drop();
    ana.reconnect();

    const replaced = await until<IncidentRow>(anaView, (s) => s.rows[0]?.id === kept);
    expect(ids(replaced.rows)).toEqual([kept]);
    const last = ana.connections();
    const resume = ana.sent.find(
      (frame) => frame.type === "subscribe" && frame.connection === last,
    );
    // Same version, other epoch: only the epoch tells the client's data apart, and the shard sends a snapshot.
    expect(resume).toMatchObject({ version: 1, epoch: before.epoch });
    const answer = ana.received.find((frame) => frame.connection === last)!;
    expect(answer).toMatchObject({ type: "snapshot", version: 1 });
    expect(answer.epoch).not.toBe(before.epoch);
    await eventually(() => !anaView.getSnapshot().pending, "no pending mutations");
    ana.sync.close();
    fresh.sync.close();
    expect([...ana.warnings, ...fresh.warnings]).toEqual([]);
  });
});
