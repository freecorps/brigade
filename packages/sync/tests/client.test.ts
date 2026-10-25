// The sync client against the reference server in fake-server.ts, over a fake network with deterministic timers.
import { expect, test } from "vite-plus/test";
import {
  defineQuery,
  newId,
  queries,
  runQuery,
  v,
  type Actor,
  type IncidentRow,
  type mutations,
} from "@freecorps/brigade-schema";
import {
  backoffDelay,
  createSyncClient,
  type QueryState,
  type SyncClientOptions,
} from "../src/client.ts";
import { MUTATION_RETENTION_MS } from "../src/protocol.ts";
import { FakeNetwork, FakeServer, FakeTimers, type FakeSocket } from "./fake-server.ts";

const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);
const SHARD = "ws_1";

const ana: Actor = { kind: "user", id: "usr_ana", role: "responder" };
const bia: Actor = { kind: "user", id: "usr_bia", role: "responder" };
const vic: Actor = { kind: "user", id: "usr_vic", role: "viewer" };

function setup() {
  const timers = new FakeTimers();
  const clock = () => T0 + timers.now;
  const server = new FakeServer(clock);
  const network = new FakeNetwork(server);
  let counter = 0;
  // Unique, deterministic bytes per call.
  const randomBytes = (length: number) => {
    const bytes = new Uint8Array(length);
    let n = ++counter;
    for (let i = length - 1; i >= 0 && n > 0; i--, n = Math.floor(n / 256)) bytes[i] = n % 256;
    return bytes;
  };
  const warnings: string[] = [];
  /** A client running optimistically as `actor`, authenticated on the server as `auth` (default: the same). */
  const client = (
    actor: Actor | (() => Actor),
    auth: Actor = typeof actor === "function" ? ana : actor,
    extra: Partial<SyncClientOptions<typeof queries, typeof mutations>> = {},
  ) =>
    createSyncClient({
      url: (shard) => `wss://sync.test/sync/${shard}`,
      actor,
      transport: network.transport(auth),
      timers,
      now: clock,
      random: () => 0.5,
      randomBytes,
      onWarning: (message) => warnings.push(message),
      ...extra,
    });
  const incidentId = () => newId("inc", clock(), randomBytes);
  /** Delivers everything, then lets resolved promises run. */
  const settle = async () => {
    network.flush();
    await Promise.resolve();
  };
  return {
    timers,
    server,
    network,
    client,
    randomBytes,
    incidentId,
    settle,
    warnings,
    shard: server.shard(SHARD),
  };
}

/** Subscribes and records every state the handle goes through. */
function watch<R>(handle: { subscribe(l: () => void): () => void; getSnapshot(): QueryState<R> }) {
  const states: QueryState<R>[] = [];
  const stop = handle.subscribe(() => states.push(handle.getSnapshot()));
  return { states, stop, get: () => handle.getSnapshot() };
}

const sentTypes = (socket: FakeSocket) =>
  socket.sent.map((frame) => (frame as { type: string }).type);

test("two clients stay in sync; an optimistic declare shows at once and gets its number from the server", async () => {
  const { client, incidentId, settle, network } = setup();
  const a = client(ana);
  const b = client(bia);
  const aActive = watch(a.query(SHARD, "incidents.active", {}));
  const bActive = watch(b.query(SHARD, "incidents.active", {}));
  expect(aActive.get().status).toBe("loading");
  await settle();
  expect(aActive.get()).toMatchObject({ status: "ready", rows: [], pending: false });
  expect(bActive.get()).toMatchObject({ status: "ready", rows: [] });
  expect(network.open()).toHaveLength(2);

  const id = incidentId();
  const declared = a.mutate(SHARD, "incident.declare", {
    id,
    title: "Checkout is down",
    severity: "sev2",
  });
  // Optimistic: there before any frame moves, without a number yet.
  expect(aActive.get()).toMatchObject({
    pending: true,
    rows: [{ id, number: null, status: "triage" }],
  });
  expect(bActive.get().rows).toEqual([]);

  await settle();
  expect(await declared).toEqual({ ok: true, version: 1 });
  expect(aActive.get()).toMatchObject({ pending: false, rows: [{ id, number: 1 }] });
  expect(bActive.get().rows).toEqual(aActive.get().rows);

  // And back: Bia's change reaches Ana.
  const raised = b.mutate(SHARD, "incident.setSeverity", { id, severity: "sev1" });
  expect(bActive.get()).toMatchObject({ pending: true, rows: [{ severity: "sev1" }] });
  await settle();
  expect(await raised).toMatchObject({ ok: true });
  expect(aActive.get().rows).toMatchObject([{ id, number: 1, severity: "sev1" }]);
  expect(bActive.get().rows).toEqual(aActive.get().rows);

  // A single-row query on another client sees the same row.
  const byId = watch(b.query(SHARD, "incident.byId", { id }));
  await settle();
  expect(byId.get()).toMatchObject({
    status: "ready",
    rows: [{ id, number: 1, severity: "sev1" }],
  });
});

test("a rejected mutation rolls back and resolves with the server's typed error", async () => {
  const { client, incidentId, settle, server, shard } = setup();
  // The app thinks Vic is a responder; the server knows Vic is a viewer.
  const v = client(ana, vic);
  const active = watch(v.query(SHARD, "incidents.active", {}));
  await settle();

  const declared = v.mutate(SHARD, "incident.declare", {
    id: incidentId(),
    title: "Not allowed",
    severity: "sev3",
  });
  expect(active.get().rows).toHaveLength(1);
  await settle();
  expect(await declared).toEqual({
    ok: false,
    error: { code: "forbidden", message: "Not allowed to run incident.declare" },
  });
  expect(active.get()).toMatchObject({ rows: [], pending: false });
  expect(shard.store.scan("incidents")).toEqual([]);
  expect(server.shards.size).toBe(1);

  // A transition the server's state no longer allows is rejected the same way.
  const id = incidentId();
  shard.write(bia, "incident.declare", { id, title: "DB lag", severity: "sev3" });
  await settle();
  const a = client(ana);
  const mine = watch(a.query(SHARD, "incident.byId", { id }));
  await settle();
  const fixing = a.mutate(SHARD, "incident.setStatus", { id, status: "fixing" });
  expect(mine.get().rows).toMatchObject([{ status: "fixing" }]);
  shard.write(bia, "incident.setStatus", { id, status: "declined" });
  await settle();
  const outcome = await fixing;
  expect(!outcome.ok && outcome.error.code).toBe("invalid_transition");
  expect(mine.get()).toMatchObject({ pending: false, rows: [{ status: "declined" }] });
});

