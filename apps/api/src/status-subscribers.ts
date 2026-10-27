// Email subscriptions to a public status page (RFC 0012 "Email subscriptions"): the visitor's routes under
// `/status/:slug/` (subscribe, confirm, manage, unsubscribe), the owners' and admins' routes under
// `/workspaces/:id/status-page/subscribers`, and the signed links the emails carry. Subscribers live in D1
// (`status_subscriber`, migrations/0009), never in the shard. Every change still goes through the shard's outbox as an
// event that names the subscriber's id, never the address; the emails themselves go out from the queue
// (src/notify-status.ts), never from these routes.

import { can, isId, newId, STATUS_SLUG, type Role } from "@freecorps/brigade-schema";
import type { Auth } from "./auth.ts";
import { memberRole } from "./actor.ts";
import { readBounded } from "./body.ts";
import { renderSubscriptionPage, type SubscriptionPage } from "./status-html.ts";
import { isSnapshot, statusPageHeaders } from "./status-route.ts";
import { statusKey } from "./status-page.ts";
import { ORGANIZATION_ID } from "./workspace.ts";

/** How long a confirmation link works. */
export const STATUS_CONFIRM_TTL_MS = 48 * 60 * 60 * 1000;
/** Confirmation emails one pending address gets from one page within `STATUS_CONFIRM_WINDOW_MS`. */
export const STATUS_CONFIRM_SENDS = 3;
export const STATUS_CONFIRM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Confirmation emails one address gets in a UTC day, from every page together (counted when sent). */
export const STATUS_CONFIRM_DAILY_CAP = 5;
/** Subscribers (pending and confirmed) one page may have; past it a subscribe does nothing (and says the same). */
export const STATUS_SUBSCRIBERS_MAX = 1000;
/** The longest address accepted (RFC 5321's path limit). */
export const STATUS_EMAIL_MAX = 254;
/** The largest form body read. */
const MAX_FORM_LENGTH = 2048;

/** An address as stored: trimmed and lower-cased; undefined when it is not one. */
export function normalizeEmail(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const email = input.trim().toLowerCase();
  if (email.length > STATUS_EMAIL_MAX) return undefined;
  return /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/.test(email)
    ? email
    : undefined;
}

/** `a•••@example.com`: enough for the owner of the address to recognise it on the manage page. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return `${email.slice(0, Math.min(1, at))}•••${email.slice(at)}`;
}

// ---- Signed links -------------------------------------------------------------------------------------------------

/** What a link does: `c` confirms a subscription (expires), `m` manages it and unsubscribes (never expires). */
export type LinkKind = "c" | "m";
export type LinkClaims = {
  kind: LinkKind;
  workspaceId: string;
  subscriberId: string;
  expires: number;
};

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

/** The HMAC key for links, derived from `BETTER_AUTH_SECRET` for this one purpose. */
function linkKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle
      .importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"])
      .then((base) =>
        crypto.subtle.deriveKey(
          {
            name: "HKDF",
            hash: "SHA-256",
            salt: new Uint8Array(),
            info: encoder.encode("brigade-status-subscription-link:v1"),
          },
          base,
          { name: "HMAC", hash: "SHA-256", length: 256 },
          false,
          ["sign", "verify"],
        ),
      );
    keys.set(secret, key);
  }
  return key;
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function fromBase64url(text: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return undefined;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
}

/** A link's token: `<kind>.<workspace>.<subscriber>.<expires>.<HMAC>`; `expires` is 0 for a manage link. */
export async function signLink(secret: string, claims: LinkClaims): Promise<string> {
  const payload = `${claims.kind}.${claims.workspaceId}.${claims.subscriberId}.${claims.expires}`;
  const mac = await crypto.subtle.sign("HMAC", await linkKey(secret), encoder.encode(payload));
  return `${payload}.${base64url(new Uint8Array(mac))}`;
}

