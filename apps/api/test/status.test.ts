// The public status page (RFC 0012): `PUT /workspaces/:id/status-page` claims the slug in D1 and sets the page up in
// the shard as the member; the shard pushes a sanitized snapshot to KV; `GET /status/:slug` reads only KV.
import { env, exports } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { newId, type Actor, type StatusSnapshot } from "@freecorps/brigade-schema";
import { describe, expect, test, vi } from "vite-plus/test";
import type { BrigadeEvent } from "../src/outbox.ts";
import { Shard } from "../src/shard.ts";
import { statusKey, StatusPublisher } from "../src/status-page.ts";
import type { WorkspaceDO } from "../src/workspace.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

let people = 0;
let clients = 0;
let slugs = 0;
/** A new client IP (TEST-NET-2) per call: sign-up is rate-limited per IP. */
const clientIp = () => `198.51.${Math.floor(++clients / 250) % 250}.${(clients % 250) + 101}`;
/** Each test its own address: the edge cache keeps a page for 30 s. */
const slug = () => `acme-${Date.now().toString(36)}-${++slugs}`;

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
      email: `${name.toLowerCase()}-s${++people}@example.com`,
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

async function workspace(owner: Person, name = "Acme") {
  const created = await api("/workspaces", {
    method: "POST",
    headers: { Cookie: owner.cookie },
    body: JSON.stringify({ name }),
  });
  expect(created.status).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

async function addMember(workspaceId: string, userId: string, role: string) {
  await env.DB.prepare(
    `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, ?, ?)`,
  )
    .bind(newId("mem", Date.now(), random), workspaceId, userId, role, new Date().toISOString())
    .run();
}

/** Ana owns a workspace; Caio is a responder there, Eva an outsider. */
async function team() {
  const [ana, caio, eva] = await Promise.all(["Ana", "Caio", "Eva"].map((name) => signUp(name)));
  const id = await workspace(ana!);
  await addMember(id, caio!.id, "responder");
  const stub = env.WORKSPACE.getByName(id);
  const withShard = <R>(fn: (shard: Shard, state: DurableObjectState) => R | Promise<R>) =>
    runInDurableObject(stub, (_instance: WorkspaceDO, state) =>
      fn(
        new Shard(state.storage, { shard: "workspace", randomBytes: random, log: () => {} }),
        state,
      ),
    );
  const run = (name: string, args: unknown, actor: Actor) =>
    withShard((shard) => {
      const { result } = shard.mutate({
        clientId: "test",
        mutationId: newId("mut", Date.now(), random),
        actor,
        name,
        args,
        now: Date.now(),
      });
      return result;
    });
  /** The shard's push, as its alarm runs it; `later` steps past KV's one write a second. */
  let pushes = 0;
  const push = () =>
    runInDurableObject(stub, async (instance: WorkspaceDO) => {
      const publisher = Reflect.get(instance, "status") as StatusPublisher;
      await publisher.publish(id, Date.now() + ++pushes * 2000);
    });
  return { id, stub, ana: ana!, caio: caio!, eva: eva!, withShard, run, push };
}

type Team = Awaited<ReturnType<typeof team>>;

const configure = (
  t: Team,
  by: Person | null,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  api(`/workspaces/${t.id}/status-page`, {
    method: "PUT",
    headers: { ...(by ? { Cookie: by.cookie } : {}), ...headers },
    body: JSON.stringify(body),
  });

const settings = (address: string, extra: Record<string, unknown> = {}) => ({
  slug: address,
  title: "Acme",
  locale: "en",
  enabled: true,
  ...extra,
});

const events = (t: Team, type: string) =>
  t.withShard((_shard, state) =>
    state.storage.sql
      .exec<{ event: string }>("select event from outbox order by seq")
      .toArray()
      .map((row) => JSON.parse(row.event) as BrigadeEvent)
      .filter((event) => event.type === type),
  );

const owners = async (address: string) =>
  (
    await env.DB.prepare("select workspace_id from status_slug where slug = ?")
      .bind(address)
      .all<{ workspace_id: string }>()
  ).results.map((row) => row.workspace_id);

const snapshot = (address: string) => env.STATUS!.get<StatusSnapshot>(statusKey(address), "json");

describe("PUT /workspaces/:id/status-page", () => {
  test("an owner sets the page up: the slug in D1, the row and its event in the shard", async () => {
    const t = await team();
    const address = slug();
    const response = await configure(t, t.ana, settings(address));
    expect(response.status).toBe(200);
    expect(await owners(address)).toEqual([t.id]);
    const row = await t.withShard((shard) => shard.store.get("status_page", "status_page"));
    expect(row).toMatchObject({ slug: address, title: "Acme", enabled: true, updatedBy: t.ana.id });
    expect(await events(t, "status_page.configured")).toMatchObject([
      { data: { slug: address, previousSlug: null }, actor: { id: t.ana.id } },
    ]);
    // Saving the same settings again changes nothing and is fine.
    expect((await configure(t, t.ana, settings(address))).status).toBe(200);
    expect(await events(t, "status_page.configured")).toHaveLength(1);
  });

  test("refused for responders, outsiders, no session, another site and bad settings", async () => {
    const t = await team();
    const address = slug();
    const answer = async (response: Response) => [response.status, await response.json()];
    expect(await answer(await configure(t, t.caio, settings(address)))).toEqual([
      403,
      { error: "forbidden" },
    ]);
    expect(await answer(await configure(t, t.eva, settings(address)))).toEqual([
      403,
      { error: "not_a_member" },
    ]);
    expect((await configure(t, null, settings(address))).status).toBe(401);
    expect(
      (await configure(t, t.ana, settings(address), { Origin: "https://evil.example" })).status,
    ).toBe(403);
    expect(await answer(await configure(t, t.ana, settings("Not A Slug")))).toEqual([
      400,
      { error: "invalid_args" },
    ]);
    // Nothing claimed on the way.
    expect(await owners(address)).toEqual([]);
  });

  test("a slug another workspace holds is taken", async () => {
    const a = await team();
    const b = await team();
    const address = slug();
    expect((await configure(a, a.ana, settings(address))).status).toBe(200);
    const response = await configure(b, b.ana, settings(address));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "slug_taken" });
    expect(await owners(address)).toEqual([a.id]);
  });
});

