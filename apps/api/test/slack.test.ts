// Slack's side of the API (RFC 0011): starting and finishing an install, the actions Slack users run as members
// (the same mutations, RBAC and events as the dashboard), and the incident message the queue consumer posts and
// updates, idempotently, without ever getting in the way of a page.
import { env, exports } from "cloudflare:workers";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runInDurableObject,
} from "cloudflare:test";
import { generateRecipient, toBase64url } from "@freecorps/brigade-push";
import { newId, SLACK_ROW_ID, type Actor } from "@freecorps/brigade-schema";
import type { SlackActResult } from "@freecorps/brigade-slack/bridge";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { clearPeople } from "@freecorps/brigade-slack/people";
import { consumeEvents, QUEUE_MAX_RETRIES, SLACK_BUDGET_MS, type Fetch } from "../src/notify.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { Shard } from "../src/shard.ts";
import { SLACK_MAX_ATTEMPTS } from "../src/slack.ts";
import {
  beginSlackInstall,
  completeSlackInstall,
  slackAct,
  slackConnection,
  slackReplyLocale,
  SLACK_STATE_COOKIE,
} from "../src/slack-bridge.ts";
import { workerAuth } from "../src/index.ts";
import type { WorkspaceDO } from "../src/workspace.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";
const BOT_TOKEN = "xoxb-test-token-not-real";
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

afterEach(() => {
  vi.restoreAllMocks();
  clearPeople();
});

let people = 0;
let clients = 0;
let teams = 0;
/** A new client IP (TEST-NET-3) per call: sign-up is rate-limited per IP. */
const clientIp = () => `203.0.${Math.floor(++clients / 250) % 250}.${(clients % 250) + 1}`;
/** A new made-up Slack team id per call, so tests never share one. */
const newTeam = () => `T0TEST${String(++teams).padStart(4, "0")}${Math.floor(Math.random() * 1e6)}`;

const api = (
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
) =>
  exports.default.fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      "cf-connecting-ip": clientIp(),
      ...init.headers,
    },
  });

type Person = { id: string; cookie: string; email: string };

async function signUp(name: string): Promise<Person> {
  const email = `${name.toLowerCase()}-s${++people}@example.com`;
  const response = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name, email, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  // Verified, as members who use Slack must be (an unverified address maps to nobody).
  await env.DB.prepare(`update "user" set "emailVerified" = 1 where id = ?`)
    .bind(body.user.id)
    .run();
  return { id: body.user.id, cookie, email };
}

/** Slack's users, by id, as `users.info` answers them: made up per test. */
const slackUsers = new Map<string, Record<string, unknown>>();
let slackPeople = 0;

/** A new Slack user of `teamId` whose email Slack confirmed (unless `more` says otherwise). */
function slackUser(teamId: string, email: string, more: Record<string, unknown> = {}): string {
  const id = `U0SU${String(++slackPeople).padStart(6, "0")}`;
  slackUsers.set(id, {
    id,
    team_id: teamId,
    deleted: false,
    is_bot: false,
    is_email_confirmed: true,
    profile: { email },
    ...more,
  });
  return id;
}

/** A fake `users.info`, called by the bridge with the token it opened. */
const usersInfo: Fetch = async (request) => {
  expect(request.url).toBe("https://slack.com/api/users.info");
  expect(request.headers.get("Authorization")).toBe(`Bearer ${BOT_TOKEN}`);
  const { user } = (await request.json()) as { user: string };
  const found = slackUsers.get(user);
  return Response.json(found ? { ok: true, user: found } : { ok: false, error: "user_not_found" });
};

async function addMember(workspaceId: string, userId: string, role: string) {
  await env.DB.prepare(
    `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, ?, ?)`,
  )
    .bind(newId("mem", Date.now(), random), workspaceId, userId, role, new Date().toISOString())
    .run();
}

/** Ana owns a new workspace; Bia is an admin, Caio a responder, Duda a viewer, Eva an outsider. */
async function team() {
  const [ana, bia, caio, duda, eva] = await Promise.all(
    ["Ana", "Bia", "Caio", "Duda", "Eva"].map((name) => signUp(name)),
  );
  const created = await api("/workspaces", {
    method: "POST",
    headers: { Cookie: ana!.cookie },
    body: JSON.stringify({ name: "Acme" }),
  });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await addMember(id, bia!.id, "admin");
  await addMember(id, caio!.id, "responder");
  await addMember(id, duda!.id, "viewer");
  const stub = env.WORKSPACE.getByName(id);
  const withShard = <R>(fn: (shard: Shard, state: DurableObjectState) => R | Promise<R>) =>
    runInDurableObject(stub, (_instance: WorkspaceDO, state) =>
      fn(
        new Shard(state.storage, { shard: "workspace", randomBytes: random, log: () => {} }),
        state,
      ),
    );
  const run = (name: string, args: unknown, actor: Actor, internal = false) =>
    withShard((shard) => {
      const { result } = shard.mutate({
        clientId: "test",
        mutationId: newId("mut", Date.now(), random),
        actor,
        name,
        args,
        now: Date.now(),
        internal,
      });
      expect(result, name).toMatchObject({ ok: true });
    });
  return { id, stub, ana: ana!, bia: bia!, caio: caio!, duda: duda!, eva: eva!, withShard, run };
}