/** The claims of a token this instance signed for `kind`, still valid at `now`; undefined otherwise. */
export async function verifyLink(
  secret: string,
  token: string | null,
  kind: LinkKind,
  now: number,
): Promise<LinkClaims | undefined> {
  if (!token || token.length > 256) return undefined;
  const parts = token.split(".");
  if (parts.length !== 5) return undefined;
  const [k, workspaceId = "", subscriberId = "", expiresText = "", mac = ""] = parts;
  if (k !== kind || !ORGANIZATION_ID.test(workspaceId) || !isId("ssb", subscriberId))
    return undefined;
  if (!/^\d{1,16}$/.test(expiresText)) return undefined;
  const expires = Number(expiresText);
  if (kind === "c" ? expires <= now : expires !== 0) return undefined;
  const signature = fromBase64url(mac);
  if (!signature) return undefined;
  const payload = `${k}.${workspaceId}.${subscriberId}.${expiresText}`;
  // `verify` compares in constant time.
  const valid = await crypto.subtle.verify(
    "HMAC",
    await linkKey(secret),
    signature,
    encoder.encode(payload),
  );
  return valid ? { kind, workspaceId, subscriberId, expires } : undefined;
}

/** The page's own URL for `path` with the token, from `base` (an https or http origin). */
export function subscriptionLink(base: string, slug: string, path: string, token: string): string {
  const url = new URL(`/status/${slug}/${path}`, base);
  url.searchParams.set("t", token);
  return url.href;
}

// ---- The visitor's routes -----------------------------------------------------------------------------------------

/** The subscription routes the web Worker forwards: `/status/:slug/<action>`. */
export const SUBSCRIPTION_ACTIONS = ["subscribe", "confirm", "manage", "unsubscribe"] as const;
export type SubscriptionAction = (typeof SUBSCRIPTION_ACTIONS)[number];

type PageFacts = { title: string; locale: "en" | "pt-BR" };

/**
 * `/status/:slug/subscribe` (POST, the page's form), `/confirm` (GET shows a button, POST confirms), `/manage` (GET)
 * and `/unsubscribe` (POST, also RFC 8058's one-click from a mail client). Always an HTML page, never cached. A GET
 * only shows a button, so a mail scanner opening links confirms or unsubscribes nobody.
 */
export async function serveSubscription(
  request: Request,
  env: Env,
  slug: string,
  action: SubscriptionAction,
): Promise<Response> {
  const allowed = action === "subscribe" || action === "unsubscribe" ? ["POST"] : ["GET", "POST"];
  if (action === "manage") allowed.splice(1);
  if (!allowed.includes(request.method)) {
    return new Response(null, { status: 405, headers: { Allow: allowed.join(", ") } });
  }
  if (!STATUS_SLUG.test(slug)) return page(404, { kind: "not_found" }, undefined, slug);
  const facts = await readPage(env, slug);
  if (facts === "unavailable") return page(503, { kind: "unavailable" }, undefined, slug);
  if (!facts) return page(404, { kind: "not_found" }, undefined, slug);
  if (action === "subscribe") return subscribe(request, env, slug, facts);
  const now = Date.now();
  const token = new URL(request.url).searchParams.get("t");
  const kind: LinkKind = action === "confirm" ? "c" : "m";
  const claims = await verifyLink(env.BETTER_AUTH_SECRET, token, kind, now);
  if (!claims) return page(400, { kind: "expired" }, facts, slug);
  try {
    if (action === "confirm") {
      if (request.method === "GET")
        return page(200, { kind: "confirm", token: token! }, facts, slug);
      return await confirm(env, claims, facts, slug);
    }
    if (action === "manage") {
      const row = await env.DB.prepare(
        "select email from status_subscriber where id = ? and workspace_id = ?",
      )
        .bind(claims.subscriberId, claims.workspaceId)
        .first<{ email: string }>();
      if (!row) return page(200, { kind: "unsubscribed" }, facts, slug);
      return page(200, { kind: "manage", token: token!, email: maskEmail(row.email) }, facts, slug);
    }
    return await unsubscribe(env, claims, facts, slug);
  } catch (error) {
    log("a status subscription link failed", { action, error: String(error) });
    return page(503, { kind: "unavailable" }, facts, slug);
  }
}

