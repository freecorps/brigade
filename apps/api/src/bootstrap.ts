// The first user (RFC 0002 "Auth", "The first owner"): `POST /setup/first-user`, called once by
// scripts/create-first-user.mjs on a new instance, whose sign-up is closed by default. It creates the first account
// (its address verified) and its workspace, with the account as owner, and refuses for good once any user exists.
//
// Only with the `BOOTSTRAP_TOKEN` secret set (otherwise the route does not exist), sent as `Authorization: Bearer`,
// compared in constant time. The password comes in the body and is stored only as Better Auth's hash.

import { memberName, workspaceName } from "@freecorps/brigade-schema";
import { authId, type Auth } from "./auth.ts";
import { readBounded } from "./body.ts";

export const BOOTSTRAP_PATH = "/setup/first-user";

/** A token shorter than this is refused as a configuration error: it could be guessed. */
export const BOOTSTRAP_TOKEN_MIN = 32;

/** The `rateLimit` row that lets one bootstrap run at a time (a latch, dropped when a run fails). */
const LATCH_KEY = "setup:first-user";

const MAX_BODY = 4096;
/** Better Auth's password lengths (`minPasswordLength`, `maxPasswordLength`), as its sign-up checks them. */
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

/**
 * `POST /setup/first-user` `{ email, name, workspace, password }`, `Authorization: Bearer <BOOTSTRAP_TOKEN>`:
 * 201 `{ userId, workspaceId, email }`. 404 without the secret; 401 for a wrong token; 409 `already_set_up` once any
 * user exists (or while another run holds the latch); 400 `invalid_args`; 503 `bootstrap_token_too_short` for a
 * secret shorter than `BOOTSTRAP_TOKEN_MIN`.
 */
export async function bootstrapFirstUser(
  request: Request,
  token: string | undefined,
  db: D1Database,
  lazyAuth: () => Auth,
): Promise<Response> {
  if (!token) return json({ error: "not_found" }, 404);
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  if (token.length < BOOTSTRAP_TOKEN_MIN) {
    return json({ error: "bootstrap_token_too_short" }, 503);
  }
  const sent = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? "";
  if (!(await sameSecret(sent, token))) return json({ error: "unauthenticated" }, 401);

  const text = await readBounded(request, MAX_BODY);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text ?? "");
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_args" }, 400);
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = memberName(body.name, "name");
  const workspace = workspaceName(body.workspace, "workspace");
  const password = body.password;
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+$/.test(email) ||
    !name.ok ||
    !workspace.ok ||
    typeof password !== "string" ||
    password.length < PASSWORD_MIN ||
    password.length > PASSWORD_MAX
  ) {
    return json({ error: "invalid_args" }, 400);
  }

  // One run at a time: two calls at once could both find no user. The latch is a `rateLimit` row (the cron prunes it
  // after two days, by then long unneeded), kept after a success.
  const now = Date.now();
  const latch = await db
    .prepare(
      `insert into "rateLimit" (id, key, count, "lastRequest") values (?, ?, 1, ?)
       on conflict (key) do nothing returning id`,
    )
    .bind(authId("rateLimit", now, randomBytes), LATCH_KEY, now)
    .first();
  if (!latch) return json({ error: "already_set_up" }, 409);
  const release = () => db.prepare(`delete from "rateLimit" where key = ?`).bind(LATCH_KEY).run();

  let userId: string | undefined;
  try {
    const users = await db.prepare(`select count(*) as n from "user"`).first<{ n: number }>();
    // Kept: the instance is set up, so the latch stays claimed for good.
    if ((users?.n ?? 0) > 0) return json({ error: "already_set_up" }, 409);

    const auth = lazyAuth();
    const context = await auth.$context;
    const hash = await context.password.hash(password);
    const user = await context.internalAdapter.createUser(
      {
        email,
        name: name.value,
        emailVerified: true,
      },
      { method: "email-password" },
    );
    userId = user.id;
    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: hash,
    });
    // Server-side with `userId`: Better Auth's own create, so the organization hooks run (the name check, the shard).
    const created = await auth.api.createOrganization({
      body: { name: workspace.value, slug: `ws-${crypto.randomUUID()}`, userId: user.id },
    });
    if (!created) throw new Error("no workspace");
    return json({ userId: user.id, workspaceId: created.id, email }, 201);
  } catch (error) {
    console.error(
      JSON.stringify({ message: "creating the first user failed", error: String(error) }),
    );
    // Back to no user, so the script can run again: any workspace the run made (the only ones on a new instance),
    // then the user, whose accounts, sessions and memberships go with it (`on delete cascade`).
    if (userId) {
      await db.batch([
        db
          .prepare(
            `delete from organization where id in (select "organizationId" from member where "userId" = ?)`,
          )
          .bind(userId),
        db.prepare(`delete from "user" where id = ?`).bind(userId),
      ]);
    }
    await release();
    return json({ error: "internal" }, 500);
  }
}

/** Compares a sent secret with the expected one in constant time (both hashed first, so lengths match). */
async function sameSecret(sent: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(sent)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
