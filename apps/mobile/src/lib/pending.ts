// Changes queued on the phone that the shard has not confirmed, kept across a restart (RFC 0004 "Clients"): one
// file per member and workspace, holding the sync client's id and its unconfirmed mutations per shard, so the app
// opened again shows them as not sent yet and sends them with the same ids. Pure, so it is tested in Node;
// src/lib/pending-files.ts keeps the files with expo-file-system.
import type { MutationOutcome, PendingStorage, RestoredMutation } from "@freecorps/brigade-sync";
import type { NoticeTarget } from "@freecorps/brigade-i18n/incident";
import { INCIDENT_ROLES, INCIDENT_STATUSES, SEVERITIES } from "@freecorps/brigade-schema";

/** Files by name, in one directory of the app's own. */
export type PendingFiles = {
  read: (name: string) => Promise<string | null>;
  /** Replaces the file whole: a reader never sees half of it. */
  write: (name: string, raw: string) => Promise<void>;
  /** Nothing when it is not there. */
  remove: (name: string) => Promise<void>;
  list: () => Promise<string[]>;
};

/**
 * Runs every operation on `files` in turn, so a save made before a sign-out lands before the sign-out deletes the
 * file, and a launch reads the file only after the last save of the client before it.
 */
export function serialFiles(files: PendingFiles): PendingFiles {
  let queue: Promise<unknown> = Promise.resolve();
  const run = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  };
  return {
    read: (name) => run(() => files.read(name)),
    write: (name, raw) => run(() => files.write(name, raw)),
    remove: (name) => run(() => files.remove(name)),
    list: () => run(() => files.list()),
  };
}

/** Device registration retries on its own (src/lib/paging.ts); a register kept from an older launch would be stale. */
const kept = (name: string) => !name.startsWith("device.");

function hex(value: string): string {
  let out = "";
  for (const byte of new TextEncoder().encode(value)) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** `<member>.<workspace>.json`, both hex: any id makes a plain file name, and a member's files share a prefix. */
export function queueFileName(userId: string, workspaceId: string): string {
  return `${hex(userId)}.${hex(workspaceId)}.json`;
}

type QueueFile = {
  version: 1;
  userId: string;
  workspaceId: string;
  clientId: string;
  shards: Record<string, unknown[]>;
};

/** The file's client id and saved mutations, if it is this member's in this workspace; anything else is nothing. */
export function parseQueueFile(
  raw: string | null,
  userId: string,
  workspaceId: string,
): { clientId: string; shards: Record<string, unknown[]> } | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const file = value as Record<string, unknown>;
    if (file.version !== 1 || file.userId !== userId || file.workspaceId !== workspaceId) {
      return null;
    }
    if (typeof file.clientId !== "string" || !/^[A-Za-z0-9_:-]{1,64}$/.test(file.clientId)) {
      return null;
    }
    if (typeof file.shards !== "object" || file.shards === null) return null;
    const shards: Record<string, unknown[]> = {};
    for (const [shard, list] of Object.entries(file.shards)) {
      if (Array.isArray(list)) shards[shard] = list;
    }
    return { clientId: file.clientId, shards };
  } catch {
    return null;
  }
}

/** One member's queue in one workspace, for their sync client (src/lib/sync-client.ts). */
export type MemberQueue = {
  /** The client id the saved mutations were sent with: the shard de-duplicates by it. */
  clientId: string;
  /** What was saved per shard, for `SyncClient.restore`. */
  saved: Readonly<Record<string, readonly unknown[]>>;
  storage: PendingStorage;
  /** Deletes the file and ignores every later save: the member signed out. */
  drop: () => Promise<void>;
};

/**
 * Opens the member's queue: their saved client id and mutations, or a new id and nothing. Files of anyone else
 * signed in on the phone before are deleted first, so another member's queue is never restored nor kept around.
 */
export async function openQueue(
  files: PendingFiles,
  member: { userId: string; workspaceId: string },
  newClientId: () => string,
): Promise<MemberQueue> {
  const { userId, workspaceId } = member;
  const name = queueFileName(userId, workspaceId);
  const mine = `${hex(userId)}.`;
  for (const other of await files.list()) {
    if (!other.startsWith(mine)) await files.remove(other).catch(() => {});
  }
  const found = parseQueueFile(await files.read(name), userId, workspaceId);
  const clientId = found?.clientId ?? newClientId();
  const shards: Record<string, unknown[]> = { ...found?.shards };
  let dropped = false;
  return {
    clientId,
    saved: found?.shards ?? {},
    storage: {
      save: (shard, mutations) => {
        if (dropped) return;
        const list = mutations.filter((mutation) => kept(mutation.name));
        if (list.length > 0) shards[shard] = list;
        else delete shards[shard];
        if (Object.keys(shards).length === 0) return files.remove(name);
        const file: QueueFile = { version: 1, userId, workspaceId, clientId, shards };
        return files.write(name, JSON.stringify(file));
      },
    },
    drop: () => {
      dropped = true;
      return files.remove(name);
    },
  };
}

/** Deletes every member's queue: after a sign-out, nothing they queued is sent or shown again. */
export async function dropQueues(files: PendingFiles): Promise<void> {
  for (const name of await files.list()) await files.remove(name).catch(() => {});
}

/**
 * The changes restored at launch, for the screens that made them: each shows as not sent yet while it waits and,
 * if the shard refuses it (or it expired), says so once, on the first screen that asked.
 */
export type RestoredChanges = {
  list: readonly RestoredMutation[];
  /** The change's outcome for one screen: the real one the first time, ok after that (no second notice). */
  claim: (change: RestoredMutation) => Promise<MutationOutcome>;
};

export function restoredChanges(list: readonly RestoredMutation[]): RestoredChanges {
  const claimed = new Set<string>();
  return {
    list,
    claim: (change) =>
      change.outcome.then((outcome) => {
        if (claimed.has(change.mutationId)) return { ok: true, version: 0 };
        claimed.add(change.mutationId);
        return outcome;
      }),
  };
}

/** What a restored change was, as the incident screens track it: its busy key and the notice it would leave. */
export type RestoredTarget = {
  incidentId: string;
  /** `status`, `severity`, `update`, `role/<role>` (the incident screen's), or `declare`. */
  key: string;
  notice: Pick<NoticeTarget, "kind" | "to" | "role"> & { title?: string };
};

export function restoredTarget(
  change: Pick<RestoredMutation, "name" | "args">,
): RestoredTarget | null {
  const args = change.args as Record<string, unknown> | null;
  if (typeof args !== "object" || args === null || typeof args.id !== "string") return null;
  const incidentId = args.id;
  switch (change.name) {
    case "incident.declare":
      return typeof args.title === "string"
        ? { incidentId, key: "declare", notice: { kind: "declare", title: args.title } }
        : null;
    case "incident.setStatus":
      return oneOf(INCIDENT_STATUSES, args.status)
        ? { incidentId, key: "status", notice: { kind: "status", to: args.status } }
        : null;
    case "incident.setSeverity":
      return oneOf(SEVERITIES, args.severity)
        ? { incidentId, key: "severity", notice: { kind: "severity", to: args.severity } }
        : null;
    case "incident.postUpdate":
      return { incidentId, key: "update", notice: { kind: "update" } };
    case "incident.assignRole":
      return oneOf(INCIDENT_ROLES, args.role)
        ? { incidentId, key: `role/${args.role}`, notice: { kind: "role", role: args.role } }
        : null;
    default:
      return null;
  }
}

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return (values as readonly unknown[]).includes(value);
}
