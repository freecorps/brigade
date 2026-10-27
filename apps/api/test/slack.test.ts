// Slack's side of the API (RFC 0011): starting and finishing an install, the actions Slack users run as members
// (the same mutations, RBAC and events as the dashboard), and the incident message the queue consumer posts and
// updates, idempotently, without ever getting in the way of a page.
import { env, exports } from "cloudflare:workers";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { generateRecipient, toBase64url } from "@freecorps/brigade-push";
import {
  ESCALATION_ACTOR,
  MONITOR_ACTOR,
  newId,
  SLACK_ROW_ID,
  type Actor,
} from "@freecorps/brigade-schema";
import type { SlackActResult } from "@freecorps/brigade-slack/bridge";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { clearPeople } from "@freecorps/brigade-slack/people";
import { consumeEvents, QUEUE_MAX_RETRIES, SLACK_BUDGET_MS, type Fetch } from "../src/notify.ts";
import { notifySlack } from "../src/notify-slack.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { Shard } from "../src/shard.ts";
import {
  SLACK_ESCALATE_WINDOW_MS,
  SLACK_LOOKUP_BATCH,
  SLACK_MAX_ATTEMPTS,
  type SlackDesk,
} from "../src/slack.ts";
import {
  actAndAnswer,
  beginSlackInstall,
  completeSlackInstall,
  listSlackChannels,
  openSlackDeclare,
  slackAct,
  slackRevoked,
  slackConnection,
  slackReplyLocale,
  SLACK_STATE_COOKIE,
} from "../src/slack-bridge.ts";
import { workerAuth } from "../src/index.ts";
import type { WorkspaceDO } from "../src/workspace.ts";
import { sessionCookie } from "./session.ts";

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
  const cookie = await sessionCookie(email, PASSWORD);
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
    // The same answer, marked a replay: an event retried is not answered twice.
    expect(second).toEqual({ ...first, replayed: true });
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
    expect(await declare(teamId, t.caio.email, k)).toEqual({ ...first, replayed: true });
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
    // Reads go as a form (`users.lookupByEmail`, `conversations.list`, `auth.revoke`), writes as JSON.
    const body = request.headers
      .get("Content-Type")
      ?.startsWith("application/x-www-form-urlencoded")
      ? Object.fromEntries(new URLSearchParams(await request.text()))
      : ((await request.json()) as Record<string, unknown>);
    calls.push({ method, body });
    expect(request.headers.get("Authorization")).toBe(`Bearer ${BOT_TOKEN}`);
    if (answers[method]) return answers[method]();
    if (method === "users.lookupByEmail") {
      const user = [...slackUsers.values()].find((one) => Object(one.profile).email === body.email);
      return Response.json(user ? { ok: true, user } : { ok: false, error: "users_not_found" });
    }
    if (method === "conversations.create") {
      return Response.json({ ok: true, channel: { id: `C0INC${String(++ts).padStart(5, "0")}` } });
    }
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
      DB: env.DB,
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

/** The incident messages posted: top-level posts, not the mirror's replies under them. */
const posts = (calls: { method: string; body: Record<string, unknown> }[]) =>
  calls.filter((call) => call.method === "chat.postMessage" && call.body.thread_ts === undefined);

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
    expect(posts(slack.calls)).toHaveLength(1);
    // Without an incident channel, the timeline is mirrored as replies under the message: the ack, then the status.
    const replies = slack.calls.filter((call) => call.body.thread_ts === "1790000000.000001");
    expect(replies.map((call) => call.body.text)).toEqual([
      // Nobody is in the shard's member list here, so nobody has a name.
      "A teammate acknowledged the incident. Paging has stopped.",
      "A teammate changed the status to *Investigating*",
    ]);
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
    await t.withShard((_shard, state) => state.storage.sql.exec("delete from slack_claims"));
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
      state.storage.sql.exec("update slack_jobs set retry_at = 0"),
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
        state.storage.sql.exec("update slack_jobs set retry_at = 0"),
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
      state.storage.sql.exec("update slack_jobs set retry_at = 0"),
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
      state.storage.sql.exec("update slack_jobs set retry_at = 0"),
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
    await t.withShard((_shard, state) => state.storage.sql.exec("delete from slack_claims"));
    await deliver([event], late.send, 2);
    const incident = (await incidents(t))[0]!;
    await t.run("incident.setSeverity", { id: incident.id, severity: "sev2" }, owner(t));
    await deliver(await eventsOf(t, "incident.severity_changed"), late.send);
    expect(posts(late.calls)).toHaveLength(1);
    const updates = late.calls.filter((call) => call.method === "chat.update");
    expect(updates).toHaveLength(1);
    expect(updates[0]?.body.ts).toBe("1790000000.000042");
  }, 15_000);
});

