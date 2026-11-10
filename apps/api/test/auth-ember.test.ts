// Better Auth in Ember's `Auth` object (RFC 0017, src/auth-ember.ts), as `/auth` serves it once `AUTH_ENGINE` is
// `ember`: Brigade's rules on the object, the cookie named after the project, and D1's copy of `user` kept, by the hook
// and, when that copy is lost, by the object's alarm.
import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  runDurableObjectAlarm,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { USER_JOURNAL_TABLE } from "@freecorps/ember-auth";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { COPY_GRACE_MS, copyUser, EMBER_AUTH_PROJECT, secureCookies } from "../src/auth-ember.ts";
import worker, { authEngine } from "../src/index.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";

/** The Worker's env with the Ember engine on; a plain object, so nothing writes through to the real env. */
const ember = { ...env, AUTH_ENGINE: "ember" } as Env;

let people = 0;
const address = (name: string) => `${name.toLowerCase()}-e${++people}@example.com`;
let ips = 0;
const clientIp = () => `198.51.100.${(++ips % 250) + 1}`;

async function call(path: string, body?: unknown, cookie?: string, method = "POST") {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${ORIGIN}/auth${path}`, {
      method,
      headers: {
        Origin: ORIGIN,
        "cf-connecting-ip": clientIp(),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    ember,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

async function signUp(name: string, email = address(name)) {
  const up = await call("/sign-up/email", { name, email, password: PASSWORD, locale: "pt-BR" });
  expect(up.status).toBe(200);
  const { user } = (await up.json()) as { user: { id: string } };
  const signedIn = await call("/sign-in/email", { email, password: PASSWORD });
  expect(signedIn.status).toBe(200);
  return { id: user.id, email, cookie: cookieOf(signedIn) };
}

const copied = (id: string) =>
  env.DB.prepare(
    `select id, name, email, "emailVerified", locale, "createdAt", "updatedAt" from "user" where id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      name: string;
      email: string;
      emailVerified: number;
      locale: string | null;
    }>();

const authObject = () => env.AUTH.getByName("auth");

const journal = () =>
  runInDurableObject(
    authObject(),
    (_instance, state) =>
      state.storage.sql
        .exec<{ n: number }>(`SELECT count(*) AS n FROM "${USER_JOURNAL_TABLE}"`)
        .one().n,
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Ember engine", () => {
  test("its cookies are Secure where the instance is served over HTTPS", () => {
    expect(secureCookies({ DASHBOARD_URL: "https://brigade.example.com" })).toBe(true);
    expect(secureCookies({ DASHBOARD_URL: "http://localhost:5173" })).toBe(false);
    expect(secureCookies({})).toBe(false);
  });

  test("is off unless AUTH_ENGINE says ember", () => {
    expect(authEngine(env)).toBe("d1");
    expect(authEngine(ember)).toBe("ember");
  });

  test("signs up and in on the object, with the project's cookie, and D1 gets the user's copy", async () => {
    const ana = await signUp("Ana");
    expect(ana.cookie).toMatch(new RegExp(`^${EMBER_AUTH_PROJECT}\\.session_token=`));

    const session = await call("/get-session", undefined, ana.cookie, "GET");
    expect(await session.json()).toMatchObject({ user: { id: ana.id, email: ana.email } });

    expect(await copied(ana.id)).toMatchObject({
      id: ana.id,
      name: "Ana",
      email: ana.email,
      emailVerified: 0,
      locale: "pt-BR",
    });
    // The hook wrote the copy: nothing left for the alarm.
    expect(await journal()).toBe(0);
  });

  test("a profile change reaches D1's copy", async () => {
    const bia = await signUp("Bia");
    const updated = await call("/update-user", { name: "Bia Lima", locale: "en" }, bia.cookie);
    expect(updated.status).toBe(200);
    expect(await copied(bia.id)).toMatchObject({ name: "Bia Lima", locale: "en" });
  });

  test("Brigade's rules run on the object: a bad name is refused", async () => {
    const refused = await call("/sign-up/email", {
      name: "Eve‮",
      email: address("Eve"),
      password: PASSWORD,
    });
    expect(refused.status).toBe(400);
  });

  test("the workspaces stay Brigade's: no organization routes", async () => {
    const caio = await signUp("Caio");
    const list = await call("/organization/list", undefined, caio.cookie, "GET");
    expect(list.status).toBe(404);
  });

  test("signing out ends the session on the object", async () => {
    const dora = await signUp("Dora");
    const out = await call("/sign-out", {}, dora.cookie);
    expect(out.status).toBe(200);
    const session = await call("/get-session", undefined, dora.cookie, "GET");
    expect(await session.json()).toBeNull();
  });

  test("a copy D1 refuses fails no request: the journal keeps it for the alarm", async () => {
    const fia = await signUp("Fia");
    const prepare = env.DB.prepare.bind(env.DB);
    vi.spyOn(env.DB, "prepare").mockImplementation((query: string) => {
      if (query.includes(`insert into "user"`)) throw new Error("D1 unavailable");
      return prepare(query);
    });
    const updated = await call("/update-user", { name: "Fia Souza" }, fia.cookie);
    expect(updated.status).toBe(200);
    vi.restoreAllMocks();
    expect((await copied(fia.id))?.name).toBe("Fia");
    expect(await journal()).toBe(1);
    // Due once the grace has passed: then the alarm writes it.
    await runInDurableObject(authObject(), (_instance, state) => {
      state.storage.sql.exec(
        `UPDATE "${USER_JOURNAL_TABLE}" SET at = ?`,
        Date.now() - COPY_GRACE_MS - 1,
      );
    });
    expect(await runDurableObjectAlarm(authObject())).toBe(true);
    expect((await copied(fia.id))?.name).toBe("Fia Souza");
    expect(await journal()).toBe(0);
  });

  test("a copy D1 never got is written by the object's alarm, from the user's current row", async () => {
    const enzo = await signUp("Enzo");
    // As if the hook had died before D1 took the copy: the journal row stays, and D1 has an older name.
    await env.DB.prepare(`update "user" set name = 'stale', "updatedAt" = ? where id = ?`)
      .bind("2000-01-01T00:00:00.000Z", enzo.id)
      .run();
    await runInDurableObject(authObject(), (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO "${USER_JOURNAL_TABLE}" (user_id, event, at, data) VALUES (?, 'update', ?, NULL)`,
        enzo.id,
        Date.now() - COPY_GRACE_MS - 1,
      );
      // What the object's next start does with a journal row left behind.
      return state.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(authObject())).toBe(true);
    expect((await copied(enzo.id))?.name).toBe("Enzo");
    expect(await journal()).toBe(0);
  });
});

describe("copyUser", () => {
  test("never puts an older copy over a newer one", async () => {
    const row = (name: string, updatedAt: Date) => ({
      id: `usr_copy${++people}`,
      name,
      email: address("Copy"),
      emailVerified: true,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt,
    });
    const newer = row("Newer", new Date("2026-02-02T00:00:00Z"));
    await copyUser(env.DB, newer);
    await copyUser(env.DB, {
      ...newer,
      name: "Older",
      updatedAt: new Date("2026-01-15T00:00:00Z"),
    });
    expect(await copied(newer.id)).toMatchObject({ name: "Newer", emailVerified: 1 });
  });
});
