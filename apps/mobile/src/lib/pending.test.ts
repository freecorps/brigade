import { newId, type Actor } from "@freecorps/brigade-schema";
import {
  createSyncClient,
  MUTATION_RETENTION_MS,
  type RestoredMutation,
  type SavedMutation,
} from "@freecorps/brigade-sync";
import { expect, test } from "vite-plus/test";
import {
  dropQueues,
  openQueue,
  parseQueueFile,
  queueFileName,
  restoredChanges,
  restoredTarget,
  restoreQueue,
  savedText,
  serialFiles,
  type PendingFiles,
} from "./pending";

const ANA = "usr_ana";
const BIA = "usr_bia";
const WORKSPACE = "org_test";
const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);

/** A directory in memory; `delay` holds every write until `release`. */
function memoryFiles() {
  const files = new Map<string, string>();
  const held: (() => void)[] = [];
  let hold = false;
  const api: PendingFiles = {
    read: async (name) => files.get(name) ?? null,
    write: async (name, raw) => {
      if (hold) await new Promise<void>((resolve) => held.push(resolve));
      files.set(name, raw);
    },
    remove: async (name) => {
      files.delete(name);
      files.delete(`${name}.next`);
    },
    list: async () => [...files.keys()],
  };
  return {
    files,
    api,
    holdWrites: () => {
      hold = true;
    },
    release: () => {
      hold = false;
      for (const resolve of held.splice(0)) resolve();
    },
  };
}

const mutation = (name: string, n: number): SavedMutation => ({
  mutationId: `mut_${n}`,
  name,
  args: { id: "inc_1", body: `Update ${n}` },
  createdAt: T0 + n,
});

const clock = () => T0;

let ids = 0;
const newClientId = () => `cli_${++ids}`;

test("a member's queue keeps its client id and mutations per shard, and comes back as it was", async () => {
  const { api, files } = memoryFiles();
  const first = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  expect(first.saved).toEqual({});
  await first.storage.save(WORKSPACE, [mutation("incident.postUpdate", 1)]);
  expect([...files.keys()]).toEqual([queueFileName(ANA, WORKSPACE)]);

  const again = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  expect(again.clientId).toBe(first.clientId);
  expect(again.saved).toEqual({ [WORKSPACE]: [mutation("incident.postUpdate", 1)] });

  // Confirmed or refused: nothing left, no file. (Saves count once the client has the saved changes back.)
  again.restoring(WORKSPACE);
  await again.storage.save(WORKSPACE, []);
  expect(files.size).toBe(0);
  const fresh = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  expect(fresh.clientId).not.toBe(first.clientId);
});

test("device registrations are not kept: the paging cycle registers again on its own", async () => {
  const { api, files } = memoryFiles();
  const queue = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  await queue.storage.save(WORKSPACE, [mutation("device.register", 1)]);
  expect(files.size).toBe(0);
  await queue.storage.save(WORKSPACE, [
    mutation("device.register", 1),
    mutation("incident.postUpdate", 2),
  ]);
  const again = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  expect(again.saved[WORKSPACE]).toEqual([mutation("incident.postUpdate", 2)]);
});

test("another member's queue is never restored: opening one deletes everyone else's", async () => {
  const { api, files } = memoryFiles();
  const ana = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  await ana.storage.save(WORKSPACE, [mutation("incident.postUpdate", 1)]);
  const anaElsewhere = await openQueue(
    api,
    { userId: ANA, workspaceId: "org_other" },
    newClientId,
    clock,
  );
  await anaElsewhere.storage.save("org_other", [mutation("incident.postUpdate", 2)]);
  expect(files.size).toBe(2);

  const bia = await openQueue(api, { userId: BIA, workspaceId: WORKSPACE }, newClientId, clock);
  expect(bia.saved).toEqual({});
  expect(bia.clientId).not.toBe(ana.clientId);
  expect(files.size).toBe(0);

  // The same member keeps their other workspace's queue.
  const again = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  again.restoring(WORKSPACE);
  await again.storage.save(WORKSPACE, [mutation("incident.postUpdate", 3)]);
  await openQueue(api, { userId: ANA, workspaceId: "org_other" }, newClientId, clock);
  expect(files.has(queueFileName(ANA, WORKSPACE))).toBe(true);
});

