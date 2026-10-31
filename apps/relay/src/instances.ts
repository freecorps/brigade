// `/v1/instances*` (RFC 0015 sections 1 and 8): an instance registers its key with the relay, after accepting the
// terms and confirming a contact address by an emailed code (Freecorps' relay), or is written in by the setup script
// (an own relay, `RELAY_REGISTRATION=closed`). Every call is signed with the instance key (`verifyRequest`).

import { fromBase64url, verifyRequest, type VerifiedRequest } from "@freecorps/brigade-push";
import { readBody } from "./body.ts";
import {
  checkRegistered,
  readInstance,
  writeInstance,
  type InstanceRecord,
  type RegistryStore,
} from "./registry.ts";

export type InstanceEnv = {
  /** Workers KV (README "Instance registration"). Without it every `/v1/` route answers `503 not_configured`. */
  REGISTRY?: RegistryStore;
  /** The `send_email` binding, for the contact code. Without it (or `EMAIL_FROM`) the code cannot be sent. */
  EMAIL?: {
    send(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
  };
  /** The code's sender, a bare address on a domain onboarded to Cloudflare Email Sending. */
  EMAIL_FROM?: string;
  /** The terms version a registration must accept (wrangler.jsonc vars). */
  RELAY_TERMS_VERSION?: string;
  /** `closed`: an own relay, whose only instance the setup script writes in directly. Anything else is open. */
  RELAY_REGISTRATION?: string;
};

const CODE_TTL_SECONDS = 15 * 60;
const CODE_TRIES = 5;
const CODES_PER_HOUR = 3;
/** Room for a rotation: the current key, the next one, and one spare. */
const MAX_KEYS = 3;
/** Pragmatic, not RFC 5322: one @, no spaces, a dot in the domain. The emailed code is the real check. */
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Stored at `code:<id>` for an hour: the pending code (hashed) and when codes were sent, for the hourly limit. */
type PendingCode = {
  contact: string;
  hash: string;
  expiresAt: number;
  tries: number;
  sent: number[];
};

type Caller = VerifiedRequest & { store: RegistryStore; now: number };

const ROUTES: Record<
  string,
  { method: string; run: (c: Caller, body: unknown, env: InstanceEnv) => Promise<Response> }
> = {
  "/v1/instances/contact": { method: "POST", run: requestCode },
  "/v1/instances": { method: "POST", run: register },
  "/v1/instances/keys": { method: "POST", run: changeKeys },
  "/v1/instances/me": { method: "GET", run: me },
};

export async function instanceRoutes(
  request: Request,
  env: InstanceEnv,
  now: number,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const route = ROUTES[path];
  if (!route) return json({ error: "not_found" }, 404);
  if (request.method !== route.method) {
    return json({ error: "method_not_allowed" }, 405, { Allow: route.method });
  }
  const store = env.REGISTRY;
  if (!store) return json({ error: "not_configured" }, 503);
  const bytes = await readBody(request);
  if (bytes === null) return json({ error: "invalid_body" }, 400);
  // The query is signed too (`/v1/health?deep=1` later).
  const verified = await verifyRequest({
    method: request.method,
    path: path + url.search,
    headers: request.headers,
    body: bytes,
    now,
  });
  if (!verified.ok) return json({ error: verified.error }, 401);
  let body: unknown = {};
  if (route.method === "POST") {
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return json({ error: "invalid_body" }, 400);
    }
    if (!isRecord(body)) return json({ error: "invalid_body" }, 400);
  }
  try {
    return await route.run({ ...verified, store, now }, body, env);
  } catch (error) {
    // Only KV throws here. Every route here registers or grants something, so a registry that cannot be read or
    // written fails closed.
    console.error(JSON.stringify({ message: "registry unavailable", path, error: String(error) }));
    return json({ error: "registry_unavailable" }, 503);
  }
}

/** The caller holds the instance: a key in its record, or, before there is one, the key its id comes from. */
function owns(caller: Caller, record: InstanceRecord | null): boolean {
  return record ? record.keys.includes(caller.key) : caller.original;
}

