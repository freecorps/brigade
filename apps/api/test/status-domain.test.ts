// A status page's own domain (RFC 0012 "Custom domains"): adding, checking and removing it against a fake of
// Cloudflare's custom hostnames API (claims, races, orphans, rollbacks), the shard re-checking it from its alarm, the
// public lookup kept in step by events, serving the page at its hostname through the `StatusPages` entrypoint, and
// the API Worker's own routes left exactly as they were.
import { env, exports } from "cloudflare:workers";
import { createExecutionContext, createMessageBatch, runInDurableObject } from "cloudflare:test";
import {
  alertSourceToken,
  newHeartbeatSecret,
  newId,
  STATUS_DOMAIN_ID,
  type Actor,
} from "@freecorps/brigade-schema";
import type { StatusPagesApi } from "@freecorps/brigade-status-edge/api";
import { describe, expect, test, vi } from "vite-plus/test";
import worker, { workerAuth } from "../src/index.ts";
import { consumeEvents } from "../src/notify.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { Shard } from "../src/shard.ts";
import {
  CLAIM_STALE_MS,
  hostKey,
  normalizeHostname,
  statusDomainRoute,
  syncStatusHost,
} from "../src/status-domain.ts";
import { domainError, type SaasConfig } from "../src/status-domain-cf.ts";
import {
  DOMAIN_ACTIVE_RECHECK_MS,
  DOMAIN_PENDING_MAX_MS,
  DOMAIN_RECHECK_MIN_MS,
  type DomainChecker,
} from "../src/status-domain-check.ts";
import type { StatusPublisher } from "../src/status-page.ts";
import { serveCustomHost } from "../src/status-pages.ts";
import type { WorkspaceDO } from "../src/workspace.ts";
import { sessionCookie } from "./session.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const SAAS = {
  CF_SAAS_TOKEN: "test-saas-token",
  CF_ZONE_ID: "zone-test",
  CF_SAAS_FALLBACK_ORIGIN: "status-origin.saas.test",
  DASHBOARD_URL: ORIGIN,
};
const SAAS_CONFIG: SaasConfig = {
  token: SAAS.CF_SAAS_TOKEN,
  zoneId: SAAS.CF_ZONE_ID,
  target: SAAS.CF_SAAS_FALLBACK_ORIGIN,
};
const configured = { ...env, ...SAAS } as Env & typeof SAAS;

let people = 0;
let clients = 0;
let hosts = 0;
const clientIp = () => `198.51.${Math.floor(++clients / 250) % 250}.${(clients % 250) + 1}`;
/** Each test its own hostname and slug: KV and the edge cache keep them a while. */
const hostname = () => `status-${Date.now().toString(36)}-${++hosts}.acme.test`;
const slug = () => `dom-${Date.now().toString(36)}-${++hosts}`;

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
  const email = `${name.toLowerCase()}-d${++people}@example.com`;
  const response = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name, email, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  return { id: body.user.id, cookie: await sessionCookie(email, PASSWORD) };
}

