import {
  createSyncClient,
  MAX_PENDING_MUTATIONS,
  MUTATION_RETENTION_MS,
  type SavedMutation,
  type SyncSocket,
} from "@freecorps/brigade-sync";
import { WORKSPACE_MUTATE, type PendingMutationRecord } from "@freecorps/brigade-sync/ember";
import { expect, test } from "vite-plus/test";
import { emberQueue } from "./ember-queue";
import {
  openQueue,
  parseQueueFile,
  queueFileName,
  restoreQueue,
  type PendingFiles,
} from "./pending";

const ANA = "usr_ana";
const WORKSPACE = "org_test";
const SHARD = `workspace:${WORKSPACE}`;
const T0 = Date.UTC(2026, 10, 8, 12, 0, 0);
const clock = () => T0;
let ids = 0;
const newClientId = () => `cli_${++ids}`;

function memoryFiles() {
  const files = new Map<string, string>();
  const api: PendingFiles = {
    read: async (name) => files.get(name) ?? null,
    write: async (name, raw) => {
      files.set(name, raw);
    },
    remove: async (name) => {
      files.delete(name);
    },
    list: async () => [...files.keys()],
  };
  const saved = () =>
    parseQueueFile(files.get(queueFileName(ANA, WORKSPACE)) ?? null, ANA, WORKSPACE)?.shards ?? {};
  return { files, api, saved };
}

const brigade = (name: string, n: number, createdAt = T0 - n): SavedMutation => ({
  mutationId: `mut_${n}`,
  name,
  args: { id: "inc_1", body: `Update ${n}` },
  createdAt,
});

const ember = (name: string, mid: string, createdAt = T0): PendingMutationRecord => ({
  mid,
  shard: SHARD,
  fn: WORKSPACE_MUTATE,
  args: { name, args: { id: "inc_1" } },
  createdAt,
});