test("the result arrives before the patch: the view never shows a stale re-apply nor flickers", async () => {
  const { client, incidentId, settle, network, shard } = setup();
  const id = incidentId();
  shard.write(bia, "incident.declare", { id, title: "Checkout is down", severity: "sev1" });
  const a = client(ana);
  const row = watch(a.query(SHARD, "incident.byId", { id }));
  await settle();

  const resolved = a.mutate(SHARD, "incident.setStatus", { id, status: "resolved" });
  const status = () => (row.get().rows[0] as IncidentRow).status;
  expect(status()).toBe("resolved");

  // The mutate reaches the server, which applies it and queues the result and then the patch…
  expect(network.step()).toBe(true);
  // …and Bia reopens the incident before Ana's client hears back.
  shard.write(bia, "incident.setStatus", { id, status: "investigating" });

  // The result alone: the mutation is confirmed but its effects have not arrived; it stays in the view.
  network.step();
  expect(await resolved).toEqual({ ok: true, version: 2 });
  expect(status()).toBe("resolved");

  // The patch with its effects drops it; Bia's patch follows. Re-applied after it, "resolved" would win.
  await settle();
  expect(status()).toBe("investigating");
  expect(row.get().pending).toBe(false);
  const seen = row.states.map((state) => (state.rows[0] as IncidentRow).status);
  expect(seen.slice(seen.indexOf("investigating"))).not.toContain("resolved");
});

test("offline mutations stay pending, then are re-sent with the same id and the subscription resumes", async () => {
  const { client, incidentId, settle, network, timers, shard } = setup();
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  const first = incidentId();
  await settle();
  const declared = a.mutate(SHARD, "incident.declare", {
    id: first,
    title: "First",
    severity: "sev3",
  });
  await settle();
  expect(await declared).toMatchObject({ ok: true });
  expect(shard.version).toBe(1);

  network.disconnect();
  await settle();
  expect(a.connectionState(SHARD)).toBe("waiting");
  expect(active.get().status).toBe("ready"); // Keeps showing what it had.

  // Offline: optimistic and pending.
  const second = incidentId();
  const offline = a.mutate(SHARD, "incident.declare", {
    id: second,
    title: "Second",
    severity: "sev2",
  });
  expect(active.get()).toMatchObject({ pending: true });
  expect(active.get().rows.map((r) => (r as IncidentRow).id)).toEqual([second, first]);

  // Retries back off while the network is down: 500 ms, then 1 s (equal jitter at 0.5 → 75% of the cap).
  timers.advance(375);
  await settle();
  expect(network.sockets).toHaveLength(2);
  expect(a.connectionState(SHARD)).toBe("waiting");
  timers.advance(749);
  await settle();
  expect(network.sockets).toHaveLength(2);
  timers.advance(1);
  await settle();
  expect(network.sockets).toHaveLength(3);

  // Someone else writes meanwhile.
  shard.write(bia, "incident.setSeverity", { id: first, severity: "sev1" });

  network.reconnect();
  timers.advance(backoffDelay(2, 0.5));
  await settle();
  const socket = network.sockets.at(-1)!;
  expect(sentTypes(socket)).toEqual(["hello", "mutate", "subscribe"]);
  const [hello, mutate, subscribe] = socket.sent;
  expect(hello).toEqual({ type: "hello", protocol: 1, clientId: a.clientId });
  expect(mutate).toMatchObject({ name: "incident.declare", args: { id: second } });
  expect(subscribe).toMatchObject({ query: "incidents.active", version: 1 });
  // The server resumed with a patch, not a snapshot.
  const connection = socket.connection!;
  // The result, the patch for its version (empty: nothing is subscribed yet), then the resume patch.
  expect(connection.out.map((m) => m.type)).toEqual(["mutationResult", "patch", "patch"]);
  expect(connection.out[1]).toMatchObject({ type: "patch", version: 3, subs: {} });

  expect(await offline).toEqual({ ok: true, version: 3 });
  expect(active.get().pending).toBe(false);
  expect(active.get().rows).toMatchObject([
    { id: second, number: 2 },
    { id: first, number: 1, severity: "sev1" },
  ]);
});

test("a mutation whose result was lost is re-sent with the same id and runs once", async () => {
  const { client, incidentId, settle, network, timers, shard } = setup();
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  await settle();

  const id = incidentId();
  const declared = a.mutate(SHARD, "incident.declare", {
    id,
    title: "Lost result",
    severity: "sev2",
  });
  const mutationId = (network.sockets[0].sent.at(-1) as { mutationId: string }).mutationId;
  network.step(); // The server runs it…
  network.disconnect(); // …and the connection drops before the result arrives.
  await settle();
  expect(shard.store.scan("incidents")).toHaveLength(1);
  expect(active.get()).toMatchObject({ pending: true, rows: [{ id, number: null }] });

  network.reconnect();
  timers.advance(10_000);
  await settle();
  const resent = network.sockets
    .at(-1)!
    .sent.find((f) => (f as { type: string }).type === "mutate");
  expect(resent).toMatchObject({ mutationId });
  expect(await declared).toEqual({ ok: true, version: 1 });
  expect(shard.store.scan("incidents")).toHaveLength(1);
  expect(shard.store.get("counters", "incident")?.value).toBe(1);
  expect(active.get()).toMatchObject({ pending: false, rows: [{ id, number: 1 }] });
});

test("the pool opens one socket per shard and closes it after the idle delay", async () => {
  const { client, settle, network, timers } = setup();
  const a = client(ana);
  const one = watch(a.query(SHARD, "incidents.active", {}));
  const same = watch(a.query(SHARD, "incidents.active", {}));
  const other = watch(a.query("ws_2", "incidents.active", {}));
  await settle();
  expect(network.open().map((s) => s.url)).toEqual([
    "wss://sync.test/sync/ws_1",
    "wss://sync.test/sync/ws_2",
  ]);
  // One subscription for the same query and args.
  expect(sentTypes(network.sockets[0])).toEqual(["hello", "subscribe"]);

  one.stop();
  same.stop();
  other.stop();
  // A listener that comes back within the linger delay keeps the subscription.
  timers.advance(999);
  const back = watch(a.query(SHARD, "incidents.active", {}));
  timers.advance(10_000);
  await settle();
  expect(sentTypes(network.sockets[0])).toEqual(["hello", "subscribe"]);
  expect(back.get().status).toBe("ready");
  // ws_2 lingered 1 s, then unsubscribed, then closed 5 s later.
  expect(sentTypes(network.sockets[1])).toEqual(["hello", "subscribe", "unsubscribe"]);
  expect(network.open().map((s) => s.url)).toEqual(["wss://sync.test/sync/ws_1"]);

  back.stop();
  timers.advance(1000);
  await settle();
  expect(sentTypes(network.sockets[0])).toEqual(["hello", "subscribe", "unsubscribe"]);
  timers.advance(4999);
  expect(network.open()).toHaveLength(1);
  timers.advance(1);
  expect(network.open()).toHaveLength(0);
  expect(a.connectionState(SHARD)).toBe("idle");
  expect(timers.pending).toBe(0);
});

