// `/v1/instances*` (RFC 0015 sections 1 and 8): an instance registers its key with the relay after accepting the
// terms and confirming a contact address by an emailed code (Freecorps' relay). On a company's own relay
// (`RELAY_REGISTRATION=closed`) there are no codes and no terms: `POST /v1/instances` registers only a call that also
// carries the relay's admin secret (`Authorization: Bearer <RELAY_ADMIN_TOKEN>`), which `vp run setup:relay` makes and
// uses for the company's instance (scripts/setup-relay). Every call is signed with the instance key
// (`verifyRequest`); every check-and-change runs inside the instance's Durable Object (src/registry.ts).

import {
  canonicalKey,
  verifyKeyProof,
  verifyRequest,
  type VerifiedRequest,
} from "@freecorps/brigade-push/instance";
import { bearerMatches } from "./auth.ts";
import { readBody } from "./body.ts";
import {
  CODE_TTL_MS,
  checkRegistered,
  instanceStub,
  remember,
  type InstanceRecord,
  type RegistryError,
  type RegistryNamespace,
  type Refusal,
} from "./registry.ts";

export type InstanceEnv = {
  /** The registry's Durable Object namespace (`RegistryDO`). Without it every `/v1/` route answers `503 not_configured`. */
  REGISTRY?: RegistryNamespace;
  /** The `send_email` binding, for the contact code. Without it (or `EMAIL_FROM`) the code cannot be sent. */
  EMAIL?: {
    send(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
  };
  /** The code's sender, a bare address on a domain onboarded to Cloudflare Email Sending. */
  EMAIL_FROM?: string;
  /** The terms version a registration must accept (wrangler.jsonc vars). */
  RELAY_TERMS_VERSION?: string;
  /**
   * `closed`: a company's own relay, which registers only an instance whose `POST /v1/instances` carries
   * `RELAY_ADMIN_TOKEN` (module comment). Anything else is open. A secret, so a deploy without flags keeps it (it
   * is not a var in wrangler.jsonc).
   */
  RELAY_REGISTRATION?: string;
  /** A closed relay's admin secret, as `Authorization: Bearer` on `POST /v1/instances`. Unset: nothing registers. */
  RELAY_ADMIN_TOKEN?: string;
  /**
   * Workers Rate Limiting, per caller IP, on every `/v1/instances*` route (wrangler.jsonc `ratelimits`). Optional:
   * without it nothing is limited per IP.
   */
  CODE_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
};

/**
 * Pragmatic, not RFC 5322: one @, a dot in the domain, and nothing that could break out of a header or a list
 * (whitespace, control characters, `<>",;`). The emailed code is the real check.
 */
const EMAIL_ADDRESS =
  // eslint-disable-next-line no-control-regex -- the control characters are what it refuses.
  /^[^\s@<>",;\x00-\x1f\x7f]+@[^\s@<>",;\x00-\x1f\x7f]+\.[^\s@<>",;\x00-\x1f\x7f]+$/;

function validContact(contact: string): boolean {
  return contact.length <= 254 && EMAIL_ADDRESS.test(contact);
}

const STATUS: Record<RegistryError, number> = {
  instance_unregistered: 403,
  instance_revoked: 403,
  already_registered: 409,
  registration_closed: 403,
  bad_signature: 401,
  terms_outdated: 409,
  code_invalid: 400,
  code_expired: 400,
  too_many_codes: 429,
  unknown_key: 400,
  cannot_retire_signer: 409,
  too_many_keys: 409,
  key_recently_retired: 409,
};

/** `authorization`: the request's `Authorization` header, for the admin token of a closed relay. */
type Caller = VerifiedRequest & {
  registry: RegistryNamespace;
  now: number;
  authorization: string | null;
};
type Route = (caller: Caller, body: Record<string, unknown>, env: InstanceEnv) => Promise<Response>;

const ROUTES: Record<string, { method: string; run: Route }> = {
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
  const registry = env.REGISTRY;
  if (!registry) return json({ error: "not_configured" }, 503);
  const url = new URL(request.url);
  const route = ROUTES[url.pathname];
  if (!route) return json({ error: "not_found" }, 404);
  if (request.method !== route.method) {
    return json({ error: "method_not_allowed" }, 405, { Allow: route.method });
  }
  // Before anything else: instance ids and keys are free, so only the caller's IP bounds how many codes one sender asks
  // for or guesses, and how many object reads it forces (a key a record does not list is read again each time).
  if (env.CODE_LIMIT) {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    let allowed = true;
    try {
      allowed = (await env.CODE_LIMIT.limit({ key: ip })).success;
    } catch (error) {
      // Best effort, like the binding itself: a limiter that fails lets the call through to the object's own limits.
      console.error(JSON.stringify({ message: "rate limiter failed", error: String(error) }));
    }
    if (!allowed) return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
  }
  const bytes = await readBody(request);
  if (bytes === null) return json({ error: "invalid_body" }, 400);
  // The query is signed too (`/v1/health?deep=1` later).
  const verified = await verifyRequest({
    method: request.method,
    path: url.pathname + url.search,
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
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return json({ error: "invalid_body" }, 400);
    }
  }
  try {
    return await route.run(
      { ...verified, registry, now, authorization: request.headers.get("Authorization") },
      body as Record<string, unknown>,
      env,
    );
  } catch (error) {
    // Only a registry call throws here. Every route registers or grants something, so it fails closed.
    console.error(
      JSON.stringify({ message: "registry unavailable", path: url.pathname, error: String(error) }),
    );
    return json({ error: "registry_unavailable" }, 503);
  }
}

async function requestCode(
  caller: Caller,
  body: Record<string, unknown>,
  env: InstanceEnv,
): Promise<Response> {
  if (env.RELAY_REGISTRATION === "closed") return json({ error: "registration_closed" }, 403);
  if (!env.EMAIL || !env.EMAIL_FROM) return json({ error: "not_configured" }, 503);
  const { contact } = body;
  if (typeof contact !== "string" || !validContact(contact)) {
    return json({ error: "invalid_contact" }, 400);
  }
  const address = contact.toLowerCase();
  const instance = instanceStub(caller.registry, caller.instance);
  // The instance's own refusals first (revoked, registered, its hourly three), so a refused instance never costs the
  // address a slot.
  const allowed = await instance.canRequestCode(signer(caller), caller.now);
  if (!allowed.ok) return refuse(allowed);
  // Then the address's limit, whichever instance asks (3 an hour, 10 a day): ids are free, so a limit per instance
  // alone would not bound what one address string receives. It bounds that string only: plus-addressing and other
  // aliases of one mailbox count as different addresses; the per-IP limit above covers the rest.
  const contactObject = caller.registry.getByName(`contact:${await sha256Hex(address)}`);
  const slot = await contactObject.takeAddressSlot(caller.now);
  if (!slot.ok) return refuse(slot);
  // A slot counts a code the address received: given back when none went (best effort; if this fails too, the address
  // has one code fewer this hour).
  const release = async () => {
    try {
      await contactObject.releaseAddressSlot(slot.at);
    } catch (error) {
      console.error(JSON.stringify({ message: "address slot not released", error: String(error) }));
    }
  };
  const code = sixDigits();
  let stored: Awaited<ReturnType<typeof instance.requestCode>>;
  try {
    stored = await instance.requestCode(
      signer(caller),
      address,
      await hashCode(caller.instance, code),
      caller.now,
    );
  } catch (error) {
    // The instance's object did not answer or could not keep the code: none goes out, and the slot goes back.
    await release();
    throw error;
  }
  // Another request of the same instance took its last code since `canRequestCode`.
  if (!stored.ok) {
    await release();
    return refuse(stored);
  }
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
    // Only the error's name and code: its message may quote the address.
    const code = Reflect.get(Object(error), "code");
    console.error(
      JSON.stringify({
        message: "contact code email failed",
        error: error instanceof Error ? error.name : typeof error,
        ...(typeof code === "string" && /^E_[A-Z_]+$/.test(code) ? { code } : {}),
      }),
    );
    // Nothing reached the address, so its slot goes back; the instance's stays used, which bounds its retries.
    await release();
    return json({ error: "email_failed" }, 502);
  }
  return json({ sent: true, expiresInSeconds: CODE_TTL_MS / 1000 });
}

async function register(
  caller: Caller,
  body: Record<string, unknown>,
  env: InstanceEnv,
): Promise<Response> {
  const closed = env.RELAY_REGISTRATION === "closed";
  // A closed relay takes no terms; an open one cannot register without a version to accept.
  const current = closed ? "" : env.RELAY_TERMS_VERSION;
  if (current === undefined || (!closed && !current)) {
    return json({ error: "not_configured" }, 503);
  }
  // On a closed relay, a wrong admin token is refused outright; a missing one falls to `registration_closed` (or the
  // record, for an instance already registered).
  let admin = false;
  if (closed && caller.authorization !== null) {
    admin = await bearerMatches(caller.authorization, env.RELAY_ADMIN_TOKEN);
    if (!admin) return json({ error: "admin_unauthorized" }, 401);
  }
  const { terms, contact, code } = body;
  if (closed && contact !== undefined && (typeof contact !== "string" || !validContact(contact))) {
    return json({ error: "invalid_contact" }, 400);
  }
  const outcome = await instanceStub(caller.registry, caller.instance).register(
    signer(caller),
    {
      terms,
      current,
      closed,
      admin,
      contact: typeof contact === "string" ? contact.toLowerCase() : "",
      hash: typeof code === "string" ? await hashCode(caller.instance, code) : null,
    },
    caller.now,
  );
  if (!outcome.ok) {
    return outcome.error === "terms_outdated"
      ? json({ error: "terms_outdated", terms: current }, 409)
      : refuse(outcome);
  }
  remember(caller.instance, outcome.record, caller.now);
  return answer(caller, outcome, env, outcome.created ? 201 : 200);
}

async function changeKeys(caller: Caller, body: Record<string, unknown>): Promise<Response> {
  const add = body.add === undefined ? null : canonicalKey(body.add);
  const retire = body.retire === undefined ? null : canonicalKey(body.retire);
  if (
    (body.add === undefined && body.retire === undefined) ||
    (body.add !== undefined && add === null) ||
    (body.retire !== undefined && retire === null)
  ) {
    return json({ error: "invalid_body" }, 400);
  }
  // Only whoever holds the new key's private half may add it.
  if (add !== null && !(await verifyKeyProof(add, caller.instance, body.proof))) {
    return json({ error: "invalid_proof" }, 400);
  }
  const outcome = await instanceStub(caller.registry, caller.instance).changeKeys(
    signer(caller),
    add,
    retire,
    caller.now,
  );
  if (!outcome.ok) return refuse(outcome);
  remember(caller.instance, outcome.record, caller.now);
  return json({ instance: caller.instance, keys: outcome.record.keys });
}

/** Only what the object needs: an RPC call serializes its arguments, and the caller holds the namespace. */
function signer(caller: Caller): { key: string; original: boolean } {
  return { key: caller.key, original: caller.original };
}

async function me(caller: Caller, _body: unknown, env: InstanceEnv): Promise<Response> {
  const admission = await checkRegistered(caller.registry, caller, caller.now);
  if (!admission.ok) return json({ error: admission.error }, admission.status);
  return answer(caller, { record: admission.record }, env, 200);
}

function answer(
  caller: Caller,
  { record }: { record: InstanceRecord },
  env: InstanceEnv,
  status: number,
): Response {
  // Not `remember`: on `/me` the record may be a cache hit, and remembering it again would keep it past its 60 s.
  return json(
    {
      instance: caller.instance,
      status: record.status,
      terms: record.terms,
      // A closed relay has no terms to fall behind on.
      termsCurrent: env.RELAY_REGISTRATION === "closed" || record.terms === env.RELAY_TERMS_VERSION,
    },
    status,
  );
}

function refuse(refusal: Refusal): Response {
  const { error, triesLeft, retryAfter } = refusal;
  return json(
    { error, ...(triesLeft === undefined ? {} : { triesLeft }) },
    STATUS[error],
    retryAfter === undefined ? {} : { "Retry-After": String(retryAfter) },
  );
}

/** Uniform over 000000–999999: values past the last whole million are drawn again. */
function sixDigits(): string {
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value);
  while (value[0]! >= 4_294_000_000);
  return String(value[0]! % 1_000_000).padStart(6, "0");
}

/** Salted with the instance id, so a stored hash says nothing and fits no other instance. */
function hashCode(instance: string, code: string): Promise<string> {
  return sha256Hex(`${instance}:${code}`);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers });
}
