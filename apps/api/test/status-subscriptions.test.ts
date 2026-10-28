// Email subscriptions to the public status page (RFC 0012 "Email subscriptions"): the visitor's form and links, double
// opt-in, the owners' count, export and delete, and the emails from the queue consumer (the confirmation, then each
// notification in batches with one-click unsubscribe); plus maintenance windows moved on by the shard's alarm and the
// page's uptime bars and maintenance sections.
import { env, exports } from "cloudflare:workers";
import {
  createExecutionContext,
  createMessageBatch,
  createScheduledController,
  getQueueResult,
  runDurableObjectAlarm,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { generateRecipient, toBase64url } from "@freecorps/brigade-push";
import {
  newId,
  STATUS_SNAPSHOT_VERSION,
  statusFollowKey,
  type Actor,
  type StatusSnapshot,
} from "@freecorps/brigade-schema";
import { describe, expect, test, vi } from "vite-plus/test";
import type { EmailSender, OutgoingEmail } from "../src/email.ts";
import worker from "../src/index.ts";
import { consumeEvents, type Fetch } from "../src/notify.ts";
import { SIDE_CONNECTIONS } from "../src/side-connections.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { Shard } from "../src/shard.ts";
import { renderStatusPage } from "../src/status-html.ts";
import { STATUS_CONFIRM_PAGE_DAILY_CAP, STATUS_EMAIL_BATCH } from "../src/status-mail.ts";
import { statusKey, type StatusPublisher } from "../src/status-page.ts";
import {
  canonicalEmail,
  isLargeProvider,
  normalizeEmail,
  recordSubscriber,
  signLink,
  STATUS_CONFIRM_DAILY_CAP,
  STATUS_CONFIRM_DOMAIN_DAILY_CAP,
  STATUS_CONFIRM_PAGE_DOMAIN_DAILY_CAP,
  STATUS_CONFIRM_TTL_MS,
  STATUS_PENDING_MAX,
  sweepSubscribers,
  undoRequest,
  verifyLink,
} from "../src/status-subscribers.ts";
import type { WorkspaceDO } from "../src/workspace.ts";
import { sessionCookie } from "./session.ts";

const ORIGIN = "http://api.test";
const DASHBOARD = "https://brigade.test";
const PASSWORD = "correct horse battery staple";
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

let people = 0;
let clients = 0;
let slugs = 0;
let addresses = 0;
const clientIp = () => `198.51.${Math.floor(++clients / 150) % 250}.${(clients % 150) + 101}`;
const slug = () => `subs-${Date.now().toString(36)}-${++slugs}`;
/** Each visitor on a domain of its own, so the suite's sign-ups never reach the per-domain caps. */
const visitor = () => {
  const n = ++addresses;
  return `visitor-${Date.now().toString(36)}-${n}@v${n}.example.com`;
};

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
  const email = `${name.toLowerCase()}-sub${++people}@example.com`;
  const response = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name, email, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  // Sign-up hands out no session (RFC 0002 "Auth"): signed in right after, as the clients do.
  return { id: body.user.id, cookie: await sessionCookie(email, PASSWORD) };
}

/**
 * Ana owns a workspace with a public page; Caio is a responder there. `crew` reuses an earlier team's Ana and Caio:
 * signing up hashes passwords, the slowest part of a team, so a test needing many pages signs up once.
 */
async function team(locale = "en", crew?: { ana: Person; caio: Person }) {
  const [ana, caio] = crew
    ? [crew.ana, crew.caio]
    : await Promise.all(["Ana", "Caio"].map((name) => signUp(name)));
  const created = await api("/workspaces", {
    method: "POST",
    headers: { Cookie: ana!.cookie },
    body: JSON.stringify({ name: "Acme" }),
  });
  const id = ((await created.json()) as { id: string }).id;
  await env.DB.prepare(
    `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, ?, ?)`,
  )
    .bind(newId("mem", Date.now(), random), id, caio!.id, "responder", new Date().toISOString())
    .run();
  const address = slug();
  const configured = await api(`/workspaces/${id}/status-page`, {
    method: "PUT",
    headers: { Cookie: ana!.cookie },
    body: JSON.stringify({ slug: address, title: "Acme <Cloud>", locale, enabled: true }),
  });
  expect(configured.status).toBe(200);
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
  let pushes = 0;
  const push = () =>
    runInDurableObject(stub, async (instance: WorkspaceDO) => {
      const publisher = Reflect.get(instance, "status") as StatusPublisher;
      await publisher.publish(id, Date.now() + ++pushes * 2000);
    });
  await push();
  const events = (type: string) =>
    withShard((_shard, state) =>
      state.storage.sql
        .exec<{ event: string }>("select event from outbox order by seq")
        .toArray()
        .map((row) => JSON.parse(row.event) as BrigadeEvent)
        .filter((event) => event.type === type),
    );
  const ana_: Actor = { kind: "user", id: ana!.id, role: "owner" };
  const caio_: Actor = { kind: "user", id: caio!.id, role: "responder" };
  return {
    id,
    address,
    stub,
    ana: ana!,
    caio: caio!,
    owner: ana_,
    responder: caio_,
    run,
    push,
    events,
    withShard,
  };
}

type Team = Awaited<ReturnType<typeof team>>;

type Form = Record<string, string> | [string, string][];

const subscribeRequest = (address: string, form: Form, ip = clientIp()) =>
  new Request(`${ORIGIN}/status/${address}/subscribe`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/x-www-form-urlencoded",
      "cf-connecting-ip": ip,
    },
    body: new URLSearchParams(form).toString(),
  }) as Parameters<typeof worker.fetch>[0];