describe("a channel per incident, and the timeline mirror", () => {
  /** Connected with incident channels on, Ana and Caio in the shard's member list. */
  async function withChannels(t: Team, settings: Record<string, unknown> = {}) {
    const teamId = await connect(t);
    await t.run("member.sync", { id: t.ana.id, name: "Ana", role: "owner" }, owner(t), true);
    await t.run(
      "member.sync",
      { id: t.caio.id, name: "Caio", role: "responder" },
      { kind: "user", id: t.caio.id, role: "responder" },
      true,
    );
    await t.run(
      "slack.configure",
      {
        channelId: "C0CHAN0001",
        locale: "en",
        incidentChannels: "all",
        archiveAfterHours: 0,
        ...settings,
      },
      owner(t),
    );
    return teamId;
  }

  async function declare(t: Team, teamId: string, title: string, severity = "sev1") {
    const result = await slackAct(
      env,
      {
        teamId,
        slackUserId: slackUser(teamId, t.ana.email),
        action: { kind: "declare", title, severity: severity as "sev1" },
        key: key(),
      },
      usersInfo,
    );
    expect(result).toMatchObject({ ok: true, did: "declared" });
    return (await eventsOf(t, "incident.declared")).at(-1)!;
  }

  const as = (t: Team, teamId: string, email: string, action: SlackActRequestAction) =>
    slackAct(env, { teamId, slackUserId: slackUser(teamId, email), action, key: key() }, usersInfo);

  test("declaring creates #inc-<n>-<slug>, invites the people, posts there, and links it from the main channel", async () => {
    const t = await team();
    const teamId = await withChannels(t);
    const event = await declare(t, teamId, "Checkout: São Paulo down!");
    const slack = slackApi();
    expect(await deliver([event], slack.send)).toMatchObject({ explicitAcks: ["msg-0"] });
    await deliver([event], slack.send);
    const methods = slack.calls.map((call) => call.method);
    expect(methods).toEqual([
      "conversations.create",
      "users.lookupByEmail",
      "conversations.invite",
      "chat.postMessage",
      "chat.postMessage",
    ]);
    expect(slack.calls[0]?.body).toEqual({
      name: "inc-1-checkout-sao-paulo-down",
      is_private: false,
    });
    const ana = [...slackUsers.values()].find((one) => Object(one.profile).email === t.ana.email)!;
    expect(slack.calls[2]?.body).toMatchObject({ channel: "C0INC00001", users: ana.id });
    expect(slack.calls[3]?.body.channel).toBe("C0INC00001");
    expect(slack.calls[4]?.body.channel).toBe("C0CHAN0001");
    expect(JSON.stringify(slack.calls[4]?.body.blocks)).toContain(
      "Incident channel: <#C0INC00001>",
    );
  });

  test("only SEV1 and SEV2 get one when the workspace says so; a taken name gets -2", async () => {
    const t = await team();
    const teamId = await withChannels(t, { incidentChannels: "major" });
    const minor = await declare(t, teamId, "Slow search", "sev3");
    const slack = slackApi();
    await deliver([minor], slack.send);
    expect(slack.calls.map((call) => call.method)).toEqual(["chat.postMessage"]);
    const major = await declare(t, teamId, "Payments down", "sev2");
    let taken = 0;
    const busy = slackApi({
      "conversations.create": () =>
        ++taken === 1
          ? Response.json({ ok: false, error: "name_taken" })
          : Response.json({ ok: true, channel: { id: "C0INC00099" } }),
    });
    await deliver([major], busy.send);
    const creates = busy.calls.filter((call) => call.method === "conversations.create");
    expect(creates.map((call) => call.body.name)).toEqual([
      "inc-2-payments-down",
      "inc-2-payments-down-2",
    ]);
  });

  test("/inc in the incident's channel acts on it; updates are mirrored there, but not `!update` messages", async () => {
    const t = await team();
    const teamId = await withChannels(t);
    const slack = slackApi();
    await deliver([await declare(t, teamId, "Checkout down")], slack.send);
    const channel = "C0INC00001";
    expect(
      await as(t, teamId, t.caio.email, {
        kind: "update",
        body: "Rolled back",
        channelId: channel,
      }),
    ).toMatchObject({
      ok: true,
      did: "updated",
      incident: { number: 1 },
    });
    expect(
      await as(t, teamId, t.caio.email, {
        kind: "update",
        body: "From a message",
        channelId: channel,
        fromMessage: true,
      }),
    ).toMatchObject({ ok: true, did: "updated" });
    // A message outside an incident's channel is nobody's update.
    expect(
      await as(t, teamId, t.caio.email, {
        kind: "update",
        body: "Lost",
        channelId: "C0CHAN0001",
        fromMessage: true,
      }),
    ).toMatchObject({ ok: false, code: "not_incident_channel" });
    expect(
      await as(t, teamId, t.caio.email, { kind: "severity", severity: "sev2", channelId: channel }),
    ).toMatchObject({
      ok: true,
      did: "severity",
      severity: "sev2",
    });
    const before = slack.calls.length;
    for (const type of ["incident.update_posted", "incident.severity_changed"]) {
      for (const one of await eventsOf(t, type)) await deliver([one], slack.send);
    }
    const later = slack.calls.slice(before);
    const mirrored = later.filter(
      (call) => call.method === "chat.postMessage" && call.body.channel === channel,
    );
    expect(mirrored.map((call) => call.body.text)).toEqual([
      "*Update from Caio*\nRolled back",
      "Caio changed the severity to *SEV2 · High*",
    ]);
    // Both messages show the new severity.
    expect(
      later.filter((call) => call.method === "chat.update").map((call) => call.body.channel),
    ).toEqual(["C0CHAN0001", channel]);
    const timeline = await t.withShard((shard) => shard.store.scan("timeline"));
    expect(
      timeline.filter((row) => row.kind === "update").map((row) => Reflect.get(row, "body")),
    ).toEqual(["Rolled back", "From a message"]);
  });

  test("editing a mirrored update rewrites its message, removing it deletes it; one written in Slack is left alone", async () => {
    const t = await team();
    const teamId = await withChannels(t);
    const slack = slackApi();
    await deliver([await declare(t, teamId, "Checkout down")], slack.send);
    const channel = "C0INC00001";
    await as(t, teamId, t.caio.email, { kind: "update", body: "Rolled back", channelId: channel });
    await as(t, teamId, t.caio.email, {
      kind: "update",
      body: "From a message",
      channelId: channel,
      fromMessage: true,
    });
    for (const one of await eventsOf(t, "incident.update_posted")) await deliver([one], slack.send);
    const timeline = await t.withShard((shard) => shard.store.scan("timeline"));
    const [mirrored, inbound] = timeline.filter((row) => row.kind === "update");
    const caio = { kind: "user" as const, id: t.caio.id, role: "responder" as const };
    for (const row of [mirrored!, inbound!]) {
      await t.run(
        "incident.editUpdate",
        { id: row.incidentId, entryId: row.id, body: "Edited" },
        caio,
      );
    }
    const before = slack.calls.length;
    for (const one of await eventsOf(t, "incident.update_edited")) await deliver([one], slack.send);
    const edits = slack.calls.slice(before);
    // Only the update the mirror posted: the one written in Slack is the person's own message.
    expect(edits.map((call) => call.method)).toEqual(["chat.update"]);
    expect(edits[0]?.body).toMatchObject({ channel, text: "*Update from Caio*\nEdited" });
    expect(typeof edits[0]?.body.ts).toBe("string");
    await t.run(
      "incident.deleteUpdate",
      { id: mirrored!.incidentId, entryId: mirrored!.id },
      owner(t),
    );
    const removing = slack.calls.length;
    // Slack says the message is gone already (deleted by hand): done, not a failure.
    const gone = slackApi({
      "chat.delete": () => Response.json({ ok: false, error: "message_not_found" }),
    });
    for (const one of await eventsOf(t, "incident.update_deleted")) await deliver([one], gone.send);
    expect(slack.calls.length).toBe(removing);
    expect(gone.calls.map((call) => call.method)).toEqual(["chat.delete"]);
    expect(gone.calls[0]?.body).toEqual({ channel, ts: edits[0]?.body.ts });
    const after = await t.withShard((shard) => shard.store.scan("timeline"));
    expect(after.some((row) => row.kind === "slack_failed")).toBe(false);
  });

  test("resolving archives the channel after the workspace's delay; a reopened incident keeps it", async () => {
    const t = await team();
    const teamId = await withChannels(t);
    const slack = slackApi();
    await deliver([await declare(t, teamId, "Checkout down")], slack.send);
    expect(
      await as(t, teamId, t.caio.email, { kind: "resolve", channelId: "C0INC00001" }),
    ).toMatchObject({
      ok: true,
      did: "resolved",
    });
    for (const one of await eventsOf(t, "incident.status_changed"))
      await deliver([one], slack.send);
    const archive = () =>
      runInDurableObject(t.stub, (instance: WorkspaceDO) =>
        (instance as unknown as { slack: SlackDesk }).slack.archiveDue(Date.now() + 1),
      );
    // Due at once (archive right away): the shard's alarm, brought forward for it, asks for the archive.
    await vi.waitFor(async () => expect(await eventsOf(t, "slack.archive_due")).toHaveLength(1));
    const due = await eventsOf(t, "slack.archive_due");
    await deliver(due, slack.send);
    expect(slack.calls.filter((call) => call.method === "conversations.archive")).toEqual([
      { method: "conversations.archive", body: { channel: "C0INC00001" } },
    ]);
    // Asked once: archived, nothing is due any more.
    expect(await archive()).toBe(0);

    const kept = await team();
    const keptTeam = await withChannels(kept, { archiveAfterHours: 24 });
    const other = slackApi();
    await deliver([await declare(kept, keptTeam, "Login down")], other.send);
    const incident = (await incidents(kept))[0]!;
    await kept.run("incident.setStatus", { id: incident.id, status: "resolved" }, owner(kept));
    await kept.run("incident.setStatus", { id: incident.id, status: "investigating" }, owner(kept));
    for (const one of await eventsOf(kept, "incident.status_changed"))
      await deliver([one], other.send);
    const keptDue = await runInDurableObject(kept.stub, (instance: WorkspaceDO) =>
      (instance as unknown as { slack: SlackDesk }).slack.archiveDue(Date.now() + 48 * 3600_000),
    );
    expect(keptDue).toBe(0);
  });

  test("the subcommands run as the member, with the dashboard's RBAC and refusals", async () => {
    const t = await team();
    const teamId = await withChannels(t, { incidentChannels: "off" });
    await declare(t, teamId, "Checkout down");
    await t.run(
      "member.sync",
      { id: t.bia.id, name: "Bia", role: "admin" },
      { kind: "user", id: t.bia.id, role: "admin" },
      true,
    );
    // A viewer cannot change an incident.
    expect(
      await as(t, teamId, t.duda.email, { kind: "update", body: "Hi", number: 1 }),
    ).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    const bia = slackUser(teamId, t.bia.email);
    expect(
      await as(t, teamId, t.caio.email, {
        kind: "role",
        role: "Incident Commander",
        user: bia,
        number: 1,
      }),
    ).toMatchObject({ ok: true, did: "role", role: { id: "commander", name: null } });
    expect(
      await as(t, teamId, t.caio.email, { kind: "role", role: "commander", user: bia, number: 1 }),
    ).toMatchObject({ ok: false, code: "unchanged" });
    expect(
      await as(t, teamId, t.caio.email, { kind: "role", role: "scribe", user: bia, number: 1 }),
    ).toMatchObject({
      ok: false,
      code: "unknown_role",
      roles: expect.arrayContaining([{ id: "commander", name: null }]),
    });
    const stranger = slackUser(teamId, "nobody@example.com");
    expect(
      await as(t, teamId, t.caio.email, { kind: "role", role: "ops", user: stranger, number: 1 }),
    ).toMatchObject({ ok: false, code: "role_unmapped" });
    const incident = (await incidents(t))[0]!;
    expect(incident.roles).toEqual({ commander: t.bia.id });
    // No policy, so no escalation run: nothing to page next.
    expect(await as(t, teamId, t.caio.email, { kind: "escalate", number: 1 })).toMatchObject({
      ok: false,
      code: "not_escalating",
    });
    await declare(t, teamId, "Search down");
    expect(await as(t, teamId, t.caio.email, { kind: "severity", severity: "sev2" })).toMatchObject(
      {
        ok: false,
        code: "which",
        choices: [1, 2],
      },
    );
    expect(await as(t, teamId, t.caio.email, { kind: "resolve", number: 2 })).toMatchObject({
      ok: true,
      did: "resolved",
    });
    expect(await as(t, teamId, t.caio.email, { kind: "resolve", number: 2 })).toMatchObject({
      ok: false,
      code: "not_active",
    });
    // The events are the dashboard's, as the member.
    const assigned = await eventsOf(t, "incident.role_assigned");
    expect(assigned[0]).toMatchObject({ actor: { kind: "user", id: t.caio.id } });
  });

  test("an Events API message is answered with an ephemeral message in its channel", async () => {
    const t = await team();
    const teamId = await withChannels(t, { incidentChannels: "off" });
    await declare(t, teamId, "Checkout down");
    const slack = slackApi();
    const send: Fetch = (request) =>
      request.url.endsWith("/users.info") ? usersInfo(request) : slack.send(request);
    const result = await actAndAnswer(
      env,
      {
        teamId,
        slackUserId: slackUser(teamId, t.caio.email),
        action: { kind: "update", body: "Hello", fromMessage: true, channelId: "C0CHAN0001" },
        key: key(),
        answer: { channelId: "C0CHAN0001", threadTs: "1790000000.000001" },
      },
      send,
    );
    expect(result).toMatchObject({ ok: false, code: "not_incident_channel" });
    expect(slack.calls).toEqual([
      {
        method: "chat.postEphemeral",
        body: expect.objectContaining({
          channel: "C0CHAN0001",
          thread_ts: "1790000000.000001",
          text: expect.stringMatching(/^This isn't an incident's channel/),
        }),
      },
    ]);
  });
});

