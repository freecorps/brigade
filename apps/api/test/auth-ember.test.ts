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
import {
  COPY_GRACE_MS,
  copyUser,
  EMBER_AUTH_PROJECT,
  findSession,
  secureCookies,
} from "../src/auth-ember.ts";
import { sessionCookie } from "./session.ts";
import { exports } from "cloudflare:workers";
import { WORKSPACE_LIMIT } from "../src/auth.ts";
import worker, { authEngine } from "../src/index.ts";
import { createWorkspaceInD1 } from "../src/workspace-create.ts";

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

/** A Worker route (not `/auth`) on the Ember engine. */
async function route(
  path: string,
  cookie?: string,
  headers: Record<string, string> = {},
  init: { method?: string; body?: unknown } = {},
) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Origin: ORIGIN,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
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

describe("sessions on the Ember engine", () => {
  test("the Worker's routes read the request's session on the object", async () => {
    const gil = await signUp("Gil");
    expect(await (await route("/workspaces", gil.cookie)).json()).toEqual({ workspaces: [] });
    // A workspace of Gil's in D1 (where workspaces stay), joined with D1's copy of Gil.
    const id = `ws_01M5W19VG0081040G2081040${String(people).padStart(2, "0")}`;
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `insert into organization (id, name, slug, "createdAt") values (?, 'Gil Ops', ?, ?)`,
      ).bind(id, `ws-${id}`, now),
      env.DB.prepare(
        `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, 'owner', ?)`,
      ).bind(`mem_${id.slice(3)}`, id, gil.id, now),
    ]);
    expect(await (await route("/workspaces", gil.cookie)).json()).toEqual({
      workspaces: [{ id, name: "Gil Ops", role: "owner" }],
    });
    expect((await route("/workspaces")).status).toBe(401);
  });

  test("an Authorization header never replaces the session cookie (Ember's bearer plugin)", async () => {
    const hal = await signUp("Hal");
    const response = await route("/workspaces", hal.cookie, {
      Authorization: "Bearer brg_notasession",
    });
    expect(response.status).toBe(200);
  });

  test("findSession finds a session by id on either engine, and none once it ended", async () => {
    // On the object.
    const ivo = await signUp("Ivo");
    const onObject = (await (await call("/get-session", undefined, ivo.cookie, "GET")).json()) as {
      session: { id: string };
    };
    const found = await findSession(ember, onObject.session.id);
    expect(found?.userId).toBe(ivo.id);
    expect(found!.expiresAt).toBeGreaterThan(Date.now());
    expect((await call("/sign-out", {}, ivo.cookie)).status).toBe(200);
    expect(await findSession(ember, onObject.session.id)).toBeNull();

    // On D1.
    const email = address("Jade");
    const up = await exports.default.fetch(`${ORIGIN}/auth/sign-up/email`, {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        "Content-Type": "application/json",
        "cf-connecting-ip": clientIp(),
      },
      body: JSON.stringify({ name: "Jade", email, password: PASSWORD }),
    });
    const { user } = (await up.json()) as { user: { id: string } };
    const cookie = await sessionCookie(email, PASSWORD);
    const onD1 = (await (
      await exports.default.fetch(`${ORIGIN}/auth/get-session`, { headers: { Cookie: cookie } })
    ).json()) as { session: { id: string } };
    expect((await findSession(env, onD1.session.id))?.userId).toBe(user.id);
    expect(await findSession(env, "ses_01M5W19VG0081040G2081040G2")).toBeNull();
  });
});

