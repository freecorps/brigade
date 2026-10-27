// Email subscriptions to a public status page (RFC 0012 "Email subscriptions"): the visitor's routes under
// `/status/:slug/` (subscribe, confirm, manage, unsubscribe), the owners' and admins' routes under
// `/workspaces/:id/status-page/subscribers`, and the signed links the emails carry. Subscribers live in D1
// (`status_subscriber`, migrations/0009), never in the shard. Every change still goes through the shard's outbox as an
// event that names the subscriber's id, never the address; the emails themselves go out from the queue
// (src/notify-status.ts), never from these routes.

import {
  can,
  isId,
  newId,
  STATUS_FOLLOW_KEY,
  STATUS_SLUG,
  type Actor,
  type Role,
} from "@freecorps/brigade-schema";
import type { Auth } from "./auth.ts";
import { memberRole } from "./actor.ts";
import { readBounded } from "./body.ts";
import {
  followGroups,
  renderSubscriptionPage,
  type FollowGroup,
  type SubscriptionPage,
} from "./status-html.ts";
import { isSnapshot, statusPageHeaders } from "./status-route.ts";
import { statusKey } from "./status-page.ts";
import { ORGANIZATION_ID, type WorkspaceDO } from "./workspace.ts";

/** How long a confirmation link works. */
export const STATUS_CONFIRM_TTL_MS = 48 * 60 * 60 * 1000;
/** Confirmation emails one pending address gets from one page within `STATUS_CONFIRM_WINDOW_MS`. */
export const STATUS_CONFIRM_SENDS = 3;
export const STATUS_CONFIRM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Confirmation emails one inbox (`canonicalEmail`) gets in a UTC day, from every page together (counted when sent). */
export const STATUS_CONFIRM_DAILY_CAP = 5;
/** Confirmation emails one page sends to one recipient domain in a UTC day (counted when sent). */
export const STATUS_CONFIRM_PAGE_DOMAIN_DAILY_CAP = 20;
/**
 * Confirmation emails one recipient domain gets in a UTC day from every page together, for a domain that is not a
 * large mail provider (`LARGE_PROVIDERS`): a domain that takes every local part, or one company's, is bounded here.
 */
export const STATUS_CONFIRM_DOMAIN_DAILY_CAP = 50;
/** Confirmed subscribers one page may have; past it a subscribe does nothing (and says the same). */
export const STATUS_SUBSCRIBERS_MAX = 1000;
/** Pending subscribers one page may have at once, counted apart from the confirmed ones. */
export const STATUS_PENDING_MAX = 200;
/** Expired pending subscribers one sweep deletes at most (the rest go in the next). */
export const STATUS_SWEEP_MAX = 500;
/** The longest address accepted (RFC 5321's path limit). */
export const STATUS_EMAIL_MAX = 254;
/** The largest form body read: an address and every component and group ticked. */
const MAX_FORM_LENGTH = 4096;
/** Keys one subscriber follows at most: every component and every group of a full page. */
export const STATUS_FOLLOWS_MAX = 100;

/**
 * An address as stored: trimmed and lower-cased, its domain in ASCII (an internationalized domain as punycode, so
 * both spellings of it are one address); undefined when it is not one.
 */
export function normalizeEmail(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim().toLowerCase();
  if (!/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"/?#%]+$/.test(trimmed)) return undefined;
  const at = trimmed.lastIndexOf("@");
  const domain = asciiDomain(trimmed.slice(at + 1));
  if (!domain) return undefined;
  const email = `${trimmed.slice(0, at)}@${domain}`;
  return email.length <= STATUS_EMAIL_MAX ? email : undefined;
}

/** `domain` in ASCII (IDNA, as a URL's host), with at least two labels and a TLD of two or more; else undefined. */
function asciiDomain(domain: string): string | undefined {
  let host: string;
  try {
    host = new URL(`http://${domain}`).hostname;
  } catch {
    return undefined;
  }
  return /^(?:[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?\.)+(?:[a-z]{2,}|xn--[a-z0-9-]+)$/.test(host)
    ? host
    : undefined;
}

const GMAIL = new Set(["gmail.com", "googlemail.com"]);

/**
 * Large mail providers: the instance-wide per-domain cap (`STATUS_CONFIRM_DOMAIN_DAILY_CAP`) skips them, since
 * one page's sign-ups could otherwise spend it for everyone; each page's own per-domain cap still applies.
 */
const LARGE_PROVIDERS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
]);