test("a mutation alone opens the shard socket and holds it until its result", async () => {
  const { client, incidentId, settle, network, timers } = setup();
  const a = client(ana);
  const declared = a.mutate(SHARD, "incident.declare", {
    id: incidentId(),
    title: "No subscription",
    severity: "sev4",
  });
  await settle();
  expect(await declared).toMatchObject({ ok: true });
  expect(network.open()).toHaveLength(1);
  timers.advance(5000);
  expect(network.open()).toHaveLength(0);
});

test("malformed server frames are logged and ignored, never thrown", async () => {
  const { client, settle, network, warnings, shard } = setup();
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  await settle();
  const before = active.get();
  const socket = network.sockets[0];
  const garbage: unknown[] = [
    "not json",
    "[]",
    "null",
    new Uint8Array([1, 2, 3]),
    JSON.stringify({ type: "snapshot", subId: "s0", epoch: "e", version: -1, rows: [] }),
    JSON.stringify({
      type: "snapshot",
      subId: "s0",
      epoch: "e",
      version: 1,
      rows: [{ title: "no id" }],
    }),
    JSON.stringify({ type: "patch", subId: "s0", version: 1, upserts: [], deletes: [1] }),
    JSON.stringify({ type: "mutationResult", mutationId: "m", ok: "yes" }),
    JSON.stringify({
      type: "mutationResult",
      mutationId: "m",
      ok: false,
      error: { code: "boom", message: "" },
    }),
    JSON.stringify({ type: "snapshot", subId: "s0", version: 1, rows: [], extra: true }),
    JSON.stringify({ type: "surprise" }),
  ];
  for (const frame of garbage) socket.deliver(frame);
  // Well-formed but about things the client does not know: ignored quietly.
  socket.deliver(
    JSON.stringify({
      type: "patch",
      epoch: shard.epoch,
      version: 0,
      subs: { nope: { upserts: [], deletes: [] } },
    }),
  );
  socket.deliver(
    JSON.stringify({ type: "mutationResult", mutationId: "nope", ok: true, version: 9 }),
  );
  await expect(settle()).resolves.toBeUndefined();
  expect(warnings).toHaveLength(garbage.length);
  expect(warnings.every((w) => w.startsWith("Ignored a malformed frame"))).toBe(true);
  expect(active.get()).toBe(before);
});

test("a subscription the server refuses reports an error; a local one never reaches the server", async () => {
  const { client, settle, network } = setup();
  const a = client(ana);
  const unknown = watch(a.query(SHARD, "nope" as "incidents.active", {}));
  const invalid = watch(a.query(SHARD, "incident.byId", { id: "inc_bad" }));
  expect(unknown.get()).toMatchObject({ status: "error", error: { code: "unknown_query" } });
  expect(invalid.get()).toMatchObject({ status: "error", error: { code: "invalid_args" } });
  await settle();
  expect(network.sockets).toHaveLength(0);

  // The server refuses a query the client would run (it decides the role).
  const v = client(vic, { ...vic, role: "nobody" as Actor["role"] });
  const refused = watch(v.query(SHARD, "incidents.active", {}));
  await settle();
  expect(refused.get()).toMatchObject({ status: "error", error: { code: "forbidden" } });
});

test("backoff grows exponentially up to its cap, with equal jitter", () => {
  expect([0, 1, 2, 3].map((n) => backoffDelay(n, 0))).toEqual([250, 500, 1000, 2000]);
  expect([0, 1, 2, 3].map((n) => backoffDelay(n, 0.999_999))).toEqual([500, 1000, 2000, 4000]);
  expect(backoffDelay(30, 0)).toBe(15_000);
  expect(backoffDelay(1e6, 1)).toBe(30_000);
  expect(backoffDelay(2, 0, { initialMs: 100, maxMs: 300, factor: 3 })).toBe(150);
});

test("a protocol error makes the client close the socket and back off, without a fast loop", async () => {
  const { client, settle, network, timers, warnings, shard } = setup();
  const a = client(ana);
  watch(a.query(SHARD, "incidents.active", {}));
  await settle();
  shard.refusing = true;
  network.sockets[0].kill();
  await settle();
  // The first connection worked (a snapshot), so the count started over: 375 ms, then 750 ms, then 1.5 s.
  for (const [i, delay] of [375, 750, 1500].entries()) {
    timers.advance(delay - 1);
    expect(network.sockets).toHaveLength(i + 1);
    timers.advance(1);
    expect(network.sockets).toHaveLength(i + 2);
    await settle(); // hello → protocol error → the client closes the socket
    expect(network.sockets.at(-1)!.closed).toBe(true);
  }
  expect(warnings.filter((w) => w.includes("Unsupported protocol"))).toHaveLength(3);
  shard.refusing = false;
  timers.advance(3000);
  await settle();
  expect(a.connectionState(SHARD)).toBe("open");
});

test("one patch frame per version carries every touched subscription; neither flickers", async () => {
  const { client, incidentId, settle, network, shard } = setup();
  const id = incidentId();
  shard.write(bia, "incident.declare", { id, title: "Two views", severity: "sev3" });
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  const byId = watch(a.query(SHARD, "incident.byId", { id }));
  await settle();
  const severity = (state: QueryState<unknown>) =>
    (state.rows[0] as IncidentRow | undefined)?.severity;

  const raised = a.mutate(SHARD, "incident.setSeverity", { id, severity: "sev1" });
  expect([severity(active.get()), severity(byId.get())]).toEqual(["sev1", "sev1"]);
  network.step(); // The server runs it: the result, then one patch for both subscriptions.
  const connection = network.sockets[0].connection!;
  const patch = connection.out.at(-1)!;
  expect(patch.type === "patch" && Object.keys(patch.subs).sort()).toEqual(["s0", "s1"]);
  expect(connection.out.filter((m) => m.type === "patch")).toHaveLength(1);

  network.step(); // The result alone: confirmed, its effects not here yet; both views keep it.
  expect(await raised).toEqual({ ok: true, version: 2 });
  expect([severity(active.get()), severity(byId.get())]).toEqual(["sev1", "sev1"]);
  await settle();
  for (const view of [active, byId]) {
    expect(view.get()).toMatchObject({ pending: false, rows: [{ severity: "sev1", number: 1 }] });
    // Never back to sev3 once sev1 showed.
    const seen = view.states.map(severity);
    expect(seen.slice(seen.indexOf("sev1"))).not.toContain("sev3");
  }
});

