// A status page's own domain (RFC 0012 "Custom domains"): adding, checking and removing it against a fake of
// Cloudflare's custom hostnames API, the public lookup kept in step by events, and serving the page at its hostname.
import { env, exports } from "cloudflare:workers";
import { createExecutionContext, createMessageBatch, runInDurableObject } from "cloudflare:test";
import { newId } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import worker, { workerAuth } from "../src/index.ts";
import { consumeEvents } from "../src/notify.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import {
  customHostRequest,
  hostKey,
  normalizeHostname,
  statusDomainRoute,
  syncStatusHost,
} from "../src/status-domain.ts";
import type { StatusPublisher } from "../src/status-page.ts";
import type { WorkspaceDO } from "../src/workspace.ts";
import { sessionCookie } from "./session.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const SAAS = {
  CF_SAAS_TOKEN: "test-saas-token",
  CF_ZONE_ID: "zone-test",
  CF_SAAS_FALLBACK_ORIGIN: "status-origin.example.net",
  DASHBOARD_URL: ORIGIN,
};
const configured = { ...env, ...SAAS } as Env & typeof SAAS;

let people = 0;
let clients = 0;
let hosts = 0;
const clientIp = () => `198.51.${Math.floor(++clients / 250) % 250}.${(clients % 250) + 1}`;
/** Each test its own hostname and slug: KV and the edge cache keep them a while. */
const hostname = () => `status-${Date.now().toString(36)}-${++hosts}.acme.example`;
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
      const row = {
        id: `cfh-${++next}`,
        hostname: body.hostname,
        status: "pending",
        ssl: "pending_validation",
      };
      hostnames.set(row.id, row);
      return Response.json({ success: true, errors: [], result: shape(row) });
    },
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
    const id = new URL(request.url).pathname.split("/custom_hostnames/")[1];
    if (request.method === "POST") return answers.create(body as { hostname: string });
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
  return { calls, hostnames, answers, send };
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
    expect(read(" Status.Acme.Example. ")).toEqual({ ok: true, hostname: "status.acme.example" });
    const idn = read("status.açaí.example");
    expect(idn).toMatchObject({ ok: true });
    expect(idn.ok && idn.hostname).toMatch(/^status\.xn--[a-z0-9-]+\.example$/);
  });
  test("no IP address, port, path, scheme, single label or bad label", () => {
    for (const bad of [
      "203.0.113.7",
      "1.2.3",
      "0x7f.1",
      "[::1]",
      "::1",
      "status.acme.example:8443",
      "status.acme.example/x",
      "https://status.acme.example",
      "localhost",
      "-bad.example",
      "a..example",
      "",
      42,
      `${"a".repeat(64)}.example`,
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
    expect(normalizeHostname("example.com.br", "brigade.example.com.br")).toEqual({
      ok: false,
      code: "own_domain",
    });
    expect(normalizeHostname("status.other.com.br", "brigade.example.com.br")).toMatchObject({
      ok: true,
    });
    expect(read("status.example.org")).toMatchObject({ ok: true });
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
      target: "status-origin.example.net",
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
        { type: "CNAME", name, value: "status-origin.example.net" },
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

describe("serving a page at its own hostname", () => {
  test("the lookup follows the events: served only while active and public, gone when removed", async () => {
    const t = await team();
    await t.push();
    const fake = cloudflare();
    const name = hostname();
    await route(t, t.ana, "PUT", fake, { hostname: name });
    // Through the queue consumer, as the outbox delivers them.
    const sync = async (type: string) => {
      const events = await outbox(t, type);
      const batch = createMessageBatch(
        "brigade-events",
        events.map((body, index) => ({
          id: `msg-${index}`,
          timestamp: new Date(),
          attempts: 1,
          body,
        })),
      );
      await consumeEvents(batch, { WORKSPACE: env.WORKSPACE, DB: env.DB, STATUS: env.STATUS });
    };
    await sync("status_domain.added");
    // Pending: Cloudflare would not route it yet, and neither does Brigade.
    expect(await env.STATUS!.get(hostKey(name))).toBeNull();
    const row = fake.hostnames.get("cfh-1")!;
    row.status = "active";
    row.ssl = "active";
    await route(t, t.ana, "POST", fake, undefined, true);
    await sync("status_domain.checked");
    expect(await env.STATUS!.get(hostKey(name))).toBe(t.slug);

    const visit = (path: string, init: RequestInit = {}) =>
      worker.fetch(incoming(`https://${name}${path}`, init), configured, createExecutionContext());
    const page = await visit("/");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("All systems operational");
    expect((await visit(`/status/${t.slug}/feed.json`)).status).toBe(200);
    // Nothing else of the API, nor another page, answers on a customer's hostname.
    for (const path of [
      "/health",
      "/auth/get-session",
      `/workspaces/${t.id}`,
      "/status/someone-else",
    ]) {
      expect((await visit(path)).status, path).toBe(404);
    }
    // The dashboard's own hostname is untouched.
    const health = await worker.fetch(
      incoming(`${ORIGIN}/health`),
      configured,
      createExecutionContext(),
    );
    expect(health.status).toBe(200);

    // Made a draft: the lookup goes; public again: back.
    const draft = await api(`/workspaces/${t.id}/status-page`, {
      method: "PUT",
      headers: { Cookie: t.ana.cookie },
      body: JSON.stringify({ slug: t.slug, title: "Acme", locale: "en", enabled: false }),
    });
    expect(draft.status).toBe(200);
    await sync("status_page.configured");
    expect(await env.STATUS!.get(hostKey(name))).toBeNull();

    await route(t, t.ana, "DELETE", fake);
    await sync("status_domain.removed");
    expect(await env.STATUS!.get(hostKey(name))).toBeNull();
  });

  test("a hostname with no page is the 404 page; without the settings nothing is rewritten", async () => {
    const unknown = new Request(`https://${hostname()}/`);
    const answer = await customHostRequest(unknown, configured);
    expect(answer).toBeInstanceOf(Response);
    expect((answer as Response).status).toBe(404);
    expect(
      await customHostRequest(unknown, { ...env, DASHBOARD_URL: ORIGIN } as Env),
    ).toBeUndefined();
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
    await env.STATUS!.put(hostKey(name), b.slug);
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
    expect(await env.STATUS!.get(hostKey(name))).toBe(b.slug);
  });
});
