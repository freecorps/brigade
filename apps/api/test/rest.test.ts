// The public HTTP API's incident and catalog routes (src/rest-routes.ts, src/rest.ts; RFC 0002 "Public HTTP API"):
// each write runs the named mutation the dashboard sends, as the member or API token, with its RBAC, timeline and
// outbox event; a declare pages exactly as one from the dashboard; a retried request runs once; a token acts only
// within its scopes and its creator's role, and a revoked or expired one is refused.
import { env, exports } from "cloudflare:workers";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runInDurableObject,
} from "cloudflare:test";
import { generateRecipient, toBase64url } from "@freecorps/brigade-push";
import {
  INCIDENT_SCAN_CAP,
  newId,
  type Actor,
  type Permission,
  type PublicIncident,
} from "@freecorps/brigade-schema";
import { beforeEach, describe, expect, test } from "vite-plus/test";
import { forgetAllTokens } from "../src/api-tokens.ts";
import { consumeEvents, type Fetch } from "../src/notify.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { Shard } from "../src/shard.ts";
import { IDEMPOTENCY_KEY_HEADER, type WorkspaceDO } from "../src/workspace.ts";
import { sessionCookie } from "./session.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

beforeEach(() => forgetAllTokens());

let people = 0;
let clients = 0;
/** A new client IP (TEST-NET-2) per call: sign-up is rate-limited per IP. */
const clientIp = () => `198.51.${Math.floor(++clients / 250) % 250}.${(clients % 250) + 7}`;

type Init = { method?: string; body?: unknown; headers?: Record<string, string> };

const api = (path: string, init: Init = {}) =>
  exports.default.fetch(`${ORIGIN}${path}`, {
    method: init.method,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      "cf-connecting-ip": clientIp(),
      ...init.headers,
    },
  });

type Person = { id: string; cookie: string };