test("a file is only its owner's, whatever its name says", () => {
  const raw = JSON.stringify({
    version: 1,
    userId: ANA,
    workspaceId: WORKSPACE,
    clientId: "cli_1",
    shards: { [WORKSPACE]: [mutation("incident.postUpdate", 1)], broken: "no" },
  });
  expect(parseQueueFile(raw, ANA, WORKSPACE)).toEqual({
    clientId: "cli_1",
    shards: { [WORKSPACE]: [mutation("incident.postUpdate", 1)] },
  });
  expect(parseQueueFile(raw, BIA, WORKSPACE)).toBeNull();
  expect(parseQueueFile(raw, ANA, "org_other")).toBeNull();
  expect(parseQueueFile("{not json", ANA, WORKSPACE)).toBeNull();
  expect(parseQueueFile(raw.replace("cli_1", "a b"), ANA, WORKSPACE)).toBeNull();
  expect(parseQueueFile(null, ANA, WORKSPACE)).toBeNull();
  // Names are hex, so any id makes a plain file name.
  expect(queueFileName("usr/../ä", "org 1")).toMatch(/^[0-9a-f]+\.[0-9a-f]+\.json$/);
});

test("signing out drops the queue: a save still on its way lands first, and later saves are ignored", async () => {
  const memory = memoryFiles();
  const files = serialFiles(memory.api);
  const queue = await openQueue(files, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  memory.holdWrites();
  const saving = queue.storage.save(WORKSPACE, [mutation("incident.postUpdate", 1)]);
  const dropping = queue.drop();
  memory.release();
  await Promise.all([saving, dropping]);
  expect(memory.files.size).toBe(0);
  await queue.storage.save(WORKSPACE, [mutation("incident.postUpdate", 2)]);
  expect(memory.files.size).toBe(0);

  const other = await openQueue(
    files,
    { userId: ANA, workspaceId: "org_other" },
    newClientId,
    clock,
  );
  await other.storage.save("org_other", [mutation("incident.postUpdate", 3)]);
  await dropQueues(files);
  expect(memory.files.size).toBe(0);
});

test("a restored change's outcome is told once: the first screen gets it, later ones read it as done", async () => {
  const refused = { ok: false as const, error: { code: "expired" as const, message: "Too old" } };
  const change: RestoredMutation = {
    ...mutation("incident.postUpdate", 1),
    outcome: Promise.resolve(refused),
  };
  const restored = restoredChanges([change]);
  expect(await restored.claim(change)).toEqual(refused);
  expect(await restored.claim(change)).toMatchObject({ ok: true });
});

test("a restored change names its incident and what it changed, as the screens track it", () => {
  const id = "inc_1";
  expect(restoredTarget({ name: "incident.postUpdate", args: { id, body: "x" } })).toEqual({
    incidentId: id,
    key: "update",
    notice: { kind: "update" },
  });
  expect(restoredTarget({ name: "incident.setStatus", args: { id, status: "fixing" } })).toEqual({
    incidentId: id,
    key: "status",
    notice: { kind: "status", to: "fixing" },
  });
  expect(restoredTarget({ name: "incident.setSeverity", args: { id, severity: "sev1" } })).toEqual({
    incidentId: id,
    key: "severity",
    notice: { kind: "severity", to: "sev1" },
  });
  expect(
    restoredTarget({ name: "incident.assignRole", args: { id, role: "commander", userId: null } }),
  ).toEqual({ incidentId: id, key: "role/commander", notice: { kind: "role", role: "commander" } });
  expect(
    restoredTarget({ name: "incident.declare", args: { id, title: "Down", severity: "sev2" } }),
  ).toEqual({ incidentId: id, key: "declare", notice: { kind: "declare", title: "Down" } });
  expect(restoredTarget({ name: "incident.setStatus", args: { id, status: "gone" } })).toBeNull();
  expect(restoredTarget({ name: "device.register", args: { id } })).toBeNull();
  expect(restoredTarget({ name: "incident.postUpdate", args: null })).toBeNull();
});

test("with the sync client: an update queued offline is back after a restart, with the same ids", async () => {
  const { api } = memoryFiles();
  const files = serialFiles(api);
  const actor: Actor = { kind: "user", id: ANA, role: "responder" };
  const timers = { setTimeout: () => 0, clearTimeout: () => {} };
  let n = 0;
  const randomBytes = (length: number) => new Uint8Array(length).fill(++n);
  const offline = () => {
    throw new Error("offline");
  };
  const launch = async () => {
    const queue = await openQueue(
      files,
      { userId: ANA, workspaceId: WORKSPACE },
      newClientId,
      clock,
    );
    const client = createSyncClient({
      url: (shard) => `wss://sync.test/${shard}`,
      actor,
      transport: offline,
      timers,
      now: () => T0,
      random: () => 0.5,
      randomBytes,
      clientId: queue.clientId,
      pendingStorage: queue.storage,
      onWarning: () => {},
    });
    return { queue, client, restored: restoreQueue(client, WORKSPACE, queue).list };
  };

  const first = await launch();
  const incident = newId("inc", T0, randomBytes);
  void first.client.mutate(WORKSPACE, "incident.postUpdate", { id: incident, body: "Rolled back" });
  first.client.close();

  const second = await launch();
  expect(second.client.clientId).toBe(first.client.clientId);
  expect(second.restored).toMatchObject([
    { name: "incident.postUpdate", args: { id: incident, body: "Rolled back" }, createdAt: T0 },
  ]);
  second.client.close();
});

test("a burst of saves of one file costs a write or two, and the last one wins", async () => {
  const memory = memoryFiles();
  let writes = 0;
  const counted: PendingFiles = {
    ...memory.api,
    write: (name, raw) => {
      writes++;
      return memory.api.write(name, raw);
    },
  };
  const queue = await openQueue(
    serialFiles(counted),
    { userId: ANA, workspaceId: WORKSPACE },
    newClientId,
    clock,
  );
  const all = Array.from({ length: 500 }, (_, n) => mutation("incident.postUpdate", n));
  memory.holdWrites();
  // 500 changes confirmed one by one: each save holds what is left.
  const saves = all.map((_, n) => Promise.resolve(queue.storage.save(WORKSPACE, all.slice(n + 1))));
  memory.release();
  await Promise.all(saves);
  expect(writes).toBeLessThanOrEqual(2);
  expect(memory.files.size).toBe(0);

  // A delete between two writes keeps its place: the newer write is not folded into the older one.
  writes = 0;
  memory.holdWrites();
  const files = serialFiles(counted);
  const steps = [
    files.write("a", "1"),
    files.remove("a"),
    files.write("a", "2"),
    files.write("a", "3"),
  ];
  memory.release();
  await Promise.all(steps);
  expect(writes).toBe(2);
  expect(memory.files.get("a")).toBe("3");
});

test("a kill between deleting the queue file and moving the new one in leaves the new one, which is read", () => {
  expect(savedText("old", "new")).toBe("old");
  expect(savedText(null, "new")).toBe("new");
  expect(savedText(null, null)).toBeNull();
  // Read as usual: a copy cut short is nothing, not half a queue.
  expect(parseQueueFile(savedText(null, '{"version":1,"userId"'), ANA, WORKSPACE)).toBeNull();
});

test("the member's queues of other workspaces go once all in them is past the retention window", async () => {
  const { api, files } = memoryFiles();
  const old = await openQueue(api, { userId: ANA, workspaceId: "org_old" }, newClientId, clock);
  await old.storage.save("org_old", [mutation("incident.postUpdate", 1)]);
  const recent = await openQueue(
    api,
    { userId: ANA, workspaceId: "org_recent" },
    newClientId,
    clock,
  );
  await recent.storage.save("org_recent", [mutation("incident.postUpdate", 1)]);
  files.set(`${queueFileName(ANA, "org_broken")}`, "{not json");
  // A copy left next to a file counts as it.
  files.set(`${queueFileName(ANA, "org_left")}.next`, "{not json");

  const later = () => T0 + 2 + MUTATION_RETENTION_MS;
  await openQueue(api, { userId: ANA, workspaceId: "org_recent" }, newClientId, later);
  // The one opened is the client's to expire (`restore`), so it stays.
  expect([...files.keys()]).toEqual([queueFileName(ANA, "org_recent")]);

  await recent.storage.save("org_recent", [
    mutation("incident.postUpdate", 1 + MUTATION_RETENTION_MS),
  ]);
  await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, later);
  expect([...files.keys()]).toEqual([queueFileName(ANA, "org_recent")]);
});