/** The page's title and language from its snapshot (no shard, no D1); null when there is no public page. */
async function readPage(env: Env, slug: string): Promise<PageFacts | null | "unavailable"> {
  if (!env.STATUS) return null;
  try {
    const stored = await env.STATUS.get(statusKey(slug), { type: "json", cacheTtl: 30 });
    if (stored === null) return null;
    if (!isSnapshot(stored)) return "unavailable";
    return { title: stored.title, locale: stored.locale };
  } catch (error) {
    log("reading a status page for a subscription failed", { error: String(error) });
    return "unavailable";
  }
}

/**
 * A visitor asked to subscribe. The answer is the same page whether the address was new, pending, confirmed, capped
 * or the honeypot was filled, so the form never tells anyone who is subscribed. Rate limits come first (per address
 * and per page), then D1, and only a confirmation that should go out wakes the shard (its outbox event).
 */
async function subscribe(
  request: Request,
  env: Env,
  slug: string,
  facts: PageFacts,
): Promise<Response> {
  const origin = request.headers.get("Origin");
  const own = new URL(request.url).origin;
  if (origin !== null && origin !== "null" && origin !== own) {
    return page(403, { kind: "invalid" }, facts, slug);
  }
  const text = await readBounded(request, MAX_FORM_LENGTH);
  if (text === undefined) return page(400, { kind: "invalid" }, facts, slug);
  const form = new URLSearchParams(text);
  // Bots fill every field; people never see this one.
  const trap = form.get("website");
  const email = normalizeEmail(form.get("email"));
  if (!email) return page(400, { kind: "invalid" }, facts, slug);
  if (!(await allowed(env, request, slug))) return page(429, { kind: "limited" }, facts, slug);
  const answer = () => page(200, { kind: "check", email }, facts, slug);
  if (trap) return answer();
  try {
    const owner = await env.DB.prepare("select workspace_id from status_slug where slug = ?")
      .bind(slug)
      .first<{ workspace_id: string }>();
    if (!owner) return page(404, { kind: "not_found" }, undefined, slug);
    const asked = await recordSubscriber(env.DB, owner.workspace_id, email, own, Date.now());
    if (asked) {
      const result = await env.WORKSPACE.getByName(owner.workspace_id).statusSubscription(
        owner.workspace_id,
        { action: "request", subscriberId: asked.id, send: asked.send },
      );
      if (!result.ok) log("a status subscription was not recorded", { code: result.code });
    }
  } catch (error) {
    log("a status subscription failed", { error: String(error) });
    return page(503, { kind: "unavailable" }, facts, slug);
  }
  return answer();
}

/**
 * Records the address in D1 and says whether a confirmation should go out (and which one, `send`): a new address, or a
 * pending one under `STATUS_CONFIRM_SENDS` in its window. A confirmed address, one over its sends, or a full page
 * (`STATUS_SUBSCRIBERS_MAX`) gets nothing. Two requests at once for one address insert one row.
 */