async function workspace(owner: Person) {
  const created = await api("/workspaces", {
    method: "POST",
    headers: { Cookie: owner.cookie },
    body: JSON.stringify({ name: "Acme" }),
  });
  expect(created.status).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

/** Ana owns a workspace with a public page; Caio is a responder there. */
async function team(crew?: { ana: Person; caio: Person }) {
  const [ana, caio] = crew
    ? [crew.ana, crew.caio]
    : await Promise.all([signUp("Ana"), signUp("Caio")]);
  const id = await workspace(ana!);
  await env.DB.prepare(
    `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, ?, ?)`,
  )
    .bind(newId("mem", Date.now(), random), id, caio!.id, "responder", new Date().toISOString())
    .run();
  const address = slug();
  const page = await api(`/workspaces/${id}/status-page`, {
    method: "PUT",
    headers: { Cookie: ana!.cookie },
    body: JSON.stringify({ slug: address, title: "Acme", locale: "en", enabled: true }),
  });
  expect(page.status).toBe(200);
  const stub = env.WORKSPACE.getByName(id);
  let pushes = 0;
  const push = () =>
    runInDurableObject(stub, async (instance: WorkspaceDO) => {
      const publisher = Reflect.get(instance, "status") as StatusPublisher;
      await publisher.publish(id, Date.now() + ++pushes * 2000);
    });
  return { id, stub, ana: ana!, caio: caio!, slug: address, push };
}
type Team = Awaited<ReturnType<typeof team>>;

/** A fake of `/zones/:zone/custom_hostnames`: what was asked, and answers a test can change. */
function cloudflare() {
  const calls: { method: string; url: string; body: unknown; auth: string | null }[] = [];
  const hostnames = new Map<
    string,
    { id: string; hostname: string; status: string; ssl: string }
  >();
  let next = 0;
  const answers = {
    create: (body: { hostname: string }) => {
      // Cloudflare's own duplicate, for a hostname this zone has already.
      if ([...hostnames.values()].some((row) => row.hostname === body.hostname)) {
        return Response.json(
          { success: false, errors: [{ code: 1406, message: "Duplicate custom hostname found." }] },
          { status: 409 },
        );
      }
      const row = {
        id: `cfh-${++next}`,
        hostname: body.hostname,
        status: "pending",
        ssl: "pending_validation",
      };
      hostnames.set(row.id, row);
      return Response.json({ success: true, errors: [], result: shape(row) });
    },
    /** `GET ?hostname=`: what this zone has under the name. */
    list: (name: string) =>
      Response.json({
        success: true,
        errors: [],
        result: [...hostnames.values()].filter((row) => row.hostname === name).map(shape),
      }),
  };
  const shape = (row: { id: string; hostname: string; status: string; ssl: string }) => ({
    id: row.id,
    hostname: row.hostname,
    status: row.status,
    ssl: { status: row.ssl, method: "http", type: "dv" },
    ownership_verification: {
      type: "txt",
      name: `_cf-custom-hostname.${row.hostname}`,
      value: `token-${row.id}`,
    },
  });
  const send = async (request: Request) => {
    const body = request.method === "POST" ? await request.json() : undefined;
    calls.push({
      method: request.method,
      url: request.url,
      body,
      auth: request.headers.get("Authorization"),
    });
    const url = new URL(request.url);
    const id = url.pathname.split("/custom_hostnames/")[1];
    if (request.method === "POST") return answers.create(body as { hostname: string });
    if (request.method === "GET" && !id)
      return answers.list(url.searchParams.get("hostname") ?? "");
    const row = id ? hostnames.get(decodeURIComponent(id)) : undefined;
    if (!row) {
      return Response.json(
        { success: false, errors: [{ code: 1436, message: "not found" }] },
        { status: 404 },
      );
    }
    if (request.method === "DELETE") {
      hostnames.delete(row.id);
      return Response.json({ success: true, errors: [], result: { id: row.id } });
    }
    return Response.json({ success: true, errors: [], result: shape(row) });
  };
  /** Adds one as if an earlier create had landed. */
  const plant = (name: string) => {
    const row = {
      id: `cfh-${++next}`,
      hostname: name,
      status: "pending",
      ssl: "pending_validation",
    };
    hostnames.set(row.id, row);
    return row;
  };
  const timeout = () =>
    new DOMException("The operation was aborted due to timeout", "TimeoutError");
  return { calls, hostnames, answers, send, plant, timeout };
}

const route = (
  t: Team,
  by: Person,
  method: string,
  fake: ReturnType<typeof cloudflare>,
  body?: unknown,
  check = false,
  config: Env = configured,
) => {
  const request = new Request(
    `${ORIGIN}/workspaces/${t.id}/status-page/domain${check ? "/check" : ""}`,
    {
      method,
      headers: { Origin: ORIGIN, Cookie: by.cookie, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  const ctx = createExecutionContext();
  return statusDomainRoute(
    request,
    config,
    () => workerAuth(config, ctx, request),
    t.id,
    check,
    fake.send,
  );
};

const domainRow = (t: Team) =>
  runInDurableObject(t.stub, (instance: WorkspaceDO) => instance.statusDomainState(t.id).domain);

const outbox = (t: Team, type: string) =>
  runInDurableObject(t.stub, (_instance: WorkspaceDO, state) =>
    state.storage.sql
      .exec<{ event: string }>("select event from outbox order by seq")
      .toArray()
      .map((row) => JSON.parse(row.event) as BrigadeEvent)
      .filter((event) => event.type === type),
  );

/** A request as a Worker receives one, for calling the default export directly. */
const incoming = (url: string, init?: RequestInit) =>
  new Request(url, init) as Request<unknown, IncomingRequestCfProperties>;

const holder = async (name: string) =>
  (
    await env.DB.prepare("select workspace_id from status_custom_host where hostname = ?")
      .bind(name)
      .first<{ workspace_id: string }>()
  )?.workspace_id;

describe("hostnames", () => {
  const read = (value: unknown) => normalizeHostname(value, "brigade.example.com");
  test("a hostname is kept lowercase and in punycode, without a trailing dot", () => {
    expect(read(" Status.Acme.Test. ")).toEqual({ ok: true, hostname: "status.acme.test" });
    const idn = read("status.açaí.test");
    expect(idn).toMatchObject({ ok: true });
    expect(idn.ok && idn.hostname).toMatch(/^status\.xn--[a-z0-9-]+\.test$/);
  });
  test("no IP address, port, path, scheme, single label or bad label", () => {
    for (const bad of [
      "203.0.113.7",
      "1.2.3",
      "0x7f.1",
      "[::1]",
      "::1",
      "status.acme.test:8443",
      "status.acme.test/x",
      "https://status.acme.test",
      "localhost",
      "-bad.test",
      "a..test",
      "",
      42,
      `${"a".repeat(64)}.test`,
    ]) {
      expect(read(bad), String(bad)).toEqual({ ok: false, code: "invalid_hostname" });
    }
  });
  test("never the instance's own domain, anything under it, or a parent of the dashboard's", () => {
    for (const own of [
      "example.com",
      "brigade.example.com",
      "status.example.com",
      "a.b.example.com",
    ]) {
      expect(read(own), own).toEqual({ ok: false, code: "own_domain" });
    }
    expect(normalizeHostname("acme.co.test", "brigade.acme.co.test")).toEqual({
      ok: false,
      code: "own_domain",
    });
    expect(normalizeHostname("status.other.co.test", "brigade.acme.co.test")).toMatchObject({
      ok: true,
    });
    expect(read("status.acme.test")).toMatchObject({ ok: true });
  });
});

describe("the dashboard's routes", () => {
  test("without the Cloudflare settings the feature is off and says so, calling nobody", async () => {
    const t = await team();
    const fake = cloudflare();
    const off = { ...env, DASHBOARD_URL: ORIGIN } as Env;
    const get = await route(t, t.ana, "GET", fake, undefined, false, off);
    expect(await get.json()).toEqual({ configured: false });
    const put = await route(t, t.ana, "PUT", fake, { hostname: hostname() }, false, off);
    expect([put.status, await put.json()]).toEqual([503, { error: "not_configured" }]);
    expect(fake.calls).toEqual([]);
  });

  test("an owner adds one: claimed in D1, created at Cloudflare, kept in the shard with the records to create", async () => {
    const t = await team();
    const fake = cloudflare();
    const name = hostname();
    expect(await (await route(t, t.caio, "GET", fake)).json()).toEqual({
      configured: true,
      target: "status-origin.saas.test",
    });
    // A responder may read it, not change it; nothing reaches Cloudflare.
    expect((await route(t, t.caio, "PUT", fake, { hostname: name })).status).toBe(403);
    expect((await route(t, t.ana, "PUT", fake, { hostname: "brigade.api.test" })).status).toBe(400);
    expect(fake.calls).toEqual([]);

    const added = await route(t, t.ana, "PUT", fake, { hostname: name.toUpperCase() });
    expect(added.status).toBe(200);
    expect(await added.json()).toMatchObject({
      hostname: name,
      state: "pending",
      records: [
        { type: "CNAME", name, value: "status-origin.saas.test" },
        { type: "TXT", name: `_cf-custom-hostname.${name}`, value: "token-cfh-1" },
      ],
    });
    expect(fake.calls).toEqual([
      {
        method: "POST",
        url: "https://api.cloudflare.com/client/v4/zones/zone-test/custom_hostnames",
        body: {
          hostname: name,
          ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
        },
        auth: "Bearer test-saas-token",
      },
    ]);
    expect(await holder(name)).toBe(t.id);
    expect(await domainRow(t)).toMatchObject({
      hostname: name,
      cloudflareId: "cfh-1",
      state: "pending",
    });
    expect(await outbox(t, "status_domain.added")).toMatchObject([
      { data: { hostname: name, state: "pending" }, actor: { id: t.ana.id } },
    ]);
    // One per page.
    expect((await route(t, t.ana, "PUT", fake, { hostname: hostname() })).status).toBe(409);
  });

  test("a hostname another workspace holds, or Cloudflare has elsewhere, is taken and leaves nothing behind", async () => {
    const a = await team();
    const b = await team();
    const fake = cloudflare();
    const name = hostname();
    expect((await route(a, a.ana, "PUT", fake, { hostname: name })).status).toBe(200);
    const calls = fake.calls.length;
    const taken = await route(b, b.ana, "PUT", fake, { hostname: name });
    expect([taken.status, await taken.json()]).toEqual([409, { error: "hostname_taken" }]);
    expect(fake.calls).toHaveLength(calls);

    const elsewhere = hostname();
    fake.answers.create = () =>
      Response.json(
        { success: false, errors: [{ code: 1406, message: "Duplicate custom hostname" }] },
        { status: 409 },
      );
    expect((await route(b, b.ana, "PUT", fake, { hostname: elsewhere })).status).toBe(409);
    expect(await holder(elsewhere)).toBeUndefined();
    expect(await domainRow(b)).toBeNull();
    // Cloudflare down: the claim goes back too.
    fake.answers.create = () => new Response("bad gateway", { status: 502 });
    expect((await route(b, b.ana, "PUT", fake, { hostname: elsewhere })).status).toBe(502);
    expect(await holder(elsewhere)).toBeUndefined();
  });

  test("checking records what Cloudflare says; removing deletes it there, in the shard and in D1", async () => {
    const t = await team();
    const fake = cloudflare();
    const name = hostname();
    await route(t, t.ana, "PUT", fake, { hostname: name });
    // Still pending: recorded all the same, with the state it was in.
    expect((await route(t, t.ana, "POST", fake, undefined, true)).status).toBe(200);
    expect(await outbox(t, "status_domain.checked")).toMatchObject([
      { data: { state: "pending", previous: "pending" } },
    ]);
    const row = fake.hostnames.get("cfh-1")!;
    row.status = "active";
    row.ssl = "active";
    const checked = await route(t, t.ana, "POST", fake, undefined, true);
    expect(await checked.json()).toMatchObject({ state: "active", error: null });
    expect((await outbox(t, "status_domain.checked")).at(-1)).toMatchObject({
      data: { hostname: name, state: "active", previous: "pending" },
    });
    row.status = "moved";
    expect(await (await route(t, t.ana, "POST", fake, undefined, true)).json()).toMatchObject({
      state: "failed",
    });

    expect((await route(t, t.caio, "DELETE", fake)).status).toBe(403);
    const removed = await route(t, t.ana, "DELETE", fake);
    expect(removed.status).toBe(200);
    expect(fake.calls.at(-1)).toMatchObject({
      method: "DELETE",
      url: "https://api.cloudflare.com/client/v4/zones/zone-test/custom_hostnames/cfh-1",
    });
    expect(fake.hostnames.size).toBe(0);
    expect(await domainRow(t)).toBeNull();
    expect(await holder(name)).toBeUndefined();
    expect(await outbox(t, "status_domain.removed")).toMatchObject([{ data: { hostname: name } }]);
    expect((await route(t, t.ana, "DELETE", fake)).status).toBe(404);
  });

  test("a domain Cloudflare refuses to delete stays, so it never serves unseen", async () => {
    const t = await team();
    const fake = cloudflare();
    const name = hostname();
    await route(t, t.ana, "PUT", fake, { hostname: name });
    const failing = { ...fake, send: async () => new Response("unavailable", { status: 503 }) };
    expect((await route(t, t.ana, "DELETE", failing)).status).toBe(502);
    expect(await domainRow(t)).toMatchObject({ hostname: name });
    expect(await holder(name)).toBe(t.id);
  });

  test("changes are rate-limited per workspace", async () => {
    const t = await team();
    const fake = cloudflare();
    await route(t, t.ana, "PUT", fake, { hostname: hostname() });
    const statuses: number[] = [];
    for (let index = 0; index < 10; index++) {
      statuses.push((await route(t, t.ana, "POST", fake, undefined, true)).status);
    }
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.filter((status) => status === 200)).toHaveLength(9);
  });
});

describe("claims, races and what Cloudflare is left with", () => {
  test("two adds at once in one workspace: one wins, the other is 409 and never releases the winner's claim", async () => {
    const t = await team();
    const fake = cloudflare();
    const name = hostname();
    const [first, second] = await Promise.all([
      route(t, t.ana, "PUT", fake, { hostname: name }),
      route(t, t.ana, "PUT", fake, { hostname: name }),
    ]);
    expect([first.status, second.status].sort((x, y) => x - y)).toEqual([200, 409]);
    const lost = first.status === 409 ? first : second;
    expect(await lost.json()).toEqual({ error: "in_progress" });
    expect(await holder(name)).toBe(t.id);
    expect(await domainRow(t)).toMatchObject({ hostname: name, cloudflareId: "cfh-1" });
    expect([...fake.hostnames.keys()]).toEqual(["cfh-1"]);
  });

  test("a create that lands after our timeout is found and adopted, not left behind", async () => {
    const t = await team();
    const fake = cloudflare();
    const name = hostname();
    fake.answers.create = (body) => {
      fake.plant(body.hostname);
      throw fake.timeout();
    };
    const added = await route(t, t.ana, "PUT", fake, { hostname: name });
    expect(added.status).toBe(200);
    expect(fake.calls.map((call) => call.method + " " + new URL(call.url).search)).toEqual([
      "POST ",
      `GET ?hostname=${name}`,
    ]);
    expect([...fake.hostnames.keys()]).toEqual(["cfh-1"]);
    expect(await domainRow(t)).toMatchObject({ hostname: name, cloudflareId: "cfh-1" });
    expect(await holder(name)).toBe(t.id);
  });

  test("Cloudflare's duplicate (1406) of a hostname this zone has already, under our claim, is adopted", async () => {
    const t = await team();
    const fake = cloudflare();
    const name = hostname();
    const left = fake.plant(name);
    expect((await route(t, t.ana, "PUT", fake, { hostname: name })).status).toBe(200);
    expect(await domainRow(t)).toMatchObject({ cloudflareId: left.id });
    expect(fake.hostnames.size).toBe(1);
  });

  test("a failed create Cloudflare cannot be asked about keeps the claim; after a while the workspace adopts it", async () => {
    const t = await team();
    const fake = cloudflare();
    const name = hostname();
    const send = fake.send;
    const create = fake.answers.create;
    let down = true;
    fake.answers.create = (body) => {
      fake.plant(body.hostname);
      return new Response("bad gateway", { status: 502 });
    };
    const flaky = {
      ...fake,
      send: (request: Request) =>
        down && request.method === "GET"
          ? Promise.resolve(new Response("bad gateway", { status: 502 }))
          : send(request),
    };
    const failed = await route(t, t.ana, "PUT", flaky, { hostname: name });
    expect([failed.status, await failed.json()]).toEqual([502, { error: "cloudflare_failed" }]);
    // From now on Cloudflare answers as it would: the name is this zone's already (1406).
    fake.answers.create = create;
    // Cloudflare may hold a hostname of ours: the name stays ours, and asking again at once is in progress.
    expect(await holder(name)).toBe(t.id);
    const other = await team();
    expect((await route(other, other.ana, "PUT", flaky, { hostname: name })).status).toBe(409);
    expect((await route(t, t.ana, "PUT", flaky, { hostname: name })).status).toBe(409);
    down = false;
    await env.DB.prepare("update status_custom_host set created_at = ? where hostname = ?")
      .bind(Date.now() - CLAIM_STALE_MS - 1, name)
      .run();
    expect((await route(t, t.ana, "PUT", flaky, { hostname: name })).status).toBe(200);
    expect(await domainRow(t)).toMatchObject({ cloudflareId: "cfh-1" });
    expect(fake.hostnames.size).toBe(1);
  });

  test("a shard that refuses after the create deletes Cloudflare's hostname, then releases the claim", async () => {
    const t = await team();
    const fake = cloudflare();
    const name = hostname();
    const create = fake.answers.create;
    // Another add lands in the shard while Cloudflare answers ours: the shard refuses ours (one domain per page).
    fake.answers.create = (body) => {
      void t.stub.changeStatusDomain(t.id, owner(t), "add", {
        hostname: `other-${body.hostname}`,
        cloudflareId: "cfh-other",
        state: "pending",
        records: [],
        error: null,
      });
      return create(body);
    };
    const refused = await route(t, t.ana, "PUT", fake, { hostname: name });
    expect([refused.status, await refused.json()]).toEqual([409, { error: "domain_exists" }]);
    expect(fake.calls.map((call) => call.method)).toEqual(["POST", "DELETE"]);
    expect(fake.calls.at(-1)?.url).toMatch(/\/custom_hostnames\/cfh-1$/);
    expect(fake.hostnames.size).toBe(0);
    expect(await holder(name)).toBeUndefined();
  });

  test("a rollback Cloudflare refuses to delete keeps the claim, and says so in the log", async () => {
    const t = await team();
    const fake = cloudflare();
    const name = hostname();
    const create = fake.answers.create;
    fake.answers.create = (body) => {
      void t.stub.changeStatusDomain(t.id, owner(t), "add", {
        hostname: `other-${body.hostname}`,
        cloudflareId: "cfh-other",
        state: "pending",
        records: [],
        error: null,
      });
      return create(body);
    };
    const failing = {
      ...fake,
      send: (request: Request) =>
        request.method === "DELETE"
          ? Promise.resolve(new Response("unavailable", { status: 503 }))
          : fake.send(request),
    };
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await route(t, t.ana, "PUT", failing, { hostname: name })).status).toBe(409);
      expect(logs.mock.calls.map(([line]) => String(line)).join("\n")).toContain(
        "the claim is kept",
      );
    } finally {
      logs.mockRestore();
    }
    expect(fake.hostnames.size).toBe(1);
    expect(await holder(name)).toBe(t.id);
  });

  test("never the fallback origin, its domain, or a two-label apex", () => {
    const read = (value: string) =>
      normalizeHostname(value, "brigade.example.com", "status-origin.saas.test");
    for (const ours of ["status-origin.saas.test", "saas.test", "x.saas.test"]) {
      expect(read(ours), ours).toEqual({ ok: false, code: "own_domain" });
    }
    expect(read("acme.test")).toEqual({ ok: false, code: "apex" });
    expect(read("status.acme.test")).toEqual({ ok: true, hostname: "status.acme.test" });
  });
});