test("signing out says it loses changes only while some are kept", async () => {
  const { api } = memoryFiles();
  const queue = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  expect(queue.unsent()).toBe(false);
  await queue.storage.save(WORKSPACE, [mutation("device.register", 1)]);
  expect(queue.unsent()).toBe(false);
  await queue.storage.save(WORKSPACE, [mutation("incident.postUpdate", 2)]);
  expect(queue.unsent()).toBe(true);
  const again = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  expect(again.unsent()).toBe(true);
  await again.drop();
  expect(again.unsent()).toBe(false);
});

test("a refused restored change nobody claimed is told to the screen that asked for what is left", async () => {
  const refused = { ok: false as const, error: { code: "forbidden" as const, message: "No" } };
  const change = (n: number): RestoredMutation => ({
    ...mutation("incident.setStatus", n),
    outcome: Promise.resolve(refused),
  });
  // The incident list asks first; the incident's screen, open too, claims it and tells it.
  const open = change(1);
  const both = restoredChanges([open]);
  const list = both.claimLeft(open, () => true);
  const screen = both.claim(open);
  expect(await screen).toEqual(refused);
  expect(await list).toMatchObject({ ok: true });

  // No screen of the incident: the list tells it, if it lists the incident.
  const alone = change(2);
  expect(await restoredChanges([alone]).claimLeft(alone, () => true)).toEqual(refused);
  const unlisted = change(3);
  const left = restoredChanges([unlisted]);
  expect(await left.claimLeft(unlisted, () => false)).toMatchObject({ ok: true });
  // Then its screen, opened later, still tells it.
  expect(await left.claim(unlisted)).toEqual(refused);
});