async function signUp(name: string): Promise<Person> {
  const email = `${name.toLowerCase()}-r${++people}@example.com`;
  const response = await api("/auth/sign-up/email", {
    method: "POST",
    body: { name, email, password: PASSWORD },
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  return { id: body.user.id, cookie: await sessionCookie(email, PASSWORD) };
}

async function addMember(workspaceId: string, userId: string, role: string) {
  await env.DB.prepare(
    `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, ?, ?)`,
  )
    .bind(newId("mem", Date.now(), random), workspaceId, userId, role, new Date().toISOString())
    .run();
}

/** Ana owns a new workspace; Caio is a responder, Duda a viewer, Eva an outsider. */
async function team() {
  const [ana, caio, duda, eva] = await Promise.all(
    ["Ana", "Caio", "Duda", "Eva"].map((name) => signUp(name)),
  );
  const created = await api("/workspaces", {
    method: "POST",
    headers: { Cookie: ana!.cookie },
    body: { name: "Acme" },
  });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
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
  const owner: Actor = { kind: "user", id: ana!.id, role: "owner" };
  /** A mutation as a socket sends it: what the dashboard does. */
  const run = (name: string, args: unknown, actor: Actor = owner, internal = false) =>
    withShard((shard) => {
      const { result } = shard.mutate({
        clientId: "dashboard",
        mutationId: newId("mut", Date.now(), random),
        actor,
        name,
        args,
        now: Date.now(),
        internal,
      });
      expect(result, name).toMatchObject({ ok: true });
    });
  return { id, stub, ana: ana!, caio: caio!, duda: duda!, eva: eva!, withShard, run };
}

type Team = Awaited<ReturnType<typeof team>>;

/** A request as `by` (a session) or with a token, and an `Idempotency-Key` for writes. */
function call(
  path: string,
  by: Person | string | null,
  init: Init & { key?: string | null } = {},
): Promise<Response> {
  const write = init.method !== undefined && init.method !== "GET";
  const key = init.key === undefined ? (write ? `k-${crypto.randomUUID()}` : null) : init.key;
  return api(path, {
    ...init,
    headers: {
      ...(typeof by === "string" ? { Authorization: `Bearer ${by}` } : {}),
      ...(by && typeof by !== "string" ? { Cookie: by.cookie } : {}),
      ...(key === null ? {} : { [IDEMPOTENCY_KEY_HEADER]: key }),
      ...init.headers,
    },
  });
}

async function mint(
  t: Team,
  by: Person,
  scopes: Permission[],
): Promise<{ id: string; token: string }> {
  const response = await api(`/workspaces/${t.id}/api-tokens`, {
    method: "POST",
    headers: { Cookie: by.cookie },
    body: { name: "Script", scopes, expiresInDays: null },
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; token: string };
}

const outbox = (t: Team) =>
  t.withShard((_shard, state) =>
    state.storage.sql
      .exec<{ event: string }>("select event from outbox order by seq")
      .toArray()
      .map((row) => JSON.parse(row.event) as BrigadeEvent),
  );

const declares = async (t: Team) =>
  (await outbox(t)).filter((event) => event.type === "incident.declared");

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

/** Caio and Ana each with a phone, and a default policy paging Caio first. */
async function onCall(t: Team): Promise<Map<string, string>> {
  const tokens = new Map<string, string>();
  const caio: Actor = { kind: "user", id: t.caio.id, role: "responder" };
  const ana: Actor = { kind: "user", id: t.ana.id, role: "owner" };
  for (const [actor, name] of [
    [ana, "Ana"],
    [caio, "Caio"],
  ] as const) {
    await t.run("member.sync", { id: actor.id, name, role: actor.role }, actor, true);
    const recipient = await generateRecipient();
    const pushToken = toBase64url(random(32)).replace(/[-_]/g, "a");
    tokens.set(actor.id, pushToken);
    await t.run(
      "device.register",
      {
        id: newId("dev", Date.now(), random),
        platform: "ios",
        environment: "sandbox",
        pushToken,
        voipToken: null,
        publicKey: toBase64url(recipient.publicKey),
      },
      actor,
      true,
    );
  }
  await t.run("escalation.createPolicy", {
    id: newId("esc", Date.now(), random),
    name: "Default",
    levels: [t.caio.id, t.ana.id].map((id) => ({
      id: newId("lvl", Date.now(), random),
      targets: [{ kind: "member", id }],
      timeoutMinutes: 5,
    })),
    repeat: 1,
    isDefault: true,
  });
  return tokens;
}

describe("declaring through the API", () => {
  test("pages exactly as a declare from the dashboard: the same event, the same escalation run, the same phones", async () => {
    const t = await team();
    const phones = await onCall(t);

    // From the dashboard: `incident.declare` over a socket, as Ana.
    const fromDashboard = newId("inc", Date.now(), random);
    await t.run("incident.declare", {
      id: fromDashboard,
      title: "Checkout down",
      severity: "sev1",
    });
    // From a script: the same, as Ana's API token.
    const { token } = await mint(t, t.ana, ["incident:declare"]);
    const response = await call(`/workspaces/${t.id}/incidents`, token, {
      method: "POST",
      body: { title: "Checkout down", severity: "sev1" },
    });
    expect(response.status).toBe(201);
    const { incident } = (await response.json()) as { incident: PublicIncident };
    expect(incident).toMatchObject({ title: "Checkout down", severity: "sev1", status: "triage" });
    expect(incident.number).toEqual(expect.any(Number));

    const events = await declares(t);
    const dashboard = events.find((event) => event.subject === fromDashboard)!;
    const viaApi = events.find((event) => event.subject === incident.id)!;
    expect(viaApi).toBeDefined();
    const shape = (event: BrigadeEvent) => ({
      type: event.type,
      workspaceId: event.workspaceId,
      data: { ...(event.data as Record<string, unknown>), id: undefined, number: undefined },
    });
    expect(shape(viaApi)).toEqual(shape(dashboard));
    expect(viaApi.actor).toMatchObject({ kind: "token" });

    const paged = async (event: BrigadeEvent) => {
      const { tokens, send } = relay();
      await deliver(event, send);
      return tokens;
    };
    const dashboardPhones = await paged(dashboard);
    const apiPhones = await paged(viaApi);
    expect(dashboardPhones).toEqual([phones.get(t.caio.id)]);
    expect(apiPhones).toEqual(dashboardPhones);
    const run = (id: string) =>
      t.withShard((shard) => shard.store.get("incidents", id)?.escalation);
    expect(await run(incident.id)).toMatchObject({ status: "running" });
    // The same run, but for who caused it (the token), its event and its times.
    const same = async (id: string) => {
      const { causedBy, eventId, startedAt, nextAt, pages, ...rest } = (await run(id))!;
      expect([causedBy, eventId, startedAt, nextAt]).not.toContain(undefined);
      return { ...rest, pages: pages.map((page) => ({ ...page, at: 0 })) };
    };
    expect(await same(incident.id)).toEqual(await same(fromDashboard));
  });

  test("the same key again answers the same incident and declares nothing more; another key declares another", async () => {
    const t = await team();
    const declare = (key: string) =>
      call(`/workspaces/${t.id}/incidents`, t.caio, {
        method: "POST",
        key,
        body: { title: "Search is slow" },
      });
    const first = (await (await declare("run-1")).json()) as { incident: PublicIncident };
    const retry = await declare("run-1");
    expect(retry.status).toBe(201);
    expect(((await retry.json()) as { incident: PublicIncident }).incident.id).toBe(
      first.incident.id,
    );
    expect(first.incident).toMatchObject({ severity: "sev3", declaredBy: t.caio.id });
    expect(await declares(t)).toHaveLength(1);
    const other = (await (await declare("run-2")).json()) as { incident: PublicIncident };
    expect(other.incident.id).not.toBe(first.incident.id);
    expect(await declares(t)).toHaveLength(2);
  });

  test("RBAC: a viewer is forbidden, an outsider not a member, and a bad body or key refused, declaring nothing", async () => {
    const t = await team();
    const path = `/workspaces/${t.id}/incidents`;
    const body = { title: "Checkout down" };
    const viewer = await call(path, t.duda, { method: "POST", body });
    expect(viewer.status).toBe(403);
    expect(await viewer.json()).toEqual({ error: "forbidden" });
    const outsider = await call(path, t.eva, { method: "POST", body });
    expect(outsider.status).toBe(403);
    expect(await outsider.json()).toEqual({ error: "not_a_member" });
    const anonymous = await call(path, null, { method: "POST", body });
    expect(anonymous.status).toBe(401);
    const crossSite = await call(path, t.caio, {
      method: "POST",
      body,
      headers: { Origin: "https://evil.example" },
    });
    expect(crossSite.status).toBe(403);
    expect(await crossSite.json()).toEqual({ error: "forbidden_origin" });
    const noKey = await call(path, t.caio, { method: "POST", body, key: null });
    expect(noKey.status).toBe(400);
    const badBody = await call(path, t.caio, { method: "POST", body: { title: "" } });
    expect(badBody.status).toBe(400);
    expect(await badBody.json()).toMatchObject({
      error: "invalid_args",
      issues: expect.any(Array),
    });
    const unknownKey = await call(path, t.caio, {
      method: "POST",
      body: { title: "x", number: 1 },
    });
    expect(unknownKey.status).toBe(400);
    expect(await declares(t)).toHaveLength(0);
  });
});

describe("API tokens on these routes", () => {
  test("a token without the scope is 403 and changes nothing; with it, it acts as itself", async () => {
    const t = await team();
    const readOnly = await mint(t, t.ana, ["incident:read", "catalog:read"]);
    const declare = await call(`/workspaces/${t.id}/incidents`, readOnly.token, {
      method: "POST",
      body: { title: "Checkout down" },
    });
    expect(declare.status).toBe(403);
    expect(await declare.json()).toEqual({ error: "forbidden" });
    const service = await call(`/workspaces/${t.id}/services`, readOnly.token, {
      method: "POST",
      body: { name: "Checkout", tier: "tier1" },
    });
    expect(service.status).toBe(403);
    expect(await declares(t)).toHaveLength(0);
    expect(await t.withShard((shard) => shard.store.scan("services"))).toEqual([]);
    // Its scopes do let it read.
    expect((await call(`/workspaces/${t.id}/incidents`, readOnly.token)).status).toBe(200);
    expect((await call(`/workspaces/${t.id}/services`, readOnly.token)).status).toBe(200);
    // A read scope does not stand in for another read.
    const incidentsOnly = await mint(t, t.ana, ["incident:read"]);
    expect((await call(`/workspaces/${t.id}/services`, incidentsOnly.token)).status).toBe(403);

    const manager = await mint(t, t.ana, ["catalog:manage"]);
    const made = await call(`/workspaces/${t.id}/services`, manager.token, {
      method: "POST",
      body: { name: "Checkout", tier: "tier1" },
    });
    expect(made.status).toBe(201);
    expect(((await made.json()) as { service: { createdBy: string } }).service.createdBy).toBe(
      manager.id,
    );
  });

  test("a PATCH answers the row, so a token needs the read scope too, even for an empty one", async () => {
    const t = await team();
    const incident = newId("inc", Date.now(), random);
    await t.run("incident.declare", { id: incident, title: "Checkout down", severity: "sev3" });
    const service = newId("svc", Date.now(), random);
    await t.run("service.create", {
      id: service,
      name: "Checkout",
      description: "",
      tier: "tier1",
      owners: [],
      escalationPolicyId: null,
    });
    const writeOnly = await mint(t, t.ana, ["incident:update", "catalog:manage"]);
    for (const [path, body] of [
      [`/workspaces/${t.id}/incidents/${incident}`, {}],
      [`/workspaces/${t.id}/incidents/${incident}`, { severity: "sev1" }],
      [`/workspaces/${t.id}/services/${service}`, {}],
    ] as const) {
      const response = await call(path, writeOnly.token, { method: "PATCH", body });
      expect(response.status, path).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    expect((await t.withShard((shard) => shard.store.get("incidents", incident)))?.severity).toBe(
      "sev3",
    );
    // The writes that answer no row still work without it.
    const posted = await call(
      `/workspaces/${t.id}/incidents/${incident}/updates`,
      writeOnly.token,
      {
        method: "POST",
        body: { body: "Looking." },
      },
    );
    expect(posted.status).toBe(201);
    expect(await posted.json()).toEqual({ ok: true, entryId: expect.stringMatching(/:\d+$/) });

    const both = await mint(t, t.ana, ["incident:update", "incident:read"]);
    const changed = await call(`/workspaces/${t.id}/incidents/${incident}`, both.token, {
      method: "PATCH",
      body: { severity: "sev1" },
    });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({ incident: { id: incident, severity: "sev1" } });
  });

  test("a token acts with its creator's current role: demoted to viewer, its write scopes are refused", async () => {
    const t = await team();
    const role = (to: string) =>
      api(`/workspaces/${t.id}/members/${t.caio.id}`, {
        method: "PATCH",
        headers: { Cookie: t.ana.cookie },
        body: { role: to },
      });
    expect((await role("admin")).status).toBe(200);
    const { token } = await mint(t, t.caio, ["incident:declare", "incident:read"]);
    expect((await role("viewer")).status).toBe(200);
    forgetAllTokens();
    const declare = await call(`/workspaces/${t.id}/incidents`, token, {
      method: "POST",
      body: { title: "Checkout down" },
    });
    expect(declare.status).toBe(403);
    expect(await declares(t)).toHaveLength(0);
    expect((await call(`/workspaces/${t.id}/incidents`, token)).status).toBe(200);
  });

  test("a revoked or expired token is 401", async () => {
    const t = await team();
    const revoked = await mint(t, t.ana, ["incident:read", "incident:declare"]);
    const expired = await mint(t, t.ana, ["incident:read", "incident:declare"]);
    expect(
      (
        await api(`/workspaces/${t.id}/api-tokens/${revoked.id}`, {
          method: "DELETE",
          headers: { Cookie: t.ana.cookie },
        })
      ).status,
    ).toBe(200);
    await env.DB.prepare(`update api_token set expires_at = ? where id = ?`)
      .bind(Date.now() - 1, expired.id)
      .run();
    forgetAllTokens();
    for (const token of [revoked.token, expired.token]) {
      const read = await call(`/workspaces/${t.id}/incidents`, token);
      expect(read.status).toBe(401);
      expect(await read.json()).toEqual({ error: "unauthenticated" });
      const write = await call(`/workspaces/${t.id}/incidents`, token, {
        method: "POST",
        body: { title: "Checkout down" },
      });
      expect(write.status).toBe(401);
    }
    expect(await declares(t)).toHaveLength(0);
  });
});

describe("reading incidents", () => {
  test("newest first, filtered by status, severity, type and service, a page at a time", async () => {
    const t = await team();
    const service = newId("svc", Date.now(), random);
    await t.run("service.create", {
      id: service,
      name: "Checkout",
      description: "",
      tier: "tier1",
      owners: [],
      escalationPolicyId: null,
    });
    const type = newId("typ", Date.now(), random);
    await t.run("incidentType.create", {
      id: type,
      name: "Security",
      description: "",
      defaultSeverity: null,
      escalationPolicyId: null,
      requiredFields: [],
    });
    const ids: string[] = [];
    for (let n = 0; n < 5; n++) {
      const id = newId("inc", Date.now() + n, random);
      ids.push(id);
      await t.run("incident.declare", {
        id,
        title: `Incident ${n}`,
        severity: n % 2 ? "sev1" : "sev3",
        ...(n === 4 && { typeId: type, serviceIds: [service] }),
      });
    }
    await t.run("incident.setStatus", { id: ids[0], status: "resolved" });

    const page = async (query: string) => {
      const response = await call(`/workspaces/${t.id}/incidents${query}`, t.duda);
      expect(response.status, query).toBe(200);
      return (await response.json()) as { incidents: PublicIncident[]; nextCursor: string | null };
    };
    const all = await page("");
    expect(all.incidents.map((incident) => incident.id)).toEqual([...ids].reverse());
    expect(all.nextCursor).toBeNull();
    expect((await page("?severity=sev1")).incidents.map((i) => i.id)).toEqual([ids[3], ids[1]]);
    expect((await page("?status=resolved")).incidents.map((i) => i.id)).toEqual([ids[0]]);
    expect((await page("?status=triage,resolved&severity=sev3")).incidents).toHaveLength(3);
    expect((await page(`?typeId=${type}`)).incidents.map((i) => i.id)).toEqual([ids[4]]);
    const named = (await page(`?serviceId=${service}`)).incidents;
    expect(named).toHaveLength(1);
    expect(named[0]).toMatchObject({ typeId: type, serviceIds: [service] });

    const first = await page("?limit=2");
    expect(first.incidents.map((i) => i.id)).toEqual([ids[4], ids[3]]);
    expect(first.nextCursor).toBe(ids[3]);
    const second = await page(`?limit=2&cursor=${first.nextCursor}`);
    expect(second.incidents.map((i) => i.id)).toEqual([ids[2], ids[1]]);
    const last = await page(`?limit=2&cursor=${second.nextCursor}`);
    expect(last.incidents.map((i) => i.id)).toEqual([ids[0]]);
    expect(last.nextCursor).toBeNull();

    for (const bad of ["?status=open", "?limit=0", "?limit=101", "?cursor=INC-1", "?typeId=x"]) {
      const response = await call(`/workspaces/${t.id}/incidents${bad}`, t.duda);
      expect(response.status, bad).toBe(400);
    }
    const one = await call(`/workspaces/${t.id}/incidents/${ids[2]}`, t.duda);
    expect(one.status).toBe(200);
    expect(((await one.json()) as { incident: PublicIncident }).incident.title).toBe("Incident 2");
    const missing = await call(`/workspaces/${t.id}/incidents/${newId("inc", 1, random)}`, t.duda);
    expect(missing.status).toBe(404);
    const outsider = await call(`/workspaces/${t.id}/incidents`, t.eva);
    expect(outsider.status).toBe(403);
  });

  test("a request reads at most INCIDENT_SCAN_CAP incidents; the cursor goes on from where it stopped, skipping and repeating none", async () => {
    const t = await team();
    const template = newId("inc", Date.now(), random);
    await t.run("incident.declare", { id: template, title: "Template", severity: "sev3" });
    // 2100 incidents, newest first by index; sev1 at a few, around the cap's edge too.
    const total = 2100;
    const matching = new Set([0, 499, 999, 1000, 1001, 2099]);
    const start = Date.now() - total * 1000;
    const ids = Array.from({ length: total }, (_, index) =>
      newId("inc", start + (total - index) * 1000, random),
    );
    await t.withShard((shard) => {
      const row = shard.store.get("incidents", template)!;
      shard.store.delete("incidents", template);
      shard.store.transaction(() => {
        ids.forEach((id, index) => {
          shard.store.insert("incidents", {
            ...row,
            id,
            number: index + 1,
            severity: matching.has(index) ? "sev1" : "sev3",
          });
        });
      });
    });
    expect(INCIDENT_SCAN_CAP).toBe(1000);
    const page = async (query: string) => {
      const response = await call(`/workspaces/${t.id}/incidents${query}`, t.duda);
      expect(response.status, query).toBe(200);
      return (await response.json()) as { incidents: PublicIncident[]; nextCursor: string | null };
    };

    // The first request stops at the cap: the matches within it, and the 1000th incident as the cursor.
    const first = await page("?severity=sev1&limit=100");
    expect(first.incidents.map((i) => i.id)).toEqual([ids[0], ids[499], ids[999]]);
    expect(first.nextCursor).toBe(ids[999]);

    // Followed to the end, a page at a time: every match once, in order.
    const seen: string[] = [];
    let cursor: string | null = null;
    let requests = 0;
    do {
      const next = await page(`?severity=sev1&limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...next.incidents.map((i) => i.id));
      cursor = next.nextCursor;
      requests++;
    } while (cursor && requests < 20);
    expect(cursor).toBeNull();
    expect(seen).toEqual([...matching].sort((a, b) => a - b).map((index) => ids[index]));

    // A short page from the cap: nothing matched in the first 1000 below the cursor.
    const empty = await page(`?severity=sev1&cursor=${ids[1001]}`);
    expect(empty.incidents).toEqual([]);
    expect(empty.nextCursor).toBe(ids[2001]);
    const rest = await page(`?severity=sev1&cursor=${empty.nextCursor}`);
    expect(rest.incidents.map((i) => i.id)).toEqual([ids[2099]]);
    expect(rest.nextCursor).toBeNull();
  });
});

describe("changing an incident", () => {
  test("type, services, fields, severity and status, each its own mutation, event and timeline entry", async () => {
    const t = await team();
    const incident = newId("inc", Date.now(), random);
    await t.run("incident.declare", { id: incident, title: "Checkout down", severity: "sev3" });
    const service = newId("svc", Date.now(), random);
    await t.run("service.create", {
      id: service,
      name: "Checkout",
      description: "",
      tier: "tier1",
      owners: [],
      escalationPolicyId: null,
    });
    const type = newId("typ", Date.now(), random);
    await t.run("incidentType.create", {
      id: type,
      name: "Outage",
      description: "",
      defaultSeverity: null,
      escalationPolicyId: null,
      requiredFields: [],
    });
    const region = newId("fld", Date.now(), random);
    await t.run("customField.create", {
      id: region,
      name: "Region",
      description: "",
      kind: "text",
      options: [],
    });
    const path = `/workspaces/${t.id}/incidents/${incident}`;
    const body = {
      typeId: type,
      serviceIds: [service],
      fields: { [region]: "eu-west" },
      severity: "sev1",
      status: "investigating",
    };
    const response = await call(path, t.caio, { method: "PATCH", key: "p-1", body });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { incident: PublicIncident }).incident).toMatchObject({
      typeId: type,
      serviceIds: [service],
      fields: { [region]: "eu-west" },
      severity: "sev1",
      status: "investigating",
    });
    const types = (await outbox(t))
      .filter((event) => event.subject === incident)
      .map((e) => e.type);
    expect(types).toEqual([
      "incident.declared",
      "incident.type_changed",
      "incident.services_changed",
      "incident.field_changed",
      "incident.severity_changed",
      "incident.status_changed",
    ]);
    const timeline = await t.withShard((shard) =>
      shard.store.scan("timeline").filter((entry) => entry.incidentId === incident),
    );
    expect(timeline.map((entry) => entry.kind)).toEqual([
      "declared",
      "type_changed",
      "services_changed",
      "field_changed",
      "severity_changed",
      "status_changed",
    ]);
    expect(timeline.at(-1)?.actor).toBe(t.caio.id);

    // The same request again (same key), and the same change under another: nothing more happens.
    expect((await call(path, t.caio, { method: "PATCH", key: "p-1", body })).status).toBe(200);
    expect((await call(path, t.caio, { method: "PATCH", body })).status).toBe(200);
    expect((await outbox(t)).filter((event) => event.subject === incident)).toHaveLength(6);

    // A field cleared, and a written update.
    const cleared = await call(path, t.caio, {
      method: "PATCH",
      body: { fields: { [region]: null } },
    });
    expect(((await cleared.json()) as { incident: PublicIncident }).incident.fields).toEqual({});
    const update = await call(`${path}/updates`, t.caio, {
      method: "POST",
      body: { body: "Rolling back the deploy." },
    });
    expect(update.status).toBe(201);
    const posted = (await outbox(t)).filter((event) => event.type === "incident.update_posted");
    expect(posted).toHaveLength(1);
    expect(posted[0]!.data).toMatchObject({ body: "Rolling back the deploy." });
  });

  test("the first refusal stops the rest and is the answer; a viewer may not change anything", async () => {
    const t = await team();
    const incident = newId("inc", Date.now(), random);
    await t.run("incident.declare", { id: incident, title: "Checkout down", severity: "sev3" });
    await t.run("incident.setStatus", { id: incident, status: "resolved" });
    const path = `/workspaces/${t.id}/incidents/${incident}`;
    const refused = await call(path, t.caio, {
      method: "PATCH",
      body: { severity: "sev2", status: "triage" },
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "invalid_transition" });
    // The severity, before it, stays made.
    expect((await t.withShard((shard) => shard.store.get("incidents", incident)))?.severity).toBe(
      "sev2",
    );
    const badField = await call(path, t.caio, {
      method: "PATCH",
      body: { fields: { [newId("fld", Date.now(), random)]: "x" } },
    });
    expect(badField.status).toBe(400);
    const viewer = await call(path, t.duda, { method: "PATCH", body: { severity: "sev1" } });
    expect(viewer.status).toBe(403);
    // Not even an empty one, which runs no mutation.
    const empty = await call(path, t.duda, { method: "PATCH", body: {} });
    expect(empty.status).toBe(403);
    expect(await empty.json()).toEqual({ error: "forbidden" });
    const missing = await call(`/workspaces/${t.id}/incidents/${newId("inc", 1, random)}`, t.caio, {
      method: "PATCH",
      body: { severity: "sev1" },
    });
    expect(missing.status).toBe(404);
  });
});

describe("renaming and incident roles", () => {
  test("title and roles in the PATCH: renamed first, roles after the fields, each with its event and entry", async () => {
    const t = await team();
    const caio: Actor = { kind: "user", id: t.caio.id, role: "responder" };
    await t.run("member.sync", { id: caio.id, name: "Caio", role: caio.role }, caio, true);
    const incident = newId("inc", Date.now(), random);
    await t.run("incident.declare", { id: incident, title: "Checkout slow", severity: "sev3" });
    const path = `/workspaces/${t.id}/incidents/${incident}`;
    const response = await call(path, t.caio, {
      method: "PATCH",
      body: {
        status: "investigating",
        roles: { commander: t.caio.id },
        title: "Checkout errors in eu-west",
      },
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { incident: PublicIncident }).incident).toMatchObject({
      title: "Checkout errors in eu-west",
      roles: { commander: t.caio.id },
      status: "investigating",
    });
    const events = (await outbox(t)).filter((event) => event.subject === incident);
    expect(events.map((event) => event.type)).toEqual([
      "incident.declared",
      "incident.renamed",
      "incident.role_assigned",
      "incident.status_changed",
    ]);
    expect(events[1]).toMatchObject({
      actor: { id: t.caio.id },
      data: { from: "Checkout slow", to: "Checkout errors in eu-west" },
    });
    const timeline = await t.withShard((shard) =>
      shard.store.scan("timeline").filter((entry) => entry.incidentId === incident),
    );
    expect(timeline[1]).toMatchObject({
      kind: "renamed",
      from: "Checkout slow",
      to: "Checkout errors in eu-west",
      actor: t.caio.id,
    });

    // The same title and holder again change nothing; `null` leaves the role empty.
    const again = await call(path, t.caio, {
      method: "PATCH",
      body: { title: "Checkout errors in eu-west", roles: { commander: t.caio.id } },
    });
    expect(again.status).toBe(200);
    const cleared = await call(path, t.caio, {
      method: "PATCH",
      body: { roles: { commander: null } },
    });
    expect(((await cleared.json()) as { incident: PublicIncident }).incident.roles).toEqual({});
    expect((await outbox(t)).filter((event) => event.subject === incident)).toHaveLength(5);
  });

  test("a refused role stops the rest, the rename before it stays; a bad title or role id is 400", async () => {
    const t = await team();
    const duda: Actor = { kind: "user", id: t.duda.id, role: "viewer" };
    await t.run("member.sync", { id: duda.id, name: "Duda", role: duda.role }, duda, true);
    const incident = newId("inc", Date.now(), random);
    await t.run("incident.declare", { id: incident, title: "Checkout slow", severity: "sev3" });
    const path = `/workspaces/${t.id}/incidents/${incident}`;
    const refused = await call(path, t.caio, {
      method: "PATCH",
      body: { title: "Checkout down", roles: { commander: t.duda.id }, severity: "sev1" },
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: "invalid_args",
      issues: [{ path: "roles.commander" }],
    });
    const row = await t.withShard((shard) => shard.store.get("incidents", incident));
    expect(row).toMatchObject({ title: "Checkout down", severity: "sev3", roles: {} });
    for (const body of [
      { title: "" },
      { title: "x".repeat(201) },
      { roles: { "not a role": t.caio.id } },
      { roles: { commander: 7 } },
    ]) {
      const response = await call(path, t.caio, { method: "PATCH", body });
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    const viewer = await call(path, t.duda, { method: "PATCH", body: { title: "Mine now" } });
    expect(viewer.status).toBe(403);
    expect((await t.withShard((shard) => shard.store.get("incidents", incident)))?.title).toBe(
      "Checkout down",
    );
  });
});

describe("editing and removing a written update", () => {
  /** An incident with an update by Caio (a session) and one by Ana; their entry ids. */
  async function withUpdates(t: Team) {
    const incident = newId("inc", Date.now(), random);
    await t.run("incident.declare", { id: incident, title: "Checkout down", severity: "sev3" });
    const path = `/workspaces/${t.id}/incidents/${incident}`;
    const post = async (by: Person | string, body: string) => {
      const response = await call(`${path}/updates`, by, { method: "POST", body: { body } });
      expect(response.status).toBe(201);
      return ((await response.json()) as { entryId: string }).entryId;
    };
    const caios = await post(t.caio, "Rolling back.");
    const anas = await post(t.ana, "Paging the database team.");
    return { incident, path, post, caios, anas };
  }

  /** A token Caio minted as an admin, back to a responder since. */
  async function caioMints(t: Team, scopes: Permission[]) {
    await setRole(t, "admin");
    const minted = await mint(t, t.caio, scopes);
    await setRole(t, "responder");
    forgetAllTokens();
    return minted;
  }

  const setRole = async (t: Team, to: string) => {
    const response = await api(`/workspaces/${t.id}/members/${t.caio.id}`, {
      method: "PATCH",
      headers: { Cookie: t.ana.cookie },
      body: { role: to },
    });
    expect(response.status).toBe(200);
  };

  const entry = (t: Team, id: string) =>
    t.withShard((shard) => shard.store.get("timeline", id) as Record<string, unknown> | undefined);

  test("its author edits it, anyone else is 403; the author, an owner or an admin removes it", async () => {
    const t = await team();
    const { incident, path, caios, anas } = await withUpdates(t);
    expect(caios).toBe(`${incident}:2`);
    const edit = (by: Person, id: string, body: string, key?: string) =>
      call(`${path}/updates/${id}`, by, { method: "PATCH", body: { body }, key });

    const edited = await edit(t.caio, caios, "Rolled back.");
    expect(edited.status).toBe(200);
    expect(await edited.json()).toEqual({ ok: true });
    expect(await entry(t, caios)).toMatchObject({
      body: "Rolled back.",
      edited: { by: t.caio.id, count: 1, previous: "Rolling back." },
    });
    // The same text again changes nothing.
    expect((await edit(t.caio, caios, "Rolled back.")).status).toBe(200);
    // Not the author: the owner included.
    for (const [by, id] of [
      [t.ana, caios],
      [t.caio, anas],
    ] as const) {
      const response = await edit(by, id, "Not mine.");
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    const removeOwn = await call(`${path}/updates/${anas}`, t.caio, { method: "DELETE" });
    expect(removeOwn.status).toBe(403);
    // The colon may come percent-encoded.
    const removed = await call(`${path}/updates/${encodeURIComponent(caios)}`, t.ana, {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);
    expect(await entry(t, caios)).toMatchObject({ body: "", removed: { by: t.ana.id } });
    // Removed: neither edited nor removed again.
    expect((await edit(t.caio, caios, "Back.")).status).toBe(409);
    expect((await call(`${path}/updates/${caios}`, t.ana, { method: "DELETE" })).status).toBe(409);

    const events = (await outbox(t)).filter((event) => event.subject === incident);
    expect(events.map((event) => event.type)).toEqual([
      "incident.declared",
      "incident.update_posted",
      "incident.update_posted",
      "incident.update_edited",
      "incident.update_deleted",
    ]);
    expect(events[3]).toMatchObject({
      data: { entryId: caios, body: "Rolled back.", previous: "Rolling back." },
    });
    expect(events[4]).toMatchObject({ actor: { id: t.ana.id }, data: { entryId: caios } });
  });

  test("no such update on this incident is 404: another incident's, another kind, a bad id, another workspace", async () => {
    const t = await team();
    const { path, caios } = await withUpdates(t);
    const other = await withUpdates(t);
    for (const id of [other.caios, `${caios.split(":")[0]}:1`, `${caios}0`, "nope", `${caios}:1`]) {
      const response = await call(`${path}/updates/${id}`, t.caio, {
        method: "PATCH",
        body: { body: "Edited." },
      });
      expect(response.status, id).toBe(404);
    }
    // Another workspace's incident, by a member of this one: not found.
    const elsewhere = await team();
    const across = await call(
      `/workspaces/${elsewhere.id}/incidents/${caios.split(":")[0]}/updates/${caios}`,
      elsewhere.ana,
      { method: "DELETE" },
    );
    expect(across.status).toBe(404);
    expect(
      (await call(`${path}/updates/${caios}`, elsewhere.ana, { method: "DELETE" })).status,
    ).toBe(403);
    expect((await call(`${path}/updates/${caios}`, t.caio, { method: "PUT" })).status).toBe(405);
    expect(await entry(t, caios)).toMatchObject({ body: "Rolling back." });
  });

  test("a token is the author of what it or its creator posted; it needs incident:update", async () => {
    const t = await team();
    const { path, post, anas, caios } = await withUpdates(t);
    const anaToken = await mint(t, t.ana, ["incident:update"]);
    const tokens = await post(anaToken.token, "Posted by a script.");
    const edit = (by: string, id: string) =>
      call(`${path}/updates/${id}`, by, { method: "PATCH", body: { body: `Edited ${id}.` } });
    // Its own, and its creator's.
    expect((await edit(anaToken.token, tokens)).status).toBe(200);
    expect((await edit(anaToken.token, anas)).status).toBe(200);
    expect(await entry(t, tokens)).toMatchObject({ edited: { by: anaToken.id } });
    // Another member's: an owner's token edits no one else's, though it may remove it.
    expect((await edit(anaToken.token, caios)).status).toBe(403);
    // Caio's token: not the author of Ana's, nor of Ana's token's.
    const caioToken = await caioMints(t, ["incident:update"]);
    for (const id of [anas, tokens]) {
      expect((await edit(caioToken.token, id)).status).toBe(403);
      const remove = await call(`${path}/updates/${id}`, caioToken.token, { method: "DELETE" });
      expect(remove.status).toBe(403);
    }
    expect((await edit(caioToken.token, caios)).status).toBe(200);

    // Without the scope: 403, nothing changed.
    const readOnly = await caioMints(t, ["incident:read"]);
    expect((await edit(readOnly.token, caios)).status).toBe(403);
    const noScope = await call(`${path}/updates/${caios}`, readOnly.token, { method: "DELETE" });
    expect(noScope.status).toBe(403);
    expect(await noScope.json()).toEqual({ error: "forbidden" });
    expect(await entry(t, caios)).toMatchObject({ body: `Edited ${caios}.` });
    expect(
      (await call(`${path}/updates/${anas}`, anaToken.token, { method: "DELETE" })).status,
    ).toBe(200);
  });

  test("a revoked token is 401, a demoted creator's is 403, and nothing changes", async () => {
    const t = await team();
    const { path, caios } = await withUpdates(t);
    const demoted = await caioMints(t, ["incident:update"]);
    const revoked = await caioMints(t, ["incident:update"]);
    expect(
      (
        await api(`/workspaces/${t.id}/api-tokens/${revoked.id}`, {
          method: "DELETE",
          headers: { Cookie: t.ana.cookie },
        })
      ).status,
    ).toBe(200);
    await setRole(t, "viewer");
    forgetAllTokens();
    const gone = await call(`${path}/updates/${caios}`, revoked.token, {
      method: "PATCH",
      body: { body: "Edited." },
    });
    expect(gone.status).toBe(401);
    expect(await gone.json()).toEqual({ error: "unauthenticated" });
    for (const method of ["PATCH", "DELETE"]) {
      const response = await call(`${path}/updates/${caios}`, demoted.token, {
        method,
        ...(method === "PATCH" ? { body: { body: "Edited." } } : {}),
      });
      expect(response.status, method).toBe(403);
    }
    expect(await entry(t, caios)).toMatchObject({ body: "Rolling back." });
  });

  test("Idempotency-Key: the same edit or removal again runs once; the key with another body is 422", async () => {
    const t = await team();
    const { incident, path, caios, anas } = await withUpdates(t);
    const events = async () =>
      (await outbox(t)).filter((event) => event.subject === incident).map((event) => event.type);
    const before = await events();
    const edit = (body: string, key: string, id = caios) =>
      call(`${path}/updates/${id}`, t.caio, { method: "PATCH", key, body: { body } });
    expect((await edit("Rolled back.", "e-1")).status).toBe(200);
    expect((await edit("Rolled back.", "e-1")).status).toBe(200);
    expect(await events()).toEqual([...before, "incident.update_edited"]);
    for (const response of [
      await edit("Something else.", "e-1"),
      await edit("Rolled back.", "e-1", anas),
      await call(`${path}/updates/${caios}`, t.caio, { method: "DELETE", key: "e-1" }),
    ]) {
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "idempotency_key_reused" });
    }
    const remove = () => call(`${path}/updates/${caios}`, t.caio, { method: "DELETE", key: "d-1" });
    expect((await remove()).status).toBe(200);
    // The retry answers what the first did, not "removed already".
    expect((await remove()).status).toBe(200);
    expect(await events()).toEqual([
      ...before,
      "incident.update_edited",
      "incident.update_deleted",
    ]);
    expect((await entry(t, caios))?.body).toBe("");
    // A retried post answers the same entry.
    const post = () =>
      call(`${path}/updates`, t.caio, { method: "POST", key: "u-1", body: { body: "Done." } });
    const first = (await (await post()).json()) as { entryId: string };
    const second = (await (await post()).json()) as { entryId: string };
    expect(second.entryId).toBe(first.entryId);
    expect(first.entryId).toBe(`${incident}:4`);
  });
});

describe("Idempotency-Key", () => {
  test("a refused PATCH answers the same refusal for its key; a new key once fixed runs the rest, the steps made as no change", async () => {
    const t = await team();
    const incident = newId("inc", Date.now(), random);
    await t.run("incident.declare", { id: incident, title: "Checkout down", severity: "sev3" });
    await t.run("incident.setStatus", { id: incident, status: "resolved" });
    const path = `/workspaces/${t.id}/incidents/${incident}`;
    const events = async () =>
      (await outbox(t)).filter((event) => event.subject === incident).map((event) => event.type);
    const before = await events();

    const body = { severity: "sev2", status: "triage" };
    const first = await call(path, t.caio, { method: "PATCH", key: "fix-1", body });
    expect(first.status).toBe(409);
    expect(await first.json()).toEqual({ error: "invalid_transition" });
    expect(await events()).toEqual([...before, "incident.severity_changed"]);
    // Even once the status could change, the same key answers what it did: the stored refusal.
    const again = await call(path, t.caio, { method: "PATCH", key: "fix-1", body });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "invalid_transition" });
    expect(await events()).toEqual([...before, "incident.severity_changed"]);

    // Fixed, with a new key: the severity comes back as no change, the status runs.
    const fixed = await call(path, t.caio, {
      method: "PATCH",
      key: "fix-2",
      body: { severity: "sev2", status: "investigating" },
    });
    expect(fixed.status).toBe(200);
    expect(((await fixed.json()) as { incident: PublicIncident }).incident).toMatchObject({
      severity: "sev2",
      status: "investigating",
    });
    expect(await events()).toEqual([
      ...before,
      "incident.severity_changed",
      "incident.status_changed",
    ]);
  });

  test("the same key with another request is 422 and runs nothing: another body, target or route", async () => {
    const t = await team();
    const one = newId("inc", Date.now(), random);
    const other = newId("inc", Date.now() + 1, random);
    for (const id of [one, other]) {
      await t.run("incident.declare", { id, title: "Checkout down", severity: "sev3" });
    }
    const path = (id: string) => `/workspaces/${t.id}/incidents/${id}`;
    const subjectEvents = async () =>
      (await outbox(t)).filter((event) => event.type !== "incident.declared").length;
    const made = await call(path(one), t.caio, {
      method: "PATCH",
      key: "same",
      body: { severity: "sev2", status: "investigating" },
    });
    expect(made.status).toBe(200);
    const after = await subjectEvents();

    // The same request with its keys in another order is the same request.
    const reordered = await call(path(one), t.caio, {
      method: "PATCH",
      key: "same",
      body: { status: "investigating", severity: "sev2" },
    });
    expect(reordered.status).toBe(200);

    const reused = [
      // Another body, mixing a new step with the first request's.
      call(path(one), t.caio, {
        method: "PATCH",
        key: "same",
        body: { severity: "sev1", status: "investigating" },
      }),
      // Another target.
      call(path(other), t.caio, { method: "PATCH", key: "same", body: { severity: "sev2" } }),
      // Another route.
      call(`${path(one)}/updates`, t.caio, { method: "POST", key: "same", body: { body: "Hi" } }),
      call(`/workspaces/${t.id}/incidents`, t.caio, {
        method: "POST",
        key: "same",
        body: { title: "Another" },
      }),
    ];
    for (const response of await Promise.all(reused)) {
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "idempotency_key_reused" });
    }
    expect(await subjectEvents()).toBe(after);
    expect(await declares(t)).toHaveLength(2);
    expect((await t.withShard((shard) => shard.store.get("incidents", one)))?.severity).toBe(
      "sev2",
    );
    // Another caller's key is their own.
    const ana = await call(path(other), t.ana, {
      method: "PATCH",
      key: "same",
      body: { severity: "sev1" },
    });
    expect(ana.status).toBe(200);
  });
});

describe("the catalog", () => {
  test("services: made, changed, unchanged, read and removed, as owners and admins only", async () => {
    const t = await team();
    const base = `/workspaces/${t.id}/services`;
    const caio: Actor = { kind: "user", id: t.caio.id, role: "responder" };
    await t.run("member.sync", { id: caio.id, name: "Caio", role: caio.role }, caio, true);
    const forbidden = await call(base, t.caio, {
      method: "POST",
      body: { name: "Checkout", tier: "tier1" },
    });
    expect(forbidden.status).toBe(403);
    const made = await call(base, t.ana, {
      method: "POST",
      key: "svc-1",
      body: { name: "Checkout", tier: "tier1", owners: [{ kind: "member", id: t.caio.id }] },
    });
    expect(made.status).toBe(201);
    const { service } = (await made.json()) as { service: { id: string } };
    expect(service).toMatchObject({ name: "Checkout", description: "", escalationPolicyId: null });
    // Retried: the same service, still one.
    const again = await call(base, t.ana, {
      method: "POST",
      key: "svc-1",
      body: { name: "Checkout", tier: "tier1", owners: [{ kind: "member", id: t.caio.id }] },
    });
    expect(((await again.json()) as { service: { id: string } }).service.id).toBe(service.id);
    const changed = await call(`${base}/${service.id}`, t.ana, {
      method: "PATCH",
      body: { tier: "tier2" },
    });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({
      service: { tier: "tier2", name: "Checkout", owners: [{ kind: "member", id: t.caio.id }] },
    });
    const same = await call(`${base}/${service.id}`, t.ana, {
      method: "PATCH",
      body: { tier: "tier2" },
    });
    expect(same.status).toBe(200);
    const badOwner = await call(`${base}/${service.id}`, t.ana, {
      method: "PATCH",
      body: { owners: [{ kind: "member", id: t.duda.id }] },
    });
    expect(badOwner.status).toBe(400);
    const listed = (await (await call(base, t.duda)).json()) as { services: unknown[] };
    expect(listed.services).toHaveLength(1);
    const events = (await outbox(t)).filter((event) => event.type.startsWith("service."));
    expect(events.map((event) => event.type)).toEqual(["service.created", "service.updated"]);
    const removed = await call(`${base}/${service.id}`, t.ana, { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect((await call(`${base}/${service.id}`, t.duda)).status).toBe(404);
    expect((await call(`${base}/${service.id}`, t.ana, { method: "DELETE" })).status).toBe(404);
    // The create retried after the service was removed: gone, not a server fault.
    const retried = await call(base, t.ana, {
      method: "POST",
      key: "svc-1",
      body: { name: "Checkout", tier: "tier1", owners: [{ kind: "member", id: t.caio.id }] },
    });
    expect(retried.status).toBe(404);
    expect(await retried.json()).toEqual({ error: "not_found" });
  });

  test("incident types and custom fields: made with their ids and options' ids, changed, listed", async () => {
    const t = await team();
    const fields = `/workspaces/${t.id}/custom-fields`;
    const made = await call(fields, t.ana, {
      method: "POST",
      key: "fld-1",
      body: {
        name: "Impact",
        kind: "single_select",
        options: [{ label: "None" }, { label: "Some" }],
      },
    });
    expect(made.status).toBe(201);
    const { customField } = (await made.json()) as {
      customField: { id: string; options: { id: string; label: string }[] };
    };
    expect(customField.options.map((option) => option.label)).toEqual(["None", "Some"]);
    expect(new Set(customField.options.map((option) => option.id)).size).toBe(2);
    const retried = (await (
      await call(fields, t.ana, {
        method: "POST",
        key: "fld-1",
        body: {
          name: "Impact",
          kind: "single_select",
          options: [{ label: "None" }, { label: "Some" }],
        },
      })
    ).json()) as { customField: { id: string; options: { id: string }[] } };
    expect(retried.customField).toEqual(customField);
    const noOptions = await call(fields, t.ana, {
      method: "POST",
      body: { name: "Tier", kind: "single_select" },
    });
    expect(noOptions.status).toBe(400);
    const kept = customField.options[0]!;
    const changed = await call(`${fields}/${customField.id}`, t.ana, {
      method: "PATCH",
      body: { options: [kept, { label: "Lots" }] },
    });
    expect(changed.status).toBe(200);
    const after = ((await changed.json()) as { customField: typeof customField }).customField;
    expect(after.options[0]).toEqual(kept);
    expect(after.options[1]).toMatchObject({ label: "Lots" });

    const types = `/workspaces/${t.id}/incident-types`;
    const type = await call(types, t.ana, {
      method: "POST",
      body: { name: "Security", defaultSeverity: "sev1", requiredFields: [customField.id] },
    });
    expect(type.status).toBe(201);
    const { incidentType } = (await type.json()) as { incidentType: { id: string } };
    expect(incidentType).toMatchObject({
      roles: [],
      requiredRoles: [],
      requiredFields: [customField.id],
    });
    const renamed = await call(`${types}/${incidentType.id}`, t.ana, {
      method: "PATCH",
      body: { name: "Security incident" },
    });
    expect(await renamed.json()).toMatchObject({
      incidentType: { name: "Security incident", defaultSeverity: "sev1" },
    });
    const listed = (await (await call(types, t.caio)).json()) as { incidentTypes: unknown[] };
    expect(listed.incidentTypes).toHaveLength(1);
    expect(
      (await call(`${types}/${incidentType.id}`, t.caio, { method: "PATCH", body: {} })).status,
    ).toBe(403);

    // A declare of the type takes its default severity, as in the app.
    const declared = await call(`/workspaces/${t.id}/incidents`, t.caio, {
      method: "POST",
      body: { title: "Leaked key", typeId: incidentType.id },
    });
    expect(await declared.json()).toMatchObject({
      incident: { severity: "sev1", typeId: incidentType.id },
    });
  });

  test("other methods answer 405 with what the path allows", async () => {
    const t = await team();
    const allow = async (path: string) => {
      const response = await call(path, t.ana, { method: "PUT" });
      expect(response.status, path).toBe(405);
      return response.headers.get("Allow");
    };
    expect(await allow(`/workspaces/${t.id}/incidents`)).toBe("GET, POST");
    expect(await allow(`/workspaces/${t.id}/incidents/${newId("inc", 1, random)}`)).toBe(
      "GET, PATCH",
    );
    expect(await allow(`/workspaces/${t.id}/services/${newId("svc", 1, random)}`)).toBe(
      "GET, PATCH, DELETE",
    );
    expect(await allow(`/workspaces/${t.id}/custom-fields/${newId("fld", 1, random)}`)).toBe(
      "GET, PATCH",
    );
  });
});