describe("the snapshot", () => {
  test("is pushed to KV, without anything internal, and served at /status/:slug", async () => {
    const t = await team();
    const address = slug();
    await configure(t, t.ana, settings(address));
    const ana: Actor = { kind: "user", id: t.ana.id, role: "owner" };
    const caio: Actor = { kind: "user", id: t.caio.id, role: "responder" };
    const component = newId("cmp", Date.now(), random);
    const incident = newId("inc", Date.now(), random);
    expect(
      await t.run("statusComponent.create", { id: component, name: "API", group: null }, ana),
    ).toMatchObject({ ok: true });
    await t.run(
      "incident.declare",
      { id: incident, title: "db-7 OOM killed", severity: "sev1" },
      caio,
    );
    expect(
      await t.run(
        "incident.publishUpdate",
        {
          id: incident,
          title: "Slow <API> responses",
          status: "investigating",
          impact: "partial_outage",
          componentIds: [component],
          body: "We're looking into it.",
        },
        caio,
      ),
    ).toMatchObject({ ok: true });
    await t.push();
    const stored = await snapshot(address);
    expect(stored).toMatchObject({
      title: "Acme",
      status: "partial_outage",
      groups: [{ name: null, components: [{ name: "API", status: "partial_outage" }] }],
      active: [{ title: "Slow <API> responses" }],
    });
    const text = JSON.stringify(stored);
    for (const internal of ["db-7 OOM", t.caio.id, t.ana.id, t.id, incident, component]) {
      expect(text).not.toContain(internal);
    }

    const response = await exports.default.fetch(`${ORIGIN}/status/${address}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=30");
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    const html = await response.text();
    expect(html).toContain("Slow &lt;API&gt; responses");
    expect(html).not.toContain("<API>");
    expect(html).toContain("Some systems are down");
    expect(html).not.toContain("<script");
    const head = await exports.default.fetch(`${ORIGIN}/status/${address}`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    // No session needed, and no write allowed.
    expect(
      (await exports.default.fetch(`${ORIGIN}/status/${address}`, { method: "POST" })).status,
    ).toBe(405);
  });

  test("written in the page's language", async () => {
    const t = await team();
    const address = slug();
    await configure(t, t.ana, settings(address, { locale: "pt-BR" }));
    await t.push();
    const html = await (await exports.default.fetch(`${ORIGIN}/status/${address}`)).text();
    expect(html).toContain('lang="pt-BR"');
    expect(html).toContain("Todos os sistemas operacionais");
  });

  test("a page that is not public is deleted from KV", async () => {
    const t = await team();
    const address = slug();
    await configure(t, t.ana, settings(address));
    await t.push();
    expect(await snapshot(address)).not.toBeNull();
    await configure(t, t.ana, settings(address, { enabled: false }));
    await t.push();
    expect(await snapshot(address)).toBeNull();
    // The address stays the workspace's.
    expect(await owners(address)).toEqual([t.id]);
  });

  test("a new slug deletes the old snapshot before D1 releases the old slug", async () => {
    const t = await team();
    const other = await team();
    const first = slug();
    const second = slug();
    await configure(t, t.ana, settings(first));
    await t.push();
    await configure(t, t.ana, settings(second));
    // Not released yet: the old snapshot may still be served.
    expect(await owners(first)).toEqual([t.id]);
    expect((await configure(other, other.ana, settings(first))).status).toBe(409);
    await t.push();
    expect(await snapshot(first)).toBeNull();
    expect(await snapshot(second)).toMatchObject({ title: "Acme" });
    expect(await owners(first)).toEqual([]);
    expect(await owners(second)).toEqual([t.id]);
    expect((await configure(other, other.ana, settings(first))).status).toBe(200);
  });

  test("a failed push keeps the change pending and backs off", async () => {
    const t = await team();
    const address = slug();
    await configure(t, t.ana, settings(address));
    const logs: string[] = [];
    await runInDurableObject(t.stub, async (_instance: WorkspaceDO, state) => {
      const shard = new Shard(state.storage, {
        shard: "workspace",
        randomBytes: random,
        log: () => {},
      });
      const failing = {
        put: () => Promise.reject(new Error("KV down")),
        delete: () => Promise.reject(new Error("KV down")),
      } as unknown as KVNamespace;
      const publisher = new StatusPublisher({
        shard,
        sql: state.storage.sql,
        kv: failing,
        db: env.DB,
        randomBytes: random,
        log: (message) => logs.push(message),
        committed: () => {},
        wake: () => {},
      });
      const now = Date.now() + 60_000;
      await publisher.publish(t.id, now);
      expect(shard.statusDirty()).toEqual(expect.any(Number));
      const next = publisher.nextAt(now)!;
      expect(next).toBeGreaterThan(now);
      expect(next).toBeLessThanOrEqual(now + 1000);
    });
    expect(logs).toContain("publishing the status page failed");
    // Past the backoff, the shard's own publisher pushes it.
    await runInDurableObject(t.stub, async (instance: WorkspaceDO) => {
      const publisher = Reflect.get(instance, "status") as StatusPublisher;
      await publisher.publish(t.id, Date.now() + 120_000);
    });
    expect(await snapshot(address)).toMatchObject({ title: "Acme" });
  });

  test("the shard's alarm pushes it", async () => {
    const t = await team();
    const address = slug();
    await configure(t, t.ana, settings(address));
    // The save brought the alarm forward to now: it may already be running on its own, so wait for its push.
    await runDurableObjectAlarm(t.stub);
    await vi.waitFor(async () => expect(await snapshot(address)).toMatchObject({ title: "Acme" }));
    await vi.waitFor(async () =>
      expect(await t.withShard((shard) => shard.statusDirty())).toBeUndefined(),
    );
  });

  test("an address with no page is a 404 with no shard involved", async () => {
    for (const address of [slug(), "x", "Bad_Slug"]) {
      const response = await exports.default.fetch(`${ORIGIN}/status/${address}`);
      expect(response.status).toBe(404);
      expect(await response.text()).toContain("No status page here");
    }
  });
});