describe("workspaces on the Ember engine", () => {
  const create = (cookie: string, name: string) =>
    route("/workspaces", cookie, {}, { method: "POST", body: { name } });

  test("POST /workspaces makes the workspace in D1 with its owner, and provisions its shard", async () => {
    const kai = await signUp("Kai");
    const created = await create(kai.cookie, "  Kai Ops  ");
    expect(created.status).toBe(201);
    const { id, name } = (await created.json()) as { id: string; name: string };
    expect(id).toMatch(/^ws_/);
    expect(name).toBe("Kai Ops");
    expect(await (await route("/workspaces", kai.cookie)).json()).toEqual({
      workspaces: [{ id, name: "Kai Ops", role: "owner" }],
    });
    // The shard has it, in the owner's language (Kai signed up in pt-BR).
    await runInDurableObject(env.WORKSPACE.getByName(id), (_instance, state) => {
      const meta = state.storage.sql
        .exec<{ value: string }>("select value from shard_meta where key = 'workspace'")
        .one();
      expect(meta.value).toBe(id);
      const [event] = state.storage.sql
        .exec<{ event: string }>("select event from outbox")
        .toArray()
        .map((row) => JSON.parse(row.event) as { type: string; data: { locale: string } });
      expect(event).toMatchObject({ type: "workspace.created", data: { locale: "pt-BR" } });
    });
    expect((await create(kai.cookie, "\u202e")).status).toBe(400);
    expect(
      (await route("/workspaces", undefined, {}, { method: "POST", body: { name: "X" } })).status,
    ).toBe(401);
  });

  test(`no more than ${WORKSPACE_LIMIT} workspaces each, even created at once`, async () => {
    const lia = await signUp("Lia");
    const statuses = await Promise.all(
      Array.from({ length: WORKSPACE_LIMIT + 2 }, (_, i) => create(lia.cookie, `Team ${i}`)),
    ).then((responses) => responses.map((response) => response.status));
    expect(statuses.filter((status) => status === 201)).toHaveLength(WORKSPACE_LIMIT);
    expect(statuses.filter((status) => status === 403)).toHaveLength(2);
    const memberships = await env.DB.prepare(`select count(*) as n from member where "userId" = ?`)
      .bind(lia.id)
      .first<{ n: number }>();
    expect(memberships?.n).toBe(WORKSPACE_LIMIT);
  });

  test("a workspace whose shard could not be provisioned is deleted again", async () => {
    const max = await signUp("Max");
    const created = await createWorkspaceInD1(env.DB, { id: max.id, locale: "en" }, "Doomed", () =>
      Promise.reject(new Error("shard down")),
    );
    expect(created).toEqual({ ok: false, code: "internal" });
    const rows = await env.DB.prepare(
      `select (select count(*) from organization where name = 'Doomed') as workspaces,
              (select count(*) from member where "userId" = ?) as memberships`,
    )
      .bind(max.id)
      .first<{ workspaces: number; memberships: number }>();
    expect(rows).toEqual({ workspaces: 0, memberships: 0 });
  });
});

describe("QR sign-in on the Ember engine", () => {
  const phoneUA = { "User-Agent": "Brigade/1.0 (iPhone)" };

  async function approved(owner: { cookie: string }) {
    const created = await route("/app-sign-in", owner.cookie, {}, { method: "POST" });
    expect(created.status).toBe(201);
    const { id, code } = (await created.json()) as { id: string; code: string };
    const claim = await route("/app-sign-in/claim", undefined, phoneUA, {
      method: "POST",
      body: { code, deviceName: "Nia's iPhone" },
    });
    expect(claim.status).toBe(201);
    const phone = (await claim.json()) as { claimId: string; secret: string; number: string };
    const approval = await route(
      `/app-sign-in/${id}/approve`,
      owner.cookie,
      {},
      {
        method: "POST",
        body: { number: phone.number },
      },
    );
    expect(approval.status).toBe(200);
    return phone;
  }

  const poll = (phone: { claimId: string; secret: string }) =>
    route(`/app-sign-in/claim/${phone.claimId}`, undefined, {
      ...phoneUA,
      Authorization: `Bearer ${phone.secret}`,
    });

  test("the phone gets a session made on the object, with the project's cookie", async () => {
    const nia = await signUp("Nia");
    const answer = (await (await poll(await approved(nia))).json()) as {
      status: string;
      session: { cookie: string };
      user: { id: string };
    };
    expect(answer).toMatchObject({ status: "approved", user: { id: nia.id } });
    const cookie = answer.session.cookie.split(";")[0]!;
    expect(cookie).toMatch(new RegExp(`^${EMBER_AUTH_PROJECT}\\.session_token=`));
    const session = (await (await call("/get-session", undefined, cookie, "GET")).json()) as {
      user: { id: string };
      session: { deviceName: string; signInMethod: string };
    };
    expect(session.user.id).toBe(nia.id);
    expect(session.session).toMatchObject({ deviceName: "Nia's iPhone", signInMethod: "qr" });
  });

  test("a dashboard signed out before the pickup leaves the phone without a session", async () => {
    const oto = await signUp("Oto");
    const phone = await approved(oto);
    expect((await call("/sign-out", {}, oto.cookie)).status).toBe(200);
    expect(await (await poll(phone)).json()).toMatchObject({
      status: "expired",
      reason: "signed_out",
    });
  });
});