test("a mutation too large or not JSON is refused before it is queued", async () => {
  const { client, incidentId, settle, network } = setup();
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  await settle();
  const before = active.get();
  const huge = a.mutate(SHARD, "incident.declare", {
    id: incidentId(),
    title: "a".repeat(70_000),
    severity: "sev1",
  });
  expect(await huge).toEqual({
    ok: false,
    error: { code: "invalid_args", message: "The change is too large to send" },
  });
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  const notJson = a.mutate(SHARD, "incident.declare", cyclic as never);
  expect(await notJson).toMatchObject({ ok: false, error: { code: "invalid_args" } });
  expect(sentTypes(network.sockets[0])).toEqual(["hello", "subscribe"]);
  expect(active.get()).toBe(before);
});

test("an error frame naming a mutation fails it, and it is not re-sent", async () => {
  const { client, incidentId, settle, network, timers } = setup();
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  await settle();
  network.disconnect();
  await settle();
  const first = a.mutate(SHARD, "incident.declare", {
    id: incidentId(),
    title: "One",
    severity: "sev2",
  });
  const second = a.mutate(SHARD, "incident.declare", {
    id: incidentId(),
    title: "Two",
    severity: "sev2",
  });
  expect(active.get().rows).toHaveLength(2);
  network.reconnect();
  timers.advance(10_000);
  network.step(); // open: hello, both mutates and the subscribe go out…
  const socket = network.sockets.at(-1)!;
  const [m1, m2] = socket.sent.filter((f) => (f as { type: string }).type === "mutate") as {
    mutationId: string;
  }[];
  // …and the server reports it could not take them (delivered ahead of anything else it sends).
  socket.connection!.alive = false;
  socket.fire("onmessage", {
    data: JSON.stringify({
      type: "error",
      code: "protocol",
      message: "Frame too large",
      mutationId: m1.mutationId,
    }),
  });
  socket.fire("onmessage", {
    data: JSON.stringify({
      type: "error",
      code: "invalid_args",
      message: "Bad",
      mutationId: m2.mutationId,
    }),
  });
  expect(await first).toEqual({
    ok: false,
    error: { code: "internal", message: "Frame too large" },
  });
  expect(await second).toEqual({ ok: false, error: { code: "invalid_args", message: "Bad" } });
  expect(active.get().rows).toEqual([]);
  expect(socket.closed).toBe(false); // About a mutation, not the socket.
  // Reconnecting does not re-send them.
  socket.kill();
  await settle();
  timers.advance(10_000);
  await settle();
  expect(sentTypes(network.sockets.at(-1)!)).toEqual(["hello", "subscribe"]);
});

test("a mutation pending past the retention window fails as expired instead of being re-sent", async () => {
  const { client, incidentId, settle, network, timers, shard } = setup();
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  await settle();
  network.disconnect();
  await settle();
  const old = a.mutate(SHARD, "incident.declare", {
    id: incidentId(),
    title: "Old",
    severity: "sev3",
  });
  timers.advance(MUTATION_RETENTION_MS - 1000);
  await settle();
  const recent = a.mutate(SHARD, "incident.declare", {
    id: incidentId(),
    title: "Recent",
    severity: "sev3",
  });
  expect(active.get().rows).toHaveLength(2);
  timers.advance(2000);
  network.reconnect();
  await settle();
  timers.advance(60_000);
  await settle();
  expect(await old).toEqual({
    ok: false,
    error: { code: "expired", message: "The change waited too long to be sent" },
  });
  expect(await recent).toMatchObject({ ok: true });
  const mutates = network.sockets
    .at(-1)!
    .sent.filter((f) => (f as { type: string }).type === "mutate");
  expect(mutates).toMatchObject([{ args: { title: "Recent" } }]);
  expect(shard.runs).toBe(1);
  expect(active.get().rows).toMatchObject([{ title: "Recent", number: 1 }]);
});

test("pending mutations are capped with a typed error", async () => {
  const { client, incidentId, settle, network } = setup();
  const a = client(ana, ana, { maxPending: 2 });
  network.disconnect();
  const declare = (title: string) =>
    a.mutate(SHARD, "incident.declare", { id: incidentId(), title, severity: "sev4" });
  const [one, two, three] = [declare("1"), declare("2"), declare("3")];
  expect(await three).toMatchObject({ ok: false, error: { code: "too_many_pending" } });
  await settle();
  a.close();
  expect(await one).toMatchObject({ ok: false, error: { code: "closed" } });
  expect(await two).toMatchObject({ ok: false, error: { code: "closed" } });
});

test("configuration errors throw in the constructor; mutate never throws", async () => {
  const { client, incidentId, warnings } = setup();
  expect(() => client(ana, ana, { clientId: "not a token" })).toThrow(RangeError);
  expect(() => client(ana, ana, { clientId: "x".repeat(65) })).toThrow(RangeError);
  expect(client(ana, ana, { clientId: "cli_web:tab-1" }).clientId).toBe("cli_web:tab-1");

  const broken = client(() => {
    throw new Error("no session");
  });
  const outcome = broken.mutate(SHARD, "incident.declare", {
    id: incidentId(),
    title: "No actor",
    severity: "sev4",
  });
  expect(await outcome).toMatchObject({ ok: false, error: { code: "internal" } });
  expect(warnings).toContain("Could not run incident.declare");
  expect(broken.newId("inc")).toMatch(/^inc_[0-9A-Z]{26}$/);
});

test("close resolves pending mutations, gives subscriptions a final state and closes every socket", async () => {
  const { client, incidentId, settle, network } = setup();
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  const id = incidentId();
  const declared = a.mutate(SHARD, "incident.declare", { id, title: "Kept", severity: "sev4" });
  await settle();
  await declared;
  network.disconnect();
  await settle();
  const pending = a.mutate(SHARD, "incident.declare", {
    id: incidentId(),
    title: "Bye",
    severity: "sev4",
  });
  const notified = active.states.length;
  a.close();
  expect(await pending).toEqual({
    ok: false,
    error: { code: "closed", message: "The sync client is closed" },
  });
  expect(active.states.length).toBe(notified + 1);
  expect(active.get()).toMatchObject({
    status: "error",
    pending: false,
    error: { code: "closed" },
    rows: [{ id, title: "Kept" }],
  });
  expect(network.open()).toHaveLength(0);
  expect(
    await a.mutate(SHARD, "incident.declare", {
      id: incidentId(),
      title: "Late",
      severity: "sev4",
    }),
  ).toMatchObject({ ok: false, error: { code: "closed" } });
});

