// Email subscriptions to the public status page (RFC 0012 "Email subscriptions"): the visitor's form and links, double
// opt-in, the owners' count, export and delete, and the emails from the queue consumer (the confirmation, then each
// notification in batches with one-click unsubscribe); plus maintenance windows moved on by the shard's alarm and the
// page's uptime bars and maintenance sections.
import { env, exports } from "cloudflare:workers";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import {
  newId,
  STATUS_SNAPSHOT_VERSION,
  type Actor,
  type StatusSnapshot,
} from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import type { EmailSender, OutgoingEmail } from "../src/email.ts";
import { consumeEvents } from "../src/notify.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { Shard } from "../src/shard.ts";
import { renderStatusPage } from "../src/status-html.ts";
import { STATUS_EMAIL_BATCH } from "../src/status-mail.ts";
import { statusKey, type StatusPublisher } from "../src/status-page.ts";
import { signLink, STATUS_CONFIRM_DAILY_CAP, verifyLink } from "../src/status-subscribers.ts";
import type { WorkspaceDO } from "../src/workspace.ts";

const ORIGIN = "http://api.test";
const DASHBOARD = "https://brigade.test";
const PASSWORD = "correct horse battery staple";
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

let people = 0;
let clients = 0;
let slugs = 0;
let addresses = 0;
const clientIp = () => `198.51.${Math.floor(++clients / 250) % 250}.${(clients % 250) + 101}`;
const slug = () => `subs-${Date.now().toString(36)}-${++slugs}`;
const visitor = () => `visitor-${Date.now().toString(36)}-${++addresses}@example.com`;

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
      email: `${name.toLowerCase()}-sub${++people}@example.com`,
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

/** Ana owns a workspace with a public page; Caio is a responder there. */
async function team(locale = "en") {
  const [ana, caio] = await Promise.all(["Ana", "Caio"].map((name) => signUp(name)));
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

const subscribe = (address: string, form: Record<string, string>, ip = clientIp()) =>
  exports.default.fetch(`${ORIGIN}/status/${address}/subscribe`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/x-www-form-urlencoded",
      "cf-connecting-ip": ip,
    },
    body: new URLSearchParams(form).toString(),
  });

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
async function confirmed(t: Team, email: string) {
  expect((await subscribe(t.address, { email })).status).toBe(200);
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
        componentIds: [],
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
    expect(await verifyLink(secret, `${token.slice(0, -2)}AA`, "c", Date.now())).toBeUndefined();
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

  test(`at most ${STATUS_CONFIRM_DAILY_CAP} confirmations a day to one address, from every page`, async () => {
    const email = visitor();
    const { sent, sender } = recorder();
    for (let index = 0; index < STATUS_CONFIRM_DAILY_CAP + 1; index++) {
      const t = await team();
      await subscribe(t.address, { email });
      await deliver(await t.events("status_subscriber.requested"), sender);
    }
    expect(sent).toHaveLength(STATUS_CONFIRM_DAILY_CAP);
  });
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
          `insert into status_subscriber (id, workspace_id, email, status, created_at, confirmed_at, confirm_sends, confirm_since, origin)
           values (?, ?, ?, 'confirmed', ?, ?, 1, ?, null)`,
        ).bind(
          newId("ssb", now + index, random),
          t.id,
          `bulk-${index}-${now}@example.com`,
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
    expect(await (await as(t.ana)).json()).toEqual({ confirmed: 1, pending: 1 });
    expect((await as(t.caio)).status).toBe(403);
    expect((await as(t.caio, "/export")).status).toBe(403);
    const csv = await (await as(t.ana, "/export")).text();
    expect(csv.split("\r\n")[0]).toBe("email,status,subscribed_at,confirmed_at");
    expect(csv).toContain(`"${email}",confirmed,`);
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
          endsAt: now + 400,
        },
        t.responder,
      ),
    ).toMatchObject({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await runDurableObjectAlarm(t.stub);
    expect(await t.events("maintenance.started")).toHaveLength(1);
    // The alarm's own push waits on KV's spacing after the test's pushes (which run ahead of the clock): push now.
    await t.push();
    const page = await env.STATUS!.get<StatusSnapshot>(statusKey(t.address), "json");
    expect(page?.maintenance).toMatchObject([{ title: "Database upgrade", components: ["API"] }]);
    expect(page?.groups[0]?.components[0]?.status).toBe("maintenance");
    await new Promise((resolve) => setTimeout(resolve, 200));
    await runDurableObjectAlarm(t.stub);
    expect(await t.events("maintenance.ended")).toHaveLength(1);
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

  test("pt-BR", () => {
    const html = renderStatusPage({ ...base, locale: "pt-BR" }, { slug: "acme", subscribe: true });
    expect(html).toContain("de disponibilidade nos últimos 90 dias");
    expect(html).toContain("Manutenção em andamento");
    expect(html).toContain("Receba atualizações por email");
  });
});
