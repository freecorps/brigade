// The Brigade Sync adapter end to end (RFC 0016 "Clients", src/sync-adapter.ts): a `/sync` socket of a workspace on
// Ember, through the Worker into the workspace's Ember shard.
import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { newId } from "@freecorps/brigade-schema";
import { PROTOCOL_VERSION } from "@freecorps/brigade-sync/protocol";
import { setWorkspaceEngine, workspaceShard } from "../src/ember.ts";
import { sessionCookie } from "./session.ts";

type Frame = { type: string; [key: string]: unknown };

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";
let people = 0;
let clients = 0;
const clientIp = () => `198.52.${Math.floor(++clients / 250) % 250}.${(clients % 250) + 1}`;

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

const open: WebSocket[] = [];
afterEach(() => {
  for (const ws of open.splice(0)) {
    try {
      ws.close(1000, "done");
    } catch {
      // Already closed.
    }
  }
});

/** A signed-in owner of a new workspace on Ember, its shard provisioned as the migration does. */
async function emberOwner() {
  const address = `adapter-${++people}@example.com`;
  const signedUp = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name: "Ana", email: address, password: PASSWORD }),
  });
  expect(signedUp.status).toBe(200);
  const { user } = (await signedUp.json()) as { user: { id: string } };
  const cookie = await sessionCookie(address, PASSWORD);
  const created = await api("/workspaces", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({ name: "Acme" }),
  });
  expect(created.status).toBe(201);
  const { id: workspaceId } = (await created.json()) as { id: string };
  const shard = env.SHARD.getByName(workspaceShard(workspaceId)) as unknown as {
    mutation(
      shard: string,
      fn: string,
      args: unknown,
      identity: null,
      internal: boolean,
    ): Promise<{ ok: boolean; value?: unknown }>;
  };
  const actor = { kind: "user", id: user.id, role: "owner" };
  for (const [name, args] of [
    ["workspace.create", { id: workspaceId, name: "Acme" }],
    ["member.sync", { id: user.id, name: "Ana", role: "owner" }],
  ] as const) {
    const out = await shard.mutation(
      workspaceShard(workspaceId),
      "workspace:serverMutate",
      { name, args, actor },
      null,
      true,
    );
    expect(out).toMatchObject({ ok: true, value: { ok: true } });
  }
  await setWorkspaceEngine(env.DB, workspaceId, "ember", Date.now());
  return { userId: user.id, cookie, workspaceId };
}

/** Opens a sync socket and collects what it sends. */
async function connect(workspaceId: string, cookie: string) {
  const response = await api(`/sync/${workspaceId}`, {
    headers: { Upgrade: "websocket", Cookie: cookie },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  open.push(socket);
  const frames: Frame[] = [];
  const waiting: (() => void)[] = [];
  let read = 0;
  socket.addEventListener("message", (event) => {
    frames.push(JSON.parse(event.data as string) as Frame);
    waiting.splice(0).forEach((wake) => wake());
  });
  const client = {
    send(frame: unknown) {
      socket.send(JSON.stringify(frame));
    },
    async next(): Promise<Frame> {
      while (frames.length <= read) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`no frame after ${JSON.stringify(frames)}`)),
            5000,
          );
          waiting.push(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      return frames[read++]!;
    },
  };
  return client;
}

describe("/sync on an Ember workspace", () => {
  test("hello, subscribe, mutate: a snapshot, the mutation's patch, then its result", async () => {
    const { cookie, workspaceId } = await emberOwner();
    const a = await connect(workspaceId, cookie);
    a.send({ type: "hello", protocol: PROTOCOL_VERSION, clientId: `adapter-${people}` });
    a.send({ type: "ping" });
    expect(await a.next()).toEqual({ type: "pong" });
    a.send({ type: "subscribe", subId: "active", query: "incidents.active", args: {} });
    const snapshot = await a.next();
    expect(snapshot).toMatchObject({ type: "snapshot", subId: "active", rows: [] });
    expect(typeof snapshot.epoch).toBe("string");

    const id = newId("inc", Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n)));
    a.send({
      type: "mutate",
      mutationId: "m-1",
      name: "incident.declare",
      args: { id, title: "Checkout down", severity: "sev2" },
    });
    const patch = await a.next();
    expect(patch).toMatchObject({ type: "patch", epoch: snapshot.epoch });
    expect((patch.subs as Record<string, { upserts: { id: string }[] }>).active!.upserts).toEqual([
      expect.objectContaining({ id }),
    ]);
    expect(await a.next()).toEqual({
      type: "mutationResult",
      mutationId: "m-1",
      ok: true,
      version: patch.version,
    });

    // A refusal comes back as the mutation's result, and an unknown query as the subscription's error.
    a.send({ type: "mutate", mutationId: "m-2", name: "incident.declare", args: {} });
    expect(await a.next()).toMatchObject({ type: "mutationResult", mutationId: "m-2", ok: false });
    a.send({ type: "subscribe", subId: "nope", query: "nope", args: {} });
    expect(await a.next()).toMatchObject({ type: "error", subId: "nope" });
  });

  test("without a session it is refused, and frames before hello close the socket", async () => {
    const { cookie, workspaceId } = await emberOwner();
    const anonymous = await api(`/sync/${workspaceId}`, { headers: { Upgrade: "websocket" } });
    expect(anonymous.status).not.toBe(101);
    const a = await connect(workspaceId, cookie);
    a.send({ type: "subscribe", subId: "x", query: "incidents.active", args: {} });
    expect(await a.next()).toMatchObject({ type: "error", code: "protocol" });
  });
});