test("data older than what a subscription holds is logged and ignored", async () => {
  const { client, incidentId, settle, network, shard, warnings } = setup();
  const id = incidentId();
  shard.write(bia, "incident.declare", { id, title: "Fresh", severity: "sev2" });
  shard.write(bia, "incident.setSeverity", { id, severity: "sev1" });
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  await settle();
  const before = active.get();
  const stale = { ...(before.rows[0] as IncidentRow), severity: "sev2" };
  const socket = network.sockets[0];
  const epoch = shard.epoch;
  socket.deliver(
    JSON.stringify({ type: "snapshot", subId: "s0", epoch, version: 1, rows: [stale] }),
  );
  socket.deliver(
    JSON.stringify({
      type: "patch",
      epoch,
      version: 1,
      subs: { s0: { upserts: [stale], deletes: [] } },
    }),
  );
  await settle();
  expect(active.get()).toBe(before);
  expect(warnings.filter((w) => w.startsWith("Ignored stale data for s0"))).toHaveLength(2);
});

test("frames from a socket the client has left are ignored", async () => {
  const { client, incidentId, settle, network, timers, shard, warnings } = setup();
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  await settle();
  const old = network.sockets[0];
  network.disconnect();
  await settle();
  network.reconnect();
  timers.advance(10_000);
  await settle();
  expect(a.connectionState(SHARD)).toBe("open");
  shard.write(bia, "incident.declare", { id: incidentId(), title: "Real", severity: "sev2" });
  await settle();
  const before = active.get();
  expect(before.rows).toHaveLength(1);
  const ghost = { ...(before.rows[0] as IncidentRow), id: incidentId(), title: "Ghost" };
  old.fire("onmessage", {
    data: JSON.stringify({ type: "snapshot", subId: "s0", version: 99, rows: [ghost] }),
  });
  old.fire("onclose", {});
  expect(active.get()).toBe(before);
  expect(a.connectionState(SHARD)).toBe("open");
  expect(warnings).toEqual([]);
});

test("a resume older than the change log gets a snapshot, which drops rows that left meanwhile", async () => {
  const { client, incidentId, settle, network, timers, shard } = setup();
  const [first, second] = [incidentId(), incidentId()];
  shard.write(bia, "incident.declare", { id: first, title: "First", severity: "sev2" });
  shard.write(bia, "incident.declare", { id: second, title: "Second", severity: "sev2" });
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  await settle();
  expect(active.get().rows).toHaveLength(2);

  network.disconnect();
  await settle();
  shard.write(bia, "incident.setStatus", { id: first, status: "declined" });
  shard.log = [];
  shard.logStart = shard.version; // Compacted: the log no longer reaches back to version 2.
  network.reconnect();
  timers.advance(10_000);
  await settle();
  const socket = network.sockets.at(-1)!;
  expect(socket.sent.at(-1)).toMatchObject({ type: "subscribe", version: 2 });
  expect(socket.connection!.out.map((m) => m.type)).toEqual(["snapshot"]);
  expect(active.get().rows.map((r) => (r as IncidentRow).id)).toEqual([second]);
});

test("a rejected mutation takes a dependent pending one out of the view; the server rejects it too", async () => {
  const { client, settle, network, timers, randomBytes } = setup();
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  await settle();
  // Dated an hour ahead: fine locally, refused by the server's clock check.
  const id = newId("inc", T0 + timers.now + 60 * 60 * 1000, randomBytes);
  const declared = a.mutate(SHARD, "incident.declare", { id, title: "Ahead", severity: "sev3" });
  const raised = a.mutate(SHARD, "incident.setSeverity", { id, severity: "sev1" });
  expect(active.get()).toMatchObject({ pending: true, rows: [{ id, severity: "sev1" }] });

  network.step(); // The server rejects the declare…
  network.step(); // …and then the severity change (not_found).
  network.step(); // The declare's result: rolled back; the dependent change no longer applies either.
  expect(await declared).toMatchObject({ ok: false, error: { code: "invalid_args" } });
  expect(active.get()).toMatchObject({ pending: false, rows: [] });
  await settle();
  expect(await raised).toMatchObject({ ok: false, error: { code: "not_found" } });
  expect(active.get()).toMatchObject({ pending: false, rows: [] });
});

/** Ids of the incidents a state shows. */
const idsOf = (state: QueryState<unknown>) => state.rows.map((row) => (row as IncidentRow).id);

test("a patch lost after its result: the mutation stays until every subscription is in sync again", async () => {
  const { client, incidentId, settle, network, timers, shard } = setup();
  const other = incidentId();
  shard.write(bia, "incident.declare", { id: other, title: "Elsewhere", severity: "sev3" });
  const a = client(ana);
  // s0 does not see the new incident, s1 does; s0 is resumed first after the reconnect.
  const elsewhere = watch(a.query(SHARD, "incident.byId", { id: other }));
  const active = watch(a.query(SHARD, "incidents.active", {}));
  await settle();
  expect(elsewhere.get().rows).toHaveLength(1);

  const id = incidentId();
  const declared = a.mutate(SHARD, "incident.declare", { id, title: "New", severity: "sev2" });
  expect(idsOf(active.get())).toContain(id);
  network.step(); // The server runs it: the result, then a patch for s1.
  network.step(); // The result arrives…
  expect(await declared).toMatchObject({ ok: true, version: 2 });
  network.disconnect(); // …and the patch is lost with the connection.
  await settle();
  network.reconnect();
  timers.advance(10_000);
  // Frame by frame: s0's resume answer comes before s1's; the row must never go missing in between.
  while (network.step()) expect(idsOf(active.get())).toContain(id);
  const since = active.states.findIndex((state) => idsOf(state).includes(id));
  expect(active.states.slice(since).every((state) => idsOf(state).includes(id))).toBe(true);
  expect(active.get()).toMatchObject({ pending: false });
  expect(active.get().rows).toMatchObject([{ id, number: 2 }, { id: other }]);
});

test("a subscription waiting for its resume answer keeps its version when others get patches", async () => {
  const { client, incidentId, settle, network, timers, shard } = setup();
  const other = incidentId();
  shard.write(bia, "incident.declare", { id: other, title: "Elsewhere", severity: "sev3" });
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  watch(a.query(SHARD, "incident.byId", { id: other }));
  await settle();
  network.disconnect();
  await settle();
  network.reconnect();
  timers.advance(10_000);
  network.step(); // open: hello, subscribe s0 (active) and s1 (byId) go out
  network.step(); // hello
  network.step(); // subscribe s0 → its resume answer
  // A change touching only s0 is patched to this socket before the server reads s1's subscribe…
  shard.write(bia, "incident.declare", { id: incidentId(), title: "Meanwhile", severity: "sev2" });
  const socket = network.sockets.at(-1)!;
  socket.connection!.alive = false; // …and the server never gets to it.
  network.flush();
  expect(active.get().rows).toHaveLength(2);
  socket.kill();
  await settle();
  timers.advance(10_000);
  await settle();
  const resumes = network.sockets
    .at(-1)!
    .sent.filter((f) => (f as { type: string }).type === "subscribe");
  // s0 holds version 2; s1 never got data on the lost socket, so it still resumes from version 1.
  expect(resumes).toMatchObject([
    { subId: "s0", version: 2, epoch: shard.epoch },
    { subId: "s1", version: 1, epoch: shard.epoch },
  ]);
});