/** Whether `domain` (ASCII, lower-cased) is a large mail provider's (`LARGE_PROVIDERS`, and GMX at its country domains). */
export function isLargeProvider(domain: string): boolean {
  return LARGE_PROVIDERS.has(domain) || /^gmx\.(?:[a-z]{2,3}|co\.uk)$/.test(domain);
}

/**
 * The inbox a normalized address reaches, for the caps and for one subscriber per inbox: the `+tag` dropped at every
 * domain (so `a+b@` and `a@` are one inbox even where `+` is a plain character: a rare address loses its own
 * subscription, and no domain gives one inbox many), and at Gmail the dots too (with `googlemail.com` as
 * `gmail.com`). Spellings this cannot see (a custom domain's own dots or aliases, a catch-all, subdomains) are
 * bounded by the per-domain caps instead.
 */
export function canonicalEmail(email: string): string {
  const at = email.lastIndexOf("@");
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL.has(domain)) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
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

type PageFacts = { title: string; locale: "en" | "pt-BR"; groups: FollowGroup[] };

/**
 * What a form asked to follow (`follow`, repeated): the keys the page offers now, once each; null for everything
 * (none ticked, or `scope=all`).
 */
export function chosenFollows(form: URLSearchParams, groups: FollowGroup[]): string[] | null {
  if (form.get("scope") === "all") return null;
  const offered = new Set(
    groups.flatMap((group) => [
      ...(group.key ? [group.key] : []),
      ...group.components.map((component) => component.key),
    ]),
  );
  const keys = [...new Set(form.getAll("follow"))].filter(
    (key) => STATUS_FOLLOW_KEY.test(key) && offered.has(key),
  );
  return keys.length === 0 ? null : keys.slice(0, STATUS_FOLLOWS_MAX);
}

/** A row's `follows` as stored: a JSON array of keys, or null (everything; also anything unreadable). */
export function readFollows(stored: string | null): string[] | null {
  if (stored === null) return null;
  try {
    const keys: unknown = JSON.parse(stored);
    return Array.isArray(keys) && keys.length > 0 && keys.every((key) => typeof key === "string")
      ? keys
      : null;
  } catch {
    return null;
  }
}

/**
 * `/status/:slug/subscribe` (POST, the page's form), `/confirm` (GET shows a button, POST confirms), `/manage` (GET)
 * and `/unsubscribe` (GET shows the manage page and its button, as the emails' footer links there; POST unsubscribes,
 * also RFC 8058's one-click from a mail client). Always an HTML page, never cached. A GET only shows a button, so a
 * mail scanner opening links confirms or unsubscribes nobody. Subscribing needs the public
 * page; the links work from their signed token alone (it names the workspace), so a link keeps working after the page
 * moved to another address or stopped being public.
 */