type Team = Awaited<ReturnType<typeof team>>;

const owner = (t: Team): Actor => ({ kind: "user", id: t.ana.id, role: "owner" });

const begin = (t: Team, by: Person, headers: Record<string, string> = {}) =>
  api(`/workspaces/${t.id}/slack/install`, {
    method: "POST",
    headers: { Cookie: by.cookie, ...headers },
  });

/** Connects `teamId` to the workspace as Ana, as the OAuth callback would, and sets the channel. */
async function connect(t: Team, teamId = newTeam(), channel: string | null = "C0CHAN0001") {
  const started = await begin(t, t.ana);
  expect(started.status).toBe(200);
  const { state } = (await started.json()) as { state: string };
  const done = await completeSlackInstall(env, state, {
    teamId,
    teamName: "Acme Slack",
    botUserId: "U0BOT00001",
    token: BOT_TOKEN,
    scopes: ["commands", "chat:write"],
  });
  expect(done).toEqual({ ok: true });
  if (channel) await t.run("slack.configure", { channelId: channel, locale: "en" }, owner(t));
  return teamId;
}

const key = () => Array.from(random(32), (b) => b.toString(16).padStart(2, "0")).join("");

const outbox = (t: Team) =>
  t.withShard((_shard, state) =>
    state.storage.sql
      .exec<{ event: string }>("select event from outbox order by seq")
      .toArray()
      .map((row) => JSON.parse(row.event) as BrigadeEvent),
  );

const incidents = (t: Team) => t.withShard((shard) => shard.store.scan("incidents"));

