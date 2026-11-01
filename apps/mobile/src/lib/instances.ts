// The instances this phone signs in to (RFC 0015 section 5 "Several at once"): at most `MAX_INSTANCES`, kept in secure
// storage, one of them active (the one the app shows). Each keeps its own session, workspaces, relay handle and
// pending sign-out under keys of its own (`instanceStorage`), and its own device key on the native side (keyed by
// origin). The build's default instance (`DEFAULT_INSTANCE`, at the build's `EXPO_PUBLIC_BRIGADE_URL`) keeps the keys
// the app used before several instances, so an existing install becomes it without signing out or losing anything.
// Pure, so it is tested in Node; src/lib/instance-clients.ts keeps it in secure storage.
import { PHONE_WORKSPACES_KEY } from "@/lib/phone-workspaces";
import { WORKSPACE_KEY } from "@/lib/sync";

/** Each instance costs sockets, battery and a device key. */
export const MAX_INSTANCES = 5;

/** Where the list is kept (secure storage). */
export const INSTANCES_KEY = "brigade.instances";

/** The id of the build's default instance: its origin follows the build, its keys are the ones from before. */
export const DEFAULT_INSTANCE = "default";

export type Instance = {
  /** `DEFAULT_INSTANCE`, or letters and digits made when it was added; names its keys in secure storage. */
  id: string;
  /** The dashboard's origin, as `URL.origin` writes it: where the app signs in, syncs and registers. */
  origin: string;
};

export type Instances = { instances: Instance[]; active: string | null };

const ID = /^[A-Za-z0-9]{1,32}$/;

/** Where an instance keeps what is its own in secure storage. */
export type InstanceStorage = {
  /** `@better-auth/expo`'s `storagePrefix` (`brigade:<id>`; it writes `:` as `_` in keys). */
  auth: string;
  /** The workspaces this phone is registered in there (src/lib/phone-workspaces.ts). */
  workspaces: string;
  /** The workspace and role as last read (src/lib/sync.ts `KnownWorkspace`). */
  workspace: string;
  /** The relay handle (src/lib/relay.ts `HandleRecord`). */
  handle: string;
};

export function instanceStorage(id: string): InstanceStorage {
  if (id === DEFAULT_INSTANCE) {
    // The keys from before several instances: an existing install keeps its session and lists.
    return {
      auth: "brigade",
      workspaces: PHONE_WORKSPACES_KEY,
      workspace: WORKSPACE_KEY,
      handle: "brigade.handle",
    };
  }
  return {
    auth: `brigade:${id}`,
    workspaces: `brigade.${id}.workspaces`,
    workspace: `brigade_${id}_workspace`,
    handle: `brigade.${id}.handle`,
  };
}

/** `value` as `URL.origin` writes it, when it is an http(s) URL; undefined otherwise. */
export function originOf(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** The list before anything was stored: the build's default instance alone, active, or nothing without one. */
export function firstInstances(defaultOrigin: string | undefined): Instances {
  return defaultOrigin
    ? { instances: [{ id: DEFAULT_INSTANCE, origin: defaultOrigin }], active: DEFAULT_INSTANCE }
    : { instances: [], active: null };
}

/**
 * The list in `raw`. Nothing stored (an install from before several instances, or a new one) is `firstInstances`. The
 * default instance's origin is the build's (`defaultOrigin`), as it always was: a development build follows its Metro
 * host, a new build its new address. Entries that are not instances, repeated ids or origins, and any past
 * `MAX_INSTANCES` are dropped; an active id that is not listed falls back to the first.
 */
export function readInstances(raw: string | null, defaultOrigin: string | undefined): Instances {
  if (raw === null) return firstInstances(defaultOrigin);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return firstInstances(defaultOrigin);
  }
  if (typeof value !== "object" || value === null) return firstInstances(defaultOrigin);
  const stored = value as { instances?: unknown; active?: unknown };
  if (!Array.isArray(stored.instances)) return firstInstances(defaultOrigin);
  const read: Instance[] = [];
  for (const item of stored.instances as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const { id, origin } = item as Record<string, unknown>;
    if (typeof id !== "string" || !ID.test(id) || typeof origin !== "string") continue;
    const normalized =
      id === DEFAULT_INSTANCE && defaultOrigin !== undefined ? defaultOrigin : originOf(origin);
    if (normalized === undefined) continue;
    read.push({ id, origin: normalized });
  }
  // The default instance first wins its origin over an instance added with the same address.
  const ordered = [
    ...read.filter((one) => one.id === DEFAULT_INSTANCE),
    ...read.filter((one) => one.id !== DEFAULT_INSTANCE),
  ];
  const instances: Instance[] = [];
  for (const one of ordered) {
    if (instances.some((kept) => kept.id === one.id || kept.origin === one.origin)) continue;
    instances.push(one);
  }
  // Back in stored order, so the list reads as the member left it.
  const kept = read.filter((one) => instances.includes(one)).slice(0, MAX_INSTANCES);
  const active =
    typeof stored.active === "string" && kept.some((one) => one.id === stored.active)
      ? stored.active
      : (kept[0]?.id ?? null);
  return { instances: kept, active };
}

