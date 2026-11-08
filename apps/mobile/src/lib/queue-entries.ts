// A change kept on the phone in either client's shape (src/lib/pending.ts): Brigade Sync's `SavedMutation`, under the
// workspace's id, or Ember's `PendingMutationRecord` of `workspace:mutate`, under the workspace's Ember shard. The
// adapter sends a Brigade change to Ember with its client id and its mutation id as the mid (apps/api
// src/sync-adapter.ts), so a change moved from one shape to the other keeps its id, and the shard that ran it answers
// it instead of running it again. Pure, so it is tested in Node.
import type { SavedMutation } from "@freecorps/brigade-sync";
import { WORKSPACE_MUTATE, type PendingMutationRecord } from "@freecorps/brigade-sync/ember";

type Entry = Record<string, unknown>;

const object = (value: unknown): value is Entry => typeof value === "object" && value !== null;
const time = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** A kept Ember change of `shard`, or null for anything else. */
export function emberRecord(entry: unknown, shard: string): PendingMutationRecord | null {
  if (!object(entry) || typeof entry.mid !== "string" || entry.mid === "") return null;
  if (entry.shard !== shard || entry.fn !== WORKSPACE_MUTATE || !time(entry.createdAt)) return null;
  if (!object(entry.args) || typeof entry.args.name !== "string") return null;
  return {
    mid: entry.mid,
    shard,
    fn: WORKSPACE_MUTATE,
    args: { name: entry.args.name, args: entry.args.args },
    createdAt: entry.createdAt,
  };
}

/** A kept Brigade Sync change as Ember's client keeps it for `shard`, with the same id. */
export function emberFromSaved(entry: unknown, shard: string): PendingMutationRecord | null {
  if (!object(entry) || typeof entry.mutationId !== "string" || entry.mutationId === "")
    return null;
  if (typeof entry.name !== "string" || !time(entry.createdAt)) return null;
  return {
    mid: entry.mutationId,
    shard,
    fn: WORKSPACE_MUTATE,
    args: { name: entry.name, args: entry.args },
    createdAt: entry.createdAt,
  };
}

/** A kept Ember change as Brigade Sync keeps it, with the same id; null for anything else. */
export function savedFromEmber(entry: unknown): SavedMutation | null {
  if (!object(entry) || typeof entry.shard !== "string") return null;
  const record = emberRecord(entry, entry.shard);
  if (!record) return null;
  return {
    mutationId: record.mid,
    name: record.args.name as string,
    args: record.args.args,
    createdAt: record.createdAt,
  };
}

/** The named mutation of a kept Ember change. */
export const changeName = (record: PendingMutationRecord): string => String(record.args.name);
