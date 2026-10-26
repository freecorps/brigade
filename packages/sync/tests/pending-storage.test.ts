// Pending mutations kept across a restart (`pendingStorage` and `restore`): a new client, as the app after a kill,
// takes up the queue the old one saved, against the reference server in fake-server.ts.
import { expect, test } from "vite-plus/test";
import {
  newId,
  type Actor,
  type IncidentRow,
  type mutations,
  type queries,
} from "@freecorps/brigade-schema";
import {
  createSyncClient,
  type PendingStorage,
  type QueryState,
  type SavedMutation,
  type SyncClientOptions,
} from "../src/client.ts";
import { MUTATION_RETENTION_MS } from "../src/protocol.ts";
import { FakeNetwork, FakeServer, FakeTimers } from "./fake-server.ts";

const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);
const SHARD = "ws_1";
const CLIENT_ID = "cli_phone";

const ana: Actor = { kind: "user", id: "usr_ana", role: "responder" };
const bia: Actor = { kind: "user", id: "usr_bia", role: "responder" };

/** What the app would keep on disk: one queue per member, workspace and shard. */
class FakeStorage {
  readonly queues = new Map<string, readonly SavedMutation[]>();
  saves = 0;
  for(userId: string, workspaceId: string): PendingStorage {
    return {
      save: (shard, mutations) => {
        this.saves++;
        const key = `${userId}/${workspaceId}/${shard}`;
        // A copy through JSON, as a file would hold it.
        if (mutations.length > 0) this.queues.set(key, JSON.parse(JSON.stringify(mutations)));
        else this.queues.delete(key);
      },
    };
  }
  load(userId: string, workspaceId: string, shard: string): readonly SavedMutation[] {
    return this.queues.get(`${userId}/${workspaceId}/${shard}`) ?? [];
  }
}

function setup() {
  const timers = new FakeTimers();
  const clock = () => T0 + timers.now;
  const server = new FakeServer(clock);
  const network = new FakeNetwork(server);
  const storage = new FakeStorage();
  let counter = 0;
  const randomBytes = (length: number) => {
    const bytes = new Uint8Array(length);
    let n = ++counter;
    for (let i = length - 1; i >= 0 && n > 0; i--, n = Math.floor(n / 256)) bytes[i] = n % 256;
    return bytes;
  };
  const warnings: string[] = [];
  const client = (
    actor: Actor,
    extra: Partial<SyncClientOptions<typeof queries, typeof mutations>> = {},
  ) =>
    createSyncClient({
      url: (shard) => `wss://sync.test/sync/${shard}`,
      actor,
      transport: network.transport(actor),
      timers,
      now: clock,
      random: () => 0.5,
      randomBytes,
      clientId: CLIENT_ID,
      pendingStorage: storage.for(actor.id, SHARD),
      onWarning: (message) => warnings.push(message),
      ...extra,
    });
  const settle = async () => {
    network.flush();
    await Promise.resolve();
  };
  const incidentId = () => newId("inc", clock(), randomBytes);
  return {
    timers,
    server,
    network,
    storage,
    client,
    settle,
    incidentId,
    warnings,
    shard: server.shard(SHARD),
  };
}

function watch<R>(handle: { subscribe(l: () => void): () => void; getSnapshot(): QueryState<R> }) {
  handle.subscribe(() => {});
  return { get: () => handle.getSnapshot() };
}

const mutatesOn = (socket: { sent: unknown[] }) =>
  socket.sent.filter((frame) => (frame as { type: string }).type === "mutate") as {
    mutationId: string;
    name: string;
  }[];

test("a change queued offline survives a restart: shown again, re-sent with its id once online, then cleared", async () => {
  const { client, settle, network, timers, storage, incidentId, shard } = setup();
  const before = client(ana);
  network.disconnect();
  await settle();
  const id = incidentId();
  void before.mutate(SHARD, "incident.declare", { id, title: "Queued offline", severity: "sev2" });
  const saved = storage.load(ana.id, SHARD, SHARD);
  expect(saved).toMatchObject([
    { name: "incident.declare", args: { id, title: "Queued offline" }, createdAt: T0 },
  ]);
  // The app is killed: closing the old client leaves the saved queue alone.
  before.close();
  expect(storage.load(ana.id, SHARD, SHARD)).toEqual(saved);

  timers.advance(60_000);
  const after = client(ana);
  const restored = after.restore(SHARD, storage.load(ana.id, SHARD, SHARD));
  expect(restored).toMatchObject([{ mutationId: saved[0].mutationId, name: "incident.declare" }]);
  const active = watch(after.query(SHARD, "incidents.active", {}));
  // Applied again, at its creation time, before the server has said anything.
  expect(active.get()).toMatchObject({
    pending: true,
    rows: [{ id, number: null, declaredAt: T0, title: "Queued offline" }],
  });
  await settle(); // Still offline: the socket fails and a retry waits.

  network.reconnect();
  timers.advance(60_000);
  await settle();
  // Sent once, on the socket that opened, with the id it was saved with.
  expect(network.sockets.flatMap(mutatesOn)).toMatchObject([{ mutationId: saved[0].mutationId }]);
  expect(await restored[0].outcome).toEqual({ ok: true, version: 1 });
  expect(shard.runs).toBe(1);
  expect(active.get()).toMatchObject({ pending: false, rows: [{ id, number: 1 }] });
  expect(storage.queues.size).toBe(0);
});