test("restored changes wait for the member's role: a save before then keeps them, and they apply as it", async () => {
  const { api, files } = memoryFiles();
  const name = queueFileName(ANA, WORKSPACE);
  const incident = newId("inc", T0, () => new Uint8Array(10).fill(3));
  const declare: SavedMutation = {
    mutationId: newId("mut", T0, () => new Uint8Array(10).fill(4)),
    name: "incident.declare",
    args: { id: incident, title: "Checkout down", severity: "sev2" },
    createdAt: T0,
  };
  const first = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  await first.storage.save(WORKSPACE, [declare]);

  // Launch: the role the client reads is still the viewer a missing one reads as.
  let role: Actor["role"] = "viewer";
  const queue = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  const client = createSyncClient({
    url: (shard) => `wss://sync.test/${shard}`,
    actor: () => ({ kind: "user", id: ANA, role }),
    transport: () => {
      throw new Error("offline");
    },
    timers: { setTimeout: () => 0, clearTimeout: () => {} },
    now: clock,
    random: () => 0.5,
    randomBytes: () => new Uint8Array(10).fill(5),
    clientId: queue.clientId,
    pendingStorage: queue.storage,
    onWarning: () => {},
  });
  const active = client.query(WORKSPACE, "incidents.active", {});
  active.subscribe(() => {});
  // The paging cycle registers the phone before the role is known: the queue on disk is not replaced.
  await queue.storage.save(WORKSPACE, [mutation("device.register", 9)]);
  expect(parseQueueFile(files.get(name) ?? null, ANA, WORKSPACE)?.shards[WORKSPACE]).toEqual([
    declare,
  ]);

  role = "responder";
  const restored = restoreQueue(client, WORKSPACE, queue);
  expect(restored.list).toMatchObject([{ mutationId: declare.mutationId }]);
  // Applied as a responder, so it shows; as a viewer it would have dropped out of the view.
  expect(active.getSnapshot().rows).toMatchObject([{ id: incident, title: "Checkout down" }]);
  await Promise.resolve();
  expect(parseQueueFile(files.get(name) ?? null, ANA, WORKSPACE)?.shards[WORKSPACE]).toMatchObject([
    { mutationId: declare.mutationId },
  ]);
  client.close();
});