export async function serveSubscription(
  request: Request,
  env: Env,
  ctx: Pick<ExecutionContext, "waitUntil">,
  slug: string,
  action: SubscriptionAction,
): Promise<Response> {
  const allowed = action === "subscribe" ? ["POST"] : ["GET", "POST"];
  if (!allowed.includes(request.method)) {
    return new Response(null, { status: 405, headers: { Allow: allowed.join(", ") } });
  }
  if (!STATUS_SLUG.test(slug)) return page(404, { kind: "not_found" }, undefined, slug);
  if (action === "subscribe") {
    const facts = await readPage(env, slug);
    if (facts === "unavailable") return page(503, { kind: "unavailable" }, undefined, slug);
    if (!facts) return page(404, { kind: "not_found" }, undefined, slug);
    return subscribe(request, env, ctx, slug, facts);
  }
  const now = Date.now();
  const token = new URL(request.url).searchParams.get("t");
  const kind: LinkKind = action === "confirm" ? "c" : "m";
  const claims = await verifyLink(env.BETTER_AUTH_SECRET, token, kind, now);
  if (!claims) return page(400, { kind: "expired" }, undefined, slug);
  const facts = await linkFacts(env, slug, claims.workspaceId);
  try {
    if (action === "confirm") {
      if (request.method === "GET")
        return page(200, { kind: "confirm", token: token! }, facts, slug);
      return await confirm(env, claims, facts, slug);
    }
    if (action === "manage" && request.method === "POST") {
      return await follow(request, env, claims, token!, facts, slug);
    }
    if (action === "manage" || request.method === "GET") {
      const row = await env.DB.prepare(
        "select email, follows from status_subscriber where id = ? and workspace_id = ?",
      )
        .bind(claims.subscriberId, claims.workspaceId)
        .first<{ email: string; follows: string | null }>();
      if (!row) return page(200, { kind: "unsubscribed" }, facts, slug);
      return page(200, manageView(token!, row, facts), facts, slug);
    }
    return await unsubscribe(env, claims, facts, slug);
  } catch (error) {
    log("a status subscription link failed", { action, error: String(error) });
    return page(503, { kind: "unavailable" }, facts, slug);
  }
}

/**
 * The manage page: the masked address, what it follows (`gone`: it followed only components no longer on the page,
 * so it hears of everything) and, while the page is public at this address, the choice to change it.
 */
function manageView(
  token: string,
  row: { email: string; follows: string | null },
  facts: PageFacts | undefined,
  saved = false,
): SubscriptionPage {
  const follows = readFollows(row.follows);
  const groups = facts?.groups ?? [];
  const offered = new Set(
    groups.flatMap((group) => [
      ...(group.key ? [group.key] : []),
      ...group.components.map((component) => component.key),
    ]),
  );
  const gone = follows !== null && facts !== undefined && !follows.some((key) => offered.has(key));
  return {
    kind: "manage",
    token,
    email: maskEmail(row.email),
    groups,
    follows: gone ? null : follows,
    gone,
    saved,
  };
}

/**
 * The manage page's form: what the subscriber follows from now on (the keys the page offers now, or everything).
 * The shard's event first, then D1, like confirming: saving again after a failure finishes it.
 */
async function follow(
  request: Request,
  env: Env,
  claims: LinkClaims,
  token: string,
  facts: PageFacts | undefined,
  slug: string,
): Promise<Response> {
  const text = await readBounded(request, MAX_FORM_LENGTH);
  if (text === undefined) return page(400, { kind: "invalid" }, facts, slug);
  const row = await env.DB.prepare(
    "select email, follows from status_subscriber where id = ? and workspace_id = ?",
  )
    .bind(claims.subscriberId, claims.workspaceId)
    .first<{ email: string; follows: string | null }>();
  if (!row) return page(200, { kind: "unsubscribed" }, facts, slug);
  // Choosing needs the page's components: without them (the page moved or is not public) nothing changes.
  if (!facts) return page(200, manageView(token, row, facts), facts, slug);
  const follows = chosenFollows(new URLSearchParams(text), facts.groups);
  await shardChange(env, claims.workspaceId, {
    action: "follow",
    subscriberId: claims.subscriberId,
    follows: follows?.length ?? 0,
  });
  const stored = follows === null ? null : JSON.stringify(follows);
  await env.DB.prepare("update status_subscriber set follows = ? where id = ? and workspace_id = ?")
    .bind(stored, claims.subscriberId, claims.workspaceId)
    .run();
  return page(200, manageView(token, { ...row, follows: stored }, facts, true), facts, slug);
}

