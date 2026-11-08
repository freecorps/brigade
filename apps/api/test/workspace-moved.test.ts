// A `WorkspaceDO` whose workspace moved to Ember (RFC 0016 "Data migration", step 3; src/workspace-moved.ts): what
// still reaches it goes to the Ember shard or is refused, and its sockets close.
import { env, exports } from "cloudflare:workers";
import { describe, expect, test } from "vite-plus/test";
import { newId } from "@freecorps/brigade-schema";
import { workspaceShard } from "../src/ember.ts";
import { WHEN_MOVED } from "../src/workspace.ts";
import { FORWARDED } from "../src/workspace-moved.ts";
import { sessionCookie } from "./session.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";
let people = 0;
const clientIp = () => `198.53.${Math.floor(++people / 250) % 250}.${(people % 250) + 1}`;

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

/** A workspace on `WorkspaceDO`, and its Ember shard holding a copy with one incident the DO does not have. */
async function copied() {
  const address = `moved-${people}-${Math.random().toString(36).slice(2)}@example.com`;
  const signedUp = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name: "Ana", email: address, password: PASSWORD }),
  });
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
      s: string,
      fn: string,
      args: unknown,
      identity: null,
      internal: boolean,
    ): Promise<unknown>;
  };
  const actor = { kind: "user", id: user.id, role: "owner" } as const;
  const incident = newId("inc", Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n)));
  for (const [name, args] of [
    ["workspace.create", { id: workspaceId, name: "Acme" }],
    ["member.sync", { id: user.id, name: "Ana", role: "owner" }],
    ["incident.declare", { id: incident, title: "Checkout is down" }],
  ] as const) {
    expect(
      await shard.mutation(
        workspaceShard(workspaceId),
        "workspace:serverMutate",
        { name, args, actor },
        null,
        true,
      ),
    ).toMatchObject({ ok: true, value: { ok: true } });
  }
  return { workspaceId, cookie, actor, incident, stub: env.WORKSPACE.getByName(workspaceId) };
}

describe("a WorkspaceDO moved to Ember", () => {
  test("every call it forwards has an Ember counterpart, and only those", () => {
    const forwarded = Object.entries(WHEN_MOVED)
      .filter(([, when]) => when === "forward")
      .map(([name]) => name)
      .sort();
    expect(forwarded).toEqual(Object.keys(FORWARDED).sort());
  });

  test("forwards an ack to the shard, refuses the rest, closes its sockets, and comes back", async () => {
    const { workspaceId, cookie, actor, incident, stub } = await copied();
    const upgrade = await api(`/sync/${workspaceId}`, {
      headers: { Upgrade: "websocket", Cookie: cookie },
    });
    expect(upgrade.status).toBe(101);
    const socket = upgrade.webSocket!;
    socket.accept();
    const closed = new Promise<number>((resolve) =>
      socket.addEventListener("close", (event) => resolve(event.code)),
    );

    // Before the move the DO answers for itself: it has no such incident.
    expect(await stub.acknowledge(workspaceId, actor, incident, "tap-0")).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(await stub.moveToEmber("ws_another")).toEqual({ ok: false, code: "not_found" });
    expect(await stub.moveToEmber(workspaceId)).toEqual({ ok: true });
    expect(await closed).toBe(1012);

    // The ack runs on Ember, where the incident is.
    expect(await stub.acknowledge(workspaceId, actor, incident, "tap-1")).toEqual({ ok: true });
    const refused = await Promise.resolve(stub.info()).then(
      () => null,
      (error: unknown) => String(error),
    );
    expect(refused).toMatch(/moved to Ember/);
    const again = await env.WORKSPACE.getByName(workspaceId).fetch("http://do/sync", {
      headers: { Upgrade: "websocket" },
    });
    expect(again.status).toBe(503);

    await stub.moveBack();
    expect((await stub.info()).tables).toBeGreaterThan(0);
  });
});
