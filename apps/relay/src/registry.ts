// The relay's registry of instances (RFC 0015 section 1), in Workers KV: one record per instance id, read through a
// per-isolate cache. A KV failure fails closed for registration and anything that grants a capability
// (`checkRegistered`), and open only for the send path's revocation check (`isRevoked`): a handle is only minted for
// a registered instance, so a send needs no registration read, and a KV outage must not stop every self-hosted page.

import type { VerifiedRequest } from "@freecorps/brigade-push";

/** The part of a KV namespace the registry uses, so tests can pass a Map-backed one. */
export type RegistryStore = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

/**
 * Stored at `instance:<id>`. `keys` are base64url raw Ed25519 public keys, the original first while it is not
 * retired; `terms` is the terms version accepted (`closed` for an own relay's instance); `contact` the address
 * confirmed by email, null on an own relay.
 */
export type InstanceRecord = {
  status: "registered" | "revoked";
  keys: string[];
  terms: string;
  contact: string | null;
  registeredAt: string;
  revokedAt?: string;
};

/** How long an isolate trusts what it read, a revocation included. */
const CACHE_MS = 60_000;
/** Past this many entries the cache starts over, so an isolate's memory stays bounded. */
const CACHE_MAX = 10_000;
// One per isolate: instance id → the record (null: KV said there is none) and when it was read.
const cache = new Map<string, { record: InstanceRecord | null; at: number }>();

/** The instance's record, null when it has none; `fresh` skips the cache. Throws when KV does. */
export async function readInstance(
  store: RegistryStore,
  instance: string,
  now: number,
  fresh = false,
): Promise<InstanceRecord | null> {
  const hit = cache.get(instance);
  if (!fresh && hit && now - hit.at < CACHE_MS) return hit.record;
  const text = await store.get(`instance:${instance}`);
  const record = text === null ? null : (JSON.parse(text) as InstanceRecord);
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(instance, { record, at: now });
  return record;
}

export async function writeInstance(
  store: RegistryStore,
  instance: string,
  record: InstanceRecord,
  now: number,
): Promise<void> {
  await store.put(`instance:${instance}`, JSON.stringify(record));
  cache.set(instance, { record, at: now });
}

export type Admission =
  | { ok: true; record: InstanceRecord }
  | {
      ok: false;
      status: number;
      error:
        | "instance_unregistered"
        | "instance_revoked"
        | "bad_signature"
        | "registry_unavailable";
    };

/**
 * Is this signed caller a registered instance, with a key in its record? Fails closed: a KV error is
 * `503 registry_unavailable`.
 */
export async function checkRegistered(
  store: RegistryStore,
  caller: VerifiedRequest,
  now: number,
): Promise<Admission> {
  let record: InstanceRecord | null;
  try {
    record = await readInstance(store, caller.instance, now);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "registry read failed",
        instance: caller.instance,
        error: String(error),
      }),
    );
    return { ok: false, status: 503, error: "registry_unavailable" };
  }
  if (record === null) return { ok: false, status: 403, error: "instance_unregistered" };
  if (record.status === "revoked") return { ok: false, status: 403, error: "instance_revoked" };
  if (!record.keys.includes(caller.key)) return { ok: false, status: 401, error: "bad_signature" };
  return { ok: true, record };
}

/**
 * Has the instance been revoked? For the send path. Fails open: a KV error answers false (logged), so a registry
 * outage never stops a page.
 */
export async function isRevoked(
  store: RegistryStore,
  instance: string,
  now: number,
): Promise<boolean> {
  try {
    return (await readInstance(store, instance, now))?.status === "revoked";
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "registry read failed, revocation check fails open",
        instance,
        error: String(error),
      }),
    );
    return false;
  }
}