export function writeInstances(list: Instances): string {
  return JSON.stringify(list);
}

/** The instance whose dashboard is at `origin` (any URL of it); undefined when the phone has none there. */
export function instanceAt(list: Instances, origin: string | undefined): Instance | undefined {
  const normalized = origin === undefined ? undefined : originOf(origin);
  return normalized === undefined
    ? undefined
    : list.instances.find((one) => one.origin === normalized);
}

export function activeInstance(list: Instances): Instance | undefined {
  return list.instances.find((one) => one.id === list.active);
}

/**
 * With the instance at `origin` in it: the one already there, or a new one with `id` (not made active). `full` past
 * `MAX_INSTANCES`; `invalid` for an address that is not http(s).
 */
export function withInstance(
  list: Instances,
  origin: string,
  id: string,
): { list: Instances; instance: Instance } | "full" | "invalid" {
  const normalized = originOf(origin);
  if (normalized === undefined || !ID.test(id)) return "invalid";
  const existing = list.instances.find((one) => one.origin === normalized);
  if (existing) return { list, instance: existing };
  if (list.instances.length >= MAX_INSTANCES) return "full";
  const instance = { id, origin: normalized };
  return {
    list: { instances: [...list.instances, instance], active: list.active ?? id },
    instance,
  };
}

/** Without instance `id`; the active one moves to the first left when it was that one. */
export function withoutInstance(list: Instances, id: string): Instances {
  const instances = list.instances.filter((one) => one.id !== id);
  const active =
    list.active !== null && instances.some((one) => one.id === list.active)
      ? list.active
      : (instances[0]?.id ?? null);
  return { instances, active };
}

/** With instance `id` active; unchanged when it is not listed. */
export function withActive(list: Instances, id: string): Instances {
  return list.instances.some((one) => one.id === id) ? { ...list, active: id } : list;
}

/**
 * The list kept in `storage`, its changes made one at a time (each reads what the one before wrote), and what it holds
 * now for those reading it in render: `firstInstances` until it was read, so the app opens on the build's default
 * instance at once. A read that fails (secure storage locked) keeps that in memory and writes nothing, so a stored
 * list is never overwritten by one it could not read; a change then fails rather than guess.
 */
export function instancesStore(deps: {
  read: () => Promise<string | null>;
  write: (raw: string) => Promise<void>;
  defaultOrigin: string | undefined;
  /** A new instance id: letters and digits. */
  newId: () => string;
}) {
  let queue: Promise<unknown> = Promise.resolve();
  let latest = firstInstances(deps.defaultOrigin);
  const listeners = new Set<() => void>();
  const publish = (list: Instances) => {
    latest = list;
    for (const listener of listeners) listener();
  };
  const run = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  };
  const change = <T>(edit: (list: Instances) => { list: Instances; result: T }): Promise<T> =>
    run(async () => {
      const list = readInstances(await deps.read(), deps.defaultOrigin);
      const { list: next, result } = edit(list);
      if (next !== list) await deps.write(writeInstances(next));
      publish(next);
      return result;
    });
  return {
    /** Reads the stored list; what it holds now if it cannot be read. */
    load: () =>
      run(async () => {
        let raw: string | null;
        try {
          raw = await deps.read();
        } catch {
          return latest;
        }
        publish(readInstances(raw, deps.defaultOrigin));
        return latest;
      }),
    current: (): Instances => latest,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Adds the instance at `origin` (not made active), or finds it; `full` or `invalid` adds nothing. */
    add: (origin: string) =>
      change<Instance | "full" | "invalid">((list) => {
        const added = withInstance(list, origin, deps.newId());
        return typeof added === "string"
          ? { list, result: added }
          : { list: added.list, result: added.instance };
      }),
    remove: (id: string) =>
      change((list) => ({ list: withoutInstance(list, id), result: undefined })),
    activate: (id: string) => change((list) => ({ list: withActive(list, id), result: undefined })),
  };
}

export type InstancesStore = ReturnType<typeof instancesStore>;