/** The page's title and language from its snapshot (no shard, no D1); null when there is no public page. */
async function readPage(env: Env, slug: string): Promise<PageFacts | null | "unavailable"> {
  if (!env.STATUS) return null;
  try {
    const stored = await env.STATUS.get(statusKey(slug), { type: "json", cacheTtl: 30 });
    if (stored === null) return null;
    if (!isSnapshot(stored)) return "unavailable";
    return { title: stored.title, locale: stored.locale, groups: followGroups(stored) };
  } catch (error) {
    log("reading a status page for a subscription failed", { error: String(error) });
    return "unavailable";
  }
}

/**
 * The title and language a link's page is shown with: the public page at `slug` when it is still `workspaceId`'s,
 * else none (a plain page in English). Never fails: the link works without them.
 */
async function linkFacts(
  env: Env,
  slug: string,
  workspaceId: string,
): Promise<PageFacts | undefined> {
  try {
    const owner = await env.DB.prepare("select workspace_id from status_slug where slug = ?")
      .bind(slug)
      .first<{ workspace_id: string }>();
    if (owner?.workspace_id !== workspaceId) return undefined;
  } catch (error) {
    log("reading a status page's owner for a link failed", { error: String(error) });
    return undefined;
  }
  const facts = await readPage(env, slug);
  return facts && facts !== "unavailable" ? facts : undefined;
}

/**
 * A visitor asked to subscribe. The answer is the same page, sent at once, whether the address was new, pending,
 * confirmed, capped or the honeypot was filled, so neither the form nor its timing tells anyone who is subscribed:
 * after the rate limits (per address and per page), D1 and the shard run after the answer, under `waitUntil`.
 */
async function subscribe(
  request: Request,
  env: Env,
  ctx: Pick<ExecutionContext, "waitUntil">,
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
  const follows = chosenFollows(form, facts.groups);
  if (!trap) ctx.waitUntil(requestSubscription(env, slug, email, follows, own, Date.now()));
  return page(200, { kind: "check", email }, facts, slug);
}

/**
 * The subscribe's work, after the answer: the row in D1, then the shard's event for a confirmation that should go out.
 * A shard that refuses or cannot be reached gives the confirmation back (`undoRequest`), so asking again sends it.
 * Never throws.
 */
async function requestSubscription(
  env: Env,
  slug: string,
  email: string,
  follows: string[] | null,
  origin: string,
  now: number,
): Promise<void> {
  try {
    const owner = await env.DB.prepare("select workspace_id from status_slug where slug = ?")
      .bind(slug)
      .first<{ workspace_id: string }>();
    if (!owner) return;
    const asked = await recordSubscriber(env.DB, owner.workspace_id, email, origin, now, follows);
    if (!asked) return;
    let result: { ok: true } | { ok: false; code: string };
    try {
      result = await env.WORKSPACE.getByName(owner.workspace_id).statusSubscription(
        owner.workspace_id,
        { action: "request", subscriberId: asked.id, send: asked.send },
      );
    } catch (error) {
      result = { ok: false, code: String(error) };
    }
    if (!result.ok) {
      log("a status subscription was not recorded", { code: result.code });
      await undoRequest(env.DB, asked);
    }
  } catch (error) {
    log("a status subscription failed", { error: String(error) });
  }
}

/** A confirmation asked for (`recordSubscriber`). */
export type SubscriberRequest = { id: string; send: number; created: boolean };