/** Subscribes through the Worker, and waits for the work it does after answering (`waitUntil`). */
async function subscribe(address: string, form: Form, ip = clientIp()) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(subscribeRequest(address, form, ip), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

const rows = (workspaceId: string) =>
  env.DB.prepare(
    "select id, email, status, confirm_sends from status_subscriber where workspace_id = ? order by email",
  )
    .bind(workspaceId)
    .all<{ id: string; email: string; status: string; confirm_sends: number }>()
    .then((result) => result.results);

/** A sender that records every email. */
function recorder(fail?: (email: OutgoingEmail) => boolean) {
  const sent: OutgoingEmail[] = [];
  const sender: EmailSender = {
    id: "test",
    async send(email) {
      if (fail?.(email)) return { ok: false, retry: true, code: "E_RATE_LIMIT_EXCEEDED" };
      sent.push(email);
      return { ok: true };
    },
  };
  return { sent, sender };
}

async function deliver(events: BrigadeEvent[], mail: EmailSender) {
  const batch = createMessageBatch(
    "brigade-events",
    events.map((body, index) => ({ id: `msg-${index}`, timestamp: new Date(), attempts: 1, body })),
  );
  const ctx = createExecutionContext();
  await consumeEvents(
    batch,
    {
      WORKSPACE: env.WORKSPACE,
      DB: env.DB,
      DASHBOARD_URL: DASHBOARD,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    },
    async () => new Response("unexpected", { status: 500 }),
    mail,
    (promise) => ctx.waitUntil(promise),
  );
  return getQueueResult(batch, ctx);
}

/** Subscribes `email` and follows the confirmation email's link. */
async function confirmed(t: Team, email: string, follows: string[] = []) {
  const form: [string, string][] = [
    ["email", email],
    ...follows.map((key): [string, string] => ["follow", key]),
  ];
  expect((await subscribe(t.address, form)).status).toBe(200);
  const [requested] = (await t.events("status_subscriber.requested")).slice(-1);
  const { sent, sender } = recorder();
  await deliver([requested!], sender);
  const link = /https:\/\/brigade\.test\/status\/[^\s]+\/confirm\?t=[^\s]+/.exec(sent[0]!.text)![0];
  const path = new URL(link).pathname + new URL(link).search;
  expect((await exports.default.fetch(`${ORIGIN}${path}`, { method: "POST" })).status).toBe(200);
}

async function publish(
  t: Team,
  status = "investigating",
  incident = newId("inc", Date.now(), random),
  componentIds: string[] = [],
) {
  if (status === "investigating") {
    await t.run(
      "incident.declare",
      { id: incident, title: "db-7 OOM", severity: "sev1" },
      t.responder,
    );
  }
  expect(
    await t.run(
      "incident.publishUpdate",
      {
        id: incident,
        title: "Slow <API> responses",
        status,
        impact: "partial_outage",
        componentIds,
        body: "We're looking into it.\nMore soon.",
      },
      t.responder,
    ),
  ).toMatchObject({ ok: true });
  return incident;
}

describe("subscribing", () => {
  test("the page has the form; its CSP lets it post to its own origin only", async () => {
    const t = await team();
    const response = await exports.default.fetch(`${ORIGIN}/status/${t.address}`);
    const html = await response.text();
    expect(html).toContain(`action="/status/${t.address}/subscribe"`);
    expect(html).toContain('name="website"');
    expect(response.headers.get("Content-Security-Policy")).toContain("form-action 'self'");
  });

  test("the same answer for a new, pending, confirmed or trapped address; only pending ones get a confirmation", async () => {
    const t = await team();
    const email = visitor();
    const first = await subscribe(t.address, { email: email.toUpperCase() });
    expect(first.status).toBe(200);
    const answer = await first.text();
    expect(answer).toContain("Check your inbox");
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    expect(await rows(t.id)).toMatchObject([{ email, status: "pending", confirm_sends: 1 }]);
    const again = await subscribe(t.address, { email });
    expect(await again.text()).toBe(answer);
    const requested = await t.events("status_subscriber.requested");
    expect(requested.map((event) => (event.data as { send: number }).send)).toEqual([1, 2]);
    // The address never reaches the shard's events.
    expect(JSON.stringify(requested)).not.toContain(email);
    // A bot filling every field: the same answer, nothing stored.
    const bot = visitor();
    expect(await (await subscribe(t.address, { email: bot, website: "x" })).text()).toContain(
      "Check your inbox",
    );
    expect((await rows(t.id)).map((row) => row.email)).toEqual([email]);
    // Past three confirmations nothing more goes out, and the answer stays the same.
    await subscribe(t.address, { email });
    await subscribe(t.address, { email });
    expect(await t.events("status_subscriber.requested")).toHaveLength(3);
  });

  test("a bad address, another origin and a missing page", async () => {
    const t = await team();
    expect((await subscribe(t.address, { email: "not an address" })).status).toBe(400);
    const foreign = await exports.default.fetch(`${ORIGIN}/status/${t.address}/subscribe`, {
      method: "POST",
      headers: {
        Origin: "https://elsewhere.example.com",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `email=${encodeURIComponent(visitor())}`,
    });
    expect(foreign.status).toBe(403);
    expect((await subscribe(slug(), { email: visitor() })).status).toBe(404);
    expect((await exports.default.fetch(`${ORIGIN}/status/${t.address}/subscribe`)).status).toBe(
      405,
    );
  });

  test("rate-limited per caller address", async () => {
    const t = await team();
    const ip = "203.0.113.77";
    const statuses: number[] = [];
    for (let index = 0; index < 7; index++) {
      statuses.push((await subscribe(t.address, { email: visitor() }, ip)).status);
    }
    expect(statuses).toContain(429);
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
  });
});

describe("double opt-in", () => {
  test("the confirmation email links a signed page; a GET only shows the button; POST confirms", async () => {
    const t = await team();
    const email = visitor();
    await subscribe(t.address, { email });
    const [requested] = await t.events("status_subscriber.requested");
    const { sent, sender } = recorder();
    expect((await deliver([requested!], sender)).explicitAcks).toEqual(["msg-0"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: { email },
      subject: "Confirm your subscription to Acme <Cloud>",
    });
    expect(sent[0]!.html).toContain("Acme &lt;Cloud&gt;");
    // A redelivery sends nothing more.
    await deliver([requested!], sender);
    expect(sent).toHaveLength(1);
    const link = new URL(/https:\/\/brigade\.test\/\S+/.exec(sent[0]!.text)![0]);
    const shown = await exports.default.fetch(`${ORIGIN}${link.pathname}${link.search}`);
    expect(await shown.text()).toContain("Confirm subscription</button>");
    expect((await rows(t.id))[0]!.status).toBe("pending");
    const done = await exports.default.fetch(`${ORIGIN}${link.pathname}${link.search}`, {
      method: "POST",
    });
    expect(await done.text()).toContain("You&#39;re subscribed");
    expect((await rows(t.id))[0]!.status).toBe("confirmed");
    expect(await t.events("status_subscriber.confirmed")).toHaveLength(1);
  });

  test("links are signed, typed and expire", async () => {
    const secret = env.BETTER_AUTH_SECRET;
    const claims = {
      kind: "c" as const,
      workspaceId: `ws_${"0".repeat(26)}`,
      subscriberId: newId("ssb", Date.now(), random),
      expires: Date.now() + 1000,
    };
    const token = await signLink(secret, claims);
    expect(await verifyLink(secret, token, "c", Date.now())).toEqual(claims);
    expect(await verifyLink(secret, token, "m", Date.now())).toBeUndefined();
    expect(await verifyLink(secret, token, "c", Date.now() + 2000)).toBeUndefined();
    expect(await verifyLink("another secret", token, "c", Date.now())).toBeUndefined();
    // One signature character changed. Not the last ones: a token that already ended in what replaces them would
    // still verify, and base64url's last character carries padding bits a decoder may ignore.
    const at = token.length - 3;
    const tampered = `${token.slice(0, at)}${token[at] === "A" ? "B" : "A"}${token.slice(at + 1)}`;
    expect(await verifyLink(secret, tampered, "c", Date.now())).toBeUndefined();
    const t = await team();
    const forged = await exports.default.fetch(
      `${ORIGIN}/status/${t.address}/confirm?t=c.x.y.1.z`,
      {
        method: "POST",
      },
    );
    expect(forged.status).toBe(400);
    expect(await forged.text()).toContain("This link has expired");
  });

  // Six workspaces, each with its page and a confirmation: on a loaded runner that passes the default 5 s.
  test(`at most ${STATUS_CONFIRM_DAILY_CAP} confirmations a day to one address, from every page`, async () => {
    const email = visitor();
    const { sent, sender } = recorder();
    let crew: Team | undefined;
    for (let index = 0; index < STATUS_CONFIRM_DAILY_CAP + 1; index++) {
      const t = await team("en", crew);
      crew ??= t;
      await subscribe(t.address, { email });
      await deliver(await t.events("status_subscriber.requested"), sender);
    }
    expect(sent).toHaveLength(STATUS_CONFIRM_DAILY_CAP);
  }, 20_000);
});

describe("notifications", () => {
  test("confirmed subscribers get each published update, in batches, with one-click unsubscribe", async () => {
    const t = await team();
    const email = visitor();
    await confirmed(t, email);
    await subscribe(t.address, { email: visitor() }); // pending: never notified
    const incident = await publish(t);
    const [published] = await t.events("incident.update_published");
    const { sent, sender } = recorder();
    await deliver([published!], sender);
    expect(sent.map((one) => one.to.email)).toEqual([email]);
    const mail = sent[0]!;
    expect(mail.subject).toBe("Acme <Cloud>: Slow <API> responses");
    expect(mail.text).toContain("Status: Investigating");
    expect(mail.html).toContain("Slow &lt;API&gt; responses");
    expect(mail.html).not.toContain("db-7");
    expect(mail.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const unsubscribe = /^<(.+)>$/.exec(mail.headers!["List-Unsubscribe"]!)![1]!;
    expect(unsubscribe).toMatch(/^https:\/\/brigade\.test\/status\/.+\/unsubscribe\?t=m\./);
    expect(mail.text).toContain("/manage?t=m.");
    // A redelivery emails nobody twice.
    await deliver([published!], sender);
    expect(sent).toHaveLength(1);
    // Resolved: its own subject.
    await publish(t, "resolved", incident);
    const [, resolved] = await t.events("incident.update_published");
    await deliver([resolved!], sender);
    expect(sent[1]!.subject).toBe("Acme <Cloud> resolved: Slow <API> responses");
    // The footer's link, opened in a browser: the manage page and its button, nothing unsubscribed yet.
    const footer = /https:\/\/brigade\.test\/\S+\/unsubscribe\?t=\S+/.exec(mail.text)![0];
    const shown = await exports.default.fetch(
      `${ORIGIN}${new URL(footer).pathname}${new URL(footer).search}`,
    );
    expect(shown.status).toBe(200);
    expect(await shown.text()).toMatch(/<form method="post" action="[^"]+\/unsubscribe\?t=/);
    expect((await rows(t.id)).map((row) => row.email)).toContain(email);
    // One click from the mail client: a POST with RFC 8058's body.
    const url = new URL(unsubscribe);
    const response = await exports.default.fetch(`${ORIGIN}${url.pathname}${url.search}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("unsubscribed");
    expect((await rows(t.id)).map((row) => row.email)).not.toContain(email);
    expect(await t.events("status_subscriber.removed")).toMatchObject([
      { data: { reason: "unsubscribed" } },
    ]);
  });

  test("a long list goes out in batches, carried on through the outbox", async () => {
    const t = await team("pt-BR");
    const total = STATUS_EMAIL_BATCH + 7;
    const now = Date.now();
    await env.DB.batch(
      Array.from({ length: total }, (_, index) =>
        env.DB.prepare(
          `insert into status_subscriber (id, workspace_id, email, canonical, status, created_at, confirmed_at, requested_at, confirm_sends, confirm_since, origin)
           values (?, ?, ?, ?, 'confirmed', ?, ?, ?, 1, ?, null)`,
        ).bind(
          newId("ssb", now + index, random),
          t.id,
          `bulk-${index}-${now}@example.com`,
          `bulk-${index}-${now}@example.com`,
          now,
          now,
          now,
          now,
        ),
      ),
    );
    await publish(t);
    const [published] = await t.events("incident.update_published");
    const { sent, sender } = recorder();
    await deliver([published!], sender);
    expect(sent).toHaveLength(STATUS_EMAIL_BATCH);
    // The page's language.
    expect(sent[0]!.text).toContain("Status: Investigando");
    const [carry] = await t.events("status_email.continue");
    expect(carry).toMatchObject({ data: { eventId: published!.id } });
    await deliver([carry!], sender);
    expect(new Set(sent.map((one) => one.to.email)).size).toBe(total);
  });

  test("a failed send is retried later without emailing anyone twice", async () => {
    const t = await team();
    const [first, second] = [visitor(), visitor()];
    await confirmed(t, first);
    await confirmed(t, second);
    await publish(t);
    const [published] = await t.events("incident.update_published");
    let failing = true;
    const { sent, sender } = recorder(() => failing);
    const result = await deliver([published!], sender);
    expect(result.retryMessages).toHaveLength(1);
    expect(sent).toHaveLength(0);
    failing = false;
    // The hold ran out.
    await t.withShard((_shard, state) =>
      state.storage.sql.exec("update status_emails set claimed_until = 0"),
    );
    await deliver([published!], sender);
    expect(sent.map((one) => one.to.email).sort()).toEqual([first, second].sort());
  });
});

describe("owners and admins", () => {
  test("see a count, export CSV and delete by address; nobody else reads them", async () => {
    const t = await team();
    const email = visitor();
    await confirmed(t, email);
    await subscribe(t.address, { email: visitor() });
    const as = (person: Person, path = "", init: { method?: string; body?: string } = {}) =>
      api(`/workspaces/${t.id}/status-page/subscribers${path}`, {
        ...init,
        headers: { Cookie: person.cookie },
      });
    expect(await (await as(t.ana)).json()).toEqual({
      confirmed: 1,
      pending: 1,
      everything: 1,
      follows: {},
    });
    expect((await as(t.caio)).status).toBe(403);
    expect((await as(t.caio, "/export")).status).toBe(403);
    const csv = await (await as(t.ana, "/export")).text();
    expect(csv.split("\r\n")[0]).toBe("email,status,subscribed_at,confirmed_at,follows");
    expect(csv).toMatch(
      new RegExp(`"${email.replace(/\./g, "\\.")}",confirmed,[^\r]+,"everything"\r\n`),
    );
    expect(
      (
        await as(t.ana, "", {
          method: "DELETE",
          body: JSON.stringify({ email: email.toUpperCase() }),
        })
      ).status,
    ).toBe(200);
    expect(
      (await as(t.ana, "", { method: "DELETE", body: JSON.stringify({ email }) })).status,
    ).toBe(404);
    expect(await t.events("status_subscriber.removed")).toMatchObject([
      { actor: { id: t.ana.id }, data: { reason: "deleted" } },
    ]);
  });
});

describe("one inbox, many spellings", () => {
  test("the canonical inbox drops a +tag everywhere, and dots at Gmail", () => {
    expect(canonicalEmail("victim+1@example.com")).toBe("victim@example.com");
    expect(canonicalEmail("v.ic.tim+news@googlemail.com")).toBe("victim@gmail.com");
    expect(canonicalEmail("v.ictim@example.com")).toBe("v.ictim@example.com");
    expect(canonicalEmail("+only@example.com")).toBe("+only@example.com");
  });

  // Seven workspaces, as above.
  test("every spelling is one subscriber on a page, and one inbox's cap across pages", async () => {
    const local = `victim${Date.now().toString(36)}${++addresses}`;
    const spelling = (n: number) => `${local.slice(0, 3)}.${local.slice(3)}+${n}@googlemail.com`;
    const t = await team();
    await subscribe(t.address, { email: `${local}@gmail.com` });
    await subscribe(t.address, { email: spelling(1) });
    expect(await rows(t.id)).toMatchObject([{ email: `${local}@gmail.com`, confirm_sends: 2 }]);
    const { sent, sender } = recorder();
    for (let index = 0; index < STATUS_CONFIRM_DAILY_CAP + 1; index++) {
      const other = await team("en", t);
      await subscribe(other.address, { email: spelling(index + 2) });
      await deliver(await other.events("status_subscriber.requested"), sender);
    }
    expect(sent).toHaveLength(STATUS_CONFIRM_DAILY_CAP);
  }, 20_000);

  test(`a domain gets at most ${STATUS_CONFIRM_DOMAIN_DAILY_CAP} confirmations a day, from every page`, async () => {
    const domain = `catch-all-${Date.now().toString(36)}-${++addresses}.example.com`;
    const day = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(
      "insert into status_confirmation_domain (domain, day, count) values (?, ?, ?)",
    )
      .bind(domain, day, STATUS_CONFIRM_DOMAIN_DAILY_CAP - 1)
      .run();
    const t = await team();
    await subscribe(t.address, { email: `first@${domain}` });
    await subscribe(t.address, { email: `second@${domain}` });
    const { sent, sender } = recorder();
    await deliver(await t.events("status_subscriber.requested"), sender);
    expect(sent).toHaveLength(1);
  });

  test("an internationalized domain is one address in either spelling; a host that is no domain is refused", () => {
    expect(normalizeEmail("Ana@Bücher.example")).toBe("ana@xn--bcher-kva.example");
    expect(normalizeEmail("ana@xn--bcher-kva.example")).toBe("ana@xn--bcher-kva.example");
    expect(canonicalEmail(normalizeEmail("ana+news@bücher.example")!)).toBe(
      "ana@xn--bcher-kva.example",
    );
    for (const bad of [
      "a@x/y.example",
      "a@192.0.2.1",
      "a@example.com.",
      "a@.example",
      "a@x..example",
    ]) {
      expect(normalizeEmail(bad)).toBeUndefined();
    }
  });

  test(`one page sends one domain at most ${STATUS_CONFIRM_PAGE_DOMAIN_DAILY_CAP} confirmations a day; other pages still can`, async () => {
    const domain = `shared-${Date.now().toString(36)}-${++addresses}.example.com`;
    const day = new Date().toISOString().slice(0, 10);
    const t = await team();
    await env.DB.prepare(
      "insert into status_confirmation_page_domain (workspace_id, domain, day, count) values (?, ?, ?, ?)",
    )
      .bind(t.id, domain, day, STATUS_CONFIRM_PAGE_DOMAIN_DAILY_CAP - 1)
      .run();
    await subscribe(t.address, { email: `first@${domain}` });
    await subscribe(t.address, { email: `second@${domain}` });
    const { sent, sender } = recorder();
    await deliver(await t.events("status_subscriber.requested"), sender);
    expect(sent).toHaveLength(1);
    // That page's flood is its own: another page still reaches the domain.
    const other = await team();
    await subscribe(other.address, { email: `third@${domain}` });
    await deliver(await other.events("status_subscriber.requested"), sender);
    expect(sent.map((one) => one.to.email)).toEqual([`first@${domain}`, `third@${domain}`]);
  });

  test("the instance-wide domain cap is for domains that are not a large provider's", () => {
    expect(isLargeProvider("gmail.com")).toBe(true);
    expect(isLargeProvider("gmx.de")).toBe(true);
    expect(isLargeProvider("example.com")).toBe(false);
    expect(isLargeProvider("gmx.example.com")).toBe(false);
  });

  test("an inbox confirmed on another page skips the domain caps", async () => {
    const domain = `known-${Date.now().toString(36)}-${++addresses}.example.com`;
    const email = `owner@${domain}`;
    await confirmed(await team(), email);
    const day = new Date().toISOString().slice(0, 10);
    const t = await team();
    await env.DB.batch([
      env.DB.prepare(
        "insert into status_confirmation_page_domain (workspace_id, domain, day, count) values (?, ?, ?, ?)",
      ).bind(t.id, domain, day, STATUS_CONFIRM_PAGE_DOMAIN_DAILY_CAP),
      env.DB.prepare(
        `insert into status_confirmation_domain (domain, day, count) values (?, ?, ?)
         on conflict (domain, day) do update set count = excluded.count`,
      ).bind(domain, day, STATUS_CONFIRM_DOMAIN_DAILY_CAP),
    ]);
    await subscribe(t.address, { email: `stranger@${domain}` });
    await subscribe(t.address, { email });
    const { sent, sender } = recorder();
    await deliver(await t.events("status_subscriber.requested"), sender);
    expect(sent.map((one) => one.to.email)).toEqual([email]);
  });

  test("a confirmation retried after a refused send counts against the inbox cap once", async () => {
    const t = await team();
    const email = visitor();
    await subscribe(t.address, { email });
    const [requested] = await t.events("status_subscriber.requested");
    let failing = true;
    const { sent, sender } = recorder(() => failing);
    expect((await deliver([requested!], sender)).retryMessages).toHaveLength(1);
    failing = false;
    await t.withShard((_shard, state) =>
      state.storage.sql.exec("update status_emails set claimed_until = 0"),
    );
    await deliver([requested!], sender);
    expect(sent).toHaveLength(1);
    const count = await env.DB.prepare("select count from status_confirmation_send where email = ?")
      .bind(canonicalEmail(email))
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  test(`a page sends at most ${STATUS_CONFIRM_PAGE_DAILY_CAP} confirmations a day, apart from its notifications`, async () => {
    const t = await team();
    const day = new Date().toISOString().slice(0, 10);
    await t.withShard((_shard, state) =>
      state.storage.sql.exec(
        "insert into status_confirm_days (day, sent) values (?, ?)",
        day,
        STATUS_CONFIRM_PAGE_DAILY_CAP - 1,
      ),
    );
    await subscribe(t.address, { email: visitor() });
    await subscribe(t.address, { email: visitor() });
    const { sent, sender } = recorder();
    await deliver(await t.events("status_subscriber.requested"), sender);
    expect(sent).toHaveLength(1);
    // Confirmations never spend the page's notification budget.
    const spent = await t.withShard((_shard, state) =>
      state.storage.sql.exec("select * from status_email_days").toArray(),
    );
    expect(spent).toEqual([]);
  });
});

describe("the answer to a subscribe", () => {
  test("comes before D1 or the shard is touched, the same for every address", async () => {
    const t = await team();
    const known = visitor();
    await confirmed(t, known);
    const answers: string[] = [];
    for (const email of [visitor(), known]) {
      const ctx = createExecutionContext();
      const work: Promise<unknown>[] = [];
      let settled = false;
      const waitUntil = ctx.waitUntil.bind(ctx);
      ctx.waitUntil = (promise) => {
        work.push(promise.finally(() => (settled = true)));
        waitUntil(promise);
      };
      const response = await worker.fetch(subscribeRequest(t.address, { email }), env, ctx);
      expect(response.status).toBe(200);
      // The D1 writes and the shard's event run after the answer.
      expect(work).toHaveLength(1);
      expect(settled).toBe(false);
      answers.push((await response.text()).replace(email, "ADDRESS"));
      await waitOnExecutionContext(ctx);
    }
    expect(answers[0]).toBe(answers[1]);
    expect(await rows(t.id)).toHaveLength(2);
  });
});

describe("links outlive the page's address", () => {
  async function notified(t: Team) {
    const email = visitor();
    await confirmed(t, email);
    await publish(t);
    const [published] = await t.events("incident.update_published");
    const { sent, sender } = recorder();
    await deliver([published!], sender);
    const mail = sent[0]!;
    return {
      email,
      unsubscribe: new URL(/^<(.+)>$/.exec(mail.headers!["List-Unsubscribe"]!)![1]!),
      manage: new URL(/https:\/\/brigade\.test\/\S+\/manage\?t=\S+/.exec(mail.text)![0]),
    };
  }

  const oneClick = (url: URL) =>
    exports.default.fetch(`${ORIGIN}${url.pathname}${url.search}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });

  const configure = (t: Team, settings: { slug: string; enabled: boolean }) =>
    api(`/workspaces/${t.id}/status-page`, {
      method: "PUT",
      headers: { Cookie: t.ana.cookie },
      body: JSON.stringify({ title: "Acme <Cloud>", locale: "en", ...settings }),
    });

  test("after the page moved, the old links manage and unsubscribe", async () => {
    const t = await team();
    const { unsubscribe, manage } = await notified(t);
    expect((await configure(t, { slug: slug(), enabled: true })).status).toBe(200);
    await t.push();
    const shown = await exports.default.fetch(`${ORIGIN}${manage.pathname}${manage.search}`);
    expect(shown.status).toBe(200);
    expect(await shown.text()).toMatch(/•••@v\d+\.example\.com/);
    const response = await oneClick(unsubscribe);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("unsubscribed");
    expect(await rows(t.id)).toEqual([]);
    expect(await t.events("status_subscriber.removed")).toHaveLength(1);
  });

  test("once the page is no longer public, unsubscribing still works", async () => {
    const t = await team();
    const { unsubscribe, manage } = await notified(t);
    expect((await configure(t, { slug: t.address, enabled: false })).status).toBe(200);
    await t.push();
    expect(
      (await exports.default.fetch(`${ORIGIN}${manage.pathname}${manage.search}`)).status,
    ).toBe(200);
    expect((await oneClick(unsubscribe)).status).toBe(200);
    expect(await rows(t.id)).toEqual([]);
  });

  test("asking again after a failure finishes it, with one event", async () => {
    const t = await team();
    const { unsubscribe } = await notified(t);
    const [row] = await rows(t.id);
    // A first try whose shard call landed and whose D1 delete did not.
    await t.stub.statusSubscription(t.id, {
      action: "remove",
      subscriberId: row!.id,
      reason: "unsubscribed",
    });
    expect(await rows(t.id)).toHaveLength(1);
    expect((await oneClick(unsubscribe)).status).toBe(200);
    expect(await rows(t.id)).toEqual([]);
    expect(await t.events("status_subscriber.removed")).toHaveLength(1);
  });
});

describe("pending subscribers", () => {
  test("expire with their link: swept with an event each; confirmed ones stay", async () => {
    const t = await team();
    const kept = visitor();
    await confirmed(t, kept);
    await subscribe(t.address, { email: visitor() });
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    const stale = `stale-${Date.now().toString(36)}@example.com`;
    await env.DB.prepare(
      "insert into status_confirmation_send (email, day, count) values (?, ?, 1)",
    )
      .bind(stale, old)
      .run();
    // Not yet: the link still works.
    await sweepSubscribers(env, Date.now() + STATUS_CONFIRM_TTL_MS - 60_000);
    expect(await rows(t.id)).toHaveLength(2);
    await sweepSubscribers(env, Date.now() + STATUS_CONFIRM_TTL_MS + 1000);
    expect((await rows(t.id)).map((row) => row.email)).toEqual([kept]);
    expect(await t.events("status_subscriber.removed")).toMatchObject([
      { data: { reason: "expired" } },
    ]);
    const counts = await env.DB.prepare("select 1 from status_confirmation_send where email = ?")
      .bind(stale)
      .all();
    expect(counts.results).toEqual([]);
  });

  test("the cron sweeps them once an hour", async () => {
    const t = await team();
    const id = newId("ssb", Date.now(), random);
    const long = Date.now() - STATUS_CONFIRM_TTL_MS - 60_000;
    const email = visitor();
    await env.DB.prepare(
      `insert into status_subscriber (id, workspace_id, email, canonical, status, created_at, confirmed_at, requested_at, confirm_sends, confirm_since, origin)
       values (?, ?, ?, ?, 'pending', ?, null, ?, 1, ?, null)`,
    )
      .bind(id, t.id, email, email, long, long, long)
      .run();
    const ctx = createExecutionContext();
    const at = new Date();
    at.setUTCMinutes(37);
    await worker.scheduled(
      createScheduledController({ scheduledTime: at, cron: "* * * * *" }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(await rows(t.id)).toEqual([]);
  });

  test("two requests at once whose shard calls both failed leave no row, in either order", async () => {
    const t = await team();
    for (const order of [
      [0, 1],
      [1, 0],
    ]) {
      const email = visitor();
      const now = Date.now();
      const asked = [
        await recordSubscriber(env.DB, t.id, email, ORIGIN, now),
        await recordSubscriber(env.DB, t.id, email, ORIGIN, now + 1),
      ];
      expect(asked.map((one) => one?.send)).toEqual([1, 2]);
      for (const index of order) await undoRequest(env.DB, asked[index]!);
      expect((await rows(t.id)).map((row) => row.email)).not.toContain(email);
    }
    // One failed beside one that went through: the row stays, its confirmation on the way.
    const email = visitor();
    const first = await recordSubscriber(env.DB, t.id, email, ORIGIN, Date.now());
    await recordSubscriber(env.DB, t.id, email, ORIGIN, Date.now());
    await undoRequest(env.DB, first!);
    expect((await rows(t.id)).filter((row) => row.email === email)).toMatchObject([
      { status: "pending", confirm_sends: 1 },
    ]);
  });

  test("the sweep keeps a row asked for again while it ran", async () => {
    const t = await team();
    const id = newId("ssb", Date.now(), random);
    const long = Date.now() - STATUS_CONFIRM_TTL_MS - 60_000;
    const email = visitor();
    await env.DB.prepare(
      `insert into status_subscriber (id, workspace_id, email, canonical, status, created_at, confirmed_at, requested_at, confirm_sends, confirm_since, origin)
       values (?, ?, ?, ?, 'pending', ?, null, ?, 1, ?, null)`,
    )
      .bind(id, t.id, email, email, long, long, long)
      .run();
    // Between the sweep's read and its delete, the row is asked for again.
    const racing = {
      ...env,
      WORKSPACE: {
        getByName: (name: string) => ({
          expireStatusSubscribers: async (workspaceId: string, ids: string[]) => {
            await env.DB.prepare("update status_subscriber set requested_at = ? where id = ?")
              .bind(long + 1, id)
              .run();
            return env.WORKSPACE.getByName(name).expireStatusSubscribers(workspaceId, ids);
          },
        }),
      },
    } as unknown as Env;
    await sweepSubscribers(racing, Date.now());
    expect((await rows(t.id)).map((row) => row.id)).toEqual([id]);
  });

  test(`at most ${STATUS_PENDING_MAX} pending on a page, counted apart from the confirmed`, async () => {
    const t = await team();
    const now = Date.now();
    await env.DB.batch(
      Array.from({ length: STATUS_PENDING_MAX }, (_, index) => {
        const email = `pending-${index}-${now}@example.com`;
        return env.DB.prepare(
          `insert into status_subscriber (id, workspace_id, email, canonical, status, created_at, confirmed_at, requested_at, confirm_sends, confirm_since, origin)
           values (?, ?, ?, ?, 'pending', ?, null, ?, 1, ?, null)`,
        ).bind(newId("ssb", now + index, random), t.id, email, email, now, now, now);
      }),
    );
    await subscribe(t.address, { email: visitor() });
    expect(await rows(t.id)).toHaveLength(STATUS_PENDING_MAX);
  });
});

describe("paging comes first", () => {
  test("a flood of confirmations in one batch never holds a page's relay call", async () => {
    const t = await team();
    const internal = (name: string, args: unknown, actor: Actor) =>
      t.withShard((shard) =>
        shard.mutate({
          clientId: "test",
          mutationId: newId("mut", Date.now(), random),
          actor,
          name,
          args,
          now: Date.now(),
          internal: true,
        }),
      );
    // Ana's phone, which a sev1 pages.
    await internal("member.sync", { id: t.ana.id, name: "Ana", role: "owner" }, t.owner);
    const recipient = await generateRecipient();
    await t.run(
      "device.register",
      {
        id: newId("dev", Date.now(), random),
        platform: "ios",
        environment: "production",
        pushToken: "e".repeat(64),
        voipToken: null,
        publicKey: toBase64url(recipient.publicKey),
      },
      t.owner,
    );
    // Twenty sign-ups waiting for their confirmation.
    const now = Date.now();
    const ids = Array.from({ length: 20 }, (_, index) => newId("ssb", now + index, random));
    await env.DB.batch(
      ids.map((id, index) => {
        const email = `flood-${index}@f${index}-${now}.example.com`;
        return env.DB.prepare(
          `insert into status_subscriber (id, workspace_id, email, canonical, status, created_at, confirmed_at, requested_at, confirm_sends, confirm_since, origin)
           values (?, ?, ?, ?, 'pending', ?, null, ?, 1, ?, null)`,
        ).bind(id, t.id, email, email, now, now, now);
      }),
    );
    for (const subscriberId of ids) {
      await internal("statusSubscriber.request", { subscriberId, send: 1 }, t.owner);
    }
    await t.run(
      "incident.declare",
      { id: newId("inc", Date.now(), random), title: "Checkout down", severity: "sev1" },
      t.responder,
    );
    const [declared] = await t.events("incident.declared");
    const requested = await t.events("status_subscriber.requested");
    // The Worker's limit, modelled for the relay and the email sends together: six at once, a seventh waits.
    const CAP = 6;
    let open = 0;
    let mailOpen = 0;
    let mailPeak = 0;
    const waiting: (() => void)[] = [];
    const take = async () => {
      if (open >= CAP) await new Promise<void>((resolve) => waiting.push(resolve));
      open++;
    };
    const free = () => {
      open--;
      waiting.shift()?.();
    };
    const started = Date.now();
    let relayAt: number | undefined;
    const send: Fetch = async (request) => {
      await take();
      try {
        relayAt ??= Date.now() - started;
        await request.body?.cancel();
        return Response.json({ status: 200 });
      } finally {
        free();
      }
    };
    let mailed = 0;
    const mailedTo = new Set<string>();
    const mail: EmailSender = {
      id: "test",
      async send(email) {
        await take();
        mailPeak = Math.max(mailPeak, ++mailOpen);
        try {
          // 1.2 s: waves start at 0, 1.2 and 2.4 s, none on the 3 s budget's edge (`STATUS_EMAIL_BUDGET_MS`).
          await new Promise((resolve) => setTimeout(resolve, 1200));
          mailed++;
          mailedTo.add(email.to.email);
          return { ok: true };
        } finally {
          mailOpen--;
          free();
        }
      },
    };
    const batch = createMessageBatch(
      "brigade-events",
      [...requested, declared!].map((body, index) => ({
        id: `msg-${index}`,
        timestamp: new Date(),
        attempts: 1,
        body,
      })),
    );
    const ctx = createExecutionContext();
    await consumeEvents(
      batch,
      {
        WORKSPACE: env.WORKSPACE,
        DB: env.DB,
        RELAY_URL: "https://relay.test",
        RELAY_SEND_TOKEN: "test-token",
        DASHBOARD_URL: DASHBOARD,
        BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
      },
      send,
      mail,
      (promise) => ctx.waitUntil(promise),
    );
    const result = await getQueueResult(batch, ctx);
    // The relay was asked at once, not after the emails.
    expect(relayAt).toBeDefined();
    expect(relayAt!).toBeLessThan(1000);
    expect(mailPeak).toBeLessThanOrEqual(SIDE_CONNECTIONS);
    expect(result.explicitAcks).toContain(`msg-${requested.length}`);
    // The confirmations that found no slot in time come back later, none lost. A send still under way when its
    // delivery let go (`STATUS_EMAIL_BUDGET_MS` plus one send's bound) finishes under `waitUntil` and is counted in
    // `mailed`, yet its message is retried too (the retry finds it sent): so every message is acked or retried, an
    // acked one was mailed, and at least the unmailed ones come back.
    expect(mailed).toBeLessThan(requested.length);
    const confirmations = requested.map((_, index) => `msg-${index}`);
    const acked = confirmations.filter((id) => result.explicitAcks.includes(id));
    const retried = confirmations.filter((id) =>
      result.retryMessages.some((retry) => retry.msgId === id),
    );
    expect(acked.length + retried.length).toBe(requested.length);
    expect(acked.length).toBeLessThanOrEqual(mailed);
    expect(retried.length).toBeGreaterThanOrEqual(requested.length - mailed);
    // Each acked confirmation went to its own subscriber (a retried one may have gone too: at least once).
    const emailOf = async (subscriberId: string) =>
      (
        await env.DB.prepare("select email from status_subscriber where id = ?")
          .bind(subscriberId)
          .first<{ email: string }>()
      )?.email;
    for (const id of acked) {
      const event = requested[Number(id.slice("msg-".length))]!;
      const { subscriberId } = event.data as { subscriberId: string };
      expect(mailedTo).toContain(await emailOf(subscriberId));
    }
  }, 30_000);
});

describe("maintenance", () => {
  test("the alarm starts and ends a window, the page shows it, subscribers hear of each step", async () => {
    const t = await team();
    const email = visitor();
    await confirmed(t, email);
    const component = newId("cmp", Date.now(), random);
    await t.run("statusComponent.create", { id: component, name: "API", group: null }, t.owner);
    const id = newId("mnt", Date.now(), random);
    const now = Date.now();
    expect(
      await t.run(
        "maintenance.schedule",
        {
          id,
          title: "Database upgrade",
          body: "Read-only for a minute.",
          componentIds: [component],
          startsAt: now + 200,
          endsAt: now + 1500,
        },
        t.responder,
      ),
    ).toMatchObject({ ok: true });
    // Run the shard's alarm until the window has started: the runtime may run the same alarm first, or meanwhile.
    await vi.waitFor(
      async () => {
        await runDurableObjectAlarm(t.stub);
        expect(await t.events("maintenance.started")).toHaveLength(1);
      },
      { timeout: 5000, interval: 100 },
    );
    // The alarm's own push waits on KV's spacing after the test's pushes (which run ahead of the clock): push now.
    await t.push();
    const page = await env.STATUS!.get<StatusSnapshot>(statusKey(t.address), "json");
    expect(page?.maintenance).toMatchObject([{ title: "Database upgrade", components: ["API"] }]);
    expect(page?.groups[0]?.components[0]?.status).toBe("maintenance");
    await vi.waitFor(
      async () => {
        await runDurableObjectAlarm(t.stub);
        expect(await t.events("maintenance.ended")).toHaveLength(1);
      },
      { timeout: 5000, interval: 100 },
    );
    const { sent, sender } = recorder();
    await deliver(
      [
        ...(await t.events("maintenance.scheduled")),
        ...(await t.events("maintenance.started")),
        ...(await t.events("maintenance.ended")),
      ],
      sender,
    );
    expect(sent.map((one) => one.subject).sort()).toEqual([
      "Acme <Cloud> maintenance completed: Database upgrade",
      "Acme <Cloud> maintenance started: Database upgrade",
      "Acme <Cloud> scheduled maintenance: Database upgrade",
    ]);
  });
});

describe("following components", () => {
  /** A page with Core (API, Web), Money (Billing) and an ungrouped Docs, pushed so the form offers them. */
  async function components(t: Team) {
    const id = () => newId("cmp", Date.now(), random);
    const made = { api: id(), web: id(), billing: id(), docs: id() };
    for (const [name, componentId, group] of [
      ["API", made.api, "Core"],
      ["Web", made.web, "Core"],
      ["Billing", made.billing, "Money"],
      ["Docs", made.docs, null],
    ] as const) {
      expect(
        await t.run("statusComponent.create", { id: componentId, name, group }, t.owner),
      ).toMatchObject({ ok: true });
    }
    await t.push();
    return made;
  }

  const recipients = async (t: Team, componentIds: string[]) => {
    await publish(t, "investigating", undefined, componentIds);
    const [published] = (await t.events("incident.update_published")).slice(-1);
    const { sent, sender } = recorder();
    await deliver([published!], sender);
    return sent.map((one) => one.to.email).sort();
  };

  const follows = (workspaceId: string) =>
    env.DB.prepare(
      "select email, follows from status_subscriber where workspace_id = ? order by email",
    )
      .bind(workspaceId)
      .all<{ email: string; follows: string | null }>()
      .then((result) => Object.fromEntries(result.results.map((row) => [row.email, row.follows])));

  test("the form offers each component and group as a checkbox, by a key that is not its id", async () => {
    const t = await team();
    const made = await components(t);
    const html = await (await exports.default.fetch(`${ORIGIN}/status/${t.address}`)).text();
    for (const id of Object.values(made)) {
      expect(html).toContain(`value="${statusFollowKey("c", id)}"`);
      expect(html).not.toContain(id);
    }
    expect(html).toContain(`value="${statusFollowKey("g", "Core")}"`);
    expect(html).toContain("The whole group, including components added later");
    expect(html).toMatch(/<details class="follow"><summary>/);
  });

  test("only incidents on a followed component or group, or on none, reach those who chose", async () => {
    const t = await team();
    const made = await components(t);
    const [all, api, core, docs] = [visitor(), visitor(), visitor(), visitor()];
    await confirmed(t, all);
    await confirmed(t, api, [statusFollowKey("c", made.api)]);
    await confirmed(t, core, [statusFollowKey("g", "Core")]);
    await confirmed(t, docs, [statusFollowKey("c", made.docs), "c-0000000000000000", "nonsense"]);
    // A forged or unknown key is never stored; nothing ticked is everything.
    expect(await follows(t.id)).toEqual({
      [all]: null,
      [api]: JSON.stringify([statusFollowKey("c", made.api)]),
      [core]: JSON.stringify([statusFollowKey("g", "Core")]),
      [docs]: JSON.stringify([statusFollowKey("c", made.docs)]),
    });
    expect(await recipients(t, [made.web])).toEqual([all, core].sort());
    expect(await recipients(t, [made.api, made.docs])).toEqual([all, api, core, docs].sort());
    expect(await recipients(t, [made.billing])).toEqual([all]);
    // Nothing named: everyone.
    expect(await recipients(t, [])).toEqual([all, api, core, docs].sort());
  });

  test("a subscriber whose components are all deleted hears of everything again", async () => {
    const t = await team();
    const made = await components(t);
    const [api, core] = [visitor(), visitor()];
    await confirmed(t, api, [statusFollowKey("c", made.api)]);
    await confirmed(t, core, [statusFollowKey("g", "Core")]);
    expect(await recipients(t, [made.billing])).toEqual([]);
    expect(await t.run("statusComponent.delete", { id: made.api }, t.owner)).toMatchObject({
      ok: true,
    });
    // `core` still has Web in Core; `api` follows nothing on the page any more.
    expect(await recipients(t, [made.billing])).toEqual([api]);
    expect(await recipients(t, [made.web])).toEqual([api, core].sort());
  });

  test("an unreadable choice hears of everything and holds back nobody else", async () => {
    const t = await team();
    const made = await components(t);
    const [onApi, broken] = [visitor(), visitor()];
    await confirmed(t, onApi, [statusFollowKey("c", made.api)]);
    await confirmed(t, broken, [statusFollowKey("c", made.docs)]);
    await env.DB.prepare("update status_subscriber set follows = ? where email = ?")
      .bind("{not json", broken)
      .run();
    expect(await recipients(t, [made.api])).toEqual([onApi, broken].sort());
    const counts = await api(`/workspaces/${t.id}/status-page/subscribers`, {
      headers: { Cookie: t.ana.cookie },
    });
    expect(await counts.json()).toMatchObject({
      confirmed: 2,
      everything: 1,
      follows: { [statusFollowKey("c", made.api)]: 1 },
    });
  });

  test("maintenance follows the same rule", async () => {
    const t = await team();
    const made = await components(t);
    const [all, docs] = [visitor(), visitor()];
    await confirmed(t, all);
    await confirmed(t, docs, [statusFollowKey("c", made.docs)]);
    const now = Date.now();
    expect(
      await t.run(
        "maintenance.schedule",
        {
          id: newId("mnt", now, random),
          title: "Billing upgrade",
          body: "Invoices wait a minute.",
          componentIds: [made.billing],
          startsAt: now + 3_600_000,
          endsAt: now + 7_200_000,
        },
        t.responder,
      ),
    ).toMatchObject({ ok: true });
    const [scheduled] = await t.events("maintenance.scheduled");
    const { sent, sender } = recorder();
    await deliver([scheduled!], sender);
    expect(sent.map((one) => one.to.email)).toEqual([all]);
  });

  test("the manage link changes what a subscriber follows, or goes back to everything", async () => {
    const t = await team();
    const made = await components(t);
    const email = visitor();
    await confirmed(t, email);
    await publish(t);
    const [published] = await t.events("incident.update_published");
    const { sent, sender } = recorder();
    await deliver([published!], sender);
    const manage = new URL(/https:\/\/brigade\.test\/\S+\/manage\?t=\S+/.exec(sent[0]!.text)![0]);
    const path = `${ORIGIN}${manage.pathname}${manage.search}`;
    const shown = await (await exports.default.fetch(path)).text();
    expect(shown).toContain("You hear about every incident and maintenance.");
    expect(shown).toContain(`value="${statusFollowKey("c", made.web)}"`);
    expect(shown).not.toContain(" checked");
    const post = (form: [string, string][]) =>
      exports.default.fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form).toString(),
      });
    const saved = await post([
      ["follow", statusFollowKey("c", made.web)],
      ["follow", statusFollowKey("g", "Money")],
      ["scope", "some"],
    ]);
    expect(saved.status).toBe(200);
    const html = await saved.text();
    expect(html).toContain("Saved.");
    expect(html).toContain("You hear about incidents and maintenance on Web and Money");
    expect(html).toContain(`value="${statusFollowKey("c", made.web)}" checked`);
    expect(await follows(t.id)).toEqual({
      [email]: JSON.stringify([statusFollowKey("c", made.web), statusFollowKey("g", "Money")]),
    });
    expect(await recipients(t, [made.docs])).toEqual([]);
    expect(await recipients(t, [made.billing])).toEqual([email]);
    // Follow everything again.
    await post([
      ["follow", statusFollowKey("c", made.web)],
      ["scope", "all"],
    ]);
    expect(await follows(t.id)).toEqual({ [email]: null });
    expect(await t.events("status_subscriber.followed")).toMatchObject([
      { data: { follows: 2 } },
      { data: { follows: 0 } },
    ]);
    // The address never reaches the shard's events.
    expect(JSON.stringify(await t.events("status_subscriber.followed"))).not.toContain(email);
  });

  test("the public form never changes a confirmed subscriber's choice; a pending one's goes with its new link", async () => {
    const t = await team();
    const made = await components(t);
    const [done, waiting] = [visitor(), visitor()];
    await confirmed(t, done, [statusFollowKey("c", made.api)]);
    await subscribe(t.address, { email: waiting });
    const again = (email: string) =>
      subscribe(t.address, [
        ["email", email],
        ["follow", statusFollowKey("c", made.docs)],
      ]);
    const first = await (await again(done)).text();
    expect(await (await again(waiting)).text()).toBe(first.replace(done, waiting));
    expect(await follows(t.id)).toEqual({
      [done]: JSON.stringify([statusFollowKey("c", made.api)]),
      [waiting]: JSON.stringify([statusFollowKey("c", made.docs)]),
    });
  });

  test("owners and admins see who follows what; the CSV says it by name", async () => {
    const t = await team();
    const made = await components(t);
    const [all, core] = [visitor(), visitor()];
    await confirmed(t, all);
    await confirmed(t, core, [statusFollowKey("g", "Core"), statusFollowKey("c", made.docs)]);
    const as = (path = "") =>
      api(`/workspaces/${t.id}/status-page/subscribers${path}`, {
        headers: { Cookie: t.ana.cookie },
      });
    expect(await (await as()).json()).toEqual({
      confirmed: 2,
      pending: 0,
      everything: 1,
      follows: { [statusFollowKey("g", "Core")]: 1, [statusFollowKey("c", made.docs)]: 1 },
    });
    const csv = await (await as("/export")).text();
    expect(csv).toContain(`,"everything"\r\n`);
    expect(csv).toContain(`,"group: Core; Docs"\r\n`);
  });

  test("a full page's choice fits in the form", async () => {
    const t = await team();
    const keys: string[] = [];
    for (let index = 0; index < 50; index++) {
      const id = newId("cmp", Date.now(), random);
      const group = `Região de disponibilidade ${index % 25} com um nome bem comprido`;
      await t.run("statusComponent.create", { id, name: `Componente ${index}`, group }, t.owner);
      keys.push(statusFollowKey("c", id), statusFollowKey("g", group));
    }
    await t.push();
    const email = visitor();
    const response = await subscribe(t.address, [
      ["email", email],
      ...keys.map((key): [string, string] => ["follow", key]),
    ]);
    expect(response.status).toBe(200);
    expect(JSON.parse((await follows(t.id))[email]!)).toHaveLength(75);
  });
});

describe("the page", () => {
  const base: StatusSnapshot = {
    v: STATUS_SNAPSHOT_VERSION,
    title: "Acme",
    locale: "en",
    generatedAt: Date.UTC(2026, 9, 27, 12),
    status: "operational",
    groups: [
      {
        name: null,
        components: [
          {
            name: "API",
            status: "maintenance",
            uptime: {
              percent: 99.5,
              days: [
                { date: "2026-10-25", state: "none", down: 0 },
                { date: "2026-10-26", state: "down", down: 90 },
                { date: "2026-10-27", state: "up", down: 0 },
              ],
            },
          },
        ],
      },
    ],
    active: [],
    history: [],
    maintenance: [
      {
        title: "Database <upgrade>",
        body: "Read-only.",
        components: ["API"],
        startsAt: Date.UTC(2026, 9, 27, 11),
        endsAt: Date.UTC(2026, 9, 27, 13),
      },
    ],
    upcoming: [],
  };

  test("uptime bars have one text alternative; maintenance says so in the banner", () => {
    const html = renderStatusPage(base, { slug: "acme", subscribe: false });
    expect(html).toContain(
      'role="img" aria-label="API: 99.5% uptime in the last 90 days. Oct 26, 2026: down for 90 min"',
    );
    expect(html).toContain("Scheduled maintenance in progress");
    expect(html).toContain("Database &lt;upgrade&gt;");
    expect(html).toContain("Under maintenance");
    expect(html).not.toContain("<form");
  });

  test("a named group is a card that folds with its count; each day rises in turn and names itself", () => {
    const html = renderStatusPage(
      { ...base, groups: [{ ...base.groups[0]!, name: "Payments <EU>" }] },
      { slug: "acme" },
    );
    expect(html).toContain(
      '<details class="group" open><summary><span class="name">Payments &lt;EU&gt;</span><span class="count">1 component</span></summary>',
    );
    expect(html).toContain(
      '<span class="u-down" style="--i:1" data-tip="Oct 26, 2026: down for 90 min"></span>',
    );
    // The scale says 30 days on a phone, where only those show.
    expect(html).toContain('<span class="short">30 days ago</span>');
    expect(html).toContain('<span class="pct">99.5% uptime</span>');
  });

  test("pt-BR", () => {
    const html = renderStatusPage({ ...base, locale: "pt-BR" }, { slug: "acme", subscribe: true });
    expect(html).toContain("de disponibilidade nos últimos 90 dias");
    expect(html).toContain("Manutenção em andamento");
    expect(html).toContain("Receba atualizações por email");
  });
});