describe("POST /workspaces/:id/slack/install", () => {
  test("an owner or admin gets a one-time state and the cookie the callback checks", async () => {
    const t = await team();
    for (const person of [t.ana, t.bia]) {
      const response = await begin(t, person);
      expect(response.status).toBe(200);
      const { state } = (await response.json()) as { state: string };
      expect(state).toMatch(new RegExp(`^${t.id}\\.[A-Za-z0-9_-]{43}$`));
      const cookie = response.headers.get("Set-Cookie") ?? "";
      expect(cookie).toContain(`${SLACK_STATE_COOKIE}=${state}`);
      expect(cookie).toContain("Path=/slack/oauth");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
    }
  });

  test("responders, viewers, outsiders, other sites and anonymous callers are refused", async () => {
    const t = await team();
    expect((await begin(t, t.caio)).status).toBe(403);
    expect((await begin(t, t.duda)).status).toBe(403);
    expect(await (await begin(t, t.eva)).json()).toEqual({ error: "not_a_member" });
    expect((await begin(t, t.ana, { Origin: "https://evil.test" })).status).toBe(403);
    const anonymous = await api(`/workspaces/${t.id}/slack/install`, { method: "POST" });
    expect(anonymous.status).toBe(401);
  });

  test("without SLACK_TOKEN_KEY Slack is off", async () => {
    const t = await team();
    const request = new Request(`${ORIGIN}/workspaces/${t.id}/slack/install`, {
      method: "POST",
      headers: { Cookie: t.ana.cookie, Origin: ORIGIN },
    });
    const response = await beginSlackInstall(
      request,
      { DB: env.DB, WORKSPACE: env.WORKSPACE },
      () => workerAuth(env, createExecutionContext(), request),
      t.id,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
  });
});

describe("SlackBridge.completeInstall", () => {
  test("connects the team as the member who started it, with the token sealed", async () => {
    const t = await team();
    const teamId = await connect(t, newTeam(), null);
    const { row, token, all } = await t.withShard((shard, state) => ({
      row: shard.store.get("slack", SLACK_ROW_ID),
      token: shard.store.get("slack_tokens", SLACK_ROW_ID),
      all: JSON.stringify(state.storage.sql.exec("select * from store_rows").toArray()),
    }));
    expect(row).toMatchObject({
      teamId,
      teamName: "Acme Slack",
      connectedBy: t.ana.id,
      channelId: null,
    });
    expect(token?.token).toMatch(/^v1\./);
    // The plaintext token is nowhere in the shard, nor in its outbox.
    expect(all).not.toContain(BOT_TOKEN);
    expect(JSON.stringify(await outbox(t))).not.toContain(BOT_TOKEN);
    expect((await outbox(t)).map((event) => event.type)).toContain("slack.connected");
    // And the bridge opens it for that team only.
    expect(await slackConnection(env, teamId)).toMatchObject({
      ok: true,
      workspaceId: t.id,
      token: BOT_TOKEN,
    });
    expect(await slackConnection(env, newTeam())).toEqual({ ok: false, code: "not_connected" });
  });

  test("a state works once; a made-up or another workspace's state never, and the token it holds is kept", async () => {
    const t = await team();
    const { state } = (await (await begin(t, t.ana)).json()) as { state: string };
    const install = {
      teamId: newTeam(),
      teamName: "Acme Slack",
      botUserId: "U0BOT00001",
      token: BOT_TOKEN,
      scopes: [],
    };
    expect(await completeSlackInstall(env, state, install)).toEqual({ ok: true });
    // The same token the workspace now holds (a double-submitted callback): refused, and not to be revoked.
    expect(await completeSlackInstall(env, state, install)).toEqual({
      ok: false,
      code: "invalid_state",
      revoke: false,
    });
    const made = `${t.id}.${"a".repeat(43)}`;
    expect(await completeSlackInstall(env, made, install)).toEqual({
      ok: false,
      code: "invalid_state",
      revoke: false,
    });
    expect(await completeSlackInstall(env, "garbage", install)).toEqual({
      ok: false,
      code: "invalid_state",
      revoke: false,
    });
    // A token the workspace does not hold, or for a team nobody holds, Brigade gives back.
    expect(
      await completeSlackInstall(env, made, { ...install, token: "xoxb-another-test-token" }),
    ).toEqual({ ok: false, code: "invalid_state", revoke: true });
    expect(await completeSlackInstall(env, made, { ...install, teamId: newTeam() })).toEqual({
      ok: false,
      code: "invalid_state",
      revoke: true,
    });
  });

  test("a member demoted after starting cannot finish", async () => {
    const t = await team();
    const { state } = (await (await begin(t, t.bia)).json()) as { state: string };
    await env.DB.prepare(`update member set role = 'responder' where "userId" = ?`)
      .bind(t.bia.id)
      .run();
    const result = await completeSlackInstall(env, state, {
      teamId: newTeam(),
      teamName: "Acme Slack",
      botUserId: "U0BOT00001",
      token: BOT_TOKEN,
      scopes: [],
    });
    expect(result).toEqual({ ok: false, code: "forbidden", revoke: true });
  });

  test("a Slack team connected to another workspace is refused until that one disconnects", async () => {
    const first = await team();
    const second = await team();
    const teamId = await connect(first);
    const { state } = (await (await begin(second, second.ana)).json()) as { state: string };
    const install = {
      teamId,
      teamName: "Acme Slack",
      botUserId: "U0BOT00001",
      token: BOT_TOKEN,
      scopes: [],
    };
    // Slack handed the reinstall the token the first workspace holds: revoking it would cut that one off.
    expect(await completeSlackInstall(env, state, install)).toEqual({
      ok: false,
      code: "team_taken",
      revoke: false,
    });
    const other = (await (await begin(second, second.ana)).json()) as { state: string };
    expect(
      await completeSlackInstall(env, other.state, {
        ...install,
        token: "xoxb-another-test-token",
      }),
    ).toEqual({ ok: false, code: "team_taken", revoke: true });
    await first.run("slack.disconnect", {}, owner(first));
    const again = (await (await begin(second, second.ana)).json()) as { state: string };
    expect(await completeSlackInstall(env, again.state, install)).toEqual({ ok: true });
    expect(await slackConnection(env, teamId)).toMatchObject({ ok: true, workspaceId: second.id });
  });
});

describe("SlackBridge.act", () => {
  const declare = (teamId: string, email: string, k = key(), title = "Checkout down") =>
    slackAct(
      env,
      {
        teamId,
        slackUserId: slackUser(teamId, email),
        action: { kind: "declare", title, severity: "sev2" },
        key: k,
      },
      usersInfo,
    );

  test("declares as the member the email maps to: their name on the incident, the event through the outbox", async () => {
    const t = await team();
    const teamId = await connect(t);
    const result = await declare(teamId, t.caio.email.toUpperCase());
    expect(result).toMatchObject({
      ok: true,
      did: "declared",
      incident: { title: "Checkout down" },
    });
    const [incident] = await incidents(t);
    expect(incident).toMatchObject({ declaredBy: t.caio.id, severity: "sev2", status: "triage" });
    const declared = (await outbox(t)).filter((event) => event.type === "incident.declared");
    expect(declared).toHaveLength(1);
    expect(declared[0]?.actor).toMatchObject({ kind: "user", id: t.caio.id });
  });

  test("the same request twice declares once and answers the same", async () => {
    const t = await team();
    const teamId = await connect(t);
    const k = key();
    const first = await declare(teamId, t.caio.email, k);
    const second = await declare(teamId, t.caio.email, k);
    expect(second).toEqual(first);
    expect(await incidents(t)).toHaveLength(1);
  });

  test("a replay never runs the declaration again, even when the shard kept only its result", async () => {
    const t = await team();
    const teamId = await connect(t);
    const k = key();
    const first = (await declare(teamId, t.caio.email, k)) as Extract<SlackActResult, { ok: true }>;
    // The mutation's stored success is all that is left of the first request.
    await t.withShard((_shard, state) => state.storage.sql.exec("delete from slack_commands"));
    const second = await declare(teamId, t.caio.email, k);
    expect(second).toMatchObject({ ok: false });
    expect(await incidents(t)).toEqual([expect.objectContaining({ id: first.incident.id })]);
    expect((await outbox(t)).filter((event) => event.type === "incident.declared")).toHaveLength(1);
  });

  test("a request that stopped before its declaration ran declares the incident it reserved, once", async () => {
    const t = await team();
    const teamId = await connect(t);
    const k = key();
    const reserved = newId("inc", Date.now(), random);
    await t.withShard((_shard, state) =>
      state.storage.sql.exec(
        "insert into slack_commands (key, incident_id, at) values (?, ?, ?)",
        k,
        reserved,
        Date.now(),
      ),
    );
    const first = await declare(teamId, t.caio.email, k);
    expect(first).toMatchObject({ ok: true, did: "declared", incident: { id: reserved } });
    expect(await declare(teamId, t.caio.email, k)).toEqual(first);
    expect(await incidents(t)).toEqual([expect.objectContaining({ id: reserved })]);
  });

  test("RBAC: a viewer can neither declare nor acknowledge", async () => {
    const t = await team();
    const teamId = await connect(t);
    expect(await declare(teamId, t.duda.email)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await incidents(t)).toHaveLength(0);
    await declare(teamId, t.caio.email);
    const ack = await slackAct(
      env,
      {
        teamId,
        slackUserId: slackUser(teamId, t.duda.email),
        action: { kind: "ack" },
        key: key(),
      },
      usersInfo,
    );
    expect(ack).toMatchObject({ ok: false, code: "forbidden" });
    expect((await incidents(t))[0]?.acknowledgedAt).toBeNull();
  });

  test("an email that is no member's, or an outsider's, runs nothing", async () => {
    const t = await team();
    const teamId = await connect(t);
    expect(await declare(teamId, "nobody@example.com")).toMatchObject({
      ok: false,
      code: "unmapped",
    });
    expect(await declare(teamId, t.eva.email)).toMatchObject({ ok: false, code: "unmapped" });
    expect(await incidents(t)).toHaveLength(0);
  });

  test("a team nobody connected, or one disconnected since, is not connected", async () => {
    const t = await team();
    expect(await declare(newTeam(), t.ana.email)).toMatchObject({
      ok: false,
      code: "not_connected",
    });
    const teamId = await connect(t);
    await t.run("slack.disconnect", {}, owner(t));
    expect(await declare(teamId, t.ana.email)).toMatchObject({ ok: false, code: "not_connected" });
  });

  test("ack runs incident.ack as the member: by number, by id, or the only one waiting", async () => {
    const t = await team();
    const teamId = await connect(t);
    const one = (await declare(teamId, t.ana.email)) as Extract<SlackActResult, { ok: true }>;
    const byNumber = await slackAct(
      env,
      {
        teamId,
        slackUserId: slackUser(teamId, t.caio.email),
        action: { kind: "ack", number: one.incident.number! },
        key: key(),
      },
      usersInfo,
    );
    expect(byNumber).toMatchObject({ ok: true, did: "acknowledged" });
    const row = (await incidents(t))[0]!;
    expect(row.acknowledgedBy).toBe(t.caio.id);
    const acked = (await outbox(t)).filter((event) => event.type === "incident.acknowledged");
    expect(acked).toHaveLength(1);
    // Again, by anyone: already acknowledged.
    const again = await slackAct(
      env,
      {
        teamId,
        slackUserId: slackUser(teamId, t.bia.email),
        action: { kind: "ack", incidentId: row.id },
        key: key(),
      },
      usersInfo,
    );
    expect(again).toMatchObject({ ok: false, code: "already" });

    expect(
      await slackAct(
        env,
        {
          teamId,
          slackUserId: slackUser(teamId, t.caio.email),
          action: { kind: "ack" },
          key: key(),
        },
        usersInfo,
      ),
    ).toMatchObject({ ok: false, code: "none" });
    await declare(teamId, t.ana.email, key(), "Two");
    await declare(teamId, t.ana.email, key(), "Three");
    expect(
      await slackAct(
        env,
        {
          teamId,
          slackUserId: slackUser(teamId, t.caio.email),
          action: { kind: "ack" },
          key: key(),
        },
        usersInfo,
      ),
    ).toMatchObject({ ok: false, code: "ambiguous", choices: [2, 3] });
    expect(
      await slackAct(
        env,
        {
          teamId,
          slackUserId: slackUser(teamId, t.caio.email),
          action: { kind: "ack", number: 99 },
          key: key(),
        },
        usersInfo,
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
  });

  test("answers in the member's own language when they have one", async () => {
    const t = await team();
    const teamId = await connect(t);
    await env.DB.prepare(`update "user" set locale = 'pt-BR' where id = ?`).bind(t.caio.id).run();
    expect(await declare(teamId, t.caio.email)).toMatchObject({
      ok: true,
      locale: "pt-BR",
      workspaceName: "Acme",
    });
  });

  test("a member whose Brigade address is not verified maps to nobody", async () => {
    const t = await team();
    const teamId = await connect(t);
    await env.DB.prepare(`update "user" set "emailVerified" = 0 where id = ?`)
      .bind(t.caio.id)
      .run();
    expect(await declare(teamId, t.caio.email)).toMatchObject({ ok: false, code: "unmapped" });
    expect(await incidents(t)).toHaveLength(0);
  });

  test("Slack users Slack does not vouch for run nothing: another team's guest, an unconfirmed email", async () => {
    const t = await team();
    const teamId = await connect(t);
    for (const more of [
      { team_id: newTeam() },
      { is_stranger: true },
      { is_email_confirmed: false },
      { deleted: true },
    ]) {
      const result = await slackAct(
        env,
        {
          teamId,
          slackUserId: slackUser(teamId, t.caio.email, more),
          action: { kind: "declare", title: "Checkout down", severity: "sev2" },
          key: key(),
        },
        usersInfo,
      );
      expect(result, JSON.stringify(more)).toMatchObject({ ok: false, code: "unconfirmed" });
    }
    expect(await incidents(t)).toHaveLength(0);
  });

  test("the role is read on every request: an admin demoted to viewer is refused at once", async () => {
    const t = await team();
    const teamId = await connect(t);
    expect(await declare(teamId, t.bia.email)).toMatchObject({ ok: true, did: "declared" });
    await env.DB.prepare(`update member set role = 'viewer' where "userId" = ?`)
      .bind(t.bia.id)
      .run();
    expect(await declare(teamId, t.bia.email)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await incidents(t)).toHaveLength(1);
  });

  test("a removed member acts as nobody, even with a role read before the removal", async () => {
    const t = await team();
    const teamId = await connect(t);
    const removed = await api(`/workspaces/${t.id}/members/${t.caio.id}`, {
      method: "DELETE",
      headers: { Cookie: t.ana.cookie },
    });
    expect(removed.status).toBe(200);
    expect(await declare(teamId, t.caio.email)).toMatchObject({ ok: false, code: "unmapped" });
    // A bridge that read D1 just before the removal: the shard's tombstone refuses the stale role.
    const stale = await t.stub.slackAct(
      t.id,
      teamId,
      { kind: "user", id: t.caio.id, role: "responder" },
      { kind: "declare", title: "Checkout down", severity: "sev2" },
      key(),
    );
    expect(stale).toEqual({ ok: false, code: "unmapped" });
    expect(await incidents(t)).toHaveLength(0);
  });

  test("a token the key no longer opens says to reconnect, distinctly from not connected", async () => {
    const t = await team();
    const teamId = newTeam();
    const { state } = (await (await begin(t, t.ana)).json()) as { state: string };
    // Sealed under another key, as after SLACK_TOKEN_KEY changed.
    const before = {
      DB: env.DB,
      WORKSPACE: env.WORKSPACE,
      SLACK_TOKEN_KEY: toBase64url(random(32)),
    };
    expect(
      await completeSlackInstall(before, state, {
        teamId,
        teamName: "Acme Slack",
        botUserId: "U0BOT00001",
        token: BOT_TOKEN,
        scopes: [],
      }),
    ).toEqual({ ok: true });
    expect(await declare(teamId, t.caio.email)).toMatchObject({ ok: false, code: "unreadable" });
    expect(await slackConnection(env, teamId)).toEqual({ ok: false, code: "unreadable" });
  });

  test("the usage is in the Slack user's language, else the connection's", async () => {
    const t = await team();
    const teamId = await connect(t);
    const pt = slackUser(teamId, t.caio.email, { locale: "pt-BR" });
    expect(await slackReplyLocale(env, { teamId, slackUserId: pt }, usersInfo)).toBe("pt-BR");
    const plain = slackUser(teamId, t.caio.email);
    expect(await slackReplyLocale(env, { teamId, slackUserId: plain }, usersInfo)).toBe("en");
    expect(await slackReplyLocale(env, { teamId: newTeam(), slackUserId: plain }, usersInfo)).toBe(
      "en",
    );
  });
});

/** A fake Slack Web API and relay in one `fetch`: records calls, answers per method. */
function slackApi(answers: Record<string, () => Response | Promise<Response>> = {}) {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  let ts = 0;
  const pushes: string[] = [];
  const send: Fetch = async (request) => {
    if (request.url.startsWith("https://relay.test/")) {
      pushes.push(((await request.json()) as { deviceToken: string }).deviceToken);
      return Response.json({ status: 200 });
    }
    const method = request.url.replace("https://slack.com/api/", "");
    calls.push({ method, body: (await request.json()) as Record<string, unknown> });
    expect(request.headers.get("Authorization")).toBe(`Bearer ${BOT_TOKEN}`);
    if (answers[method]) return answers[method]();
    return Response.json({ ok: true, ts: `1790000000.${String(++ts).padStart(6, "0")}` });
  };
  return { calls, send, pushes };
}

async function deliver(events: BrigadeEvent[], send: Fetch, attempts = 1) {
  const batch = createMessageBatch(
    "brigade-events",
    events.map((body, index) => ({ id: `msg-${index}`, timestamp: new Date(), attempts, body })),
  );
  const delays = new Map<string, number | undefined>();
  for (const message of batch.messages) {
    const retry = message.retry.bind(message);
    message.retry = (options) => {
      delays.set(message.id, options?.delaySeconds);
      retry(options);
    };
  }
  const ctx = createExecutionContext();
  const started = Date.now();
  await consumeEvents(
    batch,
    {
      WORKSPACE: env.WORKSPACE,
      RELAY_URL: "https://relay.test",
      RELAY_SEND_TOKEN: "test-token",
      // Set for the tests in vite.config.ts; optional, so not in the generated `Env`.
      SLACK_TOKEN_KEY: Reflect.get(env, "SLACK_TOKEN_KEY") as string,
      DASHBOARD_URL: "https://brigade.test",
    },
    send,
    undefined,
    (promise) => ctx.waitUntil(promise),
  );
  // How long the batch took to settle; work left to `waitUntil` finishes before the result below.
  const settledIn = Date.now() - started;
  const result = await getQueueResult(batch, ctx);
  return {
    settledIn,
    explicitAcks: result.explicitAcks,
    retryMessages: result.retryMessages.map(({ msgId }) => ({
      msgId,
      delaySeconds: delays.get(msgId),
    })),
  };
}

const eventsOf = async (t: Team, type: string) =>
  (await outbox(t)).filter((event) => event.type === type);

/** Ana in the shard's member list (as her first socket would put her) with a phone that pages reach. */
async function phone(t: Team, pushToken: string) {
  await t.run("member.sync", { id: t.ana.id, name: "Ana", role: "owner" }, owner(t), true);
  const recipient = await generateRecipient();
  await t.run(
    "device.register",
    {
      id: newId("dev", Date.now(), random),
      platform: "ios",
      environment: "production",
      pushToken,
      voipToken: null,
      publicKey: toBase64url(recipient.publicKey),
    },
    owner(t),
  );
}

describe("the incident message", () => {
  async function declared(t: Team, teamId: string) {
    await slackAct(
      env,
      {
        teamId,
        slackUserId: slackUser(teamId, t.ana.email),
        action: { kind: "declare", title: "Checkout <!channel> down", severity: "sev1" },
        key: key(),
      },
      usersInfo,
    );
    return (await eventsOf(t, "incident.declared"))[0]!;
  }

  test("is posted once per incident, and redeliveries post nothing", async () => {
    const t = await team();
    const teamId = await connect(t);
    const event = await declared(t, teamId);
    const slack = slackApi();
    expect(await deliver([event], slack.send)).toMatchObject({ explicitAcks: ["msg-0"] });
    await deliver([event], slack.send);
    await deliver([event, event], slack.send);
    const posts = slack.calls.filter((call) => call.method === "chat.postMessage");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body.channel).toBe("C0CHAN0001");
    expect(JSON.stringify(posts[0]?.body.blocks)).toContain("Checkout &lt;!channel&gt; down");
  });

  test("later changes update the same message", async () => {
    const t = await team();
    const teamId = await connect(t);
    const event = await declared(t, teamId);
    const slack = slackApi();
    await deliver([event], slack.send);
    const incident = (await incidents(t))[0]!;
    await slackAct(
      env,
      {
        teamId,
        slackUserId: slackUser(teamId, t.caio.email),
        action: { kind: "ack", incidentId: incident.id },
        key: key(),
      },
      usersInfo,
    );
    await t.run("incident.setStatus", { id: incident.id, status: "investigating" }, owner(t));
    const later = [
      ...(await eventsOf(t, "incident.acknowledged")),
      ...(await eventsOf(t, "incident.status_changed")),
    ];
    for (const one of later) await deliver([one], slack.send);
    const updates = slack.calls.filter((call) => call.method === "chat.update");
    expect(updates).toHaveLength(2);
    expect(updates.every((call) => call.body.ts === "1790000000.000001")).toBe(true);
    // Acknowledged: the button is gone.
    expect(JSON.stringify(updates[1]?.body.blocks)).not.toContain("brigade_ack");
    expect(slack.calls.filter((call) => call.method === "chat.postMessage")).toHaveLength(1);
  });

  test("an incident open past the ledger's retention keeps its message, and each use refreshes it", async () => {
    const t = await team();
    const teamId = await connect(t);
    const event = await declared(t, teamId);
    const slack = slackApi();
    await deliver([event], slack.send);
    const messageAt = () =>
      t.withShard(
        (_shard, state) =>
          state.storage.sql.exec<{ at: number }>("select at from slack_messages").toArray()[0]?.at,
      );
    // Last used long before the retention window.
    await t.withShard((_shard, state) =>
      state.storage.sql.exec("update slack_messages set at = 1"),
    );
    const incident = (await incidents(t))[0]!;
    await t.run("incident.setSeverity", { id: incident.id, severity: "sev2" }, owner(t));
    await deliver(await eventsOf(t, "incident.severity_changed"), slack.send);
    expect(slack.calls.filter((call) => call.method === "chat.update")).toHaveLength(1);
    expect(await messageAt()).toBeGreaterThan(Date.now() - 60_000);
    // Resolved and unused past retention: the next prune drops it.
    await t.run("incident.setStatus", { id: incident.id, status: "resolved" }, owner(t));
    await t.withShard((_shard, state) =>
      state.storage.sql.exec("update slack_messages set at = 1"),
    );
    await deliver([event], slack.send);
    expect(await messageAt()).toBeUndefined();
  });

  test("two events of one incident in a batch post once; the second waits for it and updates", async () => {
    const t = await team();
    const teamId = await connect(t);
    const event = await declared(t, teamId);
    const incident = (await incidents(t))[0]!;
    await t.run("incident.setSeverity", { id: incident.id, severity: "sev2" }, owner(t));
    const changed = (await eventsOf(t, "incident.severity_changed"))[0]!;
    const slack = slackApi();
    const first = await deliver([event, changed], slack.send);
    expect(slack.calls.filter((call) => call.method === "chat.postMessage")).toHaveLength(1);
    expect(first.retryMessages).toEqual([{ msgId: "msg-1", delaySeconds: expect.any(Number) }]);
    // Once the claim ends, the retry updates the message the first posted.
    await t.withShard((_shard, state) =>
      state.storage.sql.exec("update slack_messages set claimed_until = 0"),
    );
    await deliver([changed], slack.send, 2);
    expect(slack.calls.filter((call) => call.method === "chat.update")).toHaveLength(1);
  });

  test("429: retried after Slack's Retry-After, then posted", async () => {
    const t = await team();
    const teamId = await connect(t);
    const event = await declared(t, teamId);
    const limited = slackApi({
      "chat.postMessage": () => new Response("", { status: 429, headers: { "Retry-After": "30" } }),
    });
    const result = await deliver([event], limited.send);
    expect(result.retryMessages).toEqual([{ msgId: "msg-0", delaySeconds: 30 }]);
    // Too early: held, Slack is not called again.
    await deliver([event], limited.send, 2);
    expect(limited.calls).toHaveLength(1);
    await t.withShard((_shard, state) =>
      state.storage.sql.exec("update slack_events set retry_at = 0"),
    );
    const ok = slackApi();
    expect(await deliver([event], ok.send, 3)).toMatchObject({ explicitAcks: ["msg-0"] });
    expect(ok.calls.filter((call) => call.method === "chat.postMessage")).toHaveLength(1);
  });

  test("Slack failing every time ends on the timeline as slack_failed, once", async () => {
    const t = await team();
    const teamId = await connect(t);
    const event = await declared(t, teamId);
    const down = slackApi({ "chat.postMessage": () => new Response("", { status: 503 }) });
    for (let attempt = 1; attempt <= SLACK_MAX_ATTEMPTS + 1; attempt++) {
      await t.withShard((_shard, state) =>
        state.storage.sql.exec("update slack_events set retry_at = 0"),
      );
      await deliver([event], down.send, attempt);
    }
    expect(down.calls).toHaveLength(SLACK_MAX_ATTEMPTS);
    const timeline = await t.withShard((shard) => shard.store.scan("timeline"));
    expect(timeline.filter((row) => row.kind === "slack_failed")).toEqual([
      expect.objectContaining({
        kind: "slack_failed",
        reason: "undelivered",
        actor: "sys_notifier",
      }),
    ]);
    const failed = await eventsOf(t, "notification.failed");
    expect(failed.map((one) => one.data)).toEqual([
      expect.objectContaining({ channel: "slack", reason: "undelivered", eventId: event.id }),
    ]);
  });

  test("a channel Slack says is gone fails at once, without retries", async () => {
    const t = await team();
    const teamId = await connect(t);
    const event = await declared(t, teamId);
    const gone = slackApi({
      "chat.postMessage": () => Response.json({ ok: false, error: "channel_not_found" }),
    });
    expect(await deliver([event], gone.send)).toMatchObject({ explicitAcks: ["msg-0"] });
    const timeline = await t.withShard((shard) => shard.store.scan("timeline"));
    expect(timeline.at(-1)).toMatchObject({ kind: "slack_failed", reason: "no_channel" });
  });

  test("no channel set, or Slack not connected: nothing is posted", async () => {
    const t = await team();
    const teamId = await connect(t, newTeam(), null);
    const event = await declared(t, teamId);
    const slack = slackApi();
    expect(await deliver([event], slack.send)).toMatchObject({ explicitAcks: ["msg-0"] });
    expect(slack.calls).toHaveLength(0);
  });

  test("push paging is unaffected: Slack down still pages, and the retry pages nobody twice", async () => {
    const t = await team();
    const teamId = await connect(t);
    // Ana's phone, so the declaration pages someone (Caio declares; Ana is paged).
    await phone(t, "a".repeat(64));
    await slackAct(
      env,
      {
        teamId,
        slackUserId: slackUser(teamId, t.caio.email),
        action: { kind: "declare", title: "Checkout down", severity: "sev1" },
        key: key(),
      },
      usersInfo,
    );
    const event = (await eventsOf(t, "incident.declared"))[0]!;
    const down = slackApi({ "chat.postMessage": () => new Response("", { status: 500 }) });
    const first = await deliver([event], down.send);
    expect(down.pushes).toEqual(["a".repeat(64)]);
    // Retried for Slack's sake only.
    expect(first.retryMessages).toHaveLength(1);
    await t.withShard((_shard, state) =>
      state.storage.sql.exec("update slack_events set retry_at = 0"),
    );
    await deliver([event], down.send, 2);
    expect(down.pushes).toHaveLength(1);

    // A Slack that hangs, or a key that cannot open the token, changes nothing for push either.
    const t2 = await team();
    const teamId2 = await connect(t2);
    await phone(t2, "b".repeat(64));
    await slackAct(
      env,
      {
        teamId: teamId2,
        slackUserId: slackUser(teamId2, t2.caio.email),
        action: { kind: "declare", title: "Search down", severity: "sev1" },
        key: key(),
      },
      usersInfo,
    );
    const event2 = (await eventsOf(t2, "incident.declared"))[0]!;
    const throwing = slackApi({
      "chat.postMessage": () => Promise.reject(new TypeError("network down")),
    });
    await deliver([event2], throwing.send);
    expect(throwing.pushes).toEqual(["b".repeat(64)]);
  });

  test("a page that needs a retry still waits for Slack's work, and keeps its own retry", async () => {
    const t = await team();
    const teamId = await connect(t);
    await phone(t, "d".repeat(64));
    // Caio declares, so Ana's phone is paged.
    await slackAct(
      env,
      {
        teamId,
        slackUserId: slackUser(teamId, t.caio.email),
        action: { kind: "declare", title: "Checkout down", severity: "sev1" },
        key: key(),
      },
      usersInfo,
    );
    const event = (await eventsOf(t, "incident.declared"))[0]!;
    const slack = slackApi({
      // Slower than push, so the page's answer comes first.
      "chat.postMessage": async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return Response.json({ ok: true, ts: "1790000000.000009" });
      },
    });
    const relayDown: Fetch = (request) =>
      request.url.startsWith("https://relay.test/")
        ? Promise.resolve(Response.json({ error: "apns_unreachable" }, { status: 502 }))
        : slack.send(request);
    const result = await deliver([event], relayDown);
    expect(result.retryMessages).toEqual([{ msgId: "msg-0", delaySeconds: expect.any(Number) }]);
    // Slack's post was recorded before the message was settled.
    const message = await t.withShard((_shard, state) =>
      state.storage.sql.exec<{ ts: string | null }>("select ts from slack_messages").toArray(),
    );
    expect(message).toEqual([{ ts: "1790000000.000009" }]);
  });

  test("Slack's own retries stop where the Queue's do: the last delivery is acked, never dead-lettered", async () => {
    const t = await team();
    const teamId = await connect(t);
    const event = await declared(t, teamId);
    const down = slackApi({ "chat.postMessage": () => new Response("", { status: 503 }) });
    expect((await deliver([event], down.send, QUEUE_MAX_RETRIES)).retryMessages).toHaveLength(1);
    await t.withShard((_shard, state) =>
      state.storage.sql.exec("update slack_events set retry_at = 0"),
    );
    const last = await deliver([event], down.send, QUEUE_MAX_RETRIES + 1);
    expect(last.retryMessages).toEqual([]);
    expect(last.explicitAcks).toEqual(["msg-0"]);
  });

  test("a Slack that hangs never holds the batch: it settles within Slack's budget, paged, and retried", async () => {
    const t = await team();
    const teamId = await connect(t);
    await phone(t, "c".repeat(64));
    // Caio declares, so Ana's phone is paged.
    await slackAct(
      env,
      {
        teamId,
        slackUserId: slackUser(teamId, t.caio.email),
        action: { kind: "declare", title: "Checkout down", severity: "sev1" },
        key: key(),
      },
      usersInfo,
    );
    const event = (await eventsOf(t, "incident.declared"))[0]!;
    // Answers long after the budget and ignores its abort signal: only the consumer's own budget can end the wait.
    const hanging = slackApi({
      "chat.postMessage": () =>
        new Promise<Response>((resolve) =>
          setTimeout(() => resolve(Response.json({ ok: true, ts: "1" })), SLACK_BUDGET_MS + 4000),
        ),
    });
    const result = await deliver([event], hanging.send);
    expect(result.settledIn).toBeGreaterThanOrEqual(SLACK_BUDGET_MS - 100);
    expect(result.settledIn).toBeLessThan(SLACK_BUDGET_MS + 2000);
    expect(hanging.pushes).toEqual(["c".repeat(64)]);
    expect(result.retryMessages).toEqual([{ msgId: "msg-0", delaySeconds: expect.any(Number) }]);
  }, 15_000);

  test("a Slack that answers after the budget still records its message: the retry updates it, never posts again", async () => {
    const t = await team();
    const teamId = await connect(t);
    const event = await declared(t, teamId);
    // Slack accepts the post, but only once the consumer has stopped waiting for it.
    const late = slackApi({
      "chat.postMessage": () =>
        new Promise<Response>((resolve) =>
          setTimeout(
            () => resolve(Response.json({ ok: true, ts: "1790000000.000042" })),
            SLACK_BUDGET_MS + 500,
          ),
        ),
    });
    const first = await deliver([event], late.send);
    expect(first.settledIn).toBeLessThan(SLACK_BUDGET_MS + 400);
    expect(first.retryMessages).toEqual([{ msgId: "msg-0", delaySeconds: expect.any(Number) }]);
    const recorded = await t.withShard(
      (_shard, state) =>
        state.storage.sql.exec<{ ts: string | null }>("select ts from slack_messages").toArray()[0]
          ?.ts,
    );
    expect(recorded).toBe("1790000000.000042");
    // The Queue's retry, and the incident's next change: neither posts a second message.
    await t.withShard((_shard, state) =>
      state.storage.sql.exec("update slack_messages set claimed_until = 0"),
    );
    await deliver([event], late.send, 2);
    const incident = (await incidents(t))[0]!;
    await t.run("incident.setSeverity", { id: incident.id, severity: "sev2" }, owner(t));
    await deliver(await eventsOf(t, "incident.severity_changed"), late.send);
    expect(late.calls.filter((call) => call.method === "chat.postMessage")).toHaveLength(1);
    const updates = late.calls.filter((call) => call.method === "chat.update");
    expect(updates).toHaveLength(1);
    expect(updates[0]?.body.ts).toBe("1790000000.000042");
  }, 15_000);
});
