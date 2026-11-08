// The copy and the switch to Ember end to end (RFC 0016 "Data migration"; src/ember-migration.ts, src/ember-admin.ts):
// a workspace written on its WorkspaceDO, copied to its Ember shard, checked, switched and turned back.
import { env, exports } from "cloudflare:workers";
import { describe, expect, test } from "vite-plus/test";
import { newId } from "@freecorps/brigade-schema";
import { PROTOCOL_VERSION } from "@freecorps/brigade-sync/protocol";
import { workspaceEngine, workspaceShard } from "../src/ember.ts";
import { serveMigration } from "../src/ember-admin.ts";
import { switchWorkspace } from "../src/ember-migration.ts";
import { sessionCookie } from "./session.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";
const TOKEN = "migration-token-for-tests";
let people = 0;
const clientIp = () => `198.54.${Math.floor(++people / 250) % 250}.${(people % 250) + 1}`;

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

const admin = (method: string, path: string, token: string | null = TOKEN) =>
  serveMigration(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: token === null ? {} : { Authorization: `Bearer ${token}` },
    }),
    { ...env, MIGRATION_TOKEN: TOKEN },
    new URL(`${ORIGIN}${path}`).pathname,
  );

/** A workspace on its WorkspaceDO with one incident declared through a sync socket. */
async function written() {
  const address = `migrate-${people}-${Math.random().toString(36).slice(2)}@example.com`;
  const signedUp = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name: "Ana", email: address, password: PASSWORD }),
  });
  expect(signedUp.status).toBe(200);
  const cookie = await sessionCookie(address, PASSWORD);
  const created = await api("/workspaces", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({ name: "Acme" }),
  });
  const { id: workspaceId } = (await created.json()) as { id: string };
  const upgrade = await api(`/sync/${workspaceId}`, {
    headers: { Upgrade: "websocket", Cookie: cookie },
  });
  const socket = upgrade.webSocket!;
  socket.accept();
  const result = new Promise<Record<string, unknown>>((resolve) =>
    socket.addEventListener("message", (event) => {
      const frame = JSON.parse(event.data as string) as Record<string, unknown>;
      if (frame.type === "mutationResult") resolve(frame);
    }),
  );
  const incident = newId("inc", Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n)));
  socket.send(
    JSON.stringify({ type: "hello", protocol: PROTOCOL_VERSION, clientId: `m-${people}` }),
  );
  socket.send(
    JSON.stringify({
      type: "mutate",
      mutationId: "m-1",
      name: "incident.declare",
      args: { id: incident, title: "Checkout down", severity: "sev2" },
    }),
  );
  expect(await result).toMatchObject({ ok: true });
  socket.close(1000, "done");
  return { workspaceId, incident };
}

/** The rows of `table` on the workspace's Ember shard. */
async function emberRows(workspaceId: string, table: string) {
  const name = workspaceShard(workspaceId);
  const shard = env.SHARD.getByName(name) as unknown as {
    query(
      s: string,
      fn: string,
      args: unknown,
      identity: null,
      internal: boolean,
    ): Promise<{ ok: boolean; value: unknown }>;
  };
  const out = await shard.query(
    name,
    "migration:page",
    { table, after: "", limit: 200 },
    null,
    true,
  );
  return (out.value as { id: string }[]).map((row) => row.id);
}

describe("the migration's operator routes", () => {
  test("are a 404 without the token, or with a wrong one", async () => {
    expect((await admin("GET", "/admin/ember/workspaces", null)).status).toBe(404);
    expect((await admin("GET", "/admin/ember/workspaces", "wrong")).status).toBe(404);
    const unset = await serveMigration(
      new Request(`${ORIGIN}/admin/ember/workspaces`, { headers: { Authorization: "Bearer " } }),
      env,
      "/admin/ember/workspaces",
    );
    expect(unset.status).toBe(404);
  });

  test("copy, check, switch and back", async () => {
    const { workspaceId, incident } = await written();
    const listed = (await (await admin("GET", "/admin/ember/workspaces")).json()) as {
      workspaces: { id: string; engine: string }[];
    };
    expect(listed.workspaces).toContainEqual({ id: workspaceId, engine: "brigade" });

    const copied = (await (await admin("POST", `/admin/ember/copy/${workspaceId}`)).json()) as {
      written: number;
      mismatched: unknown[];
    };
    expect(copied.mismatched).toEqual([]);
    expect(copied.written).toBeGreaterThan(0);
    expect(await emberRows(workspaceId, "incidents")).toEqual([incident]);
    // Again: nothing to write, still checked.
    const again = (await (await admin("POST", `/admin/ember/copy/${workspaceId}`)).json()) as {
      written: number;
      dropped: number;
      mismatched: unknown[];
    };
    expect(again).toMatchObject({ written: 0, dropped: 0, mismatched: [] });

    const switched = await admin("POST", `/admin/ember/switch/${workspaceId}`);
    expect(switched.status).toBe(200);
    expect(await switched.json()).toMatchObject({ ok: true, copy: { mismatched: [] } });
    expect(await workspaceEngine(env.DB, workspaceId)).toBe("ember");
    // The DO is frozen: what it no longer runs is refused.
    const refused = await Promise.resolve(env.WORKSPACE.getByName(workspaceId).info()).then(
      () => null,
      (error: unknown) => String(error),
    );
    expect(refused).toMatch(/moved to Ember/);

    // On Ember now: a copy would overwrite live data, and a switch again only finishes the forwarding.
    expect((await admin("POST", `/admin/ember/copy/${workspaceId}`)).status).toBe(409);
    expect(await (await admin("POST", `/admin/ember/switch/${workspaceId}`)).json()).toEqual({
      ok: true,
      finished: true,
    });

    expect((await admin("POST", `/admin/ember/back/${workspaceId}`)).status).toBe(200);
    expect(await workspaceEngine(env.DB, workspaceId)).toBe("brigade");
    expect((await env.WORKSPACE.getByName(workspaceId).info()).tables).toBeGreaterThan(0);
  });

  test("two switches at once: one switches, the other is busy and touches nothing", async () => {
    const { workspaceId } = await written();
    const results = await Promise.all([
      switchWorkspace(env, workspaceId),
      switchWorkspace(env, workspaceId),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, code: "busy" }]);
    expect(await workspaceEngine(env.DB, workspaceId)).toBe("ember");
  });

  test("a table near the read cap holds the switch back, unless forced", async () => {
    const { workspaceId } = await written();
    const held = await switchWorkspace(env, workspaceId, { guard: 0 });
    expect(held).toMatchObject({ ok: false, code: "too_large" });
    expect(held.copy?.large).toContain("incidents");
    expect(held.copy?.rows.incidents).toBe(1);
    // Not switched: D1 and the DO as they were.
    expect(await workspaceEngine(env.DB, workspaceId)).toBe("brigade");
    expect((await env.WORKSPACE.getByName(workspaceId).info()).tables).toBeGreaterThan(0);
    expect(await switchWorkspace(env, workspaceId, { guard: 0, force: true })).toMatchObject({
      ok: true,
    });
    expect(await workspaceEngine(env.DB, workspaceId)).toBe("ember");
  });
});
