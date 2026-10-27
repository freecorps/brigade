// The public status page (RFC 0012): `PUT /workspaces/:id/status-page` claims the slug in D1 and sets the page up in
// the shard as the member; the shard pushes a sanitized snapshot to KV; `GET /status/:slug` reads only KV.
import { env, exports } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import {
  newId,
  type Actor,
  type AlertRow,
  type MonitorRow,
  type StatusSnapshot,
} from "@freecorps/brigade-schema";
import { describe, expect, test, vi } from "vite-plus/test";
import type { BrigadeEvent } from "../src/outbox.ts";
import { Shard, touchesStatusPage } from "../src/shard.ts";
import {
  STATUS_OUTAGE_REFRESH_MS,
  STATUS_PUSH_ABANDON_MS,
  STATUS_REFRESH_MS,
  STATUS_SLUG_GRACE_MS,
  statusKey,
  StatusPublisher,
} from "../src/status-page.ts";
import type { WorkspaceDO } from "../src/workspace.ts";
import { sessionCookie } from "./session.ts";

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
  const email = `${name.toLowerCase()}-s${++people}@example.com`;
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
  /** The shard's push, as its alarm runs it, each a little later (KV's one write a second), `ahead` later still. */
  let pushes = 0;
  let ahead = 0;
  const push = (more = 0) =>
    runInDurableObject(stub, async (instance: WorkspaceDO) => {
      ahead += more;
      const publisher = Reflect.get(instance, "status") as StatusPublisher;
      await publisher.publish(id, Date.now() + ahead + ++pushes * 2000);
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

/**
 * A KV whose first put hangs until `settle`: `true` lands its write then (late), `false` fails it. Every other call
 * goes to the real namespace.
 */
function hangingFirstPut() {
  let release: ((ok: boolean) => void) | undefined;
  let puts = 0;
  const kv = {
    put: (key: string, value: string) => {
      if (++puts > 1) return env.STATUS!.put(key, value);
      return new Promise<void>((resolve, reject) => {
        release = (ok) => {
          if (ok) void env.STATUS!.put(key, value).then(() => resolve(), reject);
          else reject(new Error("KV gave up"));
        };
      });
    },
    delete: (key: string) => env.STATUS!.delete(key),
  } as unknown as KVNamespace;
  return { kv, puts: () => puts, settle: (ok: boolean) => release!(ok) };
}

/** A publisher on the shard's own storage with `kv`, recording its logs and the alarm times it asks for. */
function publisherWith(state: DurableObjectState, kv: KVNamespace, db: D1Database = env.DB) {
  const shard = new Shard(state.storage, {
    shard: "workspace",
    randomBytes: random,
    log: () => {},
  });
  const logs: string[] = [];
  const wakes: number[] = [];
  const publisher = new StatusPublisher({
    shard,
    sql: state.storage.sql,
    kv,
    db,
    randomBytes: random,
    log: (message) => logs.push(message),
    committed: () => {},
    wake: (at) => wakes.push(at),
  });
  return { shard, publisher, logs, wakes };
}

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

  test("a new slug deletes the old snapshot, and D1 releases the old slug only after the caches' grace", async () => {
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
    // Deleted from KV, but edge copies may still serve it for a while: still held.
    expect(await owners(first)).toEqual([t.id]);
    const retired = await t.withShard((shard) => shard.store.get("status_retired", first));
    expect(retired?.cleared).toEqual(expect.any(Number));
    const publisher = (instance: WorkspaceDO) => Reflect.get(instance, "status") as StatusPublisher;
    const next = await runInDurableObject(t.stub, (instance: WorkspaceDO) =>
      publisher(instance).nextAt(retired!.cleared! + 1),
    );
    expect(next).toBe(retired!.cleared! + STATUS_SLUG_GRACE_MS);
    await t.push(STATUS_SLUG_GRACE_MS);
    expect(await owners(first)).toEqual([]);
    expect(await owners(second)).toEqual([t.id]);
    expect(await t.withShard((shard) => shard.store.scan("status_retired"))).toEqual([]);
    expect((await configure(other, other.ana, settings(first))).status).toBe(200);
  });

  test("a slug taken back after it was given up stays the workspace's, even if a late release lands", async () => {
    const t = await team();
    const first = slug();
    const second = slug();
    await configure(t, t.ana, settings(first));
    await configure(t, t.ana, settings(second));
    const retired = await t.withShard((shard) => shard.store.get("status_retired", first));
    expect((await configure(t, t.ana, settings(first))).status).toBe(200);
    // The release of the first retirement, landing only now: the claim since is stamped later, so it stays.
    await env.DB.prepare(
      "delete from status_slug where slug = ? and workspace_id = ? and created_at <= ?",
    )
      .bind(first, t.id, retired!.at)
      .run();
    expect(await owners(first)).toEqual([t.id]);
  });

  test("without KV, a slug given up is released at once", async () => {
    const t = await team();
    const first = slug();
    const second = slug();
    const ana: Actor = { kind: "user", id: t.ana.id, role: "owner" };
    await runInDurableObject(t.stub, async (_instance: WorkspaceDO, state) => {
      const shard = new Shard(state.storage, {
        shard: "workspace",
        randomBytes: random,
        log: () => {},
      });
      const publisher = new StatusPublisher({
        shard,
        sql: state.storage.sql,
        kv: undefined,
        db: env.DB,
        randomBytes: random,
        log: () => {},
        committed: () => {},
        wake: () => {},
      });
      expect(await publisher.configure(t.id, ana, settings(first))).toEqual({ ok: true });
      // A page with nowhere to push it is nothing to do.
      expect(publisher.nextAt(Date.now())).toBeNull();
      expect(await publisher.configure(t.id, ana, settings(second))).toEqual({ ok: true });
      const now = Date.now();
      expect(publisher.nextAt(now)).toBe(now);
      await publisher.publish(t.id, now);
      expect(shard.store.scan("status_retired")).toEqual([]);
      expect(publisher.nextAt(Date.now())).toBeNull();
    });
    expect(await owners(first)).toEqual([]);
    expect(await owners(second)).toEqual([t.id]);
  });

  test("a quiet public page is rebuilt daily, so its history and its time stay true", async () => {
    const t = await team();
    const address = slug();
    await configure(t, t.ana, settings(address));
    await t.push();
    const built = (await snapshot(address))!.generatedAt;
    const pushed = await t.withShard((shard, state) => {
      expect(shard.statusDirty()).toBeUndefined();
      return state.storage.sql
        .exec<{ value: number }>("select value from shard_meta where key = 'status_pushed_at'")
        .one().value;
    });
    const next = await runInDurableObject(t.stub, (instance: WorkspaceDO) =>
      (Reflect.get(instance, "status") as StatusPublisher).nextAt(pushed + 1),
    );
    // At the next UTC midnight, so "today" on the uptime bars moves on with the date.
    expect(next).toBe((Math.floor(pushed / STATUS_REFRESH_MS) + 1) * STATUS_REFRESH_MS);
    await t.push(STATUS_REFRESH_MS);
    expect((await snapshot(address))!.generatedAt).toBeGreaterThanOrEqual(
      built + STATUS_REFRESH_MS,
    );
    // A draft is not rebuilt: there is nothing public to keep true.
    await configure(t, t.ana, settings(address, { enabled: false }));
    await t.push();
    const draft = await runInDurableObject(t.stub, (instance: WorkspaceDO) =>
      (Reflect.get(instance, "status") as StatusPublisher).nextAt(
        Date.now() + 10 * STATUS_REFRESH_MS,
      ),
    );
    expect(draft).toBeNull();
  });

  test("while a linked monitor's alert fires, the page is rebuilt every few minutes", async () => {
    const t = await team();
    const address = slug();
    await configure(t, t.ana, settings(address));
    const ana: Actor = { kind: "user", id: t.ana.id, role: "owner" };
    const component = newId("cmp", Date.now(), random);
    const monitor = newId("mon", Date.now(), random);
    await t.run("statusComponent.create", { id: component, name: "API", group: null }, ana);
    await t.withShard((shard) => {
      shard.store.insert("monitors", {
        id: monitor,
        createdAt: Date.now() - 86_400_000,
        paused: false,
        pausedAt: null,
      } as MonitorRow);
    });
    expect(
      await t.run("statusComponent.linkMonitors", { id: component, monitorIds: [monitor] }, ana),
    ).toMatchObject({ ok: true });
    await t.push();
    const nextAt = (at: number) =>
      runInDurableObject(t.stub, (instance: WorkspaceDO) =>
        (Reflect.get(instance, "status") as StatusPublisher).nextAt(at),
      );
    const pushedAt = () =>
      t.withShard(
        (_shard, state) =>
          state.storage.sql
            .exec<{ value: number }>("select value from shard_meta where key = 'status_pushed_at'")
            .one().value,
      );
    const pushed = await pushedAt();
    const midnight = (Math.floor(pushed / STATUS_REFRESH_MS) + 1) * STATUS_REFRESH_MS;
    expect(await nextAt(pushed + 1)).toBe(midnight);
    // Down now: the bar grows while the page stands still, so it is rebuilt every few minutes.
    const alert = newId("alt", Date.now(), random);
    await t.withShard((shard) => {
      shard.store.insert("alerts", {
        id: alert,
        monitorId: monitor,
        status: "firing",
        firedAt: pushed - 60_000,
        resolvedAt: null,
      } as AlertRow);
    });
    await t.push();
    const during = await pushedAt();
    expect(await nextAt(during + 1)).toBe(Math.min(midnight, during + STATUS_OUTAGE_REFRESH_MS));
    // Back up: once a day again.
    await t.withShard((shard) => {
      shard.store.update("alerts", alert, { status: "resolved", resolvedAt: during });
    });
    await t.push();
    const after = await pushedAt();
    expect(await nextAt(after + 1)).toBe(
      (Math.floor(after / STATUS_REFRESH_MS) + 1) * STATUS_REFRESH_MS,
    );
  });

  test("only an alert of a monitor a component shows marks the page for a rebuild", async () => {
    const t = await team();
    await configure(t, t.ana, settings(slug()));
    const ana: Actor = { kind: "user", id: t.ana.id, role: "owner" };
    const component = newId("cmp", Date.now(), random);
    const [shown, hidden] = [newId("mon", Date.now(), random), newId("mon", Date.now(), random)];
    await t.run("statusComponent.create", { id: component, name: "API", group: null }, ana);
    await t.withShard((shard) => {
      for (const id of [shown, hidden]) {
        shard.store.insert("monitors", {
          id,
          createdAt: Date.now(),
          paused: false,
          pausedAt: null,
        } as MonitorRow);
      }
    });
    const alert = (monitorId: string) => {
      const id = newId("alt", Date.now(), random);
      return t.withShard((shard) => {
        shard.store.insert("alerts", {
          id,
          monitorId,
          status: "firing",
          firedAt: Date.now(),
          resolvedAt: null,
        } as AlertRow);
        return touchesStatusPage([{ table: "alerts", id }], shard.store);
      });
    };
    // Nothing linked yet: no alert moves the page.
    expect(await alert(shown)).toBe(false);
    expect(
      await t.run("statusComponent.linkMonitors", { id: component, monitorIds: [shown] }, ana),
    ).toMatchObject({ ok: true });
    expect(await alert(hidden)).toBe(false);
    expect(await alert(shown)).toBe(true);
    expect(
      await t.withShard((shard) =>
        touchesStatusPage([{ table: "status_components", id: component }], shard.store),
      ),
    ).toBe(true);
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

  test("a push hung on KV backs the alarm off, holds nothing else, and the page can still be configured", async () => {
    const t = await team();
    const address = slug();
    await configure(t, t.ana, settings(address));
    const logs: string[] = [];
    const result = await runInDurableObject(t.stub, async (instance: WorkspaceDO, state) => {
      const real: unknown = Reflect.get(instance, "status");
      const shard = new Shard(state.storage, {
        shard: "workspace",
        randomBytes: random,
        log: () => {},
      });
      const hanging = {
        put: () => new Promise(() => {}),
        delete: () => new Promise(() => {}),
      } as unknown as KVNamespace;
      const publisher = new StatusPublisher({
        shard,
        sql: state.storage.sql,
        kv: hanging,
        db: env.DB,
        randomBytes: random,
        log: (message) => logs.push(message),
        committed: () => {},
        wake: () => {},
      });
      Reflect.set(instance, "status", publisher);
      Reflect.set(instance, "statusBudgetMs", 20);
      Reflect.set(instance, "drainPaused", true);
      try {
        const first = Date.now();
        await instance.alarm();
        const afterFirst = await state.storage.getAlarm();
        // The push is still out. The alarm comes back for it later, and then does not wait on it again.
        const second = Date.now();
        await instance.alarm();
        const took = Date.now() - second;
        const afterSecond = await state.storage.getAlarm();
        // Configuring the page waits on D1 and the shard only, never on the push.
        const configured = await instance.configureStatusPage(
          t.id,
          { kind: "user", id: t.ana.id, role: "owner" },
          settings(address, { title: "Acme Status" }),
        );
        return { first, afterFirst, second, took, afterSecond, configured };
      } finally {
        Reflect.set(instance, "status", real);
      }
    });
    expect(result.afterFirst).not.toBeNull();
    expect(result.afterFirst!).toBeGreaterThanOrEqual(result.first + 400);
    expect(result.took).toBeLessThan(1000);
    expect(result.afterSecond!).toBeGreaterThan(result.second + 400);
    expect(result.configured).toEqual({ ok: true });
    expect(logs).toContain("publishing the status page failed");
  });

  test("a push that hangs, then lands, brings the alarm back at once for a change made meanwhile", async () => {
    const t = await team();
    const address = slug();
    await configure(t, t.ana, settings(address));
    const ana: Actor = { kind: "user", id: t.ana.id, role: "owner" };
    await runInDurableObject(t.stub, async (_instance: WorkspaceDO, state) => {
      const kv = hangingFirstPut();
      const { publisher, logs, wakes } = publisherWith(state, kv.kv);
      const start = Date.now() + 60_000;
      const hung = publisher.publish(t.id, start);
      expect(kv.puts()).toBe(1);
      expect(
        await publisher.configure(t.id, ana, settings(address, { title: "Acme Status" })),
      ).toEqual({ ok: true });
      // Due again while the first is out: no second push beside it, and it backs off.
      await publisher.publish(t.id, start + 2000);
      expect(kv.puts()).toBe(1);
      expect(logs.filter((m) => m === "publishing the status page failed")).toHaveLength(1);
      // Within the backoff nothing is due: nothing is logged.
      await publisher.publish(t.id, start + 2001);
      expect(logs.filter((m) => m === "publishing the status page failed")).toHaveLength(1);
      kv.settle(true);
      await hung;
      // Landed: the change made meanwhile is still to push, and the alarm is asked back for it now.
      expect(wakes.at(-1)!).toBeLessThanOrEqual(start + STATUS_PUSH_ABANDON_MS);
      const at = publisher.nextAt(start + 3000);
      expect(at).toBe(start + 3000);
      await publisher.publish(t.id, at!);
      expect(kv.puts()).toBe(2);
    });
    expect(await snapshot(address)).toMatchObject({ title: "Acme Status" });
  });

  for (const lands of [true, false]) {
    test(`a push hung past the ceiling is abandoned, and when it ${lands ? "lands late" : "fails"} the page is pushed again`, async () => {
      const t = await team();
      const address = slug();
      await configure(t, t.ana, settings(address));
      const ana: Actor = { kind: "user", id: t.ana.id, role: "owner" };
      await runInDurableObject(t.stub, async (_instance: WorkspaceDO, state) => {
        const kv = hangingFirstPut();
        const { publisher, logs, wakes } = publisherWith(state, kv.kv);
        const start = Date.now() + 60_000;
        const hung = publisher.publish(t.id, start);
        expect(
          await publisher.configure(t.id, ana, settings(address, { title: "Acme Status" })),
        ).toEqual({ ok: true });
        // Still out after the ceiling: given up on, and a new push writes the change.
        await publisher.publish(t.id, start + STATUS_PUSH_ABANDON_MS);
        expect(logs).toContain("abandoning a stuck status page push");
        expect(kv.puts()).toBe(2);
        expect(await snapshot(address)).toMatchObject({ title: "Acme Status" });
        // The abandoned one settles; landing, its older snapshot would be the last write.
        kv.settle(lands);
        await hung;
        if (lands) expect(await snapshot(address)).toMatchObject({ title: "Acme" });
        expect(logs).not.toContain("publishing the status page failed");
        const later = start + STATUS_PUSH_ABANDON_MS + 2000;
        expect(wakes.at(-1)!).toBeLessThanOrEqual(later);
        expect(publisher.nextAt(later)).toBe(later);
        await publisher.publish(t.id, later);
        expect(kv.puts()).toBe(3);
        expect(publisher.nextAt(later + 2000)).toBeGreaterThan(later + 2000);
      });
      expect(await snapshot(address)).toMatchObject({ title: "Acme Status" });
    });
  }

  test("a slug taken back and given up again while D1 releases it keeps the newer record, released after its grace", async () => {
    const t = await team();
    const first = slug();
    const second = slug();
    const ana: Actor = { kind: "user", id: t.ana.id, role: "owner" };
    await configure(t, t.ana, settings(first));
    await configure(t, t.ana, settings(second));
    await runInDurableObject(t.stub, async (_instance: WorkspaceDO, state) => {
      let publisher: StatusPublisher | undefined;
      let interposed = false;
      // The push's release of `first`: before it reaches D1, the page takes `first` back and gives it up again.
      const db = {
        batch: env.DB.batch.bind(env.DB),
        prepare: (query: string) => {
          const statement = env.DB.prepare(query);
          if (interposed || !query.startsWith("delete from status_slug")) return statement;
          interposed = true;
          return {
            bind: (...values: unknown[]) => ({
              run: async () => {
                expect(await publisher!.configure(t.id, ana, settings(first))).toEqual({
                  ok: true,
                });
                await new Promise((resolve) => setTimeout(resolve, 5));
                expect(await publisher!.configure(t.id, ana, settings(second))).toEqual({
                  ok: true,
                });
                return statement.bind(...values).run();
              },
            }),
          };
        },
      } as unknown as D1Database;
      const made = publisherWith(state, env.STATUS!, db);
      publisher = made.publisher;
      const { shard } = made;
      const before = shard.store.get("status_retired", first)!;
      const start = Date.now() + 60_000;
      await publisher.publish(t.id, start);
      await publisher.publish(t.id, start + STATUS_SLUG_GRACE_MS + 2000);
      expect(interposed).toBe(true);
      // The newer retirement stays, with the slug still held for it.
      const after = shard.store.get("status_retired", first);
      expect(after?.at).toBeGreaterThan(before.at);
      expect(await owners(first)).toEqual([t.id]);
      // Its own push deletes the snapshot again, and releases the slug after its grace.
      await publisher.publish(t.id, start + STATUS_SLUG_GRACE_MS + 4000);
      const cleared = shard.store.get("status_retired", first)?.cleared;
      expect(cleared).toBe(start + STATUS_SLUG_GRACE_MS + 4000);
      await publisher.publish(t.id, cleared! + STATUS_SLUG_GRACE_MS + 2000);
      expect(shard.store.get("status_retired", first)).toBeUndefined();
    });
    expect(await owners(first)).toEqual([]);
    expect(await owners(second)).toEqual([t.id]);
  });

  test("editing or removing a published update changes the snapshot in KV", async () => {
    const t = await team();
    const address = slug();
    await configure(t, t.ana, settings(address));
    const caio: Actor = { kind: "user", id: t.caio.id, role: "responder" };
    const incident = newId("inc", Date.now(), random);
    await t.run(
      "incident.declare",
      { id: incident, title: "Checkout is down", severity: "sev2" },
      caio,
    );
    for (const body of ["We're looking into it.", "A fix is rolling out."]) {
      expect(
        await t.run(
          "incident.publishUpdate",
          {
            id: incident,
            title: "Checkout errors",
            status: "identified",
            impact: "degraded",
            componentIds: [],
            body,
          },
          caio,
        ),
      ).toMatchObject({ ok: true });
    }
    await t.push();
    const bodies = async () =>
      (await snapshot(address))!.active
        .flatMap((shown) => shown.updates.map((update) => update.body))
        .sort();
    expect(await bodies()).toEqual(["A fix is rolling out.", "We're looking into it."]);
    const [older, newer] = await t.withShard(
      (shard) => shard.store.get("status_incidents", incident)!.updates,
    );
    expect(
      await t.run(
        "incident.editPublishedUpdate",
        { id: incident, updateId: older!.id, body: "We're looking into slow checkouts." },
        caio,
      ),
    ).toMatchObject({ ok: true });
    await t.push();
    expect(await bodies()).toEqual(["A fix is rolling out.", "We're looking into slow checkouts."]);
    expect(
      await t.run("incident.removePublishedUpdate", { id: incident, updateId: newer!.id }, caio),
    ).toMatchObject({ ok: true });
    await t.push();
    expect(await bodies()).toEqual(["We're looking into slow checkouts."]);
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

  test("a snapshot this Worker cannot read is the 503 page, never half a page", async () => {
    const t = await team();
    const address = slug();
    await configure(t, t.ana, settings(address));
    await t.push();
    const good = (await snapshot(address))!;
    // Nothing version 2 added: written as a 1, which a Worker rolled back to version 1 still reads.
    expect(good).toMatchObject({ v: 1 });
    expect(good).not.toHaveProperty("maintenance");
    const good2 = { ...good, v: 2, maintenance: [], upcoming: [] };
    const broken = [
      { ...good, locale: "fr" },
      { ...good, status: "on_fire" },
      { ...good, generatedAt: "yesterday" },
      { ...good, v: 3 },
      // A 1 carrying version 2's fields.
      { ...good2, v: 1 },
      {
        ...good2,
        groups: [
          {
            name: null,
            components: [
              { name: "API", status: "maintenance", uptime: { percent: 101, days: [] } },
            ],
          },
        ],
      },
      {
        ...good2,
        upcoming: [{ title: "Upgrade", body: "", components: [], startsAt: "soon", endsAt: 1 }],
      },
      {
        ...good,
        active: [
          {
            title: "Slow",
            status: "investigating",
            impact: "degraded",
            components: [],
            publishedAt: 8.65e15,
            resolvedAt: null,
            updates: [],
          },
        ],
      },
    ];
    for (const [index, value] of broken.entries()) {
      const other = `${address}-${index}`;
      await env.STATUS!.put(statusKey(other), JSON.stringify(value));
      const response = await exports.default.fetch(`${ORIGIN}/status/${other}`);
      expect(response.status, JSON.stringify(value).slice(0, 80)).toBe(503);
      expect(await response.text()).toContain("Status page unavailable");
    }
  });

  test("an address with no page is a 404 with no shard involved", async () => {
    for (const address of [slug(), "x", "Bad_Slug", ""]) {
      const response = await exports.default.fetch(`${ORIGIN}/status/${address}`);
      expect(response.status).toBe(404);
      expect(await response.text()).toContain("No status page here");
    }
    expect((await exports.default.fetch(`${ORIGIN}/status`)).status).toBe(404);
  });
});
