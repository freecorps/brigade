// The first owner (src/bootstrap.ts, RFC 0002 "The first owner"): `POST /setup/first-user` with the BOOTSTRAP_TOKEN
// secret, on an instance with no user yet. Every test starts from an empty D1.
import { env } from "cloudflare:workers";
import { createExecutionContext, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vite-plus/test";
import { bootstrapFirstUser } from "../src/bootstrap.ts";
import worker, { workerAuth } from "../src/index.ts";
import type { WorkspaceDO } from "../src/workspace.ts";
import { sessionCookie } from "./session.ts";

const ORIGIN = "http://api.test";
/** Test-only, made up: 43 characters, like `openssl rand -base64 32`. */
const TOKEN = "test-bootstrap-token-not-a-real-secret-0000";
const PASSWORD = "a strong password the script generated";

const FIRST = {
  email: "owner@example.com",
  name: "Owner",
  workspace: "Brigade",
  password: PASSWORD,
};

beforeEach(async () => {
  await env.DB.batch(
    ["member", "invitation", "session", "account", "organization", "user", "rateLimit"].map(
      (table) => env.DB.prepare(`delete from "${table}"`),
    ),
  );
});

function setup(
  body: unknown = FIRST,
  { token = TOKEN, secret = TOKEN as string | null, method = "POST" } = {},
) {
  // null: the secret is not set.
  const { BOOTSTRAP_TOKEN: _unset, ...rest } = env as typeof env & { BOOTSTRAP_TOKEN?: string };
  const instance = (secret === null ? rest : { ...rest, BOOTSTRAP_TOKEN: secret }) as typeof env;
  const request = new Request(`${ORIGIN}/setup/first-user`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  }) as Parameters<typeof worker.fetch>[0];
  return worker.fetch(request, instance, createExecutionContext());
}

const count = async (table: string) =>
  (await env.DB.prepare(`select count(*) as n from "${table}"`).first<{ n: number }>())!.n;

describe("POST /setup/first-user", () => {
  test("creates the owner, verified, with a workspace and its shard; signs in with the password", async () => {
    const response = await setup();
    expect(response.status).toBe(201);
    const body = (await response.json()) as { userId: string; workspaceId: string; email: string };
    expect(body).toEqual({
      userId: expect.stringMatching(/^usr_/),
      workspaceId: expect.stringMatching(/^ws_/),
      email: "owner@example.com",
    });
    expect(JSON.stringify(body)).not.toContain(PASSWORD);
    const user = await env.DB.prepare(`select name, "emailVerified" from "user" where id = ?`)
      .bind(body.userId)
      .first<{ name: string; emailVerified: number }>();
    expect(user).toEqual({ name: "Owner", emailVerified: 1 });
    // Only Better Auth's hash is stored.
    const account = await env.DB.prepare(`select password from account where "userId" = ?`)
      .bind(body.userId)
      .first<{ password: string }>();
    expect(account?.password).toBeTruthy();
    expect(account?.password).not.toContain(PASSWORD);
    const member = await env.DB.prepare(
      `select m.role, o.name from member m join organization o on o.id = m."organizationId"
       where m."userId" = ?`,
    )
      .bind(body.userId)
      .first<{ role: string; name: string }>();
    expect(member).toEqual({ role: "owner", name: "Brigade" });
    // The shard was provisioned.
    const provisioned = await runInDurableObject(
      env.WORKSPACE.getByName(body.workspaceId),
      (_instance: WorkspaceDO, state) =>
        state.storage.sql.exec<{ n: number }>("select count(*) as n from shard_meta").one().n,
    );
    expect(provisioned).toBeGreaterThan(0);
    await expect(sessionCookie("owner@example.com", PASSWORD)).resolves.toContain("session_token");
  });

  test("refused once any user exists, however it came", async () => {
    expect((await setup()).status).toBe(201);
    const again = await setup({ ...FIRST, email: "second@example.com" });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "already_set_up" });
    expect(await count("user")).toBe(1);
  });

  test("two at once: one owner", async () => {
    const statuses = await Promise.all([
      setup({ ...FIRST, email: "one@example.com" }),
      setup({ ...FIRST, email: "two@example.com" }),
    ]).then((responses) => responses.map((response) => response.status).sort((a, b) => a - b));
    expect(statuses).toEqual([201, 409]);
    expect(await count("user")).toBe(1);
  });

  test("a run that fails leaves no user, workspace or latch, so the script can run again", async () => {
    const failing = (auth: () => ReturnType<typeof workerAuth>) =>
      bootstrapFirstUser(
        new Request(`${ORIGIN}/setup/first-user`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify(FIRST),
        }),
        TOKEN,
        env.DB,
        auth,
      );
    const request = new Request(ORIGIN);
    // The shard fails after Better Auth made the workspace.
    const shardFails = await failing(() =>
      workerAuth(env, createExecutionContext(), request, async () => {
        throw new Error("shard down");
      }),
    );
    expect(shardFails.status).toBe(500);
    // Better Auth itself fails, before any user.
    const authFails = await failing(() => {
      throw new Error("auth down");
    });
    expect(authFails.status).toBe(500);
    for (const table of ["user", "account", "member", "organization", "rateLimit"]) {
      expect(await count(table)).toBe(0);
    }
    expect((await setup()).status).toBe(201);
  });

  test("a latch left by a run that died is taken over after five minutes", async () => {
    const hold = (at: number) =>
      env.DB.prepare(
        `insert into "rateLimit" (id, key, count, "lastRequest") values ('rl_test', 'setup:first-user', 1, ?)
         on conflict (key) do update set "lastRequest" = excluded."lastRequest"`,
      )
        .bind(at)
        .run();
    await hold(Date.now() - 60_000);
    const busy = await setup();
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({ error: "setup_in_progress" });
    await hold(Date.now() - 6 * 60_000);
    expect((await setup()).status).toBe(201);
  });

  test("a secret stored with a trailing newline still matches", async () => {
    expect((await setup(FIRST, { secret: `${TOKEN}\n` })).status).toBe(201);
  });

  test("does not exist without the secret", async () => {
    const response = await setup(FIRST, { secret: null });
    expect(response.status).toBe(404);
    expect(await count("user")).toBe(0);
  });

  test("a wrong or missing token is refused", async () => {
    for (const token of ["wrong", `${TOKEN}x`, TOKEN.slice(0, -1), ""]) {
      expect((await setup(FIRST, { token })).status).toBe(401);
    }
    expect(await count("user")).toBe(0);
  });

  test("a secret too short to be safe is a configuration error", async () => {
    const response = await setup(FIRST, { token: "short", secret: "short" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "bootstrap_token_too_short" });
  });

  test("checks what it is given", async () => {
    for (const body of [
      { ...FIRST, email: "not an address" },
      { ...FIRST, password: "short" },
      { ...FIRST, password: "x".repeat(129) },
      { ...FIRST, name: "" },
      { ...FIRST, workspace: "" },
      "nonsense",
    ]) {
      expect((await setup(body)).status).toBe(400);
    }
    expect(await count("user")).toBe(0);
    // Nothing held: a good request still goes through.
    expect((await setup()).status).toBe(201);
  });

  test("only POST", async () => {
    expect((await setup(FIRST, { method: "GET" })).status).toBe(405);
  });
});