export async function recordSubscriber(
  db: D1Database,
  workspaceId: string,
  email: string,
  origin: string,
  now: number,
): Promise<{ id: string; send: number } | null> {
  type Row = { id: string; status: string; confirm_sends: number; confirm_since: number };
  const select = db
    .prepare(
      "select id, status, confirm_sends, confirm_since from status_subscriber where workspace_id = ? and email = ?",
    )
    .bind(workspaceId, email);
  let row = await select.first<Row>();
  if (!row) {
    const count = await db
      .prepare("select count(*) as n from status_subscriber where workspace_id = ?")
      .bind(workspaceId)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= STATUS_SUBSCRIBERS_MAX) {
      log("a status page is full: subscription dropped", { workspaceId });
      return null;
    }
    const id = newId("ssb", now, (n) => crypto.getRandomValues(new Uint8Array(n)));
    const inserted = await db
      .prepare(
        `insert into status_subscriber
           (id, workspace_id, email, status, created_at, confirmed_at, confirm_sends, confirm_since, origin)
         values (?, ?, ?, 'pending', ?, null, 1, ?, ?)
         on conflict (workspace_id, email) do nothing`,
      )
      .bind(id, workspaceId, email, now, now, origin)
      .run();
    if (inserted.meta.changes === 1) return { id, send: 1 };
    row = await select.first<Row>();
    if (!row) return null;
  }
  if (row.status !== "pending") return null;
  const fresh = row.confirm_since + STATUS_CONFIRM_WINDOW_MS <= now;
  const send = fresh ? 1 : row.confirm_sends + 1;
  if (send > STATUS_CONFIRM_SENDS) return null;
  const updated = await db
    .prepare(
      `update status_subscriber set confirm_sends = ?, confirm_since = ?, origin = ?
       where id = ? and status = 'pending' and confirm_sends = ?`,
    )
    .bind(send, fresh ? now : row.confirm_since, origin, row.id, row.confirm_sends)
    .run();
  return updated.meta.changes === 1 ? { id: row.id, send } : null;
}

async function confirm(
  env: Env,
  claims: LinkClaims,
  facts: PageFacts,
  slug: string,
): Promise<Response> {
  const now = Date.now();
  const result = await env.DB.prepare(
    `update status_subscriber set status = 'confirmed', confirmed_at = ?
     where id = ? and workspace_id = ? and status = 'pending'`,
  )
    .bind(now, claims.subscriberId, claims.workspaceId)
    .run();
  if (result.meta.changes === 1) {
    await env.WORKSPACE.getByName(claims.workspaceId).statusSubscription(claims.workspaceId, {
      action: "confirm",
      subscriberId: claims.subscriberId,
    });
    return page(200, { kind: "confirmed" }, facts, slug);
  }
  const row = await env.DB.prepare(
    "select status from status_subscriber where id = ? and workspace_id = ?",
  )
    .bind(claims.subscriberId, claims.workspaceId)
    .first<{ status: string }>();
  return row?.status === "confirmed"
    ? page(200, { kind: "confirmed" }, facts, slug)
    : page(400, { kind: "expired" }, facts, slug);
}

async function unsubscribe(
  env: Env,
  claims: LinkClaims,
  facts: PageFacts,
  slug: string,
): Promise<Response> {
  const removed = await deleteSubscriber(env.DB, claims.workspaceId, claims.subscriberId);
  if (removed) {
    await env.WORKSPACE.getByName(claims.workspaceId).statusSubscription(claims.workspaceId, {
      action: "remove",
      subscriberId: claims.subscriberId,
      reason: "unsubscribed",
    });
  }
  return page(200, { kind: "unsubscribed" }, facts, slug);
}

async function deleteSubscriber(
  db: D1Database,
  workspaceId: string,
  subscriberId: string,
): Promise<boolean> {
  const result = await db
    .prepare("delete from status_subscriber where id = ? and workspace_id = ?")
    .bind(subscriberId, workspaceId)
    .run();
  return result.meta.changes === 1;
}

/**
 * Whether this subscribe may go on: Workers Rate Limiting per caller address (`STATUS_SUBSCRIBE_IP_LIMIT`) and per
 * page (`STATUS_SUBSCRIBE_PAGE_LIMIT`). A limiter that fails lets it through: the per-address sends and the daily
 * caps still bound what is emailed.
 */
async function allowed(env: Env, request: Request, slug: string): Promise<boolean> {
  const address = request.headers.get("cf-connecting-ip") ?? "unknown";
  try {
    const [ip, pageLimit] = await Promise.all([
      env.STATUS_SUBSCRIBE_IP_LIMIT.limit({ key: address }),
      env.STATUS_SUBSCRIBE_PAGE_LIMIT.limit({ key: slug }),
    ]);
    return ip.success && pageLimit.success;
  } catch (error) {
    log("status subscription rate limit failed", { error: String(error) });
    return true;
  }
}

