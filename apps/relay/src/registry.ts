// The relay's registry of instances (RFC 0015 section 1): one Durable Object per instance
// (`instance:<id>`) holds its record and its pending contact code, and one per contact address
// (`contact:<hex SHA-256 of the address>`) counts the codes sent to it. Every method is synchronous over the object's
// SQLite-backed storage, so each call (compare a code and count the try, add or retire a key, register) runs whole,
// with no other call in between: parallel guesses or two rotations cannot interleave.
//
// A failed call fails closed (`checkRegistered`, every route that registers or grants something), except the send
// path's revocation check (`isRevoked`): a handle is only minted for a registered instance, so a send needs only that
// check, and a registry outage must not stop every self-hosted page.

import { DurableObject } from "cloudflare:workers";
import type { VerifiedRequest } from "@freecorps/brigade-push";

/**
 * `keys` are canonical public keys (`canonicalKey`), the original first while it is not retired; `terms` is the terms
 * version accepted; `contact` the address confirmed by email (lowercase).
 */
export type InstanceRecord = {
  status: "registered" | "revoked";
  keys: string[];
  terms: string;
  contact: string | null;
  registeredAt: string;
  revokedAt?: string;
};

/** The pending code: its hash (`hashCode`), the address it went to, and how many wrong guesses it has taken. */
type PendingCode = {
  contact: string;
  hash: string;
  expiresAt: number;
  tries: number;
  spent: boolean;
};

export type RegistryError =
  | "instance_unregistered"
  | "instance_revoked"
  | "bad_signature"
  | "registration_closed"
  | "terms_outdated"
  | "code_invalid"
  | "code_expired"
  | "too_many_codes"
  | "unknown_key"
  | "cannot_retire_signer"
  | "too_many_keys";

export type Refusal = { ok: false; error: RegistryError; triesLeft?: number; retryAfter?: number };
export type Outcome = { ok: true; record: InstanceRecord; created?: boolean } | Refusal;
type Done = { ok: true } | Refusal;

/** Who signed: the key (canonical) and whether it is the one the instance id comes from. */
type Signer = { key: string; original: boolean };

export const CODE_TTL_MS = 15 * 60_000;
const CODE_TRIES = 5;
/** Codes an hour, per instance and per contact address. */
const CODES_PER_HOUR = 3;
const HOUR_MS = 3600_000;
/** Room for a rotation: the current key, the next one, and one spare. */
const MAX_KEYS = 3;

export class RegistryDO extends DurableObject {
  record(): InstanceRecord | null {
    return this.ctx.storage.kv.get<InstanceRecord>("record") ?? null;
  }

  /**
   * Counts one code sent from this object (an instance, or a contact address), unless 3 already went in the past
   * hour.
   */
  countSend(now: number): Done {
    const sent = (this.ctx.storage.kv.get<number[]>("sent") ?? []).filter(
      (at) => now - at < HOUR_MS,
    );
    if (sent.length >= CODES_PER_HOUR) {
      const retryAfter = Math.ceil((Math.min(...sent) + HOUR_MS - now) / 1000);
      return { ok: false, error: "too_many_codes", retryAfter };
    }
    this.ctx.storage.kv.put("sent", [...sent, now]);
    return { ok: true };
  }

  /** Stores a new pending code for the instance, within its own 3 an hour. */
  requestCode(signer: Signer, contact: string, hash: string, now: number): Done {
    const record = this.record();
    if (record?.status === "revoked") return { ok: false, error: "instance_revoked" };
    if (!owns(signer, record)) return { ok: false, error: "bad_signature" };
    const sent = this.countSend(now);
    if (!sent.ok) return sent;
    const pending: PendingCode = {
      contact,
      hash,
      expiresAt: now + CODE_TTL_MS,
      tries: 0,
      spent: false,
    };
    this.ctx.storage.kv.put("code", pending);
    return { ok: true };
  }

