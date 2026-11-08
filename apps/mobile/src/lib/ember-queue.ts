// The member's kept queue (src/lib/pending.ts) as Ember's client keeps its unconfirmed mutations (`PendingStorage`),
// for a workspace on Ember (RFC 0016 step 5): the same file, its entries under the workspace's Ember shard, the same
// client id. Changes Brigade Sync kept before the workspace moved are taken over with their ids (src/lib/
// queue-entries.ts). As with Brigade Sync, the changes go back only once the member's role is known (`restore`): until
// then the client's `load` waits, so a change restored as the `viewer` a role still loading reads as never drops out of
// the view. Pure, so it is tested in Node.
import {
  MUTATION_RETENTION_MS,
  RESTORE_CLOCK_SLACK_MS,
  type MutationOutcome,
  type RestoredMutation,
} from "@freecorps/brigade-sync";
import {
  emberShard,
  type PendingMutationRecord,
  type PendingStorage,
} from "@freecorps/brigade-sync/ember";
import { keptChange, restoredChanges, type MemberQueue, type RestoredChanges } from "@/lib/pending";
import { changeName, emberFromSaved, emberRecord } from "@/lib/queue-entries";

export type EmberQueue = {
  /** For the workspace's Ember client; `load` waits for `restore`. */
  storage: PendingStorage;
  /** Gives the kept changes to the client, once; the screens track what it returns. Later calls return the same. */
  restore: () => RestoredChanges;
  /** The outcome Ember's client had for a restored change (`onRestoredOutcome`). */
  settle: (record: PendingMutationRecord, outcome: MutationOutcome) => void;
};

const expired: MutationOutcome = {
  ok: false,
  error: { code: "expired", message: "The change waited too long to be sent" },
};

export function emberQueue(
  queue: MemberQueue,
  workspaceId: string,
  now: () => number = Date.now,
): EmberQueue {
  const shard = emberShard(workspaceId);
  // Saves for either key are this client's from here: nothing Brigade Sync saves for the workspace may replace them.
  queue.restoring(shard);
  queue.restoring(workspaceId);
  const seen = new Set<string>();
  const kept: PendingMutationRecord[] = [];
  const take = (record: PendingMutationRecord | null) => {
    if (!record || seen.has(record.mid)) return;
    seen.add(record.mid);
    kept.push(record);
  };
  for (const entry of queue.saved[shard] ?? []) take(emberRecord(entry, shard));
  for (const entry of queue.saved[workspaceId] ?? []) take(emberFromSaved(entry, shard));
  kept.sort((a, b) => a.createdAt - b.createdAt);

  // What the screens get back: each change's outcome, settled by the client (or at once, for one too old to send).
  const outcomes = new Map<string, (outcome: MutationOutcome) => void>();
  const restoredList: RestoredMutation[] = kept.map((record) => ({
    mutationId: record.mid,
    name: changeName(record),
    args: record.args.args,
    createdAt: record.createdAt,
    outcome: new Promise<MutationOutcome>((resolve) => outcomes.set(record.mid, resolve)),
  }));

  let records: PendingMutationRecord[] = [];
  let restored: RestoredChanges | undefined;
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  const save = () => {
    // Until `restore`, the kept changes are on disk only: a change made before it is saved next to them.
    const all = restored
      ? records
      : [...kept, ...records.filter((record) => !seen.has(record.mid))];
    const list = all.filter((record) => keptChange(changeName(record)));
    void queue.keep(shard, list);
    void queue.keep(workspaceId, []);
  };

  return {
    storage: {
      getClientId: () => queue.clientId,
      // The queue's id is the one its changes were sent with; it never changes.
      setClientId: () => {},
      load: async () => {
        await opened;
        return [...records];
      },
      put: (record) => {
        if (records.some((other) => other.mid === record.mid)) return;
        records.push(record);
        save();
      },
      remove: (mid) => {
        const before = records.length;
        records = records.filter((record) => record.mid !== mid);
        if (records.length !== before) save();
      },
    },
    restore: () => {
      if (restored) return restored;
      const at = now();
      const live: PendingMutationRecord[] = [];
      for (const record of kept) {
        // Past the retention window (Brigade Sync fails these once it reconnects), or made well "later than now" (a
        // clock that was wrong then, or is now): not sent.
        const age = at - record.createdAt;
        if (age > MUTATION_RETENTION_MS || -age > RESTORE_CLOCK_SLACK_MS) {
          outcomes.get(record.mid)?.(expired);
          outcomes.delete(record.mid);
        } else live.push(record);
      }
      // Put first: restored changes are older than any made since (a device registration before the role was known).
      records = [...live, ...records.filter((record) => !seen.has(record.mid))];
      restored = restoredChanges(restoredList);
      save();
      open();
      return restored;
    },
    settle: (record, outcome) => {
      outcomes.get(record.mid)?.(outcome);
      outcomes.delete(record.mid);
    },
  };
}
