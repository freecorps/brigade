// Changes queued on the phone that the shard has not confirmed, kept across a restart (RFC 0004 "Clients"): one
// file per member and workspace, holding the sync client's id and its unconfirmed mutations per shard, so the app
// opened again shows them as not sent yet and sends them with the same ids. Pure, so it is tested in Node;
// src/lib/pending-files.ts keeps the files with expo-file-system.
import {
  MUTATION_RETENTION_MS,
  type MutationOutcome,
  type SyncClient,
  type PendingStorage,
  type RestoredMutation,
} from "@freecorps/brigade-sync";
import type { NoticeTarget } from "@freecorps/brigade-i18n/incident";
import { INCIDENT_ROLES, INCIDENT_STATUSES, SEVERITIES } from "@freecorps/brigade-schema";

/** Files by name, in one directory of the app's own. */
export type PendingFiles = {
  /** The file's text, or the copy left next to it (`savedText`). */
  read: (name: string) => Promise<string | null>;
  /** Replaces the file whole: a reader never sees half of it. */
  write: (name: string, raw: string) => Promise<void>;
  /** With the copy next to it. Nothing when it is not there. */
  remove: (name: string) => Promise<void>;
  list: () => Promise<string[]>;
};

/**
 * Runs every operation on `files` in turn, so a save made before a sign-out lands before the sign-out deletes the
 * file, and a launch reads the file only after the last save of the client before it. A write still waiting its
 * turn takes the text of a newer write of the same file instead of queueing another: each change saves the whole
 * queue, so a burst of confirmations costs a write or two, not one each.
 */
export function serialFiles(files: PendingFiles): PendingFiles {
  let queue: Promise<unknown> = Promise.resolve();
  const run = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  };
  /** The write of each file that has not started yet, if it is the last operation queued on it. */
  const waiting = new Map<string, { raw: string; done: Promise<void> }>();
  return {
    read: (name) => run(() => files.read(name)),
    write: (name, raw) => {
      const queued = waiting.get(name);
      if (queued) {
        queued.raw = raw;
        return queued.done;
      }
      const entry = { raw, done: Promise.resolve() };
      entry.done = run(() => {
        if (waiting.get(name) === entry) waiting.delete(name);
        return files.write(name, entry.raw);
      });
      waiting.set(name, entry);
      return entry.done;
    },
    remove: (name) => {
      // A newer write must land after this, not be folded into the one before it.
      waiting.delete(name);
      return run(() => files.remove(name));
    },
    list: () => run(() => files.list()),
  };
}

/**
 * The text of a queue file, from the file and the copy written next to it before it is moved over the file.
 * Moving over a file deletes it first, so a kill between the two leaves only the copy, the newer queue.
 */