test("a shard restored from a backup at a lower version answers with a snapshot the client accepts", async () => {
  const { client, incidentId, settle, network, timers, shard, warnings } = setup();
  const kept = incidentId();
  shard.write(bia, "incident.declare", { id: kept, title: "Kept", severity: "sev3" });
  const restore = shard.checkpoint();
  const lost = incidentId();
  shard.write(bia, "incident.declare", { id: lost, title: "Lost", severity: "sev2" });
  shard.write(bia, "incident.setSeverity", { id: kept, severity: "sev1" });
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  await settle();
  expect(idsOf(active.get())).toEqual([lost, kept]);

  network.disconnect();
  await settle();
  restore(); // Version 3 → 1, a new epoch.
  network.reconnect();
  timers.advance(10_000);
  await settle();
  const socket = network.sockets.at(-1)!;
  expect(socket.sent.at(-1)).toMatchObject({ type: "subscribe", version: 3 });
  expect(socket.connection!.out.map((m) => m.type)).toEqual(["snapshot"]);
  expect(active.get().rows).toMatchObject([{ id: kept, severity: "sev3" }]);
  expect(warnings).toEqual([]); // Not stale: the subscription was not in sync on this socket yet.

  // Later versions apply on top as usual.
  shard.write(bia, "incident.setSeverity", { id: kept, severity: "sev2" });
  await settle();
  expect(active.get().rows).toMatchObject([{ id: kept, severity: "sev2" }]);
});

test("another epoch at the same version gets a snapshot, not an empty patch", async () => {
  const { client, incidentId, settle, network, timers, shard } = setup();
  const id = incidentId();
  shard.write(bia, "incident.declare", { id, title: "Before", severity: "sev3" });
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  await settle();
  const before = shard.epoch;

  network.disconnect();
  await settle();
  // The storage is re-created with different content at the same version number.
  shard.store.update("incidents", id, { title: "After" });
  shard.recreate();
  expect(shard.epoch).not.toBe(before);
  network.reconnect();
  timers.advance(10_000);
  await settle();
  const socket = network.sockets.at(-1)!;
  expect(socket.sent.at(-1)).toMatchObject({ version: 1, epoch: before });
  expect(socket.connection!.out).toMatchObject([
    { type: "snapshot", epoch: shard.epoch, version: 1 },
  ]);
  expect(active.get().rows).toMatchObject([{ id, title: "After" }]);
});

test("the retention window expires a mutation on a timer, with no reconnect", async () => {
  const { client, incidentId, settle, network, timers } = setup();
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  await settle();
  // The socket stays open but the server never answers.
  network.sockets[0].connection!.alive = false;
  const declared = a.mutate(SHARD, "incident.declare", {
    id: incidentId(),
    title: "Unanswered",
    severity: "sev3",
  });
  expect(active.get().rows).toHaveLength(1);
  timers.advance(MUTATION_RETENTION_MS);
  expect(active.get().rows).toHaveLength(1);
  timers.advance(1);
  expect(await declared).toMatchObject({ ok: false, error: { code: "expired" } });
  expect(active.get()).toMatchObject({ rows: [], pending: false });
  expect(a.connectionState(SHARD)).toBe("open");
  expect(network.sockets).toHaveLength(1);
});

test("a connection that ends with a protocol error does not reset the backoff, even after data", async () => {
  const { client, settle, network, timers } = setup();
  const a = client(ana);
  watch(a.query(SHARD, "incidents.active", {}));
  await settle();
  network.sockets[0].kill(); // A healthy connection drops: the count starts over.
  await settle();
  for (const [i, delay] of [375, 750, 1500].entries()) {
    timers.advance(delay - 1);
    expect(network.sockets).toHaveLength(i + 1);
    timers.advance(1);
    await settle(); // Connects and gets data (its resume answer)…
    const socket = network.sockets.at(-1)!;
    expect(socket.connection!.out.map((m) => m.type)).toEqual(["patch"]);
    // …then the shard refuses it.
    socket.deliver(JSON.stringify({ type: "error", code: "protocol", message: "Go away" }));
    await settle();
    expect(socket.closed).toBe(true);
  }
});

test("a subscription whose frame would be too large is refused locally", async () => {
  const { client, settle, network } = setup();
  const titled = defineQuery({
    name: "incidents.titled",
    args: v.object({ title: v.string({ max: 100_000 }) }),
    permission: "incident:read",
    table: "incidents",
    filter: (row, args) => row.title === args.title,
  });
  const a = client(ana, ana, { queries: { ...queries, [titled.name]: titled } as never });
  const big = watch(
    a.query(SHARD, "incidents.titled" as never, { title: "a".repeat(70_000) } as never),
  );
  const small = watch(a.query(SHARD, "incidents.titled" as never, { title: "a" } as never));
  expect(big.get()).toMatchObject({
    status: "error",
    error: { code: "invalid_args", message: "The query arguments are too large to send" },
  });
  await settle();
  // Only the small one went out (the fake server does not know the query, which is fine here).
  expect(small.get().error?.code).toBe("unknown_query");
  expect(sentTypes(network.sockets[0])).toEqual(["hello", "subscribe"]);
});

test("after close, handles report closed and unsubscribing schedules nothing", async () => {
  const { client, settle, timers } = setup();
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  await settle();
  a.close();
  active.stop();
  expect(timers.pending).toBe(0);
  const later = a.query(SHARD, "incident.byId", { id: "inc_01JB0000000000000000000000" });
  const stop = later.subscribe(() => {});
  expect(later.getSnapshot()).toMatchObject({ status: "error", error: { code: "closed" } });
  stop();
  expect(timers.pending).toBe(0);
});

test("after a restore, a mutation confirmed below the old data's version stays until its snapshot", async () => {
  const { client, incidentId, settle, network, timers, shard } = setup();
  const kept = incidentId();
  shard.write(bia, "incident.declare", { id: kept, title: "Kept", severity: "sev3" });
  const restore = shard.checkpoint();
  shard.write(bia, "incident.setSeverity", { id: kept, severity: "sev1" });
  shard.write(bia, "incident.declare", { id: incidentId(), title: "Lost", severity: "sev2" });
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  await settle(); // In sync at version 3.

  network.disconnect();
  await settle();
  const id = incidentId();
  const declared = a.mutate(SHARD, "incident.declare", { id, title: "Offline", severity: "sev2" });
  restore(); // Back to version 1.
  network.reconnect();
  timers.advance(10_000);
  // The re-sent declare runs at version 2 and its result comes before the snapshot. The subscription still
  // holds version 3 from the old socket, which must not count: the row would vanish until the snapshot.
  while (network.step()) expect(idsOf(active.get())).toContain(id);
  expect(await declared).toEqual({ ok: true, version: 2 });
  expect(active.get()).toMatchObject({ pending: false, rows: [{ id, number: 2 }, { id: kept }] });
});

