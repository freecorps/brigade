// Acknowledging from a notification action (RFC 0004 "Clients"): `POST /workspaces/:id/incidents/:incidentId/ack`
// through the Worker, authenticated like the sync upgrade, running `incident.ack` in the shard as the member with
// its RBAC, its event through the outbox and its patch to open sockets.
import { env, exports } from "cloudflare:workers";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { generateRecipient, toBase64url } from "@freecorps/brigade-push";
import { MONITOR_ACTOR, newId, type Actor } from "@freecorps/brigade-schema";
import { PROTOCOL_VERSION } from "@freecorps/brigade-sync/protocol";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { consumeEvents, type Fetch } from "../src/notify.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { Shard } from "../src/shard.ts";
import { IDEMPOTENCY_KEY_HEADER, type WorkspaceDO } from "../src/workspace.ts";
import { sessionCookie } from "./session.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

const open: WebSocket[] = [];
afterEach(() => {
  vi.restoreAllMocks();
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
const clientIp = () => `198.51.${Math.floor(++clients / 250) % 250}.${(clients % 250) + 101}`;

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
  const email = `${name.toLowerCase()}-a${++people}@example.com`;
  const response = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({
      name,
      email,
      password: PASSWORD,
    }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  const cookie = await sessionCookie(email, PASSWORD);
  return { id: body.user.id, cookie };
}

async function addMember(workspaceId: string, userId: string, role: string) {
  await env.DB.prepare(
    `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, ?, ?)`,
  )
    .bind(newId("mem", Date.now(), random), workspaceId, userId, role, new Date().toISOString())
    .run();
}

type Crew = { ana: Person; caio: Person; duda: Person; eva: Person };

async function signUpCrew(): Promise<Crew> {
  const [ana, caio, duda, eva] = await Promise.all(
    ["Ana", "Caio", "Duda", "Eva"].map((name) => signUp(name)),
  );
  return { ana: ana!, caio: caio!, duda: duda!, eva: eva! };
}

/**
 * Ana owns a new workspace with an incident in triage; Caio is a responder, Duda a viewer, Eva an outsider. `crew`
 * casts people signed up earlier in those parts: signing up hashes passwords, the slowest part of a team.
 */
async function team(crew?: Crew) {
  const { ana, caio, duda, eva } = crew ?? (await signUpCrew());
  const created = await api("/workspaces", {
    method: "POST",
    headers: { Cookie: ana.cookie },
    body: JSON.stringify({ name: "Acme" }),
  });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await addMember(id, caio.id, "responder");
  await addMember(id, duda.id, "viewer");
  const stub = env.WORKSPACE.getByName(id);
  const withShard = <R>(fn: (shard: Shard, state: DurableObjectState) => R | Promise<R>) =>
    runInDurableObject(stub, (_instance: WorkspaceDO, state) =>
      fn(
        new Shard(state.storage, { shard: "workspace", randomBytes: random, log: () => {} }),
        state,
      ),
    );
  const owner: Actor = { kind: "user", id: ana.id, role: "owner" };
  const run = (name: string, args: unknown, actor: Actor = owner, internal = false) =>
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
  const incident = newId("inc", Date.now(), random);
  await run("incident.declare", { id: incident, title: "Checkout down", severity: "sev1" });
  return { id, stub, incident, ana, caio, duda, eva, withShard, run };
}

type Team = Awaited<ReturnType<typeof team>>;

const ack = (
  t: Team,
  by: Person | null,
  options: { key?: string | null; incident?: string; headers?: Record<string, string> } = {},
) => {
  const key = options.key === undefined ? `ack-${newId("key", Date.now(), random)}` : options.key;
  return api(`/workspaces/${t.id}/incidents/${options.incident ?? t.incident}/ack`, {
    method: "POST",
    headers: {
      ...(by ? { Cookie: by.cookie } : {}),
      ...(key === null ? {} : { [IDEMPOTENCY_KEY_HEADER]: key }),
      ...options.headers,
    },
  });
};

const acks = (t: Team) =>
  t.withShard((_shard, state) =>
    state.storage.sql
      .exec<{ event: string }>("select event from outbox order by seq")
      .toArray()
      .map((row) => JSON.parse(row.event) as BrigadeEvent)
      .filter((event) => event.type === "incident.acknowledged"),
  );

const owner = (t: Team): Actor => ({ kind: "user", id: t.ana.id, role: "owner" });

const events = (t: Team, subject: string) =>
  t.withShard((_shard, state) =>
    state.storage.sql
      .exec<{ event: string }>("select event from outbox order by seq")
      .toArray()
      .map((row) => JSON.parse(row.event) as BrigadeEvent)
      .filter((event) => event.subject === subject),
  );

/** A relay that accepts every push and remembers which device tokens it got. */
function relay() {
  const tokens: string[] = [];
  const send: Fetch = async (request) => {
    tokens.push(((await request.json()) as { deviceToken: string }).deviceToken);
    return Response.json({ status: 200 });
  };
  return { tokens, send };
}

/** Hands one event to the notifier, as the Queue would. */
async function deliver(event: BrigadeEvent, send: Fetch) {
  const batch = createMessageBatch("brigade-events", [
    { id: "msg-0", timestamp: new Date(), attempts: 1, body: event },
  ]);
  const ctx = createExecutionContext();
  await consumeEvents(
    batch,
    { WORKSPACE: env.WORKSPACE, RELAY_URL: "https://relay.test", RELAY_SEND_TOKEN: "test-token" },
    send,
  );
  return getQueueResult(batch, ctx);
}

const incidentRow = (t: Team) => t.withShard((shard) => shard.store.get("incidents", t.incident));

describe("POST /workspaces/:id/incidents/:incidentId/ack", () => {
  test("acknowledges as the member: the row, the timeline and one event through the outbox", async () => {
    const t = await team();
    const response = await ack(t, t.caio);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const row = await incidentRow(t);
    expect(row?.acknowledgedBy).toBe(t.caio.id);
    expect(row?.acknowledgedAt).toEqual(expect.any(Number));
    const events = await acks(t);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      workspaceId: t.id,
      subject: t.incident,
      actor: { kind: "user", id: t.caio.id },
      data: { by: t.caio.id },
    });
    const timeline = await t.withShard((shard) =>
      shard.store.scan("timeline").filter((entry) => entry.incidentId === t.incident),
    );
    expect(timeline.map((entry) => [entry.kind, entry.actor])).toContainEqual([
      "acknowledged",
      t.caio.id,
    ]);
  });

  test("the same key again answers the same and changes nothing; another ack is a conflict", async () => {
    const t = await team();
    expect((await ack(t, t.caio, { key: "tap-1" })).status).toBe(200);
    // A retry whose first answer was lost: still this member's ack.
    const retry = await ack(t, t.caio, { key: "tap-1" });
    expect(retry.status).toBe(200);
    // A second tap, or someone else: already acknowledged.
    const again = await ack(t, t.caio, { key: "tap-2" });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "conflict" });
    const other = await ack(t, t.ana);
    expect(other.status).toBe(409);
    expect((await incidentRow(t))?.acknowledgedBy).toBe(t.caio.id);
    expect(await acks(t)).toHaveLength(1);
  });

  test("RBAC: a viewer is forbidden, and an outsider is not a member, without waking the shard for them", async () => {
    const t = await team();
    const viewer = await ack(t, t.duda);
    expect(viewer.status).toBe(403);
    expect(await viewer.json()).toEqual({ error: "forbidden" });
    const shards = vi.spyOn(env.WORKSPACE, "getByName");
    const outsider = await ack(t, t.eva);
    expect(outsider.status).toBe(403);
    expect(await outsider.json()).toEqual({ error: "not_a_member" });
    expect(shards).not.toHaveBeenCalled();
    shards.mockRestore();
    expect((await incidentRow(t))?.acknowledgedAt).toBeNull();
    expect(await acks(t)).toHaveLength(0);
  });

  test("a member removed from the workspace can no longer acknowledge", async () => {
    const t = await team();
    const removed = await api(`/workspaces/${t.id}/members/${t.caio.id}`, {
      method: "DELETE",
      headers: { Cookie: t.ana.cookie },
    });
    expect(removed.status).toBe(200);
    const response = await ack(t, t.caio);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "not_a_member" });
    expect(await acks(t)).toHaveLength(0);
  });

  test("a resolved incident is not acknowledged, and an unknown one is not found", async () => {
    const t = await team();
    await t.run("incident.setStatus", { id: t.incident, status: "resolved" });
    const resolved = await ack(t, t.caio);
    expect(resolved.status).toBe(409);
    expect(await resolved.json()).toEqual({ error: "invalid_transition" });
    const unknown = await ack(t, t.caio, { incident: newId("inc", Date.now(), random) });
    expect(unknown.status).toBe(404);
    expect(await acks(t)).toHaveLength(0);
  });

  test("the same key on another incident's page acknowledges that incident, not answered with the first's", async () => {
    const t = await team();
    const second = newId("inc", Date.now(), random);
    await t.run("incident.declare", { id: second, title: "Search is slow", severity: "sev2" });
    expect((await ack(t, t.caio, { key: "tap-1" })).status).toBe(200);
    const other = await ack(t, t.caio, { key: "tap-1", incident: second });
    expect(other.status).toBe(200);
    const row = await t.withShard((shard) => shard.store.get("incidents", second));
    expect(row?.acknowledgedBy).toBe(t.caio.id);
    const subjects = (await acks(t)).map((event) => event.subject);
    expect(subjects).toHaveLength(2);
    expect(subjects).toEqual(expect.arrayContaining([t.incident, second]));
  });

  test("an incident of another workspace is not found, and stays unacknowledged", async () => {
    const t = await team();
    // Eva, an outsider here, owns the other workspace; Caio has no part in it.
    const elsewhere = await team({ ana: t.eva, caio: t.duda, duda: t.ana, eva: t.caio });
    const response = await ack(t, t.caio, { incident: elsewhere.incident });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect((await incidentRow(elsewhere))?.acknowledgedAt).toBeNull();
    expect(await acks(t)).toHaveLength(0);
    expect(await acks(elsewhere)).toHaveLength(0);
  });

  test("ends a running escalation: the run is acknowledged, its timer cleared, and a level already queued pages nobody", async () => {
    const t = await team();
    const caio: Actor = { kind: "user", id: t.caio.id, role: "responder" };
    for (const [actor, name] of [
      [owner(t), "Ana"],
      [caio, "Caio"],
    ] as const) {
      await t.run("member.sync", { id: actor.id, name, role: actor.role }, actor, true);
      const recipient = await generateRecipient();
      await t.run(
        "device.register",
        {
          id: newId("dev", Date.now(), random),
          platform: "ios",
          environment: "sandbox",
          pushToken: toBase64url(random(32)).replace(/[-_]/g, "a"),
          voipToken: null,
          publicKey: toBase64url(recipient.publicKey),
        },
        actor,
        true,
      );
    }
    // Caio first, then Ana, 5 minutes each.
    await t.run("escalation.createPolicy", {
      id: newId("esc", Date.now(), random),
      name: "Checkout",
      levels: [caio.id, t.ana.id].map((id) => ({
        id: newId("lvl", Date.now(), random),
        targets: [{ kind: "member", id }],
        timeoutMinutes: 5,
      })),
      repeat: 3,
      isDefault: true,
    });
    const incident = newId("inc", Date.now(), random);
    await t.run(
      "incident.declare",
      { id: incident, title: "Checkout is down", severity: "sev1" },
      MONITOR_ACTOR,
      true,
    );
    const declared = (await events(t, incident)).find((e) => e.type === "incident.declared")!;
    await deliver(declared, relay().send);
    const escalation = () =>
      t.withShard((shard) => shard.store.get("incidents", incident)?.escalation);
    expect(await escalation()).toMatchObject({ status: "running" });
    // Level 1 times out: the alarm queues level 2.
    await t.withShard((shard) => {
      const at = Date.now() - 1;
      const row = shard.store.get("incidents", incident)!;
      shard.store.update("incidents", incident, { escalation: { ...row.escalation!, nextAt: at } });
      shard.store.update("escalation_timers", incident, { at });
    });
    expect(await runDurableObjectAlarm(t.stub)).toBe(true);
    const paged = (await events(t, incident)).filter((e) => e.type === "escalation.paged");
    expect(paged).toHaveLength(2);

    expect((await ack(t, t.caio, { incident })).status).toBe(200);
    expect(await escalation()).toMatchObject({ status: "acknowledged", nextAt: null });
    expect(await t.withShard((shard) => shard.store.scan("escalation_timers"))).toEqual([]);
    const { tokens, send } = relay();
    await deliver(paged[1]!, send);
    expect(tokens).toEqual([]);
    await runDurableObjectAlarm(t.stub);
    expect((await events(t, incident)).filter((e) => e.type === "escalation.paged")).toHaveLength(
      2,
    );
  });

  test("refuses no session, another site, a missing or malformed key, bad ids and other methods", async () => {
    const t = await team();
    const anonymous = await ack(t, null);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "unauthenticated" });
    // A page on another site posting with the member's cookie.
    const crossSite = await ack(t, t.caio, { headers: { Origin: "https://evil.example" } });
    expect(crossSite.status).toBe(403);
    expect(await crossSite.json()).toEqual({ error: "forbidden_origin" });
    expect((await ack(t, t.caio, { key: null })).status).toBe(400);
    expect((await ack(t, t.caio, { key: "has spaces" })).status).toBe(400);
    expect((await ack(t, t.caio, { key: "k".repeat(65) })).status).toBe(400);
    expect((await ack(t, t.caio, { incident: "INC-1" })).status).toBe(404);
    const devShard = await api(`/workspaces/demo/incidents/${t.incident}/ack`, {
      method: "POST",
      headers: { Cookie: t.caio.cookie, [IDEMPOTENCY_KEY_HEADER]: "k" },
    });
    expect(devShard.status).toBe(400);
    const get = await api(`/workspaces/${t.id}/incidents/${t.incident}/ack`, {
      headers: { Cookie: t.caio.cookie },
    });
    expect(get.status).toBe(405);
    expect(get.headers.get("Allow")).toBe("POST");
    expect(await acks(t)).toHaveLength(0);
  });

  test("the app's request passes: no Origin, the session as a Cookie header", async () => {
    const t = await team();
    const response = await exports.default.fetch(
      `${ORIGIN}/workspaces/${t.id}/incidents/${t.incident}/ack`,
      {
        method: "POST",
        headers: {
          Cookie: t.caio.cookie,
          "expo-origin": "brigade://",
          [IDEMPOTENCY_KEY_HEADER]: "tap-app",
        },
      },
    );
    expect(response.status).toBe(200);
  });

  test("an open socket gets the ack as a patch", async () => {
    const t = await team();
    const upgrade = await exports.default.fetch(`${ORIGIN}/sync/${t.id}`, {
      headers: { Upgrade: "websocket", Cookie: t.ana.cookie, Origin: ORIGIN },
    });
    expect(upgrade.status).toBe(101);
    const socket = upgrade.webSocket!;
    socket.accept();
    open.push(socket);
    const frames: { type: string; subs?: Record<string, { upserts: { id: string }[] }> }[] = [];
    let arrived = () => {};
    socket.addEventListener("message", (event) => {
      frames.push(JSON.parse(event.data as string));
      arrived();
    });
    const next = (match: (frame: (typeof frames)[number]) => boolean) =>
      new Promise<(typeof frames)[number]>((resolve) => {
        const check = () => {
          const found = frames.find(match);
          if (found) resolve(found);
        };
        arrived = check;
        check();
      });
    socket.send(JSON.stringify({ type: "hello", protocol: PROTOCOL_VERSION, clientId: "web" }));
    socket.send(
      JSON.stringify({ type: "subscribe", subId: "active", query: "incidents.active", args: {} }),
    );
    await next((frame) => frame.type === "snapshot");

    expect((await ack(t, t.caio)).status).toBe(200);
    const patch = await next((frame) => frame.type === "patch");
    const upserts = patch.subs?.active?.upserts ?? [];
    expect(upserts).toContainEqual(
      expect.objectContaining({ id: t.incident, acknowledgedBy: t.caio.id }),
    );
  });
});
