// Outbound webhooks (RFC 0005 "Outbound webhooks"): the signature (Standard Webhooks, against the specification's
// own example), creating an endpoint and rotating its secret through the API, and delivery from the queue consumer:
// signed, filtered, idempotent per event, retried with backoff and a cap, refused for targets the rules forbid,
// turned off after sustained failures with an email to the owners, and never in the way of a page.
import { env, exports } from "cloudflare:workers";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runInDurableObject,
} from "cloudflare:test";
import { generateRecipient, toBase64url } from "@freecorps/brigade-push";
import {
  newId,
  WEBHOOK_DISABLE_AFTER_MS,
  WEBHOOK_DISABLE_FAILURES,
  type Actor,
  type WebhookRow,
} from "@freecorps/brigade-schema";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { EmailSender, OutgoingEmail } from "../src/email.ts";
import { consumeEvents, WEBHOOK_BUDGET_MS, type Fetch } from "../src/notify.ts";
import { snippet, WEBHOOK_TIMEOUT_MS } from "../src/notify-webhooks.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { Shard } from "../src/shard.ts";
import { newWebhookSecret, sign, signatureHeaders } from "../src/webhook-sign.ts";
import { webhookRequest } from "../src/webhook-routes.ts";
import { WEBHOOK_MAX_ATTEMPTS, WEBHOOK_RETRY_DELAYS_MS } from "../src/webhooks.ts";
import { workerAuth } from "../src/index.ts";
import type { WorkspaceDO } from "../src/workspace.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";
const HOOK = "https://hooks.example.com/brigade";
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("signature", () => {
  test("matches the Standard Webhooks specification's example", async () => {
    // spec/standard-webhooks.md, "Signature scheme": the same secret, id, timestamp and body give this signature.
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    expect(
      await sign(secret, "msg_p5jXN8AQM9LWM0D4loKWxJek", 1614265330, '{"test": 2432232314}'),
    ).toBe("g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
  });

  test("signs with every secret in use, space separated", async () => {
    const [a, b] = [newWebhookSecret(), newWebhookSecret()];
    expect(a).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    const headers = await signatureHeaders([a!, b!], "evt_x", 1790000000, "{}");
    expect(headers).toEqual({
      "webhook-id": "evt_x",
      "webhook-timestamp": "1790000000",
      "webhook-signature": `v1,${await sign(a!, "evt_x", 1790000000, "{}")} v1,${await sign(b!, "evt_x", 1790000000, "{}")}`,
    });
  });

  test("a receiver's answer is kept as a short line of printable text", () => {
    expect(snippet("  oops\n\tbad\u0000 gateway  ")).toBe("oops bad gateway");
    expect(snippet("x".repeat(500))).toHaveLength(200);
    expect(snippet("​\u0007")).toBeNull();
  });
});

let people = 0;
let clients = 0;
const clientIp = () => `203.0.${Math.floor(++clients / 250) % 250}.${(clients % 250) + 1}`;

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

type Person = { id: string; cookie: string; email: string };

async function signUp(name: string): Promise<Person> {
  const email = `${name.toLowerCase()}-w${++people}@example.com`;
  const response = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name, email, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  await env.DB.prepare(`update "user" set "emailVerified" = 1 where id = ?`)
    .bind(body.user.id)
    .run();
  return { id: body.user.id, cookie, email };
}

async function addMember(workspaceId: string, userId: string, role: string) {
  await env.DB.prepare(
    `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, ?, ?)`,
  )
    .bind(newId("mem", Date.now(), random), workspaceId, userId, role, new Date().toISOString())
    .run();
}

/** Ana owns a new workspace; Bia is an admin, Caio a responder, Duda a viewer. */
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
  const run = (name: string, args: unknown, actor: Actor, internal = false) =>
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
  return { id, stub, ana: ana!, bia: bia!, caio: caio!, duda: duda!, withShard, run };
}

type Team = Awaited<ReturnType<typeof team>>;

const owner = (t: Team): Actor => ({ kind: "user", id: t.ana.id, role: "owner" });
const responder = (t: Team): Actor => ({ kind: "user", id: t.caio.id, role: "responder" });

/** Creates an endpoint through the API as `by`; returns its id and the secret shown once. */
async function addEndpoint(
  t: Team,
  events: string[] = ["incident.declared"],
  url = HOOK,
  by: Person = t.ana,
) {
  const id = newId("whk", Date.now(), random);
  const response = await api(`/workspaces/${t.id}/webhooks`, {
    method: "POST",
    headers: { Cookie: by.cookie },
    body: JSON.stringify({ id, url, description: "Ops bot", events }),
  });
  return { id, response };
}

