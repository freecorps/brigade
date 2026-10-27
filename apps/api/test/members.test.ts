// Member management end to end (src/members.ts): `PATCH`/`DELETE /workspaces/:id/members/:userId` through the
// Worker, D1 first and then the shard's copy, its events and its sockets; what paging sees afterwards; and both
// sides of a failure (D1 failing, the shard failing after D1 committed) with their repair.
import { env, exports } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import {
  MAX_RECONCILED_MEMBERS,
  newId,
  type Actor,
  type MemberChange,
  type Role,
} from "@freecorps/brigade-schema";
import { PROTOCOL_VERSION } from "@freecorps/brigade-sync/protocol";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { ACTOR_HEADER, MEMBER_NAME_HEADER } from "../src/actor.ts";
import {
  MEMBER_REPAIR_DELAY_MS,
  MEMBER_REPAIR_RETRY_MS,
  Membership,
  type MemberChangeResult,
} from "../src/members.ts";
import { OutboxDrain, type BrigadeEvent } from "../src/outbox.ts";
import { pageTargets } from "../src/paging.ts";
import { Shard } from "../src/shard.ts";
import { WORKSPACE_HEADER, type SocketState, type WorkspaceDO } from "../src/workspace.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

const open: WebSocket[] = [];
afterEach(() => {
  for (const ws of open.splice(0)) {
    try {
      ws.close(1000, "done");
    } catch {
      // Already closed by the shard.
    }
  }
});

let people = 0;
let clients = 0;
/** A new client IP (TEST-NET-2) per call: sign-up is rate-limited per IP. */
const clientIp = () => `198.51.${Math.floor(++clients / 250) % 250}.${(clients % 250) + 1}`;

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

type Person = { id: string; cookie: string };