describe("what must happen once: escalations, messages, retried events, the claim", () => {
  /** Connected without a main channel, Ana and Caio synced with phones, a default policy paging Ana then Caio. */
  async function escalating(t: Team) {
    const teamId = await connect(t, newTeam(), null);
    await phone(t, "a".repeat(64));
    const caio: Actor = { kind: "user", id: t.caio.id, role: "responder" };
    await t.run("member.sync", { id: t.caio.id, name: "Caio", role: "responder" }, caio, true);
    const recipient = await generateRecipient();
    await t.run(
      "device.register",
      {
        id: newId("dev", Date.now(), random),
        platform: "ios",
        environment: "production",
        pushToken: "c".repeat(64),
        voipToken: null,
        publicKey: toBase64url(recipient.publicKey),
      },
      caio,
    );
    await t.run(
      "escalation.createPolicy",
      {
        id: newId("esc", Date.now(), random),
        name: "Checkout",
        levels: [t.ana.id, t.caio.id].map((id) => ({
          id: newId("lvl", Date.now(), random),
          targets: [{ kind: "member", id }],
          timeoutMinutes: 5,
        })),
        repeat: 1,
        isDefault: true,
      },
      owner(t),
    );
    const incidentId = newId("inc", Date.now(), random);
    await t.run(
      "incident.declare",
      { id: incidentId, title: "Checkout down", severity: "sev1" },
      MONITOR_ACTOR,
    );
    const declared = (await eventsOf(t, "incident.declared"))[0]!;
    await t.run(
      "escalation.start",
      { incidentId, eventId: declared.id, causedBy: MONITOR_ACTOR.id },
      ESCALATION_ACTOR,
      true,
    );
    return { teamId, incidentId };
  }

  const run = (t: Team, incidentId: string) =>
    t.withShard((shard) => shard.store.get("incidents", incidentId)!.escalation!);
  /** The run's last page, as if it was paged `ago` ms back. */
  const pagedAgo = (t: Team, incidentId: string, ago: number) =>
    t.withShard((shard) => {
      const row = shard.store.get("incidents", incidentId)!;
      const pages = row.escalation!.pages.map((page, i, all) =>
        i === all.length - 1 ? { ...page, at: Date.now() - ago } : page,
      );
      shard.store.update("incidents", incidentId, { escalation: { ...row.escalation!, pages } });
    });
  const escalate = (t: Team, teamId: string, email: string, more: { step?: number } = {}) =>
    slackAct(
      env,
      {
        teamId,
        slackUserId: slackUser(teamId, email),
        action: { kind: "escalate", number: 1, ...more },
        key: key(),
      },
      usersInfo,
    );

  test("two people escalating at once page the next level once", async () => {
    const t = await team();
    const { teamId, incidentId } = await escalating(t);
    await pagedAgo(t, incidentId, SLACK_ESCALATE_WINDOW_MS + 1000);
    const results = await Promise.all([
      escalate(t, teamId, t.ana.email),
      escalate(t, teamId, t.caio.email),
    ]);
    expect(results.filter((one) => one.ok)).toEqual([
      expect.objectContaining({ ok: true, did: "escalated" }),
    ]);
    // The other is told the level the first paged: nobody skips a level.
    expect(results.find((one) => !one.ok)).toMatchObject({ code: "just_paged", level: 2 });
    expect(await run(t, incidentId)).toMatchObject({ paged: 2, status: "running" });
    expect((await eventsOf(t, "escalation.paged")).map((e) => e.data)).toEqual([
      expect.objectContaining({ level: 1, reason: "started" }),
      expect.objectContaining({ level: 2, reason: "manual" }),
    ]);
  });

  test("escalating right after the run's first page goes through", async () => {
    const t = await team();
    const { teamId, incidentId } = await escalating(t);
    // Level 1 was paged a moment ago, when the run started: no level moved, so nobody is made to wait.
    expect(await escalate(t, teamId, t.ana.email)).toMatchObject({ ok: true, did: "escalated" });
    expect(await run(t, incidentId)).toMatchObject({ paged: 2, status: "running" });
    // The page that escalation made does hold the next one back.
    expect(await escalate(t, teamId, t.caio.email)).toMatchObject({
      ok: false,
      code: "just_paged",
      level: 2,
    });
  });

  test("escalating right after the level's timeout fired does not skip the level it paged", async () => {
    const t = await team();
    const { teamId, incidentId } = await escalating(t);
    const seen = (await run(t, incidentId)).paged;
    // Level 1 times out: the alarm pages level 2.
    await t.withShard(async (shard, state) => {
      const at = Date.now() - 1;
      const row = shard.store.get("incidents", incidentId)!;
      shard.store.update("incidents", incidentId, {
        escalation: { ...row.escalation!, nextAt: at },
      });
      shard.store.update("escalation_timers", incidentId, { at });
      await state.storage.setAlarm(at);
    });
    await runDurableObjectAlarm(t.stub);
    expect(await run(t, incidentId)).toMatchObject({ paged: 2 });
    // Typed, with no step: the page is too young to have been seen.
    expect(await escalate(t, teamId, t.caio.email)).toMatchObject({
      ok: false,
      code: "just_paged",
      level: 2,
    });
    // With the step the person saw (level 1's): the run moved past it.
    expect(await escalate(t, teamId, t.caio.email, { step: seen })).toMatchObject({
      ok: false,
      code: "just_paged",
      level: 2,
    });
    expect(await run(t, incidentId)).toMatchObject({ paged: 2 });
    // With the step it is at now, or once the page is old enough: the next level.
    expect(
      await escalate(t, teamId, t.caio.email, { step: (await run(t, incidentId)).paged }),
    ).toMatchObject({ ok: true, did: "escalated" });
    expect(await run(t, incidentId)).toMatchObject({ paged: 3 });
    await pagedAgo(t, incidentId, SLACK_ESCALATE_WINDOW_MS + 1000);
    expect(await escalate(t, teamId, t.caio.email)).toMatchObject({ ok: true });
    expect(await run(t, incidentId)).toMatchObject({ paged: 4 });
  });

  test("one Slack message is one update, whoever posts it and however often", async () => {
    const t = await team();
    const teamId = await connect(t);
    await t.run(
      "slack.configure",
      { channelId: "C0CHAN0001", locale: "en", incidentChannels: "all" },
      owner(t),
    );
    await slackAct(
      env,
      {
        teamId,
        slackUserId: slackUser(teamId, t.ana.email),
        action: { kind: "declare", title: "Checkout down", severity: "sev1" },
        key: key(),
      },
      usersInfo,
    );
    await deliver(await eventsOf(t, "incident.declared"), slackApi().send);
    const message = key();
    const post = (email: string) =>
      slackAct(
        env,
        {
          teamId,
          slackUserId: slackUser(teamId, email),
          action: {
            kind: "update",
            body: "Rolled back",
            fromMessage: true,
            channelId: "C0INC00001",
          },
          key: message,
        },
        usersInfo,
      );
    expect(await post(t.caio.email)).toMatchObject({ ok: true, did: "updated" });
    expect(await post(t.bia.email)).toMatchObject({ ok: true, did: "updated", replayed: true });
    expect(await post(t.caio.email)).toMatchObject({ ok: true, did: "updated", replayed: true });
    expect(await eventsOf(t, "incident.update_posted")).toHaveLength(1);
  });

  test("a retried Events API message is answered once", async () => {
    const t = await team();
    const teamId = await connect(t);
    await t.run(
      "slack.configure",
      { channelId: "C0CHAN0001", locale: "en", incidentChannels: "all" },
      owner(t),
    );
    await slackAct(
      env,
      {
        teamId,
        slackUserId: slackUser(teamId, t.ana.email),
        action: { kind: "declare", title: "Checkout down", severity: "sev1" },
        key: key(),
      },
      usersInfo,
    );
    await deliver(await eventsOf(t, "incident.declared"), slackApi().send);
    const slack = slackApi();
    const send: Fetch = (request) =>
      request.url.endsWith("/users.info") ? usersInfo(request) : slack.send(request);
    const request = {
      teamId,
      slackUserId: slackUser(teamId, t.caio.email),
      action: {
        kind: "update" as const,
        body: "Rolled back",
        fromMessage: true,
        channelId: "C0INC00001",
      },
      key: key(),
      answer: { channelId: "C0INC00001" },
    };
    expect(await actAndAnswer(env, request, send)).toMatchObject({ ok: true });
    expect(await actAndAnswer(env, request, send)).toMatchObject({ ok: true, replayed: true });
    expect(slack.calls.filter((call) => call.method === "chat.postEphemeral")).toHaveLength(1);
    expect(await eventsOf(t, "incident.update_posted")).toHaveLength(1);
  });

  test("a form's type or services that are gone or unreadable: declared without them, and the person told", async () => {
    const t = await team();
    const teamId = await connect(t);
    const declare = (more: Record<string, unknown>) =>
      slackAct(
        env,
        {
          teamId,
          slackUserId: slackUser(teamId, t.caio.email),
          action: { kind: "declare", title: "Checkout down", severity: "sev2", ...more } as never,
          key: key(),
        },
        usersInfo,
      );
    expect(await declare({ typeId: newId("typ", Date.now(), random) })).toMatchObject({
      ok: true,
      did: "declared",
      dropped: true,
    });
    expect(await declare({ serviceIds: ["nope"] })).toMatchObject({ ok: true, dropped: true });
    expect(await declare({ typeId: "typ_?" })).toMatchObject({ ok: true, dropped: true });
    const plain = await declare({});
    expect(plain).toMatchObject({ ok: true });
    expect(plain).not.toHaveProperty("dropped");
    expect(await incidents(t)).toHaveLength(4);
    expect(
      (await incidents(t)).every((one) => one.typeId === undefined || one.typeId === null),
    ).toBe(true);
  });

  test("D1 failing while members are looked up is retried, never recorded as an unreadable token", async () => {
    const t = await team();
    const teamId = await connect(t, newTeam(), null);
    await t.run("member.sync", { id: t.ana.id, name: "Ana", role: "owner" }, owner(t), true);
    await t.run(
      "slack.configure",
      { channelId: null, locale: "en", incidentChannels: "all" },
      owner(t),
    );
    await slackAct(
      env,
      {
        teamId,
        slackUserId: slackUser(teamId, t.ana.email),
        action: { kind: "declare", title: "Checkout down", severity: "sev1" },
        key: key(),
      },
      usersInfo,
    );
    const declared = (await eventsOf(t, "incident.declared"))[0]!;
    const down = {
      prepare: () => {
        throw new Error("D1 down");
      },
    } as unknown as D1Database;
    const slack = slackApi();
    const delay = await notifySlack(
      declared,
      {
        WORKSPACE: env.WORKSPACE,
        DB: down,
        SLACK_TOKEN_KEY: Reflect.get(env, "SLACK_TOKEN_KEY") as string,
      },
      slack.send,
    );
    expect(delay).toBeGreaterThan(0);
    expect(slack.calls.map((call) => call.method)).toEqual(["conversations.create"]);
    expect(await eventsOf(t, "notification.failed")).toHaveLength(0);
  });

  test("an event holds the incident across its jobs: another event of it waits until it is done", async () => {
    const t = await team();
    const teamId = await connect(t);
    await t.run("member.sync", { id: t.ana.id, name: "Ana", role: "owner" }, owner(t), true);
    await t.run(
      "slack.configure",
      { channelId: "C0CHAN0001", locale: "en", incidentChannels: "all" },
      owner(t),
    );
    await slackAct(
      env,
      {
        teamId,
        slackUserId: slackUser(teamId, t.ana.email),
        action: { kind: "declare", title: "Checkout down", severity: "sev1" },
        key: key(),
      },
      usersInfo,
    );
    const incident = (await incidents(t))[0]!;
    await t.run("incident.setSeverity", { id: incident.id, severity: "sev2" }, owner(t));
    const declared = (await eventsOf(t, "incident.declared"))[0]!;
    const changed = (await eventsOf(t, "incident.severity_changed"))[0]!;
    const desk = <R>(fn: (instance: WorkspaceDO) => R) =>
      runInDurableObject(t.stub, (instance: WorkspaceDO) => fn(instance));
    const plan = (event: BrigadeEvent) => desk((instance) => instance.planSlack(event));
    const done = (job: string, more: Record<string, unknown> = {}) =>
      desk((instance) =>
        instance.recordSlack(declared, job, {
          ok: true,
          channel: "C0INC00001",
          ts: "1790000000.000001",
          ...more,
        }),
      );
    const jobs: string[] = [];
    for (;;) {
      const next = await plan(declared);
      if (!next.send) break;
      jobs.push(next.job);
      // Between every two jobs of the declaration, the severity change waits.
      expect(await plan(changed)).toMatchObject({ send: false, reason: "held" });
      await done(
        next.job,
        next.work.kind === "lookup" ? { people: { [t.ana.id]: "U0SLACKANA" } } : {},
      );
    }
    expect(jobs).toEqual([
      "channel",
      `lookup:${t.ana.id}`,
      "invite",
      "message:incident",
      "message:main",
    ]);
    // Done: the change goes on at once.
    expect(await plan(changed)).toMatchObject({ send: true });
  });

  test("invites are looked up a few at a time, and a 429 waits for Retry-After without leaving anyone out", async () => {
    const t = await team();
    const teamId = await connect(t);
    await t.run("member.sync", { id: t.ana.id, name: "Ana", role: "owner" }, owner(t), true);
    await t.run(
      "slack.configure",
      { channelId: null, locale: "en", incidentChannels: "all" },
      owner(t),
    );
    await slackAct(
      env,
      {
        teamId,
        slackUserId: slackUser(teamId, t.ana.email),
        action: { kind: "declare", title: "Checkout down", severity: "sev1" },
        key: key(),
      },
      usersInfo,
    );
    const declared = (await eventsOf(t, "incident.declared"))[0]!;
    let limited = true;
    const slack = slackApi({
      "users.lookupByEmail": () => {
        if (limited) return new Response("", { status: 429, headers: { "Retry-After": "20" } });
        const user = [...slackUsers.values()].find(
          (one) => Object(one.profile).email === t.ana.email,
        );
        return Response.json({ ok: true, user });
      },
    });
    const first = await deliver([declared], slack.send);
    expect(first.retryMessages).toEqual([{ msgId: "msg-0", delaySeconds: 20 }]);
    expect(slack.calls.map((call) => call.method)).toEqual([
      "conversations.create",
      "users.lookupByEmail",
    ]);
    limited = false;
    await t.withShard((_shard, state) =>
      state.storage.sql.exec("update slack_jobs set retry_at = 0"),
    );
    await deliver([declared], slack.send, 2);
    const ana = [...slackUsers.values()].find((one) => Object(one.profile).email === t.ana.email)!;
    expect(slack.calls.filter((call) => call.method === "conversations.invite")).toEqual([
      { method: "conversations.invite", body: expect.objectContaining({ users: ana.id }) },
    ]);
    // Many people: a batch per job, each one's lookups started at once and bounded, so a job fits the claim.
    const many = Array.from({ length: SLACK_LOOKUP_BATCH + 3 }, (_, i) => `usr_many${i}`);
    for (const id of many) {
      await t.run(
        "member.sync",
        { id, name: null, role: "responder" },
        { kind: "user", id, role: "responder" },
        true,
      );
    }
    const incident = (await incidents(t))[0]!;
    const paged: BrigadeEvent = {
      ...declared,
      id: newId("evt", Date.now(), random),
      type: "escalation.paged",
      data: { incidentId: incident.id, userIds: many },
    };
    const planned = await runInDurableObject(t.stub, (instance: WorkspaceDO) =>
      instance.planSlack(paged),
    );
    expect(planned).toMatchObject({
      send: true,
      job: `lookup:${many[0]}`,
      work: { kind: "lookup", userIds: many.slice(0, SLACK_LOOKUP_BATCH) },
    });
  });
});