test("a change the server ran before the restart is answered from its stored result, not run twice", async () => {
  const { client, settle, network, timers, storage, incidentId, shard } = setup();
  const before = client(ana);
  watch(before.query(SHARD, "incidents.active", {}));
  await settle();
  const id = incidentId();
  void before.mutate(SHARD, "incident.declare", { id, title: "Ran once", severity: "sev3" });
  network.step(); // The server runs it…
  network.disconnect(); // …the connection drops before the result, and the app is killed.
  before.close();
  expect(shard.runs).toBe(1);

  network.reconnect();
  const after = client(ana);
  const [restored] = after.restore(SHARD, storage.load(ana.id, SHARD, SHARD));
  const active = watch(after.query(SHARD, "incidents.active", {}));
  timers.advance(1000);
  await settle();
  expect(await restored.outcome).toEqual({ ok: true, version: 1 });
  expect(shard.runs).toBe(1);
  expect(shard.store.scan("incidents")).toHaveLength(1);
  expect(active.get()).toMatchObject({ pending: false, rows: [{ id, number: 1 }] });
  expect(storage.queues.size).toBe(0);
});

test("a saved change past the retention window fails as expired and is never sent", async () => {
  const { client, settle, network, timers, storage, incidentId, shard } = setup();
  const before = client(ana);
  network.disconnect();
  await settle();
  void before.mutate(SHARD, "incident.declare", {
    id: incidentId(),
    title: "Too old",
    severity: "sev3",
  });
  before.close();

  timers.advance(MUTATION_RETENTION_MS + 1);
  network.reconnect();
  const after = client(ana);
  const [restored] = after.restore(SHARD, storage.load(ana.id, SHARD, SHARD));
  expect(await restored.outcome).toEqual({
    ok: false,
    error: { code: "expired", message: "The change waited too long to be sent" },
  });
  expect(storage.queues.size).toBe(0);
  const active = watch(after.query(SHARD, "incidents.active", {}));
  await settle();
  expect(active.get()).toMatchObject({ status: "ready", rows: [], pending: false });
  expect(network.sockets.flatMap(mutatesOn)).toEqual([]);
  expect(shard.runs).toBe(0);
});

test("a saved change dated after now (the clock moved back) fails as expired and is never sent", async () => {
  const { client, settle, storage, incidentId, shard, network } = setup();
  const after = client(ana);
  const id = incidentId();
  const [restored] = after.restore(SHARD, [
    {
      mutationId: newId("mut", T0 + 60_000, () => new Uint8Array(10).fill(7)),
      name: "incident.declare",
      args: { id, title: "From the future", severity: "sev3" },
      createdAt: T0 + 60_000,
    },
  ]);
  expect(await restored.outcome).toMatchObject({ ok: false, error: { code: "expired" } });
  expect(storage.queues.size).toBe(0);
  const active = watch(after.query(SHARD, "incidents.active", {}));
  await settle();
  expect(active.get()).toMatchObject({ status: "ready", rows: [], pending: false });
  expect(network.sockets.flatMap(mutatesOn)).toEqual([]);
  expect(shard.runs).toBe(0);
});

test("a saved change still waiting when its window ends expires on the timer", async () => {
  const { client, settle, network, timers, storage, incidentId } = setup();
  const before = client(ana);
  network.disconnect();
  await settle();
  void before.mutate(SHARD, "incident.declare", {
    id: incidentId(),
    title: "Late",
    severity: "sev3",
  });
  before.close();
  timers.advance(MUTATION_RETENTION_MS - 1000);
  const after = client(ana);
  const [restored] = after.restore(SHARD, storage.load(ana.id, SHARD, SHARD));
  expect(storage.queues.size).toBe(1);
  timers.advance(2000);
  await settle();
  expect(await restored.outcome).toMatchObject({ ok: false, error: { code: "expired" } });
  expect(storage.queues.size).toBe(0);
});