async function signUp(name: string): Promise<Person> {
  const response = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({
      name,
      email: `${name.toLowerCase()}-m${++people}@example.com`,
      password: PASSWORD,
    }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return { id: body.user.id, cookie };
}

async function addMember(workspaceId: string, userId: string, role: string) {
  await env.DB.prepare(
    `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, ?, ?)`,
  )
    .bind(newId("mem", Date.now(), random), workspaceId, userId, role, new Date().toISOString())
    .run();
}

/** Ana owns a new workspace; Bia is its admin, Caio a responder and Duda a viewer. */
async function team() {
  const [ana, bia, caio, duda] = await Promise.all(
    ["Ana", "Bia", "Caio", "Duda"].map((name) => signUp(name)),
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
  return { id, stub, ana: ana!, bia: bia!, caio: caio!, duda: duda!, withShard };
}

type Team = Awaited<ReturnType<typeof team>>;

const roleIn = (workspaceId: string, userId: string) =>
  env.DB.prepare(`select role from member where "organizationId" = ? and "userId" = ?`)
    .bind(workspaceId, userId)
    .first<{ role: string }>()
    .then((row) => row?.role ?? null);

const patchRole = (t: Team, by: Person, target: Person, role: string) =>
  api(`/workspaces/${t.id}/members/${target.id}`, {
    method: "PATCH",
    headers: { Cookie: by.cookie },
    body: JSON.stringify({ role }),
  });

const remove = (t: Team, by: Person, target: Person) =>
  api(`/workspaces/${t.id}/members/${target.id}`, {
    method: "DELETE",
    headers: { Cookie: by.cookie },
  });

/** Opens a socket as `person` and says hello; resolves with it and a promise of its close code. */
async function connect(t: Team, person: Person) {
  const response = await exports.default.fetch(`${ORIGIN}/sync/${t.id}`, {
    headers: { Upgrade: "websocket", Cookie: person.cookie, Origin: ORIGIN },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  open.push(socket);
  const closed = new Promise<number>((resolve) =>
    socket.addEventListener("close", (event) => resolve(event.code)),
  );
  socket.send(JSON.stringify({ type: "hello", protocol: PROTOCOL_VERSION, clientId: "test" }));
  // The upgrade's reconcile runs after the socket opens: let it finish before the test changes anything.
  await t.stub.reconcileMembers();
  return { socket, closed };
}

const events = (t: Team, type: string) =>
  t.withShard((_shard, state) =>
    state.storage.sql
      .exec<{ event: string }>("select event from outbox order by seq")
      .toArray()
      .map((row) => JSON.parse(row.event) as BrigadeEvent)
      .filter((event) => event.type === type),
  );

/** Registers a device for `actor` straight in the shard, as `device.register` from their phone would. */
const device = (t: Team, actor: Actor) =>
  t.withShard((shard) => {
    const { result } = shard.mutate({
      clientId: "test",
      mutationId: newId("mut", Date.now(), random),
      actor,
      name: "device.register",
      args: {
        id: newId("dev", Date.now(), random),
        platform: "ios",
        environment: "sandbox",
        pushToken: `token${newId("tok", Date.now(), random)}`.replace(/_/g, ""),
        voipToken: null,
        publicKey: `B${"a".repeat(86)}`,
      },
      now: Date.now(),
      internal: true,
    });
    expect(result).toMatchObject({ ok: true });
  });

/** Who a page for an incident with no commander would reach, declared by a monitor. */
const paged = (t: Team) =>
  t.withShard((shard) =>
    [
      ...new Set(
        pageTargets(shard.store, { roles: {} }, "sys_monitors").targets.map((x) => x.userId),
      ),
    ].sort(),
  );

const user = (person: Person, role: Role): Actor => ({ kind: "user", id: person.id, role });

/** A Membership on the workspace's own storage, with D1 or the shard swapped for a failing one. */
const membership = (
  t: Team,
  state: DurableObjectState,
  options: { db?: D1Database; shardFails?: boolean } = {},
) => {
  const shard = new Shard(state.storage, {
    shard: "workspace",
    randomBytes: random,
    log: () => {},
  });
  const failing = {
    store: shard.store,
    mutate: () => {
      throw new Error("storage failed");
    },
  } as unknown as Shard;
  return new Membership({
    db: options.db ?? env.DB,
    shard: options.shardFails ? failing : shard,
    randomBytes: random,
    sql: state.storage.sql,
    log: () => {},
    committed: () => {},
    closeSockets: () => {},
    wake: (at) => void state.storage.setAlarm(at),
  });
};
/** Adds `count` made-up responders to the workspace in D1 (users included), none of whom ever opened Brigade. */
async function crowd(t: Team, count: number) {
  const prefix = `usr_crowd${t.id.slice(-8).toLowerCase()}`;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `with recursive n(i) as (select 1 union all select i + 1 from n where i < ?1)
       insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       select ?2 || i, 'Crowd ' || i, ?2 || i || '@example.com', 0, ?3, ?3 from n`,
    ).bind(count, prefix, now),
    env.DB.prepare(
      `with recursive n(i) as (select 1 union all select i + 1 from n where i < ?1)
       insert into member (id, "organizationId", "userId", role, "createdAt")
       select 'mem_' || ?2 || i, ?4, ?2 || i, 'responder', ?3 from n`,
    ).bind(count, prefix, now, t.id),
  ]);
}

/**
 * A sync upgrade as the Worker forwards it, sent straight to the shard: one the Worker authenticated before a
 * change landed and that reaches the shard after it.
 */
const staleUpgrade = (t: Team, person: Person, role: Role) =>
  t.stub.fetch(`${ORIGIN}/sync/${t.id}`, {
    headers: {
      Upgrade: "websocket",
      [WORKSPACE_HEADER]: t.id,
      [ACTOR_HEADER]: JSON.stringify(user(person, role)),
      [MEMBER_NAME_HEADER]: encodeURIComponent("Caio"),
    },
  });

/** Makes a due member repair as if `MEMBER_REPAIR_DELAY_MS` passed, then runs the shard's alarm. */
async function repairNow(t: Team) {
  await t.withShard((_shard, state) =>
    state.storage.sql.exec("update member_repair set value = ? where key = 'at'", Date.now() - 1),
  );
  expect(await runDurableObjectAlarm(t.stub)).toBe(true);
}

const brokenDb = {
  prepare: () => {
    throw new Error("D1 is down");
  },
} as unknown as D1Database;

/** A D1 whose every read never answers. */
const hangingDb = {
  prepare: () => ({
    bind: () => ({ all: () => new Promise(() => {}), first: () => new Promise(() => {}) }),
  }),
} as unknown as D1Database;

/**
 * Unpauses the shard's outbox drain with one that records the event types it sends instead of queueing them;
 * `drained` resolves when its first run that sent anything finishes.
 */
function recordingDrain(instance: WorkspaceDO, state: DurableObjectState) {
  const sent: string[] = [];
  let done: () => void = () => {};
  const drained = new Promise<void>((resolve) => (done = resolve));
  const drain = new OutboxDrain(
    state.storage.sql,
    async (messages) => {
      for (const message of messages) sent.push((message.body as BrigadeEvent).type);
    },
    () => {},
  );
  const run = drain.drain.bind(drain);
  drain.drain = async (now) => {
    const count = await run(now);
    if (count > 0) done();
    return count;
  };
  Reflect.set(instance, "drainPaused", false);
  Reflect.set(instance, "drain", drain);
  return { sent, drained };
}

describe("PATCH /workspaces/:id/members/:userId: changing a role", () => {
  test("an owner demotes a responder: D1, the shard's copy and member.role_changed, and their socket closes", async () => {
    const t = await team();
    const caio = await connect(t, t.caio);
    expect(await t.withShard((shard) => shard.store.get("members", t.caio.id)?.role)).toBe(
      "responder",
    );

    const response = await patchRole(t, t.ana, t.caio, "viewer");
    expect(response.status).toBe(200);
    expect(await roleIn(t.id, t.caio.id)).toBe("viewer");
    expect(await t.withShard((shard) => shard.store.get("members", t.caio.id)?.role)).toBe(
      "viewer",
    );
    expect(await events(t, "member.role_changed")).toMatchObject([
      {
        actor: { kind: "user", id: t.ana.id },
        subject: t.caio.id,
        data: { userId: t.caio.id, from: "responder", to: "viewer" },
      },
    ]);
    // Closed so it reconnects as a viewer: an open socket never keeps the old role.
    expect(await caio.closed).toBe(1012);
  });

  test("a demoted member stops being paged at once", async () => {
    const t = await team();
    await connect(t, t.caio);
    await device(t, user(t.caio, "responder"));
    expect(await paged(t)).toEqual([t.caio.id]);
    expect((await patchRole(t, t.bia, t.caio, "viewer")).status).toBe(200);
    expect(await paged(t)).toEqual([]);
  });

  test("a member D1 holds with a role Brigade does not know is refused, not taken for gone", async () => {
    const t = await team();
    await connect(t, t.caio);
    await device(t, user(t.caio, "responder"));
    await env.DB.prepare(
      `update member set role = 'member' where "organizationId" = ? and "userId" = ?`,
    )
      .bind(t.id, t.caio.id)
      .run();
    expect((await remove(t, t.caio, t.caio)).status).toBe(403);
    expect((await remove(t, t.ana, t.caio)).status).toBe(403);
    expect(await roleIn(t.id, t.caio.id)).toBe("member");
    expect(await events(t, "member.removed")).toEqual([]);
  });

  test("admins cannot touch owners or make one; responders and viewers change no role", async () => {
    const t = await team();
    expect((await patchRole(t, t.bia, t.ana, "admin")).status).toBe(403);
    expect((await patchRole(t, t.bia, t.caio, "owner")).status).toBe(403);
    expect((await patchRole(t, t.caio, t.duda, "responder")).status).toBe(403);
    expect((await patchRole(t, t.duda, t.duda, "responder")).status).toBe(403);
    expect(await roleIn(t.id, t.ana.id)).toBe("owner");
    expect(await roleIn(t.id, t.caio.id)).toBe("responder");
    expect(await events(t, "member.role_changed")).toEqual([]);
  });

  test("the last owner cannot step down; with a second owner they can", async () => {
    const t = await team();
    const response = await patchRole(t, t.ana, t.ana, "admin");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "last_owner" });
    expect((await patchRole(t, t.ana, t.bia, "owner")).status).toBe(200);
    expect((await patchRole(t, t.ana, t.ana, "admin")).status).toBe(200);
    expect(await roleIn(t.id, t.ana.id)).toBe("admin");
    // Bia is now the only owner.
    expect((await patchRole(t, t.bia, t.bia, "responder")).status).toBe(409);
  });

  test("the same role again changes nothing and emits nothing", async () => {
    const t = await team();
    expect((await patchRole(t, t.ana, t.caio, "responder")).status).toBe(200);
    expect(await events(t, "member.role_changed")).toEqual([]);
  });

  test("refuses other sites, no session, outsiders, unknown members and bad roles", async () => {
    const t = await team();
    const outsider = await signUp("Eva");
    expect(
      (
        await exports.default.fetch(`${ORIGIN}/workspaces/${t.id}/members/${t.caio.id}`, {
          method: "PATCH",
          headers: { Origin: "https://evil.example", Cookie: t.ana.cookie },
          body: JSON.stringify({ role: "viewer" }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api(`/workspaces/${t.id}/members/${t.caio.id}`, {
          method: "PATCH",
          body: JSON.stringify({ role: "viewer" }),
        })
      ).status,
    ).toBe(401);
    expect((await patchRole(t, outsider, t.caio, "viewer")).status).toBe(403);
    expect((await patchRole(t, t.ana, outsider, "viewer")).status).toBe(404);
    expect((await patchRole(t, t.ana, t.caio, "member")).status).toBe(400);
    expect(
      (await api(`/workspaces/${t.id}/members/${t.caio.id}`, { headers: { Cookie: t.ana.cookie } }))
        .status,
    ).toBe(405);
    expect(await roleIn(t.id, t.caio.id)).toBe("responder");
  });
});

describe("DELETE /workspaces/:id/members/:userId: removing and leaving", () => {
  test("a removed member is deleted from D1 and the shard with every device, and is no longer paged", async () => {
    const t = await team();
    const caio = await connect(t, t.caio);
    await device(t, user(t.caio, "responder"));
    await device(t, user(t.caio, "responder"));
    expect(await paged(t)).toEqual([t.caio.id]);

    expect((await remove(t, t.bia, t.caio)).status).toBe(200);
    expect(await roleIn(t.id, t.caio.id)).toBeNull();
    expect(await paged(t)).toEqual([]);
    expect(
      await t.withShard((shard) => ({
        member: shard.store.get("members", t.caio.id) ?? null,
        devices: shard.store.scan("devices").filter((d) => d.userId === t.caio.id).length,
      })),
    ).toEqual({ member: null, devices: 0 });
    expect(await events(t, "member.removed")).toMatchObject([
      {
        actor: { id: t.bia.id },
        data: { userId: t.caio.id, role: "responder", reason: "removed" },
      },
    ]);
    expect(await events(t, "device.unregistered")).toMatchObject([
      { data: { userId: t.caio.id, reason: "member_removed" } },
      { data: { userId: t.caio.id, reason: "member_removed" } },
    ]);
    // Their socket closes, and the next upgrade is refused.
    expect(await caio.closed).toBe(1008);
    const again = await exports.default.fetch(`${ORIGIN}/sync/${t.id}`, {
      headers: { Upgrade: "websocket", Cookie: t.caio.cookie, Origin: ORIGIN },
    });
    expect(again.status).toBe(403);
  });

  test("a phone the removed member signed out of offline is free for the next member", async () => {
    const t = await team();
    await connect(t, t.caio);
    const deviceId = newId("dev", Date.now(), random);
    const register = (actor: Actor) =>
      t.withShard(
        (shard) =>
          shard.mutate({
            clientId: "test",
            mutationId: newId("mut", Date.now(), random),
            actor,
            name: "device.register",
            args: {
              id: deviceId,
              platform: "ios",
              environment: "sandbox",
              pushToken: "a".repeat(64),
              voipToken: null,
              publicKey: `B${"a".repeat(86)}`,
            },
            now: Date.now(),
            internal: true,
          }).result,
      );
    expect(await register(user(t.caio, "responder"))).toMatchObject({ ok: true });
    expect(await register(user(t.duda, "viewer"))).toMatchObject({ error: { code: "forbidden" } });
    expect((await remove(t, t.ana, t.caio)).status).toBe(200);
    expect(await register(user(t.duda, "viewer"))).toMatchObject({ ok: true });
  });

  test("anyone may leave, and their sessions move off the workspace", async () => {
    const t = await team();
    const response = await remove(t, t.duda, t.duda);
    expect(response.status).toBe(200);
    expect(await roleIn(t.id, t.duda.id)).toBeNull();
    expect(await events(t, "member.removed")).toMatchObject([
      { actor: { id: t.duda.id }, data: { userId: t.duda.id, reason: "left" } },
    ]);
    // Duda belonged to no other workspace, so no workspace is active any more.
    const active = await env.DB.prepare(
      `select "activeOrganizationId" as active from session where "userId" = ?`,
    )
      .bind(t.duda.id)
      .all<{ active: string | null }>();
    expect(active.results.every((row) => row.active !== t.id)).toBe(true);
  });

  test("leaving moves only the sessions that had this workspace open", async () => {
    const t = await team();
    // Duda also owns a workspace of her own, then joins a third one.
    const own = await api("/workspaces", {
      method: "POST",
      headers: { Cookie: t.duda.cookie },
      body: JSON.stringify({ name: "Duda's" }),
    });
    expect(own.status).toBe(201);
    const { id: second } = (await own.json()) as { id: string };
    const third = (await (
      await api("/workspaces", {
        method: "POST",
        headers: { Cookie: t.ana.cookie },
        body: JSON.stringify({ name: "Beta" }),
      })
    ).json()) as { id: string };
    await addMember(third.id, t.duda.id, "viewer");
    // Two sessions: one with this workspace open, one with the third.
    await env.DB.prepare(`update session set "activeOrganizationId" = ? where "userId" = ?`)
      .bind(t.id, t.duda.id)
      .run();
    const now = new Date().toISOString();
    const other = newId("ses", Date.now(), random);
    await env.DB.prepare(
      `insert into session (id, "expiresAt", token, "createdAt", "updatedAt", "userId", "activeOrganizationId")
       values (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(other, now, `tok${other}`, now, now, t.duda.id, third.id)
      .run();

    expect((await remove(t, t.duda, t.duda)).status).toBe(200);
    const active = await env.DB.prepare(
      `select id, "activeOrganizationId" as active from session where "userId" = ?`,
    )
      .bind(t.duda.id)
      .all<{ id: string; active: string | null }>();
    // The one on the left workspace moves to her oldest remaining; the other is left alone.
    expect(active.results.find((row) => row.id !== other)?.active).toBe(second);
    expect(active.results.find((row) => row.id === other)?.active).toBe(third.id);
  });

  test("the last owner cannot leave or be removed; admins cannot remove owners", async () => {
    const t = await team();
    expect((await remove(t, t.ana, t.ana)).status).toBe(409);
    expect((await remove(t, t.bia, t.ana)).status).toBe(403);
    expect((await remove(t, t.caio, t.duda)).status).toBe(403);
    expect(await roleIn(t.id, t.ana.id)).toBe("owner");
    expect(await roleIn(t.id, t.duda.id)).toBe("viewer");
  });
});

describe("when one side fails", () => {
  test("D1 failing changes nothing anywhere", async () => {
    const t = await team();
    await connect(t, t.caio);
    const result = await runInDurableObject(t.stub, (_instance: WorkspaceDO, state) =>
      membership(t, state, { db: brokenDb }).change(t.id, t.ana.id, t.caio.id, { kind: "remove" }),
    );
    expect(result).toEqual({ ok: false, code: "unavailable" });
    expect(await roleIn(t.id, t.caio.id)).toBe("responder");
    expect(await t.withShard((shard) => shard.store.get("members", t.caio.id)?.role)).toBe(
      "responder",
    );
    expect(await events(t, "member.removed")).toEqual([]);
  });

  test("the shard failing after D1 answers not_applied; the same request again stops the paging", async () => {
    const t = await team();
    await connect(t, t.caio);
    await device(t, user(t.caio, "responder"));
    const result = await runInDurableObject(t.stub, (_instance: WorkspaceDO, state) =>
      membership(t, state, { shardFails: true }).change(t.id, t.ana.id, t.caio.id, {
        kind: "remove",
      }),
    );
    expect(result).toEqual({ ok: false, code: "not_applied" });
    expect(await roleIn(t.id, t.caio.id)).toBeNull();
    // Not silent: the API answers 503 and the shard still has them, until the retry.
    expect(await paged(t)).toEqual([t.caio.id]);

    expect((await remove(t, t.ana, t.caio)).status).toBe(200);
    expect(await paged(t)).toEqual([]);
    // The catch-up is the members' system actor reconciling, never the caller.
    expect(await events(t, "member.removed")).toMatchObject([
      { actor: { id: "sys_members" }, data: { userId: t.caio.id, reason: "reconciled" } },
    ]);
    // Nothing left to catch up: a third DELETE is a 404.
    expect((await remove(t, t.ana, t.caio)).status).toBe(404);
  });

  test("a failed leave: the leaver's own retry stops their pages, though D1 no longer has them", async () => {
    const t = await team();
    const caio = await connect(t, t.caio);
    await device(t, user(t.caio, "responder"));
    const result = await runInDurableObject(t.stub, (_instance: WorkspaceDO, state) =>
      membership(t, state, { shardFails: true }).change(t.id, t.caio.id, t.caio.id, {
        kind: "remove",
      }),
    );
    expect(result).toEqual({ ok: false, code: "not_applied" });
    expect(await roleIn(t.id, t.caio.id)).toBeNull();
    expect(await paged(t)).toEqual([t.caio.id]);
    // The repair alarm is armed, whether or not anyone connects.
    expect(await t.withShard((_shard, state) => state.storage.getAlarm())).not.toBeNull();

    const retry = await remove(t, t.caio, t.caio);
    expect(retry.status).toBe(200);
    expect(await paged(t)).toEqual([]);
    expect(await events(t, "member.removed")).toMatchObject([
      { actor: { id: t.caio.id }, data: { userId: t.caio.id, role: "responder", reason: "left" } },
    ]);
    expect(await caio.closed).toBe(1008);
    // Done: once more they are just not a member, and only the leaver may finish their own leave.
    const again = await remove(t, t.caio, t.caio);
    expect(again.status).toBe(403);
    expect(await again.json()).toEqual({ error: "not_a_member" });
    expect((await remove(t, t.caio, t.duda)).status).toBe(403);
  });

  test("a leaver finishing with only devices left is announced with an unknown role, not a guessed one", async () => {
    const t = await team();
    await device(t, user(t.caio, "responder"));
    await env.DB.prepare(`delete from member where "organizationId" = ? and "userId" = ?`)
      .bind(t.id, t.caio.id)
      .run();
    expect(await t.withShard((shard) => shard.store.get("members", t.caio.id))).toBeUndefined();
    expect((await remove(t, t.caio, t.caio)).status).toBe(200);
    expect(await paged(t)).toEqual([]);
    expect(await events(t, "member.removed")).toMatchObject([
      { actor: { id: t.caio.id }, data: { userId: t.caio.id, role: null, reason: "left" } },
    ]);
  });

  test("a failed change is repaired by the shard's alarm, with nobody connecting or retrying", async () => {
    const t = await team();
    await connect(t, t.caio);
    await device(t, user(t.caio, "responder"));
    const result = await runInDurableObject(t.stub, (_instance: WorkspaceDO, state) =>
      membership(t, state, { shardFails: true }).change(t.id, t.caio.id, t.caio.id, {
        kind: "remove",
      }),
    );
    expect(result).toEqual({ ok: false, code: "not_applied" });
    expect(await paged(t)).toEqual([t.caio.id]);

    // As if MEMBER_REPAIR_DELAY_MS passed.
    await t.withShard((_shard, state) =>
      state.storage.sql.exec("update member_repair set value = ?", Date.now() - 1),
    );
    expect(await runDurableObjectAlarm(t.stub)).toBe(true);
    expect(await paged(t)).toEqual([]);
    expect(await events(t, "member.removed")).toMatchObject([
      { actor: { id: "sys_members" }, data: { userId: t.caio.id, reason: "reconciled" } },
    ]);
    expect(
      await t.withShard((_shard, state) =>
        state.storage.sql.exec("select * from member_repair").toArray(),
      ),
    ).toEqual([]);
  });

  test("a repair armed while the alarm drains the outbox keeps its alarm", async () => {
    const t = await team();
    await connect(t, t.caio);
    await device(t, user(t.caio, "responder"));
    const result = await runInDurableObject(t.stub, async (instance: WorkspaceDO, state) => {
      await state.storage.deleteAlarm();
      // The drain's send is where the alarm awaits longest: a leave whose shard step fails lands in it.
      let left: MemberChangeResult | undefined;
      Reflect.set(instance, "drainPaused", false);
      Reflect.set(instance, "drain", {
        drain: async () => {
          left = await membership(t, state, { shardFails: true }).change(
            t.id,
            t.caio.id,
            t.caio.id,
            {
              kind: "remove",
            },
          );
        },
        nextWake: () => null,
        failed: () => {},
      });
      await instance.alarm();
      return { left, alarm: await state.storage.getAlarm() };
    });
    expect(result.left).toEqual({ ok: false, code: "not_applied" });
    // The alarm still points at the repair instead of going away with nothing else due.
    expect(result.alarm).not.toBeNull();
    expect(result.alarm).toBeLessThanOrEqual(Date.now() + MEMBER_REPAIR_DELAY_MS);
    expect(await paged(t)).toEqual([t.caio.id]);

    // As if MEMBER_REPAIR_DELAY_MS passed: the alarm reconciles them with nobody connecting.
    await t.withShard((_shard, state) =>
      state.storage.sql.exec("update member_repair set value = ?", Date.now() - 1),
    );
    expect(await runDurableObjectAlarm(t.stub)).toBe(true);
    expect(await paged(t)).toEqual([]);
  });

  test("an alarm whose due repair hangs on D1 still drains the outbox first", async () => {
    const t = await team();
    await connect(t, t.caio);
    // An event waiting in the outbox: Caio's phone registering.
    await device(t, user(t.caio, "responder"));
    const result = await runInDurableObject(t.stub, async (instance: WorkspaceDO, state) => {
      const real: unknown = Reflect.get(instance, "membership");
      state.storage.sql.exec(
        "insert into member_repair (key, value) values ('at', ?) on conflict (key) do update set value = excluded.value",
        Date.now() - 1,
      );
      Reflect.set(instance, "membership", membership(t, state, { db: hangingDb }));
      const { sent, drained } = recordingDrain(instance, state);
      let finished = false;
      void instance.alarm().then(() => (finished = true));
      await drained;
      const backlog = state.storage.sql
        .exec<{ n: number }>("select count(*) as n from outbox")
        .one().n;
      Reflect.set(instance, "membership", real);
      Reflect.set(instance, "drainPaused", true);
      return { sent, backlog, finished };
    });
    expect(result.sent).toContain("device.registered");
    expect(result.backlog).toBe(0);
    // The repair is still waiting on D1: the drain did not wait for it.
    expect(result.finished).toBe(false);
  });

  test("an alarm whose due repair hangs on D1 ends after its budget and comes back for the repair", async () => {
    const t = await team();
    const result = await runInDurableObject(t.stub, async (instance: WorkspaceDO, state) => {
      const real: unknown = Reflect.get(instance, "membership");
      state.storage.sql.exec(
        "insert into member_repair (key, value) values ('at', ?) on conflict (key) do update set value = excluded.value",
        Date.now() - 1,
      );
      Reflect.set(instance, "membership", membership(t, state, { db: hangingDb }));
      Reflect.set(instance, "repairBudgetMs", 20);
      const before = Date.now();
      await instance.alarm();
      const alarm = await state.storage.getAlarm();
      Reflect.set(instance, "membership", real);
      Reflect.set(instance, "drainPaused", true);
      return { before, alarm };
    });
    // The alarm returned (the next drain is not held) and is set to try the repair again.
    expect(result.alarm).not.toBeNull();
    expect(result.alarm!).toBeLessThanOrEqual(result.before + MEMBER_REPAIR_RETRY_MS + 1000);
  });

  test("events a due repair writes go out in the same alarm", async () => {
    const t = await team();
    await connect(t, t.caio);
    const left = await runInDurableObject(t.stub, (_instance: WorkspaceDO, state) =>
      membership(t, state, { shardFails: true }).change(t.id, t.caio.id, t.caio.id, {
        kind: "remove",
      }),
    );
    expect(left).toEqual({ ok: false, code: "not_applied" });
    const sent = await runInDurableObject(t.stub, async (instance: WorkspaceDO, state) => {
      state.storage.sql.exec("delete from outbox");
      state.storage.sql.exec("update member_repair set value = ? where key = 'at'", Date.now() - 1);
      const { sent } = recordingDrain(instance, state);
      await instance.alarm();
      Reflect.set(instance, "drainPaused", true);
      return sent;
    });
    expect(sent).toContain("member.removed");
    expect(await paged(t)).toEqual([]);
  });

  test("a repair that cannot read D1 stays due and tries again", async () => {
    const t = await team();
    await connect(t, t.caio);
    const now = Date.now();
    const next = await runInDurableObject(t.stub, async (_instance: WorkspaceDO, state) => {
      state.storage.sql.exec(
        "insert into member_repair (key, value) values ('at', ?) on conflict (key) do update set value = excluded.value",
        now - 1,
      );
      return membership(t, state, { db: brokenDb }).repairDue(t.id, now);
    });
    expect(next).toBe(now + MEMBER_REPAIR_RETRY_MS);
    expect(
      await t.withShard(
        (_shard, state) =>
          state.storage.sql.exec<{ value: number }>("select value from member_repair").one().value,
      ),
    ).toBe(now + MEMBER_REPAIR_RETRY_MS);
  });

  test("the shard failing after D1 is repaired by the next sync upgrade into the workspace, without a retry", async () => {
    const t = await team();
    await connect(t, t.caio);
    await device(t, user(t.caio, "responder"));
    await connect(t, t.duda);
    const demoted = await runInDurableObject(t.stub, (_instance: WorkspaceDO, state) =>
      membership(t, state, { shardFails: true }).change(t.id, t.ana.id, t.duda.id, {
        kind: "role",
        role: "responder",
      }),
    );
    expect(demoted).toEqual({ ok: false, code: "not_applied" });
    const removed = await runInDurableObject(t.stub, (_instance: WorkspaceDO, state) =>
      membership(t, state, { shardFails: true }).change(t.id, t.ana.id, t.caio.id, {
        kind: "remove",
      }),
    );
    expect(removed).toEqual({ ok: false, code: "not_applied" });
    expect(await paged(t)).toEqual([t.caio.id]);

    // Anyone opening Brigade reconciles the shard with D1.
    await connect(t, t.ana);
    expect(await paged(t)).toEqual([]);
    expect(await t.withShard((shard) => shard.store.get("members", t.duda.id)?.role)).toBe(
      "responder",
    );
    expect(await events(t, "member.removed")).toMatchObject([
      { actor: { id: "sys_members" }, data: { userId: t.caio.id, reason: "reconciled" } },
    ]);
    expect(await events(t, "member.role_changed")).toMatchObject([
      {
        actor: { id: "sys_members" },
        data: { userId: t.duda.id, from: "viewer", to: "responder" },
      },
    ]);
  });
});

describe("a workspace past the reconcile limit", () => {
  test("a retried removal catches up on its one member instead of reconciling everyone", async () => {
    const t = await team();
    await crowd(t, MAX_RECONCILED_MEMBERS + 1);
    await connect(t, t.caio);
    await device(t, user(t.caio, "responder"));
    const result = await runInDurableObject(t.stub, (_instance: WorkspaceDO, state) =>
      membership(t, state, { shardFails: true }).change(t.id, t.ana.id, t.caio.id, {
        kind: "remove",
      }),
    );
    expect(result).toEqual({ ok: false, code: "not_applied" });
    expect(await paged(t)).toEqual([t.caio.id]);

    expect((await remove(t, t.ana, t.caio)).status).toBe(200);
    expect(await paged(t)).toEqual([]);
    expect(await events(t, "member.removed")).toMatchObject([
      { actor: { id: "sys_members" }, data: { userId: t.caio.id, reason: "reconciled" } },
    ]);
  });

  test("the repair alarm catches up on the members whose change the shard missed", async () => {
    const t = await team();
    await crowd(t, MAX_RECONCILED_MEMBERS + 1);
    await connect(t, t.caio);
    await device(t, user(t.caio, "responder"));
    await connect(t, t.duda);
    const results = await runInDurableObject(t.stub, async (_instance: WorkspaceDO, state) => {
      const failing = membership(t, state, { shardFails: true });
      return [
        await failing.change(t.id, t.ana.id, t.caio.id, { kind: "remove" }),
        await failing.change(t.id, t.ana.id, t.duda.id, { kind: "role", role: "responder" }),
      ];
    });
    expect(results).toEqual([
      { ok: false, code: "not_applied" },
      { ok: false, code: "not_applied" },
    ]);
    expect(await paged(t)).toEqual([t.caio.id]);

    await repairNow(t);
    expect(await paged(t)).toEqual([]);
    expect(await t.withShard((shard) => shard.store.get("members", t.duda.id)?.role)).toBe(
      "responder",
    );
    expect(await events(t, "member.removed")).toMatchObject([
      { actor: { id: "sys_members" }, data: { userId: t.caio.id, reason: "reconciled" } },
    ]);
    expect(await events(t, "member.role_changed")).toMatchObject([
      {
        actor: { id: "sys_members" },
        data: { userId: t.duda.id, from: "viewer", to: "responder" },
      },
    ]);
    // Nothing left owed: no target, no due repair (the tombstone runs out on its own).
    expect(
      await t.withShard((_shard, state) =>
        state.storage.sql
          .exec<{ key: string }>("select key from member_repair where key not like 'gone:%'")
          .toArray(),
      ),
    ).toEqual([]);
  });
});

describe("a sync upgrade the Worker let through before a removal", () => {
  test("is refused by the shard instead of restoring the removed member's copy", async () => {
    const t = await team();
    await connect(t, t.caio);
    expect((await remove(t, t.ana, t.caio)).status).toBe(200);

    const response = await staleUpgrade(t, t.caio, "responder");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "not_a_member" });
    expect(await t.withShard((shard) => shard.store.get("members", t.caio.id))).toBeUndefined();
    // One removal, announced once.
    expect(await events(t, "member.removed")).toMatchObject([
      { actor: { id: t.ana.id }, data: { userId: t.caio.id, reason: "removed" } },
    ]);
  });

  test("a member D1 has again is not refused", async () => {
    const t = await team();
    expect((await remove(t, t.ana, t.caio)).status).toBe(200);
    await addMember(t.id, t.caio.id, "viewer");
    // Anyone's upgrade reconciles with D1, which has them again.
    await connect(t, t.duda);
    await connect(t, t.caio);
  });

  test("a re-added member's own upgrade, the first to arrive, is not refused", async () => {
    const t = await team();
    expect((await remove(t, t.ana, t.caio)).status).toBe(200);
    await addMember(t.id, t.caio.id, "viewer");
    // Nobody else connects first: the tombstone is checked against D1, which has them again.
    await connect(t, t.caio);
    expect(await t.withShard((shard) => shard.store.get("members", t.caio.id)?.role)).toBe(
      "viewer",
    );
    expect(
      await t.withShard((_shard, state) =>
        state.storage.sql
          .exec("select key from member_repair where key = ?", `gone:${t.caio.id}`)
          .toArray(),
      ),
    ).toEqual([]);
  });

  test("a tombstone D1 cannot be checked against still refuses", async () => {
    const t = await team();
    expect((await remove(t, t.ana, t.caio)).status).toBe(200);
    await addMember(t.id, t.caio.id, "viewer");
    const real = await runInDurableObject(t.stub, (instance: WorkspaceDO, state) => {
      const original: unknown = Reflect.get(instance, "membership");
      Reflect.set(instance, "membership", membership(t, state, { db: brokenDb }));
      return original;
    });
    const response = await staleUpgrade(t, t.caio, "viewer");
    await runInDurableObject(t.stub, (instance: WorkspaceDO) => {
      Reflect.set(instance, "membership", real);
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "not_a_member" });
  });

  test("whose reconcile then fails arms the repair alarm, which removes the copy it restored", async () => {
    const t = await team();
    expect((await remove(t, t.ana, t.caio)).status).toBe(200);
    // Past the tombstone, and with D1 failing for the shard: the upgrade restores the copy and cannot reconcile.
    const real = await runInDurableObject(t.stub, (instance: WorkspaceDO, state) => {
      state.storage.sql.exec("update member_repair set value = 0 where key like 'gone:%'");
      const original: unknown = Reflect.get(instance, "membership");
      Reflect.set(instance, "membership", membership(t, state, { db: brokenDb }));
      return original;
    });
    expect(real).toBeDefined();
    const response = await staleUpgrade(t, t.caio, "responder");
    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    socket.accept();
    open.push(socket);
    const closed = new Promise<number>((resolve) =>
      socket.addEventListener("close", (event) => resolve(event.code)),
    );
    // Waits for the upgrade's reconcile (and its failure) to finish.
    await t.stub.reconcileMembers();
    expect(await t.withShard((shard) => shard.store.get("members", t.caio.id)?.role)).toBe(
      "responder",
    );
    expect(
      await runInDurableObject(t.stub, (instance: WorkspaceDO, state) => {
        Reflect.set(instance, "membership", real);
        return {
          at: state.storage.sql
            .exec<{ value: number }>("select value from member_repair where key = 'at'")
            .toArray()[0]?.value,
        };
      }),
    ).toMatchObject({ at: expect.any(Number) });

    // D1 is back: the alarm removes the copy with nobody connecting, and the stale socket closes.
    await repairNow(t);
    expect(await t.withShard((shard) => shard.store.get("members", t.caio.id))).toBeUndefined();
    expect(await closed).toBe(1008);
    expect(await events(t, "member.removed")).toMatchObject([
      { actor: { id: t.ana.id }, data: { reason: "removed" } },
      { actor: { id: "sys_members" }, data: { reason: "reconciled" } },
    ]);
  });
});

describe("rules come before any repair", () => {
  test("an admin cannot 'make' an owner D1 already has, and the catch-up never names the caller", async () => {
    const t = await team();
    await connect(t, t.caio);
    await env.DB.prepare(
      `update member set role = 'owner' where "organizationId" = ? and "userId" = ?`,
    )
      .bind(t.id, t.caio.id)
      .run();
    expect((await patchRole(t, t.bia, t.caio, "owner")).status).toBe(403);
    expect(await events(t, "member.role_changed")).toEqual([]);

    expect((await patchRole(t, t.ana, t.caio, "owner")).status).toBe(200);
    expect(await t.withShard((shard) => shard.store.get("members", t.caio.id)?.role)).toBe("owner");
    expect(await events(t, "member.role_changed")).toMatchObject([
      { actor: { id: "sys_members" }, data: { userId: t.caio.id, from: "responder", to: "owner" } },
    ]);
  });

  test("a viewer asking for a role a member already has is forbidden, not a conflict", async () => {
    const t = await team();
    const response = await patchRole(t, t.duda, t.caio, "responder");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  test("removing someone already gone from D1: forbidden without the right, reconciled with it", async () => {
    const t = await team();
    await connect(t, t.caio);
    await device(t, user(t.caio, "responder"));
    await env.DB.prepare(`delete from member where "organizationId" = ? and "userId" = ?`)
      .bind(t.id, t.caio.id)
      .run();
    expect((await remove(t, t.duda, t.caio)).status).toBe(403);
    expect(await paged(t)).toEqual([t.caio.id]);

    expect((await remove(t, t.bia, t.caio)).status).toBe(200);
    expect(await paged(t)).toEqual([]);
    expect(await events(t, "member.removed")).toMatchObject([
      { actor: { id: "sys_members" }, data: { userId: t.caio.id, reason: "reconciled" } },
    ]);
  });

  test("removing someone who was never a member is a 404, and emits nothing", async () => {
    const t = await team();
    const outsider = await signUp("Eva");
    expect((await remove(t, t.ana, outsider)).status).toBe(404);
    expect(
      (
        await api(`/workspaces/${t.id}/members/usr_nobody`, {
          method: "DELETE",
          headers: { Cookie: t.ana.cookie },
        })
      ).status,
    ).toBe(404);
    expect(await events(t, "member.removed")).toEqual([]);
  });

  test("an outsider 'leaving' gets the same 403 whether or not the workspace exists, and the shard reads no D1", async () => {
    const t = await team();
    const outsider = await signUp("Eva");
    const existing = await remove(t, outsider, outsider);
    const missing = await api(`/workspaces/ws_00000000000000000000000000/members/${outsider.id}`, {
      method: "DELETE",
      headers: { Cookie: outsider.cookie },
    });
    expect([existing.status, missing.status]).toEqual([403, 403]);
    expect([await existing.json(), await missing.json()]).toEqual([
      { error: "not_a_member" },
      { error: "not_a_member" },
    ]);
    expect(await events(t, "member.removed")).toEqual([]);
    // The route takes a workspace's own id only, never a dev shard's short name.
    const slug = await api(`/workspaces/demo/members/${outsider.id}`, {
      method: "DELETE",
      headers: { Cookie: outsider.cookie },
    });
    expect(slug.status).toBe(400);
    // With nothing of theirs in the shard, it answers before reading D1 (which is down here).
    const result = await runInDurableObject(t.stub, (_instance: WorkspaceDO, state) =>
      membership(t, state, { db: brokenDb }).finishLeave(t.id, outsider.id),
    );
    expect(result).toEqual({ ok: false, code: "not_found" });
  });
});

describe("edits made outside Brigade", () => {
  test("a member deleted or demoted in D1 is reconciled on the next upgrade, and their open socket closes", async () => {
    const t = await team();
    const caio = await connect(t, t.caio);
    await device(t, user(t.caio, "responder"));
    const bia = await connect(t, t.bia);
    await env.DB.prepare(`delete from member where "organizationId" = ? and "userId" = ?`)
      .bind(t.id, t.caio.id)
      .run();
    await env.DB.prepare(
      `update member set role = 'viewer' where "organizationId" = ? and "userId" = ?`,
    )
      .bind(t.id, t.bia.id)
      .run();

    await connect(t, t.duda);
    expect(await paged(t)).toEqual([]);
    expect(await caio.closed).toBe(1008);
    expect(await bia.closed).toBe(1012);
    expect(await t.withShard((shard) => shard.store.get("members", t.bia.id)?.role)).toBe("viewer");
  });

  test("a socket opened with a role D1 changed meanwhile is closed by the upgrade's own reconcile", async () => {
    const t = await team();
    const response = await exports.default.fetch(`${ORIGIN}/sync/${t.id}`, {
      headers: { Upgrade: "websocket", Cookie: t.caio.cookie, Origin: ORIGIN },
    });
    const socket = response.webSocket!;
    socket.accept();
    open.push(socket);
    const closed = new Promise<number>((resolve) =>
      socket.addEventListener("close", (event) => resolve(event.code)),
    );
    // As if the role changed between the Worker's check and the shard accepting the socket.
    await runInDurableObject(t.stub, (_instance: WorkspaceDO, state) => {
      for (const ws of state.getWebSockets()) {
        const attachment = ws.deserializeAttachment() as SocketState;
        ws.serializeAttachment({ ...attachment, actor: { ...attachment.actor, role: "admin" } });
      }
    });
    await t.stub.reconcileMembers();
    expect(await closed).toBe(1012);
  });
});

describe("through an API token (RFC 0014)", () => {
  /** Ana's token holding only `members:manage`, as the Worker resolves it. */
  const token = (t: Team): Actor => ({
    kind: "token",
    id: newId("tok", Date.now(), random),
    role: "owner",
    by: t.ana.id,
    scopes: ["members:manage"],
  });

  test("a members-only token removes a member: their devices go and they are no longer paged", async () => {
    const t = await team();
    const caio = await connect(t, t.caio);
    await device(t, user(t.caio, "responder"));
    const by = token(t);
    const result = await runInDurableObject(t.stub, (_instance: WorkspaceDO, state) =>
      membership(t, state).change(t.id, t.ana.id, t.caio.id, { kind: "remove" }, by),
    );
    expect(result).toEqual({ ok: true });
    expect(await roleIn(t.id, t.caio.id)).toBeNull();
    expect(await paged(t)).toEqual([]);
    expect(await events(t, "member.removed")).toMatchObject([
      { actor: { kind: "token", id: by.id }, data: { userId: t.caio.id, reason: "removed" } },
    ]);
    // The test's Membership closes no sockets; the reconcile does, as the shard's own would.
    await t.stub.reconcileMembers();
    expect(await caio.closed).toBe(1008);
  });

  test("a members-only token changes a role in D1 and the shard", async () => {
    const t = await team();
    await connect(t, t.duda);
    const by = token(t);
    const result = await runInDurableObject(t.stub, (_instance: WorkspaceDO, state) =>
      membership(t, state).change(
        t.id,
        t.ana.id,
        t.duda.id,
        { kind: "role", role: "responder" },
        by,
      ),
    );
    expect(result).toEqual({ ok: true });
    expect(await roleIn(t.id, t.duda.id)).toBe("responder");
    expect(await t.withShard((shard) => shard.store.get("members", t.duda.id)?.role)).toBe(
      "responder",
    );
    expect(await events(t, "member.role_changed")).toMatchObject([
      { actor: { kind: "token", id: by.id }, data: { from: "viewer", to: "responder" } },
    ]);
  });

  test("a token's removal whose shard step fails is repaired by the alarm, so the member stops being paged", async () => {
    const t = await team();
    await connect(t, t.caio);
    await device(t, user(t.caio, "responder"));
    const result = await runInDurableObject(t.stub, (_instance: WorkspaceDO, state) =>
      membership(t, state, { shardFails: true }).change(
        t.id,
        t.ana.id,
        t.caio.id,
        { kind: "remove" },
        token(t),
      ),
    );
    expect(result).toEqual({ ok: false, code: "not_applied" });
    expect(await roleIn(t.id, t.caio.id)).toBeNull();
    expect(await paged(t)).toEqual([t.caio.id]);
    expect(await t.withShard((_shard, state) => state.storage.getAlarm())).not.toBeNull();

    await repairNow(t);
    expect(await paged(t)).toEqual([]);
    expect(await events(t, "member.removed")).toMatchObject([
      { actor: { id: "sys_members" }, data: { userId: t.caio.id, reason: "reconciled" } },
    ]);
  });

  test("a token never touches an owner or admin, nor makes one, whatever its creator's role", async () => {
    const t = await team();
    const by = token(t);
    const changes: [Person, MemberChange][] = [
      [t.bia, { kind: "role", role: "responder" }],
      [t.bia, { kind: "remove" }],
      [t.caio, { kind: "role", role: "admin" }],
      [t.caio, { kind: "role", role: "owner" }],
    ];
    for (const [target, change] of changes) {
      const result = await runInDurableObject(t.stub, (_instance: WorkspaceDO, state) =>
        membership(t, state).change(t.id, t.ana.id, target.id, change, by),
      );
      expect(result).toEqual({ ok: false, code: "forbidden" });
    }
    expect(await roleIn(t.id, t.bia.id)).toBe("admin");
    expect(await roleIn(t.id, t.caio.id)).toBe("responder");
  });
});