/** An action as `slackAct` takes it. */
type SlackActRequestAction = Parameters<typeof slackAct>[1]["action"];

describe("revoking: the Events API and Disconnect", () => {
  test("app_uninstalled marks the connection revoked, forgets the token, and nothing more is sent", async () => {
    const t = await team();
    const teamId = await connect(t);
    await slackRevoked(env, { teamId, reason: "uninstalled" });
    const { row, token } = await t.withShard((shard) => ({
      row: shard.store.get("slack", SLACK_ROW_ID),
      token: shard.store.get("slack_tokens", SLACK_ROW_ID),
    }));
    expect(row).toMatchObject({
      teamId,
      revokedReason: "uninstalled",
      revokedAt: expect.any(Number),
    });
    expect(token).toBeUndefined();
    expect((await eventsOf(t, "slack.revoked")).map((one) => one.data)).toEqual([
      { teamId, reason: "uninstalled" },
    ]);
    await t.run(
      "incident.declare",
      { id: newId("inc", Date.now(), random), title: "Down" },
      owner(t),
    );
    const slack = slackApi();
    await deliver(await eventsOf(t, "incident.declared"), slack.send);
    expect(slack.calls).toHaveLength(0);
    // Connecting again clears it (the channel stays: the same team).
    await connect(t, teamId, null);
    const again = await t.withShard((shard) => shard.store.get("slack", SLACK_ROW_ID));
    expect(again).toMatchObject({ revokedAt: null, revokedReason: null });
  });

  test("tokens_revoked counts only for this workspace's bot", async () => {
    const t = await team();
    const teamId = await connect(t);
    await slackRevoked(env, { teamId, reason: "tokens_revoked", botUserIds: ["U0OTHERBOT"] });
    expect(
      await t.withShard((shard) => shard.store.get("slack_tokens", SLACK_ROW_ID)),
    ).toBeDefined();
    await slackRevoked(env, { teamId, reason: "tokens_revoked", botUserIds: ["U0BOT00001"] });
    expect(
      await t.withShard((shard) => shard.store.get("slack_tokens", SLACK_ROW_ID)),
    ).toBeUndefined();
  });

  test("Disconnect gives the token back to Slack with auth.revoke, once, and forgets it", async () => {
    const t = await team();
    await connect(t);
    await t.run("slack.disconnect", {}, owner(t));
    const kept = await t.withShard((shard) => shard.store.scan("slack_revocations"));
    expect(kept).toHaveLength(1);
    // Sealed, never the token itself.
    expect(JSON.stringify(kept)).not.toContain(BOT_TOKEN);
    const slack = slackApi();
    const disconnected = await eventsOf(t, "slack.disconnected");
    await deliver(disconnected, slack.send);
    await deliver(disconnected, slack.send);
    expect(slack.calls.map((call) => call.method)).toEqual(["auth.revoke"]);
    expect(await t.withShard((shard) => shard.store.scan("slack_revocations"))).toEqual([]);
    expect(await eventsOf(t, "slack.token_forgotten")).toHaveLength(1);
  });

  test("a reinstall Slack answered with the same token keeps it", async () => {
    const t = await team();
    const teamId = await connect(t);
    await t.run("slack.disconnect", {}, owner(t));
    await connect(t, teamId, null);
    const slack = slackApi();
    await deliver(await eventsOf(t, "slack.disconnected"), slack.send);
    expect(slack.calls).toHaveLength(0);
    expect(
      await t.withShard((shard) => shard.store.get("slack_tokens", SLACK_ROW_ID)),
    ).toBeDefined();
  });
});