async function endpoint(t: Team, events?: string[], url?: string) {
  const { id, response } = await addEndpoint(t, events, url);
  expect(response.status).toBe(201);
  const body = (await response.json()) as { id: string; secret: string };
  expect(body.id).toBe(id);
  return { id, secret: body.secret };
}

const outbox = (t: Team) =>
  t.withShard((_shard, state) =>
    state.storage.sql
      .exec<{ event: string }>("select event from outbox order by seq")
      .toArray()
      .map((row) => JSON.parse(row.event) as BrigadeEvent),
  );
const eventsOf = async (t: Team, type: string) =>
  (await outbox(t)).filter((event) => event.type === type);
const row = (t: Team, id: string) =>
  t.withShard((shard) => shard.store.get("webhooks", id) as WebhookRow);

async function declare(t: Team, by: Actor, title = "Checkout down") {
  await t.run(
    "incident.declare",
    { id: newId("inc", Date.now(), random), title, severity: "sev1" },
    by,
  );
  return (await eventsOf(t, "incident.declared")).at(-1)!;
}

/** Ana in the shard's member list with a phone that pages reach. */
async function phone(t: Team, pushToken: string) {
  await t.run("member.sync", { id: t.ana.id, name: "Ana", role: "owner" }, owner(t), true);
  const recipient = await generateRecipient();
  await t.run(
    "device.register",
    {
      id: newId("dev", Date.now(), random),
      platform: "ios",
      environment: "production",
      pushToken,
      voipToken: null,
      publicKey: toBase64url(recipient.publicKey),
    },
    owner(t),
  );
}

type Received = { url: string; headers: Record<string, string>; body: string };

/** A receiver at every `https://hooks.example.com/` URL answering `answer`, and a relay that takes every push. */
function receiver(
  answer: (request: Request) => Response | Promise<Response> = () => new Response("ok"),
) {
  const received: Received[] = [];
  const pushes: string[] = [];
  const send: Fetch = async (request) => {
    if (request.url.startsWith("https://relay.test/")) {
      pushes.push(((await request.json()) as { deviceToken: string }).deviceToken);
      return Response.json({ status: 200 });
    }
    expect(request.redirect).toBe("manual");
    received.push({
      url: request.url,
      headers: Object.fromEntries(request.headers),
      body: await request.clone().text(),
    });
    return answer(request);
  };
  return { received, pushes, send };
}

async function deliver(
  events: BrigadeEvent[],
  send: Fetch,
  { attempts = 1, mail }: { attempts?: number; mail?: EmailSender } = {},
) {
  const batch = createMessageBatch(
    "brigade-events",
    events.map((body, index) => ({ id: `msg-${index}`, timestamp: new Date(), attempts, body })),
  );
  const delays = new Map<string, number | undefined>();
  for (const message of batch.messages) {
    const retry = message.retry.bind(message);
    message.retry = (options) => {
      delays.set(message.id, options?.delaySeconds);
      retry(options);
    };
  }
  const ctx = createExecutionContext();
  const started = Date.now();
  await consumeEvents(
    batch,
    {
      WORKSPACE: env.WORKSPACE,
      DB: env.DB,
      RELAY_URL: "https://relay.test",
      RELAY_SEND_TOKEN: "test-token",
      WEBHOOK_SECRET_KEY: Reflect.get(env, "WEBHOOK_SECRET_KEY") as string,
      DASHBOARD_URL: "https://brigade.test",
    },
    send,
    mail,
    (promise) => ctx.waitUntil(promise),
  );
  const settledIn = Date.now() - started;
  const result = await getQueueResult(batch, ctx);
  return {
    settledIn,
    explicitAcks: result.explicitAcks,
    retryMessages: result.retryMessages.map(({ msgId }) => ({
      msgId,
      delaySeconds: delays.get(msgId),
    })),
  };
}

/** Lets every backoff and hold in the webhook ledger run out, so the next delivery is due at once. */
const due = (t: Team) =>
  t.withShard((_shard, state) =>
    state.storage.sql.exec("update webhook_sends set retry_at = 0, claimed_until = 0"),
  );