/** Ana as the routes pass her to the shard. */
const owner = (t: Team): Actor => ({ kind: "user", id: t.ana.id, role: "owner" });

/** The shard's domain checker, pointed at a fake Cloudflare with the instance's settings. */
const checker = (t: Team, fake: ReturnType<typeof cloudflare>) =>
  runInDurableObject(t.stub, (instance: WorkspaceDO) => {
    const domains = Reflect.get(instance, "domains") as DomainChecker;
    const deps = Reflect.get(domains, "deps") as {
      config: () => SaasConfig | undefined;
      send?: typeof fake.send;
    };
    deps.config = () => SAAS_CONFIG;
    deps.send = fake.send;
  });

const runChecker = (t: Team, at: number) =>
  runInDurableObject(t.stub, async (instance: WorkspaceDO) => {
    const domains = Reflect.get(instance, "domains") as DomainChecker;
    await domains.run(t.id, at);
    return domains.nextAt(at);
  });

describe("the shard re-checks the domain on its own", () => {
  test("a pending domain is asked about again with backoff until active, then daily; failed is left alone", async () => {
    const t = await team();
    const fake = cloudflare();
    await route(t, t.ana, "PUT", fake, { hostname: hostname() });
    await checker(t, fake);
    const added = (await domainRow(t))!;
    const first = await runInDurableObject(t.stub, (instance: WorkspaceDO) =>
      (Reflect.get(instance, "domains") as DomainChecker).nextAt(Date.now()),
    );
    expect(first).toBe(added.checkedAt + DOMAIN_RECHECK_MIN_MS);
    // The alarm is armed for it.
    const alarm = await runInDurableObject(t.stub, (_i: WorkspaceDO, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).not.toBeNull();
    expect(alarm!).toBeLessThanOrEqual(first!);

    // Not due yet: Cloudflare is not asked.
    await runChecker(t, added.checkedAt + 1000);
    expect(fake.calls).toHaveLength(1);
    // Due, still pending: recorded with its event; the next one later.
    const later = await runChecker(t, first!);
    expect(fake.calls.at(-1)).toMatchObject({ method: "GET" });
    expect(await outbox(t, "status_domain.checked")).toMatchObject([
      { data: { state: "pending", previous: "pending" }, actor: { id: "sys_account" } },
    ]);
    const checked = (await domainRow(t))!;
    expect(later).toBeGreaterThan(checked.checkedAt);
    // Cloudflare verified it: active, then once a day.
    const row = fake.hostnames.get("cfh-1")!;
    row.status = "active";
    row.ssl = "active";
    const daily = await runChecker(t, later!);
    const active = (await domainRow(t))!;
    expect(active.state).toBe("active");
    expect(daily).toBe(active.checkedAt + DOMAIN_ACTIVE_RECHECK_MS);
    // Moved away at Cloudflare: the daily check sees it.
    row.status = "moved";
    expect(await runChecker(t, daily!)).toBeNull();
    expect(await domainRow(t)).toMatchObject({ state: "failed", error: "moved" });
    expect((await outbox(t, "status_domain.checked")).at(-1)).toMatchObject({
      data: { state: "failed", previous: "active" },
    });
  });

  test("the shard's alarm runs a check that is due", async () => {
    const t = await team();
    const fake = cloudflare();
    await route(t, t.ana, "PUT", fake, { hostname: hostname() });
    await checker(t, fake);
    const row = fake.hostnames.get("cfh-1")!;
    row.status = "active";
    row.ssl = "active";
    await runInDurableObject(t.stub, async (instance: WorkspaceDO) => {
      // Added two minutes ago: its first check is due.
      const shard = Reflect.get(instance, "shard") as Shard;
      const past = Date.now() - 2 * DOMAIN_RECHECK_MIN_MS;
      shard.store.update("status_domain", STATUS_DOMAIN_ID, { createdAt: past, checkedAt: past });
      await instance.alarm();
    });
    expect(await domainRow(t)).toMatchObject({ state: "active" });
    expect(await outbox(t, "status_domain.checked")).toMatchObject([
      { data: { state: "active", previous: "pending" }, actor: { id: "sys_account" } },
    ]);
  });

  test("Cloudflare failing backs off; a domain pending too long is no longer asked about", async () => {
    const t = await team();
    const fake = cloudflare();
    await route(t, t.ana, "PUT", fake, { hostname: hostname() });
    const down = { ...fake, send: async () => new Response("bad gateway", { status: 502 }) };
    await checker(t, down);
    const added = (await domainRow(t))!;
    const due = added.checkedAt + DOMAIN_RECHECK_MIN_MS;
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    let retry: number | null;
    try {
      retry = await runChecker(t, due);
    } finally {
      logs.mockRestore();
    }
    expect(retry).toBe(due + DOMAIN_RECHECK_MIN_MS);
    expect(await outbox(t, "status_domain.checked")).toEqual([]);
    await runInDurableObject(t.stub, (instance: WorkspaceDO) => {
      const domains = Reflect.get(instance, "domains") as DomainChecker;
      expect(domains.nextAt(added.createdAt + DOMAIN_PENDING_MAX_MS + 1)).toBeNull();
    });
  });

  test("without the instance's settings nothing is checked", async () => {
    const t = await team();
    await route(t, t.ana, "PUT", cloudflare(), { hostname: hostname() });
    expect(
      await runInDurableObject(t.stub, (instance: WorkspaceDO) =>
        (Reflect.get(instance, "domains") as DomainChecker).nextAt(Date.now() + 3_600_000),
      ),
    ).toBeNull();
  });

  test("Cloudflare's reasons become codes the dashboard words itself", () => {
    expect(domainError("moved", "active", [])).toBe("moved");
    // A status named like an Object method is not a failure.
    expect(domainError("constructor", "active", [])).toBeNull();
    expect(domainError("toString", "", [])).toBeNull();
    expect(domainError("pending_blocked", "", [])).toBe("blocked");
    expect(domainError("pending", "validation_timed_out", [])).toBe("timed_out");
    expect(domainError("active", "expired", [])).toBe("expired");
    expect(domainError("pending", "pending_validation", ["caa_error: CAA records block"])).toBe(
      "caa",
    );
    expect(
      domainError("pending", "pending_validation", [
        "custom hostname does not CNAME to this zone.",
      ]),
    ).toBe("dns");
    expect(domainError("pending", "pending_validation", ["something new"])).toBe("other");
    expect(domainError("pending", "pending_validation", [])).toBeNull();
  });
});

/** Through the queue consumer, as the outbox delivers them. */
async function sync(t: Team, type: string) {
  const events = await outbox(t, type);
  const batch = createMessageBatch(
    "brigade-events",
    events.map((body, index) => ({ id: `msg-${index}`, timestamp: new Date(), attempts: 1, body })),
  );
  await consumeEvents(batch, { WORKSPACE: env.WORKSPACE, DB: env.DB, STATUS: env.STATUS });
}

const lookup = (name: string) => env.STATUS!.get(hostKey(name), { type: "json" });

/** A visit to a custom hostname, as the edge Worker hands it to the `StatusPages` entrypoint. */
const visit = (
  name: string,
  host: { workspaceId: string; slug: string },
  path: string,
  init: RequestInit = {},
) =>
  serveCustomHost(new Request(`https://${name}${path}`, init), env, createExecutionContext(), host);

describe("serving a page at its own hostname", () => {
  test("the lookup follows the events: served only while active and public, gone when removed", async () => {
    const t = await team();
    await t.push();
    const fake = cloudflare();
    const name = hostname();
    await route(t, t.ana, "PUT", fake, { hostname: name });
    await sync(t, "status_domain.added");
    // Pending: Cloudflare would not route it yet, and neither does Brigade.
    expect(await lookup(name)).toBeNull();
    const row = fake.hostnames.get("cfh-1")!;
    row.status = "active";
    row.ssl = "active";
    await route(t, t.ana, "POST", fake, undefined, true);
    await sync(t, "status_domain.checked");
    expect(await lookup(name)).toEqual({ workspaceId: t.id, slug: t.slug });

    // Made a draft: the lookup goes.
    const draft = await api(`/workspaces/${t.id}/status-page`, {
      method: "PUT",
      headers: { Cookie: t.ana.cookie },
      body: JSON.stringify({ slug: t.slug, title: "Acme", locale: "en", enabled: false }),
    });
    expect(draft.status).toBe(200);
    await sync(t, "status_page.configured");
    expect(await lookup(name)).toBeNull();

    await route(t, t.ana, "DELETE", fake);
    await sync(t, "status_domain.removed");
    expect(await lookup(name)).toBeNull();
  });

  test("only the page's own routes answer, through the entrypoint", async () => {
    const t = await team();
    await t.push();
    const name = hostname();
    const host = { workspaceId: t.id, slug: t.slug };
    const page = await visit(name, host, "/");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("All systems operational");
    expect((await visit(name, host, `/status/${t.slug}`)).status).toBe(200);
    expect((await visit(name, host, `/status/${t.slug}/feed.json`)).status).toBe(200);
    expect((await visit(name, host, `/status/${t.slug}/confirm?t=nope`)).status).toBe(400);
    // Nothing else of the API, nor another page, answers on a customer's hostname.
    for (const path of [
      "/health",
      "/auth/get-session",
      `/workspaces/${t.id}`,
      "/status/someone-else",
      `/alerts/x`,
    ]) {
      expect((await visit(name, host, path)).status, path).toBe(404);
    }
    // Through the named entrypoint itself, as the edge Worker calls it: the Request crosses intact.
    const pages = (exports as unknown as { StatusPages: StatusPagesApi }).StatusPages;
    const viaRpc = await pages.serve(new Request(`https://${name}/`), host);
    expect(viaRpc.status).toBe(200);
  });

  test("a slug another workspace holds by now is the 404 page, never its page, nor its subscribe form", async () => {
    const a = await team();
    const b = await team();
    await b.push();
    const name = hostname();
    // A lookup the events have not caught up with: A's hostname, B's slug.
    const stale = { workspaceId: a.id, slug: b.slug };
    const page = await visit(name, stale, "/");
    expect(page.status).toBe(404);
    expect(await page.text()).not.toContain("All systems operational");
    expect((await visit(name, stale, `/status/${b.slug}/feed.json`)).status).toBe(404);
    const subscribe = await visit(name, stale, `/status/${b.slug}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: `https://${name}` },
      body: "email=visitor%40example.com",
    });
    expect(subscribe.status).toBe(404);
    // B's own hostname serves it, and the cached 404 above is not what it gets.
    expect((await visit(hostname(), { workspaceId: b.id, slug: b.slug }, "/")).status).toBe(200);
  });

  test("an event for a hostname another workspace holds now leaves its lookup alone", async () => {
    const a = await team();
    const b = await team();
    const name = hostname();
    await env.DB.prepare(
      "insert into status_custom_host (hostname, workspace_id, created_at) values (?, ?, ?)",
    )
      .bind(name, b.id, Date.now())
      .run();
    const theirs = JSON.stringify({ workspaceId: b.id, slug: b.slug });
    await env.STATUS!.put(hostKey(name), theirs);
    const event = {
      id: newId("evt", Date.now(), random),
      type: "status_domain.removed",
      source: `brigade://${a.id}/workspace`,
      workspaceId: a.id,
      time: new Date().toISOString(),
      actor: { kind: "user", id: a.ana.id },
      data: { hostname: name },
      specversion: "1.0",
    } satisfies BrigadeEvent;
    await syncStatusHost(event, configured);
    expect(await env.STATUS!.get(hostKey(name))).toBe(theirs);
  });
});