describe("the declare form and the channel picker", () => {
  test("/inc declare alone opens the form with the workspace's types and services", async () => {
    const t = await team();
    const teamId = await connect(t);
    const slack = slackApi();
    const send: Fetch = (request) =>
      request.url.endsWith("/users.info") ? usersInfo(request) : slack.send(request);
    const opened = await openSlackDeclare(
      env,
      {
        teamId,
        slackUserId: slackUser(teamId, t.caio.email),
        triggerId: "1000000000.1000000000.test",
        responseUrl: "https://hooks.slack.com/commands/T0/1/test",
        severity: "sev2",
      },
      send,
    );
    expect(opened).toEqual({ ok: true });
    const view = slack.calls[0];
    expect(view?.method).toBe("views.open");
    expect(view?.body.trigger_id).toBe("1000000000.1000000000.test");
    expect(JSON.stringify(view?.body.view)).toContain("brigade_declare");
    // A viewer is told they cannot, without a form.
    const viewer = await openSlackDeclare(
      env,
      {
        teamId,
        slackUserId: slackUser(teamId, t.duda.email),
        triggerId: "1000000000.1000000000.test",
        responseUrl: "https://hooks.slack.com/commands/T0/1/test",
        severity: "sev3",
      },
      send,
    );
    expect(viewer).toMatchObject({ ok: false, code: "forbidden" });
  });

  test("GET /workspaces/:id/slack/channels lists the channels Brigade can post in, for owners and admins", async () => {
    const t = await team();
    await connect(t);
    const slack = slackApi({
      "conversations.list": () =>
        Response.json({
          ok: true,
          channels: [
            { id: "C0CHAN0002", name: "incidents", is_private: false, is_member: false },
            { id: "G0PRIV0001", name: "sre-private", is_private: true, is_member: true },
            { id: "G0PRIV0002", name: "hr", is_private: true, is_member: false },
            { id: "C0CHAN0001", name: "general", is_private: false },
          ],
          response_metadata: { next_cursor: "" },
        }),
    });
    const list = (by: Person) => {
      const request = new Request(`${ORIGIN}/workspaces/${t.id}/slack/channels`, {
        headers: { Cookie: by.cookie },
      });
      return listSlackChannels(
        request,
        env,
        () => workerAuth(env, createExecutionContext(), request),
        t.id,
        slack.send,
      );
    };
    const response = await list(t.bia);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      channels: [
        { id: "C0CHAN0001", name: "general", private: false },
        { id: "C0CHAN0002", name: "incidents", private: false },
        { id: "G0PRIV0001", name: "sre-private", private: true },
      ],
    });
    expect(slack.calls[0]?.body).toMatchObject({
      types: "public_channel,private_channel",
      exclude_archived: "true",
    });
    expect((await list(t.caio)).status).toBe(403);
    const other = await team();
    const none = new Request(`${ORIGIN}/workspaces/${other.id}/slack/channels`, {
      headers: { Cookie: other.ana.cookie },
    });
    const refused = await listSlackChannels(
      none,
      env,
      () => workerAuth(env, createExecutionContext(), none),
      other.id,
      slack.send,
    );
    expect(refused.status).toBe(409);
  });
});
