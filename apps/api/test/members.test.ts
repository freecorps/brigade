// Member management end to end (src/members.ts): `PATCH`/`DELETE /workspaces/:id/members/:userId` through the
// Worker, D1 first and then the shard's copy, its events and its sockets; what paging sees afterwards; and both
// sides of a failure (D1 failing, the shard failing after D1 committed) with their repair.
import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { newId, type Actor, type Role } from "@freecorps/brigade-schema";
import { PROTOCOL_VERSION } from "@freecorps/brigade-sync/protocol";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { Membership } from "../src/members.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { pageTargets } from "../src/paging.ts";
import { Shard } from "../src/shard.ts";
import type { SocketState, WorkspaceDO } from "../src/workspace.ts";

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
      log: () => {},
      committed: () => {},
      closeSockets: () => {},
    });
  };
  const brokenDb = {
    prepare: () => {
      throw new Error("D1 is down");
    },
  } as unknown as D1Database;

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
    expect(await events(t, "member.removed")).toMatchObject([
      { data: { userId: t.caio.id, reason: "removed" } },
    ]);
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