describe("POST /workspaces/:id/webhooks", () => {
  test("an owner or admin gets the secret once; the shard keeps it sealed and never in an event", async () => {
    const t = await team();
    const { id, secret } = await endpoint(t, ["incident.declared", "alert.fired"]);
    expect(secret).toMatch(/^whsec_/);
    const stored = await t.withShard((shard) => shard.store.get("webhook_secrets", id));
    expect(stored?.secret).toMatch(/^v1\./);
    expect(JSON.stringify(stored)).not.toContain(secret.slice(6));
    const events = await outbox(t);
    expect(events.filter((event) => event.type === "webhook.created")).toEqual([
      expect.objectContaining({
        subject: id,
        data: { id, events: ["incident.declared", "alert.fired"], enabled: true },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("hooks.example.com");
    expect((await addEndpoint(t, undefined, undefined, t.bia)).response.status).toBe(201);
  });

  test("responders and viewers are refused, and so is a cross-site request", async () => {
    const t = await team();
    for (const by of [t.caio, t.duda]) {
      const { response } = await addEndpoint(t, undefined, undefined, by);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    const cross = await api(`/workspaces/${t.id}/webhooks`, {
      method: "POST",
      headers: { Cookie: t.ana.cookie, Origin: "https://evil.test" },
      body: "{}",
    });
    expect(cross.status).toBe(403);
  });

  test("refuses targets the monitors' rules forbid, and plain http", async () => {
    const t = await team();
    for (const url of [
      "http://hooks.example.com/",
      "https://127.0.0.1/",
      "https://169.254.169.254/latest/meta-data",
      "https://10.1.2.3/",
      "https://[::1]/",
      "https://metadata.internal/",
      "https://104.16.0.1/",
    ]) {
      const { response } = await addEndpoint(t, undefined, url);
      expect(response.status, url).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "invalid_args",
        issues: [{ path: "url" }],
      });
    }
  });

  test("without WEBHOOK_SECRET_KEY webhooks are off", async () => {
    const t = await team();
    const request = new Request(`${ORIGIN}/workspaces/${t.id}/webhooks`, {
      method: "POST",
      headers: { Cookie: t.ana.cookie, Origin: ORIGIN },
      body: "{}",
    });
    const response = await webhookRequest(
      request,
      { DB: env.DB, WORKSPACE: env.WORKSPACE },
      () => workerAuth(env, createExecutionContext(), request),
      t.id,
      undefined,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
  });
});

describe("delivery", () => {
  test("POSTs the versioned payload, signed with the secret shown at create", async () => {
    const t = await team();
    const { id, secret } = await endpoint(t);
    const event = await declare(t, owner(t));
    const hook = receiver();
    expect(await deliver([event], hook.send)).toMatchObject({
      explicitAcks: ["msg-0"],
      retryMessages: [],
    });
    expect(hook.received).toHaveLength(1);
    const [got] = hook.received;
    expect(got!.url).toBe(HOOK);
    expect(got!.headers["content-type"]).toBe("application/json");
    expect(got!.headers["webhook-id"]).toBe(event.id);
    const timestamp = Number(got!.headers["webhook-timestamp"]);
    expect(Math.abs(timestamp - Date.now() / 1000)).toBeLessThan(60);
    expect(got!.headers["webhook-signature"]).toBe(
      `v1,${await sign(secret, event.id, timestamp, got!.body)}`,
    );
    const payload = JSON.parse(got!.body);
    expect(payload).toMatchObject({
      version: 1,
      id: event.id,
      type: "incident.declared",
      workspaceId: t.id,
      actor: { kind: "user", id: t.ana.id },
      data: { incident: { title: "Checkout down", severity: "sev1", status: "triage" } },
    });
    const log = (await row(t, id)).recent;
    expect(log).toEqual([
      expect.objectContaining({
        eventId: event.id,
        attempt: 1,
        ok: true,
        status: 200,
        error: null,
        snippet: null,
      }),
    ]);
  });

  test("is idempotent: a redelivery, or the same event twice in a batch, posts once", async () => {
    const t = await team();
    await endpoint(t);
    const event = await declare(t, owner(t));
    const hook = receiver();
    await deliver([event, event], hook.send);
    await due(t);
    await deliver([event], hook.send, { attempts: 2 });
    expect(hook.received).toHaveLength(1);
  });

  test("goes only to endpoints whose filter has the event, created before it, and turned on", async () => {
    const t = await team();
    const declared = await endpoint(t, ["incident.declared"], "https://hooks.example.com/declared");
    await endpoint(t, ["alert.fired"], "https://hooks.example.com/alerts");
    const off = await endpoint(t, ["incident.declared"], "https://hooks.example.com/off");
    await t.run("webhook.setEnabled", { id: off.id, enabled: false }, owner(t));
    const event = await declare(t, owner(t));
    const hook = receiver();
    await deliver([event], hook.send);
    expect(hook.received.map((one) => one.url)).toEqual(["https://hooks.example.com/declared"]);
    // Events outside the catalog never go anywhere.
    await deliver(await eventsOf(t, "webhook.created"), hook.send);
    expect(hook.received).toHaveLength(1);
    expect(declared.id).toMatch(/^whk_/);
  });

  test("a test event goes to its own endpoint only, whatever its filter", async () => {
    const t = await team();
    const target = await endpoint(t, ["alert.fired"], "https://hooks.example.com/target");
    await endpoint(t, ["incident.declared"], "https://hooks.example.com/other");
    await t.run("webhook.sendTest", { id: target.id }, owner(t));
    const hook = receiver();
    await deliver(await eventsOf(t, "webhook.test"), hook.send);
    expect(hook.received.map((one) => one.url)).toEqual(["https://hooks.example.com/target"]);
    expect(JSON.parse(hook.received[0]!.body)).toMatchObject({
      type: "webhook.test",
      data: { webhookId: target.id },
    });
  });

  test("a failure is retried with backoff, then given up after the last attempt", async () => {
    const t = await team();
    const { id } = await endpoint(t);
    const event = await declare(t, owner(t));
    const hook = receiver(() => new Response("upstream on fire\n", { status: 502 }));
    const first = await deliver([event], hook.send);
    expect(first.retryMessages).toEqual([
      { msgId: "msg-0", delaySeconds: WEBHOOK_RETRY_DELAYS_MS[0] / 1000 },
    ]);
    // Redelivered before the backoff ran out: nothing is sent, and it comes back when it is due.
    const early = await deliver([event], hook.send, { attempts: 2 });
    expect(hook.received).toHaveLength(1);
    expect(early.retryMessages[0]!.delaySeconds).toBeGreaterThan(20);
    for (let attempt = 2; attempt <= WEBHOOK_MAX_ATTEMPTS; attempt++) {
      await due(t);
      const result = await deliver([event], hook.send, { attempts: attempt + 1 });
      if (attempt < WEBHOOK_MAX_ATTEMPTS) {
        expect(result.retryMessages).toEqual([
          { msgId: "msg-0", delaySeconds: WEBHOOK_RETRY_DELAYS_MS[attempt - 1]! / 1000 },
        ]);
      } else {
        expect(result).toMatchObject({ explicitAcks: ["msg-0"], retryMessages: [] });
      }
    }
    expect(hook.received).toHaveLength(WEBHOOK_MAX_ATTEMPTS);
    // Every try carries the same id and bytes, so a receiver de-duplicates them.
    expect(new Set(hook.received.map((one) => one.body)).size).toBe(1);
    expect(new Set(hook.received.map((one) => one.headers["webhook-id"]))).toEqual(
      new Set([event.id]),
    );
    await due(t);
    await deliver([event], hook.send, { attempts: 9 });
    expect(hook.received).toHaveLength(WEBHOOK_MAX_ATTEMPTS);
    const log = (await row(t, id)).recent;
    expect(log[0]).toMatchObject({
      attempt: WEBHOOK_MAX_ATTEMPTS,
      ok: false,
      status: 502,
      error: "status",
      snippet: "upstream on fire",
    });
  });

  test("never follows a redirect, and never sends to a target the rules refuse now", async () => {
    const t = await team();
    const { id } = await endpoint(t);
    const redirect = receiver(
      () => new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/" } }),
    );
    await deliver([await declare(t, owner(t))], redirect.send);
    expect(redirect.received).toHaveLength(1);
    expect((await row(t, id)).recent[0]).toMatchObject({
      ok: false,
      status: 302,
      error: "redirect",
    });
    // A URL saved before the rules got stricter (written past the validator here): checked again, never fetched.
    await t.withShard((shard) =>
      shard.store.update("webhooks", id, { url: "https://127.0.0.1/hook" }),
    );
    const blocked = receiver();
    const result = await deliver([await declare(t, owner(t), "Second")], blocked.send);
    expect(blocked.received).toEqual([]);
    expect(result).toMatchObject({ explicitAcks: ["msg-0"], retryMessages: [] });
    expect((await row(t, id)).recent[0]).toMatchObject({ ok: false, error: "blocked" });
  });

  test("signs with both secrets for a day after a rotation", async () => {
    const t = await team();
    const { id, secret: first } = await endpoint(t);
    const rotated = await api(`/workspaces/${t.id}/webhooks/${id}/rotate`, {
      method: "POST",
      headers: { Cookie: t.bia.cookie },
    });
    expect(rotated.status).toBe(200);
    const { secret: second } = (await rotated.json()) as { secret: string };
    expect(second).not.toBe(first);
    expect(await eventsOf(t, "webhook.secret_rotated")).toHaveLength(1);
    const hook = receiver();
    const event = await declare(t, owner(t));
    await deliver([event], hook.send);
    const [got] = hook.received;
    const timestamp = Number(got!.headers["webhook-timestamp"]);
    expect(got!.headers["webhook-signature"]).toBe(
      `v1,${await sign(second, event.id, timestamp, got!.body)} v1,${await sign(first, event.id, timestamp, got!.body)}`,
    );
    const viewer = await api(`/workspaces/${t.id}/webhooks/${id}/rotate`, {
      method: "POST",
      headers: { Cookie: t.duda.cookie },
    });
    expect(viewer.status).toBe(403);
  });

  test("an endpoint failing for a day is turned off, and the owners are emailed", async () => {
    const t = await team();
    const { id } = await endpoint(t);
    // Failing for a day already, one attempt short of the count.
    await t.withShard((shard) =>
      shard.store.update("webhooks", id, {
        failures: WEBHOOK_DISABLE_FAILURES - 1,
        failingSince: Date.now() - WEBHOOK_DISABLE_AFTER_MS - 1000,
      }),
    );
    const hook = receiver(() => new Response("no", { status: 500 }));
    await deliver([await declare(t, owner(t))], hook.send);
    expect(await row(t, id)).toMatchObject({ enabled: false, disabledReason: "failing" });
    const disabled = await eventsOf(t, "webhook.disabled");
    expect(disabled).toEqual([
      expect.objectContaining({
        data: { id, reason: "failing", failures: WEBHOOK_DISABLE_FAILURES },
      }),
    ]);
    // Turned off: the next event goes nowhere.
    await deliver([await declare(t, owner(t), "Again")], hook.send);
    expect(hook.received).toHaveLength(1);

    const sent: OutgoingEmail[] = [];
    const mail: EmailSender = {
      id: "test",
      async send(email) {
        sent.push(email);
        return { ok: true };
      },
    };
    await deliver(disabled, hook.send, { mail });
    await deliver(disabled, hook.send, { mail, attempts: 2 });
    expect(sent.map((email) => email.to.email)).toEqual([t.ana.email]);
    expect(sent[0]!.subject).toBe("A webhook in Acme was turned off");
    expect(sent[0]!.text).toContain("Ops bot");
    expect(sent[0]!.text).toContain("https://brigade.test/");
    expect(sent[0]!.text).not.toContain("/brigade\n");
  });

  test("a slow endpoint never holds back a page in the same batch", async () => {
    const t = await team();
    await endpoint(t);
    await phone(t, "c".repeat(64));
    // Caio declares, so Ana's phone is paged; the same event goes to the endpoint, which never answers in time.
    const event = await declare(t, responder(t));
    const other = await declare(t, responder(t), "Second");
    const hook = receiver(
      (request) =>
        new Promise<Response>((resolve) => {
          const timer = setTimeout(() => resolve(new Response("late")), WEBHOOK_TIMEOUT_MS + 5000);
          request.signal.addEventListener("abort", () => clearTimeout(timer));
        }),
    );
    const result = await deliver([event, other], hook.send);
    // Both pages went out, and the batch settled within the webhooks' budget, not the receiver's pace.
    expect(hook.pushes).toEqual(["c".repeat(64), "c".repeat(64)]);
    expect(result.settledIn).toBeGreaterThanOrEqual(WEBHOOK_BUDGET_MS - 100);
    expect(result.settledIn).toBeLessThan(WEBHOOK_BUDGET_MS + 1500);
    expect(result.retryMessages).toEqual([
      { msgId: "msg-0", delaySeconds: expect.any(Number) },
      { msgId: "msg-1", delaySeconds: expect.any(Number) },
    ]);
    // The late attempt finished under waitUntil: recorded as a timeout, and the retry waits out its backoff.
    const log = await t.withShard((shard) => shard.store.scan("webhooks")[0]!.recent);
    expect(log.map((one) => one.error)).toEqual(["timeout", "timeout"]);
    // A page's retry is never pushed again: the page ledger settled it.
    await due(t);
    await deliver([event], hook.send, { attempts: 2 });
    expect(hook.pushes).toHaveLength(2);
  }, 40_000);
});