  /**
   * Registers the signer's original key with the code it was emailed, or, already registered, answers the record
   * (and records `terms` as accepted when they are the current ones).
   */
  register(
    signer: Signer,
    input: {
      terms: unknown;
      current: string;
      closed: boolean;
      contact: string;
      hash: string | null;
    },
    now: number,
  ): Outcome {
    const record = this.record();
    if (record?.status === "revoked") return { ok: false, error: "instance_revoked" };
    if (record) {
      if (!owns(signer, record)) return { ok: false, error: "bad_signature" };
      if (!input.closed && input.terms === input.current && record.terms !== input.current) {
        const updated = { ...record, terms: input.current };
        this.ctx.storage.kv.put("record", updated);
        return { ok: true, record: updated };
      }
      return { ok: true, record };
    }
    if (input.closed) return { ok: false, error: "registration_closed" };
    if (!signer.original) return { ok: false, error: "instance_unregistered" };
    if (input.terms !== input.current) return { ok: false, error: "terms_outdated" };

    const pending = this.ctx.storage.kv.get<PendingCode>("code");
    if (!pending || pending.spent || pending.expiresAt <= now || pending.tries >= CODE_TRIES) {
      return { ok: false, error: "code_expired" };
    }
    if (pending.contact !== input.contact || pending.hash !== input.hash) {
      const tries = pending.tries + 1;
      this.ctx.storage.kv.put("code", { ...pending, tries });
      return { ok: false, error: "code_invalid", triesLeft: CODE_TRIES - tries };
    }
    const created: InstanceRecord = {
      status: "registered",
      keys: [signer.key],
      terms: input.current,
      contact: pending.contact,
      registeredAt: new Date(now).toISOString(),
    };
    this.ctx.storage.kv.put("record", created);
    this.ctx.storage.kv.put("code", { ...pending, spent: true });
    return { ok: true, record: created, created: true };
  }

  /** Retires a key other than the signer's, then adds one (at most 3). Keys are canonical. */
  changeKeys(signer: Signer, add: string | null, retire: string | null): Outcome {
    const record = this.record();
    if (!record) return { ok: false, error: "instance_unregistered" };
    if (record.status === "revoked") return { ok: false, error: "instance_revoked" };
    if (!record.keys.includes(signer.key)) return { ok: false, error: "bad_signature" };
    let keys = record.keys;
    if (retire !== null) {
      if (!keys.includes(retire)) return { ok: false, error: "unknown_key" };
      // The signer's key is never retired by itself, so the last key cannot be either.
      if (retire === signer.key) return { ok: false, error: "cannot_retire_signer" };
      keys = keys.filter((k) => k !== retire);
    }
    if (add !== null && !keys.includes(add)) {
      if (keys.length >= MAX_KEYS) return { ok: false, error: "too_many_keys" };
      keys = [...keys, add];
    }
    const updated = { ...record, keys };
    this.ctx.storage.kv.put("record", updated);
    return { ok: true, record: updated };
  }
}

/** The caller holds the instance: a key in its record, or, before there is one, the key its id comes from. */
function owns(signer: Signer, record: InstanceRecord | null): boolean {
  return record ? record.keys.includes(signer.key) : signer.original;
}

/** The registry's methods as a Worker calls them (a `DurableObjectStub<RegistryDO>`, or a test's fake). */
export type RegistryStub = {
  [K in "record" | "countSend" | "requestCode" | "register" | "changeKeys"]: (
    ...args: Parameters<RegistryDO[K]>
  ) => Promise<ReturnType<RegistryDO[K]>>;
};
export type RegistryNamespace = { getByName(name: string): RegistryStub };

export function instanceStub(registry: RegistryNamespace, instance: string): RegistryStub {
  return registry.getByName(`instance:${instance}`);
}

/** How long an isolate trusts a record it read, a revocation included. Never a missing one. */
const CACHE_MS = 60_000;
/** Past this many entries the cache starts over, so an isolate's memory stays bounded. */
const CACHE_MAX = 10_000;
// One per isolate: instance id → its record and when it was read. Only records that exist: an instance that registers
// must be seen at once.
const cache = new Map<string, { record: InstanceRecord; at: number }>();

/** Updates the cache after a change made in this isolate. */
export function remember(instance: string, record: InstanceRecord, now: number): void {
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(instance, { record, at: now });
}

async function readInstance(
  registry: RegistryNamespace,
  instance: string,
  now: number,
): Promise<InstanceRecord | null> {
  const hit = cache.get(instance);
  if (hit && now - hit.at < CACHE_MS) return hit.record;
  const record = await instanceStub(registry, instance).record();
  if (record) remember(instance, record, now);
  return record;
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

/** Is this signed caller a registered instance, with a key in its record? Fails closed: `503 registry_unavailable`. */
export async function checkRegistered(
  registry: RegistryNamespace,
  caller: VerifiedRequest,
  now: number,
): Promise<Admission> {
  let record: InstanceRecord | null;
  try {
    record = await readInstance(registry, caller.instance, now);
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
 * Has the instance been revoked? For the send path. Fails open: an error answers false (logged), so a registry
 * outage never stops a page.
 */
export async function isRevoked(
  registry: RegistryNamespace,
  instance: string,
  now: number,
): Promise<boolean> {
  try {
    return (await readInstance(registry, instance, now))?.status === "revoked";
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