function page(
  status: number,
  view: SubscriptionPage,
  facts: PageFacts | undefined,
  slug: string,
): Response {
  const html = renderSubscriptionPage(view, {
    title: facts?.title ?? null,
    locale: facts?.locale ?? "en",
    slug,
  });
  return new Response(html, { status, headers: statusPageHeaders("no-store") });
}

// ---- Owners' and admins' routes -----------------------------------------------------------------------------------

/**
 * `/workspaces/:id/status-page/subscribers`: `GET` the counts, `GET …/export` every subscriber as CSV, `DELETE` one
 * by address (`{ email }`). Owners and admins (`status:manage`), checked in D1; nobody else ever reads an address.
 */
export async function serveSubscribers(
  request: Request,
  env: Env,
  lazyAuth: () => Auth,
  workspaceId: string,
  rest: string,
): Promise<Response> {
  const exporting = rest === "/export";
  if (rest !== "" && !exporting) return json({ error: "not_found" }, 404);
  const methods = exporting ? ["GET"] : ["GET", "DELETE"];
  if (!methods.includes(request.method)) {
    return json({ error: "method_not_allowed" }, 405, { Allow: methods.join(", ") });
  }
  if (!ORGANIZATION_ID.test(workspaceId)) return json({ error: "invalid_workspace_id" }, 400);
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return json({ error: "forbidden_origin" }, 403);
  }
  const session = await lazyAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ error: "unauthenticated" }, 401);
  let role: Role | undefined;
  try {
    role = await memberRole(env.DB, workspaceId, session.user.id);
  } catch (error) {
    log("member lookup failed", { error: String(error) });
    return json({ error: "unavailable" }, 503);
  }
  if (role === undefined) return json({ error: "not_a_member" }, 403);
  if (!can(role, "status:manage")) return json({ error: "forbidden" }, 403);
  try {
    if (request.method === "GET" && !exporting) {
      const { results } = await env.DB.prepare(
        "select status, count(*) as n from status_subscriber where workspace_id = ? group by status",
      )
        .bind(workspaceId)
        .all<{ status: string; n: number }>();
      const count = (status: string) => results.find((row) => row.status === status)?.n ?? 0;
      return json({ confirmed: count("confirmed"), pending: count("pending") });
    }
    if (exporting) {
      const { results } = await env.DB.prepare(
        `select email, status, created_at, confirmed_at from status_subscriber
         where workspace_id = ? order by created_at, id`,
      )
        .bind(workspaceId)
        .all<{ email: string; status: string; created_at: number; confirmed_at: number | null }>();
      const iso = (at: number | null) => (at === null ? "" : new Date(at).toISOString());
      const lines = [
        "email,status,subscribed_at,confirmed_at",
        ...results.map((row) =>
          [csv(row.email), row.status, iso(row.created_at), iso(row.confirmed_at)].join(","),
        ),
      ];
      return new Response(`${lines.join("\r\n")}\r\n`, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="status-subscribers.csv"',
          "Cache-Control": "no-store",
        },
      });
    }
    const text = await readBounded(request, MAX_FORM_LENGTH);
    let body: unknown;
    try {
      body = text === undefined ? undefined : JSON.parse(text);
    } catch {
      body = undefined;
    }
    const email = normalizeEmail((body as { email?: unknown } | undefined)?.email);
    if (!email) return json({ error: "invalid_args" }, 400);
    const row = await env.DB.prepare(
      "delete from status_subscriber where workspace_id = ? and email = ? returning id",
    )
      .bind(workspaceId, email)
      .first<{ id: string }>();
    if (!row) return json({ error: "not_found" }, 404);
    await env.WORKSPACE.getByName(workspaceId).statusSubscription(
      workspaceId,
      { action: "remove", subscriberId: row.id, reason: "deleted" },
      { kind: "user", id: session.user.id, role },
    );
    return json({ ok: true });
  } catch (error) {
    log("status subscribers request failed", { error: String(error) });
    return json({ error: "unavailable" }, 503);
  }
}

/** A CSV field: quoted, with quotes doubled, and a leading formula character defused for spreadsheets. */
function csv(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, ...fields }));
}