const settled = async (promise: Promise<unknown>) => {
  let done = false;
  void promise.then(() => (done = true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return done;
};

test("changes Brigade Sync kept are taken over with their ids, and given back only once restored", async () => {
  const { api, saved } = memoryFiles();
  const before = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  await before.storage.save(WORKSPACE, [
    brigade("incident.postUpdate", 2),
    brigade("incident.setStatus", 1),
  ]);

  const queue = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  const kept = emberQueue(queue, WORKSPACE, clock);
  expect(kept.storage.getClientId()).toBe(before.clientId);
  const load = kept.storage.load();
  expect(await settled(Promise.resolve(load))).toBe(false);

  const restored = kept.restore();
  expect(kept.restore()).toBe(restored);
  // Oldest first, with Brigade's ids as the mids: the shard that ran one answers it instead of running it again.
  expect((await load).map((record) => [record.mid, record.args.name])).toEqual([
    ["mut_2", "incident.postUpdate"],
    ["mut_1", "incident.setStatus"],
  ]);
  expect(restored.list.map((change) => [change.mutationId, change.name])).toEqual([
    ["mut_2", "incident.postUpdate"],
    ["mut_1", "incident.setStatus"],
  ]);
  // The file now holds them as Ember's client keeps them, and nothing under the Brigade key.
  expect(Object.keys(saved())).toEqual([SHARD]);

  const [first] = restored.list;
  kept.settle((await load)[0]!, { ok: false, error: { code: "forbidden", message: "No" } });
  expect(await restored.claim(first!)).toMatchObject({ ok: false, error: { code: "forbidden" } });
  await kept.storage.remove("mut_2");
  await kept.storage.remove("mut_1");
  expect(saved()).toEqual({});
});

test("a change made before the restore is saved next to the kept ones, and goes after them", async () => {
  const { api, saved } = memoryFiles();
  const before = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  await before.keep(SHARD, [ember("incident.postUpdate", "m-1", T0 - 5)]);

  const queue = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  const kept = emberQueue(queue, WORKSPACE, clock);
  await kept.storage.put(ember("incident.ack", "m-2"));
  // Killed here, the next launch still has both.
  expect((saved()[SHARD] as PendingMutationRecord[]).map((record) => record.mid)).toEqual([
    "m-1",
    "m-2",
  ]);
  const load = kept.storage.load();
  kept.restore();
  expect((await load).map((record) => record.mid)).toEqual(["m-1", "m-2"]);
});

test("too old a change is not sent: it fails as expired, as with Brigade Sync", async () => {
  const { api } = memoryFiles();
  const before = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  await before.keep(SHARD, [
    ember("incident.postUpdate", "old", T0 - MUTATION_RETENTION_MS - 1),
    ember("incident.postUpdate", "ahead", T0 + 60 * 60 * 1000),
    ember("incident.postUpdate", "fine", T0 - 1000),
  ]);
  const queue = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  const kept = emberQueue(queue, WORKSPACE, clock);
  const load = kept.storage.load();
  const restored = kept.restore();
  expect((await load).map((record) => record.mid)).toEqual(["fine"]);
  const outcomes = await Promise.all(
    restored.list
      .filter((change) => change.mutationId !== "fine")
      .map((change) => restored.claim(change)),
  );
  expect(outcomes).toMatchObject([
    { ok: false, error: { code: "expired" } },
    { ok: false, error: { code: "expired" } },
  ]);
});

test("device registrations are not kept, as with Brigade Sync", async () => {
  const { api, saved } = memoryFiles();
  const queue = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  const kept = emberQueue(queue, WORKSPACE, clock);
  kept.restore();
  await kept.storage.put(ember("device.register", "d-1"));
  expect(saved()).toEqual({});
  await kept.storage.put(ember("incident.ack", "a-1"));
  expect((saved()[SHARD] as PendingMutationRecord[]).map((record) => record.mid)).toEqual(["a-1"]);
});

test("a workspace turned back to Brigade Sync sends what Ember's client kept, with the same ids", async () => {
  const { api, saved } = memoryFiles();
  const before = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  await before.keep(SHARD, [ember("incident.postUpdate", "m-1", T0 - 5)]);

  const queue = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  const sent: unknown[] = [];
  const client = createSyncClient({
    url: () => "wss://brigade.test/api/sync",
    actor: { kind: "user", id: ANA, role: "responder" },
    clientId: queue.clientId,
    pendingStorage: queue.storage,
    now: clock,
    transport: () =>
      ({
        readyState: 0,
        send: (frame: string) => sent.push(JSON.parse(frame)),
        close: () => {},
      }) as unknown as SyncSocket,
  });
  const restored = restoreQueue(client, WORKSPACE, queue);
  expect(restored.list.map((change) => [change.mutationId, change.name])).toEqual([
    ["m-1", "incident.postUpdate"],
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(Object.keys(saved())).toEqual([WORKSPACE]);
  client.close();
});

test("past the limit of unconfirmed changes, the rest are refused as Brigade Sync's restore does", async () => {
  const { api } = memoryFiles();
  const before = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  await before.keep(
    SHARD,
    Array.from({ length: MAX_PENDING_MUTATIONS + 2 }, (_, n) =>
      ember("incident.postUpdate", `m-${n}`, T0 - 10_000 + n),
    ),
  );
  const queue = await openQueue(api, { userId: ANA, workspaceId: WORKSPACE }, newClientId, clock);
  const kept = emberQueue(queue, WORKSPACE, clock);
  const load = kept.storage.load();
  const restored = kept.restore();
  expect(await load).toHaveLength(MAX_PENDING_MUTATIONS);
  expect(await restored.claim(restored.list.at(-1)!)).toMatchObject({
    ok: false,
    error: { code: "too_many_pending" },
  });
});

test("a failed write is the client's to report", async () => {
  const { api } = memoryFiles();
  const queue = await openQueue(
    { ...api, write: async () => Promise.reject(new Error("disk full")) },
    { userId: ANA, workspaceId: WORKSPACE },
    newClientId,
    clock,
  );
  const kept = emberQueue(queue, WORKSPACE, clock);
  kept.restore();
  await expect(kept.storage.put(ember("incident.ack", "a-1"))).rejects.toThrow("disk full");
});