async function requestCode(caller: Caller, body: unknown, env: InstanceEnv): Promise<Response> {
  if (env.RELAY_REGISTRATION === "closed") return json({ error: "registration_closed" }, 403);
  if (!env.EMAIL || !env.EMAIL_FROM) return json({ error: "not_configured" }, 503);
  const { contact } = body as { contact?: unknown };
  if (typeof contact !== "string" || contact.length > 254 || !EMAIL_ADDRESS.test(contact)) {
    return json({ error: "invalid_contact" }, 400);
  }
  const record = await readInstance(caller.store, caller.instance, caller.now);
  if (record?.status === "revoked") return json({ error: "instance_revoked" }, 403);
  if (!owns(caller, record)) return json({ error: "bad_signature" }, 401);

  const key = `code:${caller.instance}`;
  const previous = await readPending(caller.store, key);
  const sent = (previous?.sent ?? []).filter((at) => caller.now - at < 3600_000);
  if (sent.length >= CODES_PER_HOUR) {
    const retryAfter = Math.ceil((Math.min(...sent) + 3600_000 - caller.now) / 1000);
    return json({ error: "too_many_codes" }, 429, { "Retry-After": String(retryAfter) });
  }
  const code = sixDigits();
  const pending: PendingCode = {
    contact: contact.toLowerCase(),
    hash: await hashCode(caller.instance, code),
    expiresAt: caller.now + CODE_TTL_SECONDS * 1000,
    tries: 0,
    sent: [...sent, caller.now],
  };
  // Stored before sending, so a send that fails still counts towards the hourly limit.
  await caller.store.put(key, JSON.stringify(pending), { expirationTtl: 3600 });
  try {
    await env.EMAIL.send({
      from: env.EMAIL_FROM,
      to: contact,
      subject: "Your Brigade relay code / Seu código do relay do Brigade",
      text: [
        `Your code to register a Brigade instance with this relay: ${code}`,
        "It expires in 15 minutes. If you did not ask for it, ignore this email.",
        "",
        `Seu código para registrar uma instância do Brigade neste relay: ${code}`,
        "Ele expira em 15 minutos. Se você não o pediu, ignore este email.",
      ].join("\n"),
    });
  } catch (error) {
    // Never the address or the code.
    console.error(JSON.stringify({ message: "contact code email failed", error: String(error) }));
    return json({ error: "email_failed" }, 502);
  }
  return json({ sent: true, expiresInSeconds: CODE_TTL_SECONDS });
}

async function register(caller: Caller, body: unknown, env: InstanceEnv): Promise<Response> {
  const record = await readInstance(caller.store, caller.instance, caller.now, true);
  const current = env.RELAY_TERMS_VERSION;
  const { terms, contact, code } = body as { terms?: unknown; contact?: unknown; code?: unknown };
  if (record?.status === "revoked") return json({ error: "instance_revoked" }, 403);
  if (record) {
    if (!owns(caller, record)) return json({ error: "bad_signature" }, 401);
    // Registering again is how an instance accepts newer terms; the contact only changes with a new code (later).
    if (
      current &&
      terms === current &&
      record.terms !== current &&
      env.RELAY_REGISTRATION !== "closed"
    ) {
      await writeInstance(caller.store, caller.instance, { ...record, terms: current }, caller.now);
      return json(answer(caller.instance, { ...record, terms: current }, env));
    }
    return json(answer(caller.instance, record, env));
  }
  if (env.RELAY_REGISTRATION === "closed") return json({ error: "registration_closed" }, 403);
  if (!caller.original) return json({ error: "instance_unregistered" }, 403);
  if (!current) return json({ error: "not_configured" }, 503);
  if (terms !== current) return json({ error: "terms_outdated", terms: current }, 409);
  if (typeof contact !== "string" || typeof code !== "string")
    return json({ error: "invalid_body" }, 400);

  const key = `code:${caller.instance}`;
  const pending = await readPending(caller.store, key);
  if (!pending || pending.expiresAt <= caller.now || pending.tries >= CODE_TRIES) {
    return json({ error: "code_expired" }, 400);
  }
  if (
    pending.contact !== contact.toLowerCase() ||
    pending.hash !== (await hashCode(caller.instance, code))
  ) {
    const tries = pending.tries + 1;
    // Kept (spent) to the end of the hour, so the hourly limit on new codes still holds.
    await caller.store.put(key, JSON.stringify({ ...pending, tries }), { expirationTtl: 3600 });
    return json({ error: "code_invalid", triesLeft: CODE_TRIES - tries }, 400);
  }
  const created: InstanceRecord = {
    status: "registered",
    keys: [caller.key],
    terms: current,
    contact: pending.contact,
    registeredAt: new Date(caller.now).toISOString(),
  };
  await writeInstance(caller.store, caller.instance, created, caller.now);
  await caller.store.put(key, JSON.stringify({ ...pending, tries: CODE_TRIES }), {
    expirationTtl: 3600,
  });
  return json(answer(caller.instance, created, env), 201);
}