/**
 * Records the address in D1 and says whether a confirmation should go out (and which one, `send`): a new inbox
 * (`canonicalEmail`), or a pending one under `STATUS_CONFIRM_SENDS` in its window. A confirmed inbox, one over its
 * sends, or a full page gets nothing: `STATUS_SUBSCRIBERS_MAX` confirmed or `STATUS_PENDING_MAX` pending. Two
 * requests at once for one inbox insert one row. `follows` (null: everything) is stored with a new row and replaces a
 * pending one's along with the confirmation it is sent, since that is the request its link answers; a confirmed
 * subscriber's is never changed from the public form, which anyone can fill in with their address.
 */
export async function recordSubscriber(
  db: D1Database,
  workspaceId: string,
  email: string,
  origin: string,
  now: number,
  follows: string[] | null = null,
): Promise<SubscriberRequest | null> {
  const stored = follows === null ? null : JSON.stringify(follows);
  type Row = { id: string; status: string; confirm_sends: number; confirm_since: number };
  const canonical = canonicalEmail(email);
  const select = db
    .prepare(
      "select id, status, confirm_sends, confirm_since from status_subscriber where workspace_id = ? and canonical = ?",
    )
    .bind(workspaceId, canonical);
  let row = await select.first<Row>();
  if (!row) {
    const counts = await db
      .prepare(
        `select coalesce(sum(status = 'confirmed'), 0) as confirmed, coalesce(sum(status = 'pending'), 0) as pending
         from status_subscriber where workspace_id = ?`,
      )
      .bind(workspaceId)
      .first<{ confirmed: number; pending: number }>();
    if (
      (counts?.confirmed ?? 0) >= STATUS_SUBSCRIBERS_MAX ||
      (counts?.pending ?? 0) >= STATUS_PENDING_MAX
    ) {
      log("a status page is full: subscription dropped", { workspaceId });
      return null;
    }
    const id = newId("ssb", now, (n) => crypto.getRandomValues(new Uint8Array(n)));
    const inserted = await db
      .prepare(
        `insert into status_subscriber
           (id, workspace_id, email, canonical, status, created_at, confirmed_at, requested_at, confirm_sends,
            confirm_since, origin, follows)
         values (?, ?, ?, ?, 'pending', ?, null, ?, 1, ?, ?, ?)
         on conflict (workspace_id, canonical) do nothing`,
      )
      .bind(id, workspaceId, email, canonical, now, now, now, origin, stored)
      .run();
    if (inserted.meta.changes === 1) return { id, send: 1, created: true };
    row = await select.first<Row>();
    if (!row) return null;
  }
  if (row.status !== "pending") return null;
  const fresh = row.confirm_since + STATUS_CONFIRM_WINDOW_MS <= now;
  const send = fresh ? 1 : row.confirm_sends + 1;
  if (send > STATUS_CONFIRM_SENDS) return null;
  const updated = await db
    .prepare(
      `update status_subscriber set confirm_sends = ?, confirm_since = ?, requested_at = ?, origin = ?, follows = ?
       where id = ? and status = 'pending' and confirm_sends = ?`,
    )
    .bind(send, fresh ? now : row.confirm_since, now, origin, stored, row.id, row.confirm_sends)
    .run();
  return updated.meta.changes === 1 ? { id: row.id, send, created: false } : null;
}

/**
 * Gives back a confirmation the shard never recorded: one send counted back, and a row whose sends all go back to
 * its first window is deleted (an older row, emailed before, stays for the sweep and its `expired` event). It never matches a particular send, so two requests at once that both failed always end with
 * no row (in whichever order they fail), and one that failed beside one that went through leaves the row with the
 * latter's confirmation on its way.
 */
export async function undoRequest(db: D1Database, asked: SubscriberRequest): Promise<void> {
  try {
    await db.batch([
      db
        .prepare(
          `update status_subscriber set confirm_sends = confirm_sends - 1
           where id = ? and status = 'pending' and confirm_sends > 0`,
        )
        .bind(asked.id),
      db
        .prepare(
          `delete from status_subscriber
           where id = ? and status = 'pending' and confirm_sends = 0 and confirm_since = created_at`,
        )
        .bind(asked.id),
    ]);
  } catch (error) {
    log("giving back a status confirmation failed", { error: String(error) });
  }
}

