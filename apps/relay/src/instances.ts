// `/v1/instances*` (RFC 0015 sections 1 and 8): an instance registers its key with the relay after accepting the
// terms and confirming a contact address by an emailed code (Freecorps' relay). On a company's own relay
// (`RELAY_REGISTRATION=closed`) the setup script will register its one instance with a relay admin secret, in a later
// slice; until then closed mode refuses every registration. Every call is signed with the instance key
// (`verifyRequest`); every check-and-change runs inside the instance's Durable Object (src/registry.ts).

import {
  canonicalKey,
  verifyKeyProof,
  verifyRequest,
  type VerifiedRequest,
} from "@freecorps/brigade-push";
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
  /** `closed`: a company's own relay, which refuses registration here (module comment). Anything else is open. */
  RELAY_REGISTRATION?: string;
  /**
   * Workers Rate Limiting, per caller IP, on asking for a code and on guessing it (wrangler.jsonc `ratelimits`).
   * Without it nothing is limited per IP.
   */
  CODE_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
};

/** The routes that send or check a code, limited per IP by `CODE_LIMIT`. */
const LIMITED = new Set(["/v1/instances/contact", "/v1/instances"]);

/**
 * Pragmatic, not RFC 5322: one @, a dot in the domain, and nothing that could break out of a header or a list
 * (whitespace, control characters, `<>",;`). The emailed code is the real check.
 */
const EMAIL_ADDRESS =
  // eslint-disable-next-line no-control-regex -- the control characters are what it refuses.
  /^[^\s@<>",;\x00-\x1f\x7f]+@[^\s@<>",;\x00-\x1f\x7f]+\.[^\s@<>",;\x00-\x1f\x7f]+$/;

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

type Caller = VerifiedRequest & { registry: RegistryNamespace; now: number };
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
  // Before anything else: instance ids are free, so only the caller's address bounds how many codes one sender asks
  // for or guesses.
  if (env.CODE_LIMIT && LIMITED.has(url.pathname)) {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (!(await env.CODE_LIMIT.limit({ key: ip })).success) {
      return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
    }
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
    return await route.run({ ...verified, registry, now }, body as Record<string, unknown>, env);
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
  if (typeof contact !== "string" || contact.length > 254 || !EMAIL_ADDRESS.test(contact)) {
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
  const slot = await caller.registry
    .getByName(`contact:${await sha256Hex(address)}`)
    .takeAddressSlot(caller.now);
  if (!slot.ok) return refuse(slot);
  const code = sixDigits();
  const stored = await instance.requestCode(
    signer(caller),
    address,
    await hashCode(caller.instance, code),
    caller.now,
  );
  if (!stored.ok) return refuse(stored);
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
    return json({ error: "email_failed" }, 502);
  }
  return json({ sent: true, expiresInSeconds: CODE_TTL_MS / 1000 });
}

async function register(
  caller: Caller,
  body: Record<string, unknown>,
  env: InstanceEnv,
): Promise<Response> {
  const current = env.RELAY_TERMS_VERSION;
  if (!current) return json({ error: "not_configured" }, 503);
  const { terms, contact, code } = body;
  const outcome = await instanceStub(caller.registry, caller.instance).register(
    signer(caller),
    {
      terms,
      current,
      closed: env.RELAY_REGISTRATION === "closed",
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
  remember(caller.instance, record, caller.now);
  return json(
    {
      instance: caller.instance,
      status: record.status,
      terms: record.terms,
      termsCurrent: record.terms === env.RELAY_TERMS_VERSION,
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