for (const confirmPatches of [true, false]) {
  test(`a confirmed mutation that touched no subscription is dropped (${confirmPatches ? "empty patch" : "a later snapshot"})`, async () => {
    const { client, incidentId, settle, shard } = setup();
    shard.confirmPatches = confirmPatches;
    const other = incidentId();
    const id = incidentId();
    shard.write(bia, "incident.declare", { id: other, title: "Elsewhere", severity: "sev3" });
    shard.write(bia, "incident.declare", { id, title: "Checkout is down", severity: "sev1" });
    const a = client(ana);
    watch(a.query(SHARD, "incident.byId", { id: other })); // Ana watches another incident only.
    await settle();

    // Ana resolves the incident from elsewhere (a notification); nothing she watches shows it.
    const resolved = a.mutate(SHARD, "incident.setStatus", { id, status: "resolved" });
    await settle();
    expect(await resolved).toEqual({ ok: true, version: 3 });
    // Bia reopens it.
    shard.write(bia, "incident.setStatus", { id, status: "investigating" });
    await settle();

    // Ana opens it. Were her resolve still pending it would apply again on top: "resolved" over Bia's reopen.
    const row = watch(a.query(SHARD, "incident.byId", { id }));
    await settle();
    expect(row.get()).toMatchObject({
      status: "ready",
      pending: false,
      rows: [{ id, status: "investigating" }],
    });
  });
}

test("a refused subscription lets go of its rows and is not asked for again until re-listened", async () => {
  const { client, incidentId, settle, network, timers, shard } = setup();
  const id = incidentId();
  shard.write(bia, "incident.declare", { id, title: "Shared", severity: "sev2" });
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  const byIdHandle = a.query(SHARD, "incident.byId", { id });
  const byId = watch(byIdHandle);
  await settle();
  expect(idsOf(byId.get())).toEqual([id]);

  // The server refuses s1 (say the incident became restricted); s0 still holds the same row.
  network.sockets[0].deliver(
    JSON.stringify({ type: "error", subId: "s1", code: "forbidden", message: "Not allowed" }),
  );
  await settle();
  expect(byId.get()).toEqual({
    rows: [],
    status: "error",
    pending: false,
    error: { code: "forbidden", message: "Not allowed" },
  });
  expect(idsOf(active.get())).toEqual([id]);

  // A reconnect does not ask for it again.
  network.sockets[0].kill();
  await settle();
  timers.advance(10_000);
  await settle();
  const subscribes = network.sockets
    .at(-1)!
    .sent.filter((f) => (f as { type: string }).type === "subscribe");
  expect(subscribes).toMatchObject([{ subId: "s0" }]);

  // The row leaves s0; nothing holds it any more, so it leaves the store too.
  shard.write(bia, "incident.setStatus", { id, status: "declined" });
  await settle();
  expect(active.get().rows).toEqual([]);

  // A new listener asks again, from a snapshot; nothing stale shows while it loads.
  const again = watch(byIdHandle);
  expect(again.get()).toMatchObject({ status: "loading", rows: [] });
  expect(network.sockets.at(-1)!.sent.at(-1)).toEqual({
    type: "subscribe",
    subId: "s1",
    query: "incident.byId",
    args: { id },
  });
  await settle();
  expect(again.get()).toMatchObject({ status: "ready", rows: [{ id, status: "declined" }] });
});

test("a restore below a confirmed mutation's version drops it with the data it lost", async () => {
  const { client, incidentId, settle, network, timers, shard } = setup();
  const other = incidentId();
  shard.write(bia, "incident.declare", { id: other, title: "Elsewhere", severity: "sev3" });
  const restore = shard.checkpoint(); // Version 1.
  shard.write(bia, "incident.setSeverity", { id: other, severity: "sev2" });
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  await settle(); // In sync at version 2.

  const id = incidentId();
  const declared = a.mutate(SHARD, "incident.declare", { id, title: "Gone", severity: "sev1" });
  network.step(); // The server runs it at version 3…
  network.step(); // …its result arrives…
  expect(await declared).toEqual({ ok: true, version: 3 });
  network.disconnect(); // …its patch is lost…
  await settle();
  restore({ keepEpoch: true }); // …and the shard is restored to version 1, without it (epoch kept: safety net).
  network.reconnect();
  timers.advance(10_000);
  await settle();
  // The snapshot at version 1 (same epoch, below the 2 held) shows the restore: the confirmed declare at
  // version 3 is not re-applied over data that no longer has it.
  expect(network.sockets.at(-1)!.connection!.out).toMatchObject([{ type: "snapshot", version: 1 }]);
  expect(active.get()).toMatchObject({ pending: false, rows: [{ id: other, severity: "sev3" }] });
});

test("a send that throws drops the socket and the next connection replays everything", async () => {
  const { client, incidentId, settle, network, timers, warnings } = setup();
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  await settle();
  const first = network.sockets[0];
  first.send = () => {
    throw new Error("buffer full");
  };
  const id = incidentId();
  const declared = a.mutate(SHARD, "incident.declare", { id, title: "Retried", severity: "sev2" });
  expect(warnings).toContain(`Could not send to ${SHARD}`);
  expect(first.closed).toBe(true);
  expect(a.connectionState(SHARD)).toBe("waiting");
  timers.advance(10_000);
  await settle();
  expect(sentTypes(network.sockets.at(-1)!)).toEqual(["hello", "mutate", "subscribe"]);
  expect(await declared).toMatchObject({ ok: true });
  expect(active.get()).toMatchObject({ pending: false, rows: [{ id, number: 1 }] });
});

test("a new epoch keeps a mutation confirmed on the new socket until its own data arrives", async () => {
  const { client, incidentId, settle, network, timers, shard } = setup();
  const other = incidentId();
  shard.write(bia, "incident.declare", { id: other, title: "Elsewhere", severity: "sev3" });
  const a = client(ana);
  watch(a.query(SHARD, "incident.byId", { id: other })); // s0, answered first after the reconnect
  const active = watch(a.query(SHARD, "incidents.active", {})); // s1
  await settle();

  network.disconnect();
  await settle();
  const id = incidentId();
  const declared = a.mutate(SHARD, "incident.declare", { id, title: "Offline", severity: "sev2" });
  shard.recreate(); // A new epoch while Ana is away.
  network.reconnect();
  timers.advance(10_000);
  // The declare runs in the new epoch on the new socket; then s0's snapshot brings the new epoch. That must not
  // drop the declare: s1 has not got its data yet.
  while (network.step()) expect(idsOf(active.get())).toContain(id);
  expect(await declared).toEqual({ ok: true, version: 2 });
  expect(active.get()).toMatchObject({ pending: false, rows: [{ id, number: 2 }, { id: other }] });
});