describe("the API Worker's own routes, with every custom domain setting", () => {
  /** Set up for custom domains, on a dashboard at another host, with a `STATUS` that notes every read. */
  const reads: string[] = [];
  const spied = {
    ...configured,
    DASHBOARD_URL: "https://dashboard.example.com",
    STATUS: new Proxy(env.STATUS!, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          reads.push(`${String(property)} ${String(args[0])}`);
          return Reflect.apply(value, target, args);
        };
      },
    }),
  } as Env;
  const call = (config: Env, url: string, init: RequestInit = {}) =>
    worker.fetch(incoming(url, init), config, createExecutionContext());

  test("alerts, heartbeats, sync and auth answer as without them, and none reads the hostname lookup", async () => {
    const t = await team();
    const sourceId = newId("src", Date.now(), random);
    const secret = newHeartbeatSecret(random);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    const tokenHash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    await runInDurableObject(t.stub, (_instance: WorkspaceDO, state) => {
      const shard = new Shard(state.storage, {
        shard: "workspace",
        randomBytes: random,
        log: () => {},
      });
      const { result } = shard.mutate({
        clientId: "test",
        mutationId: "m-source",
        actor: owner(t),
        name: "alertSource.create",
        args: {
          id: sourceId,
          name: "Grafana",
          kind: "generic",
          tokenHash,
          auth: null,
          signingSecret: null,
        },
        now: Date.now(),
      });
      expect(result).toMatchObject({ ok: true });
    });
    const alert = (config: Env) =>
      call(config, `https://brigade-api.test/alerts/${alertSourceToken(t.id, sourceId, secret)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Disk full", status: "firing" }),
      });
    const requests: [string, RequestInit?][] = [
      [`https://brigade-api.test/heartbeat/not-a-token`, { method: "POST" }],
      [`https://brigade-api.test/sync/${t.id}`],
      ["https://brigade-api.test/auth/get-session"],
      ["https://brigade-api.test/health"],
      ["https://brigade-api.test/config"],
    ];
    const plain = { ...env, DASHBOARD_URL: "https://dashboard.example.com" } as Env;
    for (const [url, init] of requests) {
      const [expected, got] = [await call(plain, url, init), await call(spied, url, init)];
      expect([got.status, got.headers.get("Content-Type")], url).toEqual([
        expected.status,
        expected.headers.get("Content-Type"),
      ]);
      expect(await got.text(), url).toBe(await expected.text());
    }
    const paged = await alert(spied);
    expect(paged.status).toBe(202);
    expect(await outbox(t, "incident.declared")).toHaveLength(1);
    expect(reads).toEqual([]);
  });
});