/**
 * The shard first, then D1, so a failure in between is mended by trying again: the shard records each subscriber's
 * confirmation and removal once (`statusSubscription`), and D1's write is the one that is retried.
 */
async function confirm(
  env: Env,
  claims: LinkClaims,
  facts: PageFacts | undefined,
  slug: string,
): Promise<Response> {
  const row = await env.DB.prepare(
    "select status from status_subscriber where id = ? and workspace_id = ?",
  )
    .bind(claims.subscriberId, claims.workspaceId)
    .first<{ status: string }>();
  if (!row) return page(400, { kind: "expired" }, facts, slug);
  if (row.status === "confirmed") return page(200, { kind: "confirmed" }, facts, slug);
  await shardChange(env, claims.workspaceId, {
    action: "confirm",
    subscriberId: claims.subscriberId,
  });
  await env.DB.prepare(
    `update status_subscriber set status = 'confirmed', confirmed_at = ?
     where id = ? and workspace_id = ? and status = 'pending'`,
  )
    .bind(Date.now(), claims.subscriberId, claims.workspaceId)
    .run();
  return page(200, { kind: "confirmed" }, facts, slug);
}

async function unsubscribe(
  env: Env,
  claims: LinkClaims,
  facts: PageFacts | undefined,
  slug: string,
): Promise<Response> {
  const row = await env.DB.prepare(
    "select id from status_subscriber where id = ? and workspace_id = ?",
  )
    .bind(claims.subscriberId, claims.workspaceId)
    .first<{ id: string }>();
  if (row) {
    await shardChange(env, claims.workspaceId, {
      action: "remove",
      subscriberId: claims.subscriberId,
      reason: "unsubscribed",
    });
    await env.DB.prepare("delete from status_subscriber where id = ? and workspace_id = ?")
      .bind(claims.subscriberId, claims.workspaceId)
      .run();
  }
  return page(200, { kind: "unsubscribed" }, facts, slug);
}

type SubscriberChange = Parameters<WorkspaceDO["statusSubscription"]>[1];

/** Runs `change` in the workspace's shard; throws when it was not recorded (a workspace that is gone counts as done). */
async function shardChange(
  env: Env,
  workspaceId: string,
  change: SubscriberChange,
  actor?: Actor,
): Promise<void> {
  const result = await env.WORKSPACE.getByName(workspaceId).statusSubscription(
    workspaceId,
    change,
    actor,
  );
  if (!result.ok && result.code !== "not_found") {
    throw new Error(`the shard refused the change: ${result.code}`);
  }
}

/**
 * Deletes pending subscribers whose confirmation link has expired (`STATUS_CONFIRM_TTL_MS` after it was asked for),
 * at most `STATUS_SWEEP_MAX` a run, each with its `status_subscriber.removed` event (`expired`) from its shard first;
 * then the confirmation counts of days gone. Run from the API's cron; throws on a D1 failure (the next run carries on).
 */