export function savedText(file: string | null, aside: string | null): string | null {
  return file ?? aside;
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
  options: { anyWorkspace?: boolean } = {},
): { clientId: string; shards: Record<string, unknown[]> } | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const file = value as Record<string, unknown>;
    const workspace = options.anyWorkspace
      ? typeof file.workspaceId === "string"
      : file.workspaceId === workspaceId;
    if (file.version !== 1 || file.userId !== userId || !workspace) {
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

/** When the newest saved mutation was made, or nothing if none says so. */
function newest(shards: Record<string, unknown[]>): number | undefined {
  let latest: number | undefined;
  for (const list of Object.values(shards)) {
    for (const entry of list) {
      const createdAt = (entry as { createdAt?: unknown } | null)?.createdAt;
      if (typeof createdAt === "number" && (latest === undefined || createdAt > latest)) {
        latest = createdAt;
      }
    }
  }
  return latest;
}

/** One member's queue in one workspace, for their sync client (src/lib/sync-client.ts). */
export type MemberQueue = {
  /** The client id the saved mutations were sent with: the shard de-duplicates by it. */
  clientId: string;
  /** What was saved per shard, for `SyncClient.restore`. */
  saved: Readonly<Record<string, readonly unknown[]>>;
  /**
   * Saves for a shard with saved mutations are ignored until it is restored: a change made before (a device
   * registration) would otherwise replace the file with a queue that has none of them. Call it just before
   * `SyncClient.restore`, whose own save then keeps both.
   */
  restoring: (shard: string) => void;
  /** Whether changes not sent yet are kept: signing out loses them. */
  unsent: () => boolean;
  storage: PendingStorage;
  /** Deletes the file and ignores every later save: the member signed out. */
  drop: () => Promise<void>;
};

/**
 * Opens the member's queue: their saved client id and mutations, or a new id and nothing. Files of anyone else
 * signed in on the phone before are deleted first, so another member's queue is never restored nor kept around;
 * so are the member's own queues of other workspaces once everything in them is past the retention window
 * (`MUTATION_RETENTION_MS`), when the shard would refuse it anyway.
 */
export async function openQueue(
  files: PendingFiles,
  member: { userId: string; workspaceId: string },
  newClientId: () => string,
  now: () => number = Date.now,
): Promise<MemberQueue> {
  const { userId, workspaceId } = member;
  const name = queueFileName(userId, workspaceId);
  const mine = `${hex(userId)}.`;
  for (const other of await queueNames(files)) {
    if (other === name) continue;
    if (other.startsWith(mine)) {
      const raw = await files.read(other).catch(() => null);
      const shards = parseQueueFile(raw, userId, workspaceId, { anyWorkspace: true })?.shards;
      const latest = shards ? newest(shards) : undefined;
      if (latest !== undefined && now() - latest <= MUTATION_RETENTION_MS) continue;
    }
    await files.remove(other).catch(() => {});
  }
  const found = parseQueueFile(await files.read(name), userId, workspaceId);
  const clientId = found?.clientId ?? newClientId();
  const shards: Record<string, unknown[]> = { ...found?.shards };
  const unrestored = new Set(Object.keys(shards));
  let dropped = false;
  return {
    clientId,
    saved: found?.shards ?? {},
    restoring: (shard) => {
      unrestored.delete(shard);
    },
    unsent: () => !dropped && Object.keys(shards).length > 0,
    storage: {
      save: (shard, mutations) => {
        if (dropped || unrestored.has(shard)) return;
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

/** The queue files there are: a copy left next to one (`<name>.next`) counts as it, and is removed with it. */
async function queueNames(files: PendingFiles): Promise<Set<string>> {
  return new Set((await files.list()).map((name) => name.replace(/\.next$/, "")));
}

/** Deletes every member's queue: after a sign-out, nothing they queued is sent or shown again. */
export async function dropQueues(files: PendingFiles): Promise<void> {
  for (const name of await queueNames(files)) await files.remove(name).catch(() => {});
}

/**
 * The changes restored at launch, for the screens that made them: each shows as not sent yet while it waits and,
 * if the shard refuses it (or it expired), says so once: on the first screen that claimed it, or else on one that
 * asked for what is left.
 */
export type RestoredChanges = {
  list: readonly RestoredMutation[];
  /** The change's outcome for one screen: the real one the first time, ok after that (no second notice). */
  claim: (change: RestoredMutation) => Promise<MutationOutcome>;
  /**
   * Like `claim`, but only when no `claim` took it by the time it settles and `take()` still says this screen can
   * show it (the incident list, for an incident it lists). Ok otherwise.
   */
  claimLeft: (change: RestoredMutation, take: () => boolean) => Promise<MutationOutcome>;
};

export function restoredChanges(list: readonly RestoredMutation[]): RestoredChanges {
  const claimed = new Set<string>();
  const ok: MutationOutcome = { ok: true, version: 0 };
  return {
    list,
    claim: (change) =>
      change.outcome.then((outcome) => {
        if (claimed.has(change.mutationId)) return ok;
        claimed.add(change.mutationId);
        return outcome;
      }),
    // One turn later than `claim`'s handlers, which run as soon as the outcome settles, however late they asked.
    claimLeft: (change, take) =>
      change.outcome
        .then((outcome) => outcome)
        .then((outcome) => {
          if (claimed.has(change.mutationId) || !take()) return ok;
          claimed.add(change.mutationId);
          return outcome;
        }),
  };
}

/**
 * Puts the member's saved changes for `shard` back into their client. Run it once the member's role is known: each
 * change is applied as the actor is now, and one a viewer may not make drops out of the view.
 */
export function restoreQueue(
  client: Pick<SyncClient, "restore">,
  shard: string,
  queue: MemberQueue,
): RestoredChanges {
  queue.restoring(shard);
  return restoredChanges(client.restore(shard, queue.saved[shard] ?? []));
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