test("a saved change the server refuses resolves with its error and leaves storage", async () => {
  const { client, settle, network, timers, storage, shard } = setup();
  const before = client(ana);
  network.disconnect();
  await settle();
  // An incident nobody has: the shard answers not_found.
  void before.mutate(SHARD, "incident.postUpdate", {
    id: newId("inc", T0, () => new Uint8Array(10).fill(7)),
    body: "Rolled back the deploy",
  });
  before.close();
  network.reconnect();
  const after = client(ana);
  const [restored] = after.restore(SHARD, storage.load(ana.id, SHARD, SHARD));
  timers.advance(1000);
  await settle();
  expect(await restored.outcome).toMatchObject({ ok: false, error: { code: "not_found" } });
  expect(storage.queues.size).toBe(0);
  expect(shard.store.scan("timeline")).toEqual([]);
});

test("every change to the queue is saved, and only then: confirmations clear it", async () => {
  const { client, settle, network, timers, storage, incidentId } = setup();
  const a = client(ana);
  watch(a.query(SHARD, "incidents.active", {}));
  await settle();
  expect(storage.saves).toBe(0);
  network.disconnect();
  await settle();
  const ids = [incidentId(), incidentId()];
  for (const id of ids)
    void a.mutate(SHARD, "incident.declare", { id, title: id, severity: "sev3" });
  expect(storage.saves).toBe(2);
  expect(storage.load(ana.id, SHARD, SHARD).map((m) => (m.args as { id: string }).id)).toEqual(ids);
  network.reconnect();
  timers.advance(60_000);
  await settle();
  a.close();
  await settle();
  // Not re-saved by the snapshots and patches that followed.
  expect(storage.queues.size).toBe(0);
  expect(storage.saves).toBeLessThanOrEqual(4);
});

test("one member's saved queue is never another's: each restores only its own", async () => {
  const { client, settle, network, timers, storage, incidentId, shard } = setup();
  const anaBefore = client(ana);
  network.disconnect();
  await settle();
  const id = incidentId();
  void anaBefore.mutate(SHARD, "incident.declare", { id, title: "Ana's", severity: "sev2" });
  anaBefore.close();
  network.reconnect();

  // Bia signs in on the phone next: her queue is empty, and Ana's stays where it was.
  const biaClient = client(bia);
  expect(biaClient.restore(SHARD, storage.load(bia.id, SHARD, SHARD))).toEqual([]);
  const active = watch(biaClient.query(SHARD, "incidents.active", {}));
  timers.advance(1000);
  await settle();
  expect(active.get()).toMatchObject({ status: "ready", rows: [] });
  expect(shard.runs).toBe(0);
  expect(storage.load(ana.id, SHARD, SHARD)).toHaveLength(1);
  expect(storage.load(ana.id, "ws_2", SHARD)).toEqual([]);
});

test("restore skips what is not a mutation or already pending, and keeps the pending cap", async () => {
  const { client, settle, network, storage, incidentId, warnings } = setup();
  const before = client(ana);
  network.disconnect();
  await settle();
  void before.mutate(SHARD, "incident.declare", {
    id: incidentId(),
    title: "One",
    severity: "sev3",
  });
  void before.mutate(SHARD, "incident.declare", {
    id: incidentId(),
    title: "Two",
    severity: "sev3",
  });
  before.close();
  const saved = storage.load(ana.id, SHARD, SHARD);

  const after = client(ana, { maxPending: 1 });
  const restored = after.restore(SHARD, [
    null,
    { mutationId: "not a token", name: "incident.declare", args: {}, createdAt: T0 },
    { mutationId: "mut_x", name: "incident.declare", args: {}, createdAt: "yesterday" },
    ...saved,
    saved[0],
  ]);
  expect(warnings.filter((w) => w.startsWith("Skipped a saved mutation"))).toHaveLength(3);
  expect(restored).toHaveLength(2);
  expect(await restored[1].outcome).toMatchObject({
    ok: false,
    error: { code: "too_many_pending" },
  });
  const active = watch(after.query(SHARD, "incidents.active", {}));
  expect(active.get().rows.map((row) => (row as IncidentRow).title)).toEqual(["One"]);
  // What is kept now is what is pending now.
  expect(storage.load(ana.id, SHARD, SHARD)).toEqual([saved[0]]);
});

test("a storage that throws or rejects is logged; the change still goes out", async () => {
  const { client, settle, warnings, incidentId } = setup();
  const throwing = client(ana, {
    pendingStorage: {
      save: () => {
        throw new Error("disk full");
      },
    },
  });
  const rejecting = client(bia, {
    pendingStorage: { save: () => Promise.reject(new Error("no")) },
  });
  const one = throwing.mutate(SHARD, "incident.declare", {
    id: incidentId(),
    title: "One",
    severity: "sev3",
  });
  const two = rejecting.mutate(SHARD, "incident.declare", {
    id: incidentId(),
    title: "Two",
    severity: "sev3",
  });
  await settle();
  expect(await one).toMatchObject({ ok: true });
  expect(await two).toMatchObject({ ok: true });
  expect(warnings.filter((w) => w.startsWith("Could not save"))).not.toHaveLength(0);
});