test("a restore to exactly the version held drops a mutation confirmed above it", async () => {
  const { client, incidentId, settle, network, timers, shard } = setup();
  const other = incidentId();
  shard.write(bia, "incident.declare", { id: other, title: "Elsewhere", severity: "sev3" });
  shard.write(bia, "incident.setSeverity", { id: other, severity: "sev2" });
  const restore = shard.checkpoint(); // Version 2, which is also what Ana will hold.
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  await settle();

  const id = incidentId();
  const declared = a.mutate(SHARD, "incident.declare", { id, title: "Gone", severity: "sev1" });
  network.step(); // The server runs it at version 3…
  network.step(); // …its result arrives…
  expect(await declared).toEqual({ ok: true, version: 3 });
  network.disconnect(); // …its patch is lost…
  await settle();
  restore({ keepEpoch: true }); // …and the shard goes back to version 2 (epoch kept: safety net).
  network.reconnect();
  timers.advance(10_000);
  await settle();
  // The resume answer is a patch at version 2 (no snapshot: the version is not ahead of the shard's). It still
  // shows the shard is below the declare's version, so the declare is dropped instead of showing forever.
  expect(network.sockets.at(-1)!.connection!.out).toMatchObject([{ type: "patch", version: 2 }]);
  expect(active.get()).toMatchObject({ pending: false, rows: [{ id: other }] });
});

test("a restore that rewrites versions past the client's ends with the client matching the server", async () => {
  const { client, incidentId, settle, network, timers, shard } = setup();
  const kept = incidentId();
  shard.write(bia, "incident.declare", { id: kept, title: "Kept", severity: "sev3" });
  const restore = shard.checkpoint(); // Version 1.
  shard.write(bia, "incident.declare", { id: incidentId(), title: "Undone", severity: "sev2" });
  shard.write(bia, "incident.setSeverity", { id: kept, severity: "sev1" });
  const a = client(ana);
  const active = watch(a.query(SHARD, "incidents.active", {}));
  await settle(); // Ana holds version 3.

  network.disconnect();
  await settle();
  restore();
  // After the restore the shard writes other changes, past version 3: the same numbers, a different history.
  const fresh = incidentId();
  shard.write(bia, "incident.declare", { id: fresh, title: "Fresh", severity: "sev4" });
  shard.write(bia, "incident.setStatus", { id: kept, status: "investigating" });
  shard.write(bia, "incident.setSeverity", { id: fresh, severity: "sev2" });
  expect(shard.version).toBe(4);
  network.reconnect();
  timers.advance(10_000);
  await settle();
  // A resume from version 3 in the same epoch would get only version 4's change and keep "Undone".
  expect(network.sockets.at(-1)!.connection!.out).toMatchObject([{ type: "snapshot", version: 4 }]);
  const server = runQuery(queries, "incidents.active", {}, shard.store, "viewer");
  expect(server.ok && server.rows).toEqual(active.get().rows);
  expect(active.get().rows).toMatchObject([
    { id: fresh, severity: "sev2" },
    { id: kept, severity: "sev3", status: "investigating" },
  ]);
});

test("an empty patch carries the new epoch, so a later socket does not drop a mutation confirmed in it", async () => {
  const { client, incidentId, settle, network, timers, shard } = setup();
  const other = incidentId();
  shard.write(bia, "incident.declare", { id: other, title: "Elsewhere", severity: "sev3" });
  const a = client(ana);
  watch(a.query(SHARD, "incident.byId", { id: other })); // A: answered first
  const b = watch(a.query(SHARD, "incidents.active", {})); // B
  await settle();

  network.disconnect();
  await settle();
  const id = incidentId();
  const declared = a.mutate(SHARD, "incident.declare", { id, title: "Offline", severity: "sev2" });
  shard.recreate(); // A new epoch while Ana is away.
  network.reconnect();
  timers.advance(10_000);
  network.step(); // open: hello, the declare and both subscribes go out
  network.step(); // hello
  network.step(); // the declare runs in the new epoch: its result and an empty patch are queued
  const socket = network.sockets.at(-1)!;
  socket.connection!.alive = false; // The subscribes never reach the server…
  network.flush(); // …while the result and the empty patch (new epoch) reach Ana.
  expect(await declared).toEqual({ ok: true, version: 2 });
  socket.kill(); // The socket drops right after the empty patch.
  await settle();
  timers.advance(10_000);
  // On the next socket A's snapshot is in the epoch Ana already saw: the declare, confirmed on the previous
  // socket in this epoch, waits for B's data instead of being dropped as old-epoch.
  while (network.step()) expect(idsOf(b.get())).toContain(id);
  expect(b.get()).toMatchObject({ pending: false, rows: [{ id, number: 2 }, { id: other }] });
});

test("onConnectionChange reports each socket state once, without opening a socket itself", async () => {
  const { client, settle, network, timers } = setup();
  const a = client(ana);
  const seen: string[] = [];
  const stop = a.onConnectionChange(SHARD, () => seen.push(a.connectionState(SHARD)));
  await settle();
  expect(network.sockets).toHaveLength(0); // Listening alone connects nothing.

  const stopQuery = a.query(SHARD, "incidents.active", {}).subscribe(() => {});
  await settle();
  expect(seen).toEqual(["connecting", "open"]);

  network.disconnect();
  await settle();
  expect(seen.at(-1)).toBe("waiting");
  network.reconnect();
  timers.advance(500);
  await settle();
  expect(seen.slice(2)).toEqual(["waiting", "connecting", "open"]);

  // The idle close after the last subscription leaves.
  stopQuery();
  timers.advance(1000 + 5000);
  await settle();
  expect(seen.at(-1)).toBe("idle");

  stop();
  a.query(SHARD, "incidents.active", {}).subscribe(() => {});
  await settle();
  expect(seen.at(-1)).toBe("idle"); // Unsubscribed: no more calls.
  a.close();
});

test("closing the client tells connection listeners the shard is idle", async () => {
  const { client, settle } = setup();
  const a = client(ana);
  const seen: string[] = [];
  a.onConnectionChange(SHARD, () => seen.push(a.connectionState(SHARD)));
  a.query(SHARD, "incidents.active", {}).subscribe(() => {});
  await settle();
  a.close();
  expect(seen).toEqual(["connecting", "open", "idle"]);
});
