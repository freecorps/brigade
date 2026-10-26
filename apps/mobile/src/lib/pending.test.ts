import { newId, type Actor } from "@freecorps/brigade-schema";
import {
  createSyncClient,
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

let ids = 0;
const newClientId = () => `cli_${++ids}`;

test("a member's queue keeps its client id and mutations per shard, and comes back as it was", async () => {
  const { api, files } = memoryFiles();
  const first = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId);
  expect(first.saved).toEqual({});
  await first.storage.save(WORKSPACE, [mutation("incident.postUpdate", 1)]);
  expect([...files.keys()]).toEqual([queueFileName(ANA, WORKSPACE)]);

  const again = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId);
  expect(again.clientId).toBe(first.clientId);
  expect(again.saved).toEqual({ [WORKSPACE]: [mutation("incident.postUpdate", 1)] });

  // Confirmed or refused: nothing left, no file.
  await again.storage.save(WORKSPACE, []);
  expect(files.size).toBe(0);
  const fresh = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId);
  expect(fresh.clientId).not.toBe(first.clientId);
});

test("device registrations are not kept: the paging cycle registers again on its own", async () => {
  const { api, files } = memoryFiles();
  const queue = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId);
  await queue.storage.save(WORKSPACE, [mutation("device.register", 1)]);
  expect(files.size).toBe(0);
  await queue.storage.save(WORKSPACE, [
    mutation("device.register", 1),
    mutation("incident.postUpdate", 2),
  ]);
  const again = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId);
  expect(again.saved[WORKSPACE]).toEqual([mutation("incident.postUpdate", 2)]);
});

test("another member's queue is never restored: opening one deletes everyone else's", async () => {
  const { api, files } = memoryFiles();
  const ana = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId);
  await ana.storage.save(WORKSPACE, [mutation("incident.postUpdate", 1)]);
  const anaElsewhere = await openQueue(api, { userId: ANA, workspaceId: "org_other" }, newClientId);
  await anaElsewhere.storage.save("org_other", [mutation("incident.postUpdate", 2)]);
  expect(files.size).toBe(2);

  const bia = await openQueue(api, { userId: BIA, workspaceId: WORKSPACE }, newClientId);
  expect(bia.saved).toEqual({});
  expect(bia.clientId).not.toBe(ana.clientId);
  expect(files.size).toBe(0);

  // The same member keeps their other workspace's queue.
  const again = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId);
  await again.storage.save(WORKSPACE, [mutation("incident.postUpdate", 3)]);
  await openQueue(api, { userId: ANA, workspaceId: "org_other" }, newClientId);
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
  const queue = await openQueue(files, { userId: ANA, workspaceId: WORKSPACE }, newClientId);
  memory.holdWrites();
  const saving = queue.storage.save(WORKSPACE, [mutation("incident.postUpdate", 1)]);
  const dropping = queue.drop();
  memory.release();
  await Promise.all([saving, dropping]);
  expect(memory.files.size).toBe(0);
  await queue.storage.save(WORKSPACE, [mutation("incident.postUpdate", 2)]);
  expect(memory.files.size).toBe(0);

  const other = await openQueue(files, { userId: ANA, workspaceId: "org_other" }, newClientId);
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
    const queue = await openQueue(files, { userId: ANA, workspaceId: WORKSPACE }, newClientId);
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
    return { queue, client, restored: client.restore(WORKSPACE, queue.saved[WORKSPACE] ?? []) };
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