export async function sweepSubscribers(env: Env, now: number): Promise<void> {
  const cutoff = now - STATUS_CONFIRM_TTL_MS;
  const { results } = await env.DB.prepare(
    `select id, workspace_id, requested_at from status_subscriber where status = 'pending' and requested_at <= ?
     order by requested_at limit ?`,
  )
    .bind(cutoff, STATUS_SWEEP_MAX)
    .all<{ id: string; workspace_id: string; requested_at: number }>();
  const byWorkspace = new Map<string, { id: string; requested_at: number }[]>();
  for (const row of results) {
    byWorkspace.set(row.workspace_id, [...(byWorkspace.get(row.workspace_id) ?? []), row]);
  }
  for (const [workspaceId, rows] of byWorkspace) {
    const ids = rows.map((row) => row.id);
    try {
      const result = await env.WORKSPACE.getByName(workspaceId).expireStatusSubscribers(
        workspaceId,
        ids,
      );
      if (!result.ok && result.code !== "not_found") {
        log("expiring status subscribers was refused", { workspaceId, code: result.code });
        continue;
      }
    } catch (error) {
      log("expiring status subscribers failed", { workspaceId, error: String(error) });
      continue;
    }
    // Only rows still as they were read: one asked for again meanwhile keeps its new confirmation.
    await env.DB.batch(
      rows.map((row) =>
        env.DB.prepare(
          "delete from status_subscriber where id = ? and status = 'pending' and requested_at = ?",
        ).bind(row.id, row.requested_at),
      ),
    );
  }
  const yesterday = new Date(now - 86_400_000).toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare("delete from status_confirmation_send where day < ?").bind(yesterday),
    env.DB.prepare("delete from status_confirmation_domain where day < ?").bind(yesterday),
    env.DB.prepare("delete from status_confirmation_page_domain where day < ?").bind(yesterday),
  ]);
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
      // Who follows what, confirmed only: every key with its count, and those following everything.
      const [follows, everything] = await env.DB.batch<{ key?: string; n: number }>([
        env.DB.prepare(
          `select each.value as key, count(*) as n from status_subscriber, json_each(status_subscriber.follows) as each
           where workspace_id = ? and status = 'confirmed' and json_valid(follows) group by each.value`,
        ).bind(workspaceId),
        env.DB.prepare(
          `select count(*) as n from status_subscriber
           where workspace_id = ? and status = 'confirmed' and (follows is null or not json_valid(follows))`,
        ).bind(workspaceId),
      ]);
      return json({
        confirmed: count("confirmed"),
        pending: count("pending"),
        everything: everything?.results[0]?.n ?? 0,
        follows: Object.fromEntries(
          (follows?.results ?? []).flatMap((row) =>
            typeof row.key === "string" ? [[row.key, row.n]] : [],
          ),
        ),
      });
    }
    if (exporting) {
      const { results } = await env.DB.prepare(
        `select email, status, created_at, confirmed_at, follows from status_subscriber
         where workspace_id = ? order by created_at, id`,
      )
        .bind(workspaceId)
        .all<{
          email: string;
          status: string;
          created_at: number;
          confirmed_at: number | null;
          follows: string | null;
        }>();
      // The names the keys stand for now, from the shard: a key whose component or group is gone is left out.
      const names: Record<string, string> = results.some((row) => row.follows !== null)
        ? await env.WORKSPACE.getByName(workspaceId).statusFollowNames(workspaceId)
        : {};
      const iso = (at: number | null) => (at === null ? "" : new Date(at).toISOString());
      const followed = (stored: string | null) => {
        const named = (readFollows(stored) ?? []).flatMap((key) => names[key] ?? []);
        return named.length === 0 ? "everything" : named.join("; ");
      };
      const lines = [
        "email,status,subscribed_at,confirmed_at,follows",
        ...results.map((row) =>
          [
            csv(row.email),
            row.status,
            iso(row.created_at),
            iso(row.confirmed_at),
            csv(followed(row.follows)),
          ].join(","),
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
    // Any spelling of the inbox finds it. The shard first, then D1: deleting again after a failure finishes it.
    const row = await env.DB.prepare(
      "select id from status_subscriber where workspace_id = ? and canonical = ?",
    )
      .bind(workspaceId, canonicalEmail(email))
      .first<{ id: string }>();
    if (!row) return json({ error: "not_found" }, 404);
    await shardChange(
      env,
      workspaceId,
      { action: "remove", subscriberId: row.id, reason: "deleted" },
      { kind: "user", id: session.user.id, role },
    );
    await env.DB.prepare("delete from status_subscriber where id = ? and workspace_id = ?")
      .bind(row.id, workspaceId)
      .run();
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