async function changeKeys(caller: Caller, body: unknown, _env: InstanceEnv): Promise<Response> {
  const { add, retire } = body as { add?: unknown; retire?: unknown };
  if (
    (add === undefined && retire === undefined) ||
    (add !== undefined && !isPublicKey(add)) ||
    (retire !== undefined && typeof retire !== "string")
  ) {
    return json({ error: "invalid_body" }, 400);
  }
  // Read past the cache: a rotation must not work from a record another isolate already changed.
  const record = await readInstance(caller.store, caller.instance, caller.now, true);
  if (!record) return json({ error: "instance_unregistered" }, 403);
  if (record.status === "revoked") return json({ error: "instance_revoked" }, 403);
  if (!record.keys.includes(caller.key)) return json({ error: "bad_signature" }, 401);
  let keys = record.keys;
  if (retire !== undefined) {
    if (!keys.includes(retire)) return json({ error: "unknown_key" }, 400);
    // The signer's key is never retired by itself, so the last key cannot be either.
    if (retire === caller.key) return json({ error: "cannot_retire_signer" }, 409);
    keys = keys.filter((k) => k !== retire);
  }
  if (typeof add === "string" && !keys.includes(add)) {
    if (keys.length >= MAX_KEYS) return json({ error: "too_many_keys" }, 409);
    keys = [...keys, add];
  }
  await writeInstance(caller.store, caller.instance, { ...record, keys }, caller.now);
  return json({ instance: caller.instance, keys });
}

async function me(caller: Caller, _body: unknown, env: InstanceEnv): Promise<Response> {
  const admission = await checkRegistered(caller.store, caller, caller.now);
  if (!admission.ok) return json({ error: admission.error }, admission.status);
  return json(answer(caller.instance, admission.record, env));
}

function answer(instance: string, record: InstanceRecord, env: InstanceEnv) {
  return {
    instance,
    status: record.status,
    terms: record.terms,
    termsCurrent: env.RELAY_REGISTRATION === "closed" || record.terms === env.RELAY_TERMS_VERSION,
  };
}

async function readPending(store: RegistryStore, key: string): Promise<PendingCode | null> {
  const text = await store.get(key);
  return text === null ? null : (JSON.parse(text) as PendingCode);
}

function isPublicKey(value: unknown): value is string {
  try {
    return typeof value === "string" && fromBase64url(value).length === 32;
  } catch {
    return false;
  }
}

/** Uniform over 000000–999999: values past the last whole million are drawn again. */
function sixDigits(): string {
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value);
  while (value[0]! >= 4_294_000_000);
  return String(value[0]! % 1_000_000).padStart(6, "0");
}

/** Salted with the instance id, so a code read from KV says nothing and fits no other instance. */
async function hashCode(instance: string, code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${instance}:${code}`),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers });
}
