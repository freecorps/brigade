// The email notifier (RFC 0005 "Email"): what the emails say in each locale and that nothing a member typed becomes
// markup, the senders, which failed pages lead to an email and to whom, the ledger that makes redeliveries harmless,
// retries and the failure recorded on the timeline, and that a page never waits for an email.
import { env } from "cloudflare:workers";
import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { generateRecipient, toBase64url } from "@freecorps/brigade-push";
import { MONITOR_ACTOR, newId, type Actor, type Role } from "@freecorps/brigade-schema";
import {
  CloudflareEmailSender,
  emailSender,
  logEmailSender,
  parseSender,
  type EmailResult,
  type EmailSender,
  type OutgoingEmail,
} from "../src/email.ts";
import { escapeHtml, incidentLink, renderEmail } from "../src/email-templates.ts";
import { asksForEmail } from "../src/mailer.ts";
import { consumeEvents, type Fetch, type NotifyEnv } from "../src/notify.ts";
import { emailRetryDelay, MAX_EMAIL_ATTEMPTS } from "../src/notify-email.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { Shard } from "../src/shard.ts";
import type { WorkspaceDO } from "../src/workspace.ts";
import { runInDurableObject } from "cloudflare:test";

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const INCIDENT = {
  id: "inc_01JB0000000000000000000001",
  number: 142,
  title: "Checkout is down",
  severity: "sev1" as const,
};

describe("what the emails say", () => {
  test("a member a page missed, in English and in Portuguese, with the hint for a member without a phone", () => {
    const context = {
      incident: INCIDENT,
      workspace: "Acme",
      dashboardUrl: "https://brigade.example.com",
    };
    const to = { email: "ana@example.com", name: "Ana" };
    const en = renderEmail({ about: "unpaged", reason: "no_devices" }, context, to, "en");
    expect(en.subject).toBe("SEV1 · INC-142: Checkout is down (Brigade couldn't page you)");
    expect(en.text).toContain(
      "Brigade tried to page you about SEV1 · INC-142 in Acme, but the page didn't reach your phone: you have no phone registered with Brigade.",
    );
    expect(en.text).toContain("Incident: INC-142 · SEV1 Critical");
    expect(en.text).toContain("Title: Checkout is down");
    expect(en.text).toContain("Open the incident: https://brigade.example.com/incidents/142");
    expect(en.text).toContain("install the Brigade app");
    expect(en.html).toContain('<html lang="en">');
    expect(en.html).toContain('href="https://brigade.example.com/incidents/142"');
    expect(en.to).toEqual(to);

    const pt = renderEmail({ about: "unpaged", reason: "undelivered" }, context, to, "pt-BR");
    expect(pt.subject).toBe(
      "SEV1 · INC-142: Checkout is down (o Brigade não conseguiu chamar você)",
    );
    expect(pt.text).toContain("a notificação push não foi entregue");
    expect(pt.text).toContain("Incidente: INC-142 · SEV1 Crítica");
    expect(pt.text).toContain("Abrir o incidente: https://brigade.example.com/incidents/142");
    // The hint is for a member without a phone only.
    expect(pt.text).not.toContain("instale o app");
    expect(pt.html).toContain('<html lang="pt-BR">');
  });

  test("the owners' email when nobody could be paged, in both locales", () => {
    const context = { incident: { ...INCIDENT, severity: "sev2" as const }, workspace: "Acme" };
    const to = { email: "owner@example.com" };
    const en = renderEmail({ about: "nobody_paged" }, context, to, "en");
    expect(en.subject).toBe("Nobody could be paged for SEV2 · INC-142: Checkout is down");
    expect(en.text).toContain("Nobody could be paged for SEV2 · INC-142 in Acme.");
    expect(en.text).toContain("The incident's timeline says why each page failed.");
    expect(en.text).toContain("because you're an owner of Acme");
    // No DASHBOARD_URL, no link.
    expect(en.text).not.toContain("Open the incident");
    expect(en.html).not.toContain("<a ");
    const pt = renderEmail({ about: "nobody_paged" }, context, to, "pt-BR");
    expect(pt.subject).toBe("Ninguém pôde ser chamado para SEV2 · INC-142: Checkout is down");
    expect(pt.text).toContain("porque é proprietário de Acme");
  });

  test("nothing a member typed becomes markup: titles, workspace names and names are escaped", () => {
    const evil = `<script>alert("x")</script><img src=x onerror='y'> & co`;
    const email = renderEmail(
      { about: "nobody_paged" },
      {
        incident: { ...INCIDENT, title: evil },
        workspace: `</p><a href="https://evil.example.com">Acme</a>`,
        dashboardUrl: "https://brigade.example.com",
      },
      { email: "ana@example.com", name: "Ana\r\nBcc: someone@example.com" },
      "en",
    );
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain('href="https://evil.example.com"');
    expect(email.html).toContain(escapeHtml(evil));
    expect(email.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    // The only link is the incident's own.
    expect(email.html.match(/<a /g)).toHaveLength(1);
    // Plain text keeps the title as typed; headers never break a line.
    expect(email.text).toContain(evil);
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.to.name).toBe("Ana Bcc: someone@example.com");
    // A title with a line break cannot add a header either.
    const broken = renderEmail(
      { about: "unpaged", reason: "no_devices" },
      { incident: { ...INCIDENT, title: "Down\r\nBcc: x@example.com" }, workspace: "Acme" },
      { email: "ana@example.com" },
      "en",
    );
    expect(broken.subject).not.toMatch(/[\r\n]/);
  });

  test("a link only to an http(s) dashboard, and only for a numbered incident", () => {
    const at = (dashboardUrl: string | undefined, number: number | null = 7) =>
      incidentLink({ incident: { ...INCIDENT, number }, workspace: "Acme", dashboardUrl });
    expect(at("https://brigade.example.com/some/path?x=1")).toBe(
      "https://brigade.example.com/incidents/7",
    );
    expect(at("javascript:alert(1)")).toBeUndefined();
    expect(at("not a url")).toBeUndefined();
    expect(at(undefined)).toBeUndefined();
    expect(at("https://brigade.example.com", null)).toBeUndefined();
  });
});

describe("the senders", () => {
  const email: OutgoingEmail = {
    to: { email: "ana@example.com", name: "Ana" },
    subject: "Subject",
    text: "Text",
    html: "<p>Text</p>",
  };
  /** A `send_email` binding that answers with `answer` and remembers what it got. */
  const binding = (answer: () => Promise<EmailSendResult>) => {
    const sent: unknown[] = [];
    const fake = {
      send: async (message: unknown) => {
        sent.push(message);
        return answer();
      },
    } as unknown as SendEmail;
    return { fake, sent };
  };
  const failing = (code?: string) => async () => {
    throw Object.assign(new Error("refused"), code ? { code } : {});
  };

  test("Cloudflare Email Sending gets the sender, the recipient and both bodies", async () => {
    const { fake, sent } = binding(async () => ({ messageId: "m1" }));
    const sender = new CloudflareEmailSender(fake, {
      email: "brigade@example.com",
      name: "Brigade",
    });
    expect(await sender.send(email)).toEqual({ ok: true });
    expect(sent).toEqual([
      {
        from: { email: "brigade@example.com", name: "Brigade" },
        to: { email: "ana@example.com", name: "Ana" },
        subject: "Subject",
        text: "Text",
        html: "<p>Text</p>",
      },
    ]);
    // Without a name, the bare address.
    await new CloudflareEmailSender(fake, { email: "brigade@example.com" }).send({
      ...email,
      to: { email: "bia@example.com" },
    });
    expect(sent[1]).toMatchObject({ from: "brigade@example.com", to: "bia@example.com" });
  });

  test("limits and service failures are retried; a refused message or address is not", async () => {
    const from = { email: "brigade@example.com" };
    const result = async (answer: () => Promise<EmailSendResult>): Promise<EmailResult> =>
      new CloudflareEmailSender(binding(answer).fake, from).send(email);
    for (const code of [
      "E_RATE_LIMIT_EXCEEDED",
      "E_DAILY_LIMIT_EXCEEDED",
      "E_INTERNAL_SERVER_ERROR",
    ]) {
      expect(await result(failing(code)), code).toEqual({ ok: false, retry: true, code });
    }
    for (const code of ["E_SENDER_NOT_VERIFIED", "E_RECIPIENT_SUPPRESSED", "E_VALIDATION_ERROR"]) {
      expect(await result(failing(code)), code).toEqual({ ok: false, retry: false, code });
    }
    expect(await result(failing())).toEqual({ ok: false, retry: true, code: "unknown" });
  });

  test("the sender is picked from the env: Email Sending with EMAIL_FROM, else the log double in dev, else none", () => {
    const { fake } = binding(async () => ({ messageId: "m" }));
    expect(emailSender({ EMAIL: fake, EMAIL_FROM: "Brigade <brigade@example.com>" })?.id).toBe(
      "cloudflare",
    );
    expect(emailSender({ EMAIL: fake, EMAIL_LOG: "1" })).toBe(logEmailSender);
    expect(emailSender({ EMAIL: fake, EMAIL_FROM: "not an address", EMAIL_LOG: "1" })).toBe(
      logEmailSender,
    );
    expect(emailSender({ EMAIL: fake })).toBeUndefined();
    expect(emailSender({})).toBeUndefined();
    expect(parseSender("Brigade <brigade@example.com>")).toEqual({
      email: "brigade@example.com",
      name: "Brigade",
    });
    expect(parseSender(" brigade@example.com ")).toEqual({ email: "brigade@example.com" });
    expect(parseSender("<brigade@example.com>")).toEqual({ email: "brigade@example.com" });
    expect(parseSender("brigade")).toBeUndefined();
  });

  test("the log double writes what would be sent and sends nothing", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await logEmailSender.send(email)).toEqual({ ok: true });
    expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toMatchObject({
      notifier: "email",
      subject: "Subject",
      text: "Text",
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The notifier, end to end through the consumer: a real shard, D1 for the addresses, a recording sender.

const user = (id: string, role: Role): Actor => ({ kind: "user", id, role });
const ana = user("usr_ana", "owner");
const bia = user("usr_bia", "responder");
const caio = user("usr_caio", "viewer");
/** An owner who never opened Brigade: in D1, not in the shard's member list. */
const olga = user("usr_olga", "owner");

/** A sender that records each email and answers with `answer`. */
function recorder(
  answer: (email: OutgoingEmail) => EmailResult | Promise<EmailResult> = () => ({ ok: true }),
) {
  const sent: OutgoingEmail[] = [];
  const sender: EmailSender = {
    id: "test",
    async send(email) {
      sent.push(email);
      return answer(email);
    },
  };
  return { sent, sender, to: () => sent.map((one) => one.to.email).sort() };
}

/** A relay that accepts every push. */
const relayOk: Fetch = async (request) => {
  await request.body?.cancel();
  return Response.json({ status: 200 });
};

const baseEnv: NotifyEnv = {
  WORKSPACE: env.WORKSPACE,
  DB: env.DB,
  RELAY_URL: "https://relay.test",
  RELAY_SEND_TOKEN: "test-token",
  DASHBOARD_URL: "https://brigade.example.com",
};

let names = 0;
let mutations = 0;

/** A workspace in D1 (organization, users with locales, members) and its shard, with Ana, Bia and Caio synced. */
async function workspace(locales: Partial<Record<string, string>> = {}) {
  const id = newId("ws", Date.now() + ++names, random);
  const now = new Date().toISOString();
  await env.DB.prepare(`insert into organization (id, name, slug, "createdAt") values (?, ?, ?, ?)`)
    .bind(id, "Acme", id.toLowerCase(), now)
    .run();
  for (const member of [ana, bia, caio, olga]) {
    const userId = `${member.id}_${names}`;
    await env.DB.prepare(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", locale)
       values (?, ?, ?, 0, ?, ?, ?)`,
    )
      .bind(
        userId,
        member.id.slice(4),
        `${userId.slice(4)}@example.com`,
        now,
        now,
        locales[member.id] ?? null,
      )
      .run();
    await env.DB.prepare(
      `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, ?, ?)`,
    )
      .bind(newId("mem", Date.now(), random), id, userId, member.role, now)
      .run();
  }
  const stub = env.WORKSPACE.getByName(id);
  const as = (actor: Actor): Actor => ({ ...actor, id: `${actor.id}_${names}` });
  const people = { ana: as(ana), bia: as(bia), caio: as(caio), olga: as(olga) };
  const address = (actor: Actor) => `${actor.id.slice(4)}@example.com`;
  expect(await stub.provision({ id, name: "Acme" }, people.ana)).toEqual({ ok: true });
  const withShard = <R>(fn: (shard: Shard, sql: SqlStorage) => R) =>
    runInDurableObject(stub, (_instance: WorkspaceDO, state) =>
      fn(
        new Shard(state.storage, { shard: "workspace", randomBytes: random, log: () => {} }),
        state.storage.sql,
      ),
    );
  const run = (actor: Actor, name: string, args: object, ok = true) =>
    withShard((shard) => {
      const { result } = shard.mutate({
        clientId: "test",
        mutationId: `m${++mutations}`,
        actor,
        name,
        args,
        now: Date.now(),
        internal: true,
      });
      if (ok) expect(result, name).toMatchObject({ ok: true });
      return result;
    });
  for (const member of [people.ana, people.bia, people.caio]) {
    await run(member, "member.sync", {
      id: member.id,
      name: member.id.slice(4),
      role: member.role,
    });
  }
  const device = async (actor: Actor) => {
    const recipient = await generateRecipient();
    await run(actor, "device.register", {
      id: newId("dev", Date.now(), random),
      platform: "ios",
      environment: "sandbox",
      pushToken: toBase64url(random(32)).replace(/[-_]/g, "a"),
      voipToken: null,
      publicKey: toBase64url(recipient.publicKey),
    });
  };
  const events = (type?: string) =>
    withShard((_shard, sql) =>
      sql
        .exec<{ event: string }>("select event from outbox order by seq")
        .toArray()
        .map((row) => JSON.parse(row.event) as BrigadeEvent)
        .filter((event) => type === undefined || event.type === type),
    );
  const declare = async (actor: Actor, severity = "sev1") => {
    const incident = newId("inc", Date.now(), random);
    await run(actor, "incident.declare", { id: incident, title: "Checkout is down", severity });
    const event = (await events("incident.declared")).find((e) => e.subject === incident)!;
    return { incident, event };
  };
  /** The push failures recorded so far, as the email notifier will get them. */
  const failures = async () =>
    (await events("notification.failed")).filter(
      (e) => (e.data as { channel: string }).channel === "push",
    );
  const timeline = (incident: string) =>
    withShard((shard) => shard.store.scan("timeline").filter((row) => row.incidentId === incident));
  return { id, people, address, run, device, events, declare, failures, timeline, withShard };
}

/** Delivers `events` to the consumer in one batch as attempt `attempts`; what it acked and retried. */
async function deliver(
  events: BrigadeEvent[],
  sender: EmailSender | undefined,
  { attempts = 1, environment = baseEnv, relay = relayOk } = {},
) {
  const batch = createMessageBatch(
    "brigade-events",
    events.map((body, i) => ({ id: `msg-${i}`, timestamp: new Date(), attempts, body })),
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
  await consumeEvents(batch, environment, relay, sender);
  const result = await getQueueResult(batch, ctx);
  return {
    acked: result.explicitAcks,
    retried: result.retryMessages.map(({ msgId }) => ({ msgId, delaySeconds: delays.get(msgId) })),
  };
}

describe("who is emailed when paging fails", () => {
  test("a member a SEV1 page missed is emailed in their own language, once per incident; the owners are not when someone was paged", async () => {
    const ws = await workspace({ [bia.id]: "pt-BR" });
    await ws.device(ws.people.ana);
    const { event } = await ws.declare(MONITOR_ACTOR);
    const mail = recorder();
    await deliver([event], mail.sender);
    // Bia has no phone: her failure, and nobody else's (Ana was paged; Caio is a viewer).
    const [failed] = await ws.failures();
    expect(failed!.data).toMatchObject({ userId: ws.people.bia.id, reason: "no_devices" });
    expect(asksForEmail(failed!)).toBe(true);

    expect(await deliver([failed!], mail.sender)).toEqual({ acked: ["msg-0"], retried: [] });
    expect(mail.to()).toEqual([ws.address(ws.people.bia)]);
    expect(mail.sent[0]!.subject).toBe(
      "SEV1 · INC-1: Checkout is down (o Brigade não conseguiu chamar você)",
    );
    expect(mail.sent[0]!.text).toContain("https://brigade.example.com/incidents/1");

    // The same incident paging her again (a severity change, another level) does not email her twice.
    const second = { ...failed!, id: newId("evt", Date.now(), random) };
    await deliver([second], mail.sender);
    expect(mail.sent).toHaveLength(1);
  });

  test("a SEV3 or SEV4 page that missed a member emails nobody", async () => {
    const ws = await workspace();
    await ws.device(ws.people.ana);
    const { event } = await ws.declare(MONITOR_ACTOR, "sev3");
    await deliver([event], undefined);
    const mail = recorder();
    await deliver(await ws.failures(), mail.sender);
    expect(mail.sent).toEqual([]);
  });

  test("a page that reached nobody emails every owner, from D1, including one who never opened Brigade", async () => {
    const ws = await workspace({ [olga.id]: "pt-BR" });
    const { event } = await ws.declare(MONITOR_ACTOR, "sev2");
    await deliver([event], undefined);
    const failures = await ws.failures();
    // Ana and Bia could not be paged: no phones.
    expect(failures.map((e) => (e.data as { userId: string }).userId).sort()).toEqual(
      [ws.people.ana.id, ws.people.bia.id].sort(),
    );
    const mail = recorder();
    // Both failures in one batch: the owners' email goes once (the other waits on it and finds it done).
    const first = await deliver(failures, mail.sender);
    const owners = mail.sent.filter(
      (one) => one.subject.startsWith("Nobody") || one.subject.startsWith("Ninguém"),
    );
    expect(owners.map((one) => one.to.email).sort()).toEqual(
      [ws.address(ws.people.ana), ws.address(ws.people.olga)].sort(),
    );
    expect(owners.find((one) => one.to.email === ws.address(ws.people.olga))!.subject).toBe(
      "Ninguém pôde ser chamado para SEV2 · INC-1: Checkout is down",
    );
    // And each member it missed is told too.
    const unpaged = mail.sent.filter((one) => !owners.includes(one));
    expect(unpaged.map((one) => one.to.email).sort()).toEqual(
      [ws.address(ws.people.ana), ws.address(ws.people.bia)].sort(),
    );
    // The delivery that found the owners' email taken by the other is acked: the one holding it sends it, or is
    // redelivered by the Queue if it dies.
    expect(first).toEqual({ acked: ["msg-0", "msg-1"], retried: [] });
    expect(mail.sent).toHaveLength(4);
  });

  test("a level that missed everyone emails no owner while the run goes on; the run's last page that reached nobody does", async () => {
    const policy = (ws: Awaited<ReturnType<typeof workspace>>, levels: Actor[]) =>
      ws.run(ws.people.ana, "escalation.createPolicy", {
        id: newId("esc", Date.now(), random),
        name: "Checkout",
        levels: levels.map((member) => ({
          id: newId("lvl", Date.now(), random),
          targets: [{ kind: "member", id: member.id }],
          timeoutMinutes: 5,
        })),
        repeat: 0,
        isDefault: true,
      });
    // Level 1 is Ana, whose push the relay refuses; level 2 (Bia) fires at the timeout, so nobody is told yet that
    // nobody was paged. Ana hears the page missed her.
    const ws = await workspace();
    await ws.device(ws.people.ana);
    await policy(ws, [ws.people.ana, ws.people.bia]);
    const { event } = await ws.declare(MONITOR_ACTOR);
    const refusing: Fetch = async (request) => {
      await request.body?.cancel();
      return Response.json({ error: "invalid_body" }, { status: 400 });
    };
    await deliver([event], undefined, { relay: refusing });
    const failures = await ws.failures();
    expect(failures.map((e) => e.data)).toEqual([
      expect.objectContaining({
        userId: ws.people.ana.id,
        reason: "undelivered",
        page: expect.anything(),
      }),
    ]);
    const mail = recorder();
    await deliver(failures, mail.sender);
    expect(mail.sent.map((one) => [one.to.email, one.subject])).toEqual([
      [ws.address(ws.people.ana), "SEV1 · INC-1: Checkout is down (Brigade couldn't page you)"],
    ]);

    // A policy whose only level (Bia, no phone) cannot be reached ends the run on everyone who can respond, and
    // nobody has a phone: that last page reached nobody, so the owners are told.
    const ended = await workspace();
    await policy(ended, [ended.people.bia]);
    const declared = await ended.declare(MONITOR_ACTOR);
    await deliver([declared.event], undefined);
    const run = await ended.withShard(
      (shard) => shard.store.get("incidents", declared.incident)?.escalation,
    );
    expect(run).toMatchObject({ status: "exhausted" });
    const endedMail = recorder();
    await deliver(await ended.failures(), endedMail.sender);
    expect(
      endedMail.sent
        .filter((one) => one.subject.startsWith("Nobody"))
        .map((one) => one.to.email)
        .sort(),
    ).toEqual([ended.address(ended.people.ana), ended.address(ended.people.olga)].sort());
  });

  test("nothing once the incident is acknowledged, or when the workspace turned it off", async () => {
    const ws = await workspace();
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    await deliver([event], undefined);
    const failures = await ws.failures();
    await ws.run(ws.people.bia, "incident.ack", { id: incident });
    const mail = recorder();
    expect((await deliver(failures, mail.sender)).acked).toHaveLength(failures.length);
    expect(mail.sent).toEqual([]);

    const off = await workspace();
    // Owners and admins only.
    expect(
      await off.run(
        off.people.bia,
        "workspace.setEmail",
        { unpaged: false, nobodyPaged: false },
        false,
      ),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    await off.run(off.people.ana, "workspace.setEmail", { unpaged: false, nobodyPaged: false });
    expect((await off.events("workspace.email_changed"))[0]!.data).toEqual({
      unpaged: false,
      nobodyPaged: false,
    });
    const declared = await off.declare(MONITOR_ACTOR);
    await deliver([declared.event], undefined);
    await deliver(await off.failures(), mail.sender);
    expect(mail.sent).toEqual([]);
    // One of them back on: only that email.
    await off.run(off.people.ana, "workspace.setEmail", { unpaged: false, nobodyPaged: true });
    const next = await off.declare(MONITOR_ACTOR);
    await deliver([next.event], undefined);
    const fresh = (await off.failures()).filter(
      (e) => (e.data as { incidentId: string }).incidentId === next.incident,
    );
    await deliver(fresh, mail.sender);
    await deliver(fresh, mail.sender, { attempts: 2 });
    expect(mail.sent.every((one) => one.subject.startsWith("Nobody"))).toBe(true);
    expect(mail.to()).toEqual([off.address(off.people.ana), off.address(off.people.olga)].sort());
  });

  test("without a sender (email not set up) nothing is planned or sent, and the event is acked", async () => {
    const ws = await workspace();
    const { event } = await ws.declare(MONITOR_ACTOR);
    await deliver([event], undefined);
    expect(await deliver(await ws.failures(), undefined)).toMatchObject({ retried: [] });
    // Nothing claimed: a sender set up later still sends for a redelivery.
    const mail = recorder();
    await deliver(await ws.failures(), mail.sender);
    expect(mail.sent.length).toBeGreaterThan(0);
  });
});

describe("the email ledger and retries", () => {
  test("a redelivered event emails nobody again, in the same batch or later", async () => {
    const ws = await workspace();
    await ws.device(ws.people.ana);
    const { event } = await ws.declare(MONITOR_ACTOR);
    await deliver([event], undefined);
    const [failed] = await ws.failures();
    const mail = recorder();
    expect((await deliver([failed!, failed!], mail.sender)).acked).toEqual(["msg-0", "msg-1"]);
    await deliver([failed!], mail.sender, { attempts: 2 });
    expect(mail.sent).toHaveLength(1);
  });

  test("a failing send is retried with backoff, skipping who already got it, then recorded on the timeline", async () => {
    const ws = await workspace();
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    await deliver([event], undefined);
    // Ana and Bia have no phones: a nobody-paged email to Ana and Olga, and Ana's and Bia's own.
    const failures = await ws.failures();
    const anaFailure = failures.find(
      (e) => (e.data as { userId: string }).userId === ws.people.ana.id,
    )!;
    // Olga's address keeps failing for now; everyone else's goes through.
    const olgaAddress = ws.address(ws.people.olga);
    const mail = recorder((email) =>
      email.to.email === olgaAddress
        ? { ok: false, retry: true, code: "E_RATE_LIMIT_EXCEEDED" }
        : { ok: true },
    );
    for (let attempt = 1; attempt < MAX_EMAIL_ATTEMPTS; attempt++) {
      expect(await deliver([anaFailure], mail.sender, { attempts: attempt })).toEqual({
        acked: [],
        retried: [{ msgId: "msg-0", delaySeconds: emailRetryDelay(attempt) }],
      });
    }
    expect(emailRetryDelay(1)).toBe(30);
    expect(emailRetryDelay(4)).toBe(240);
    expect(emailRetryDelay(10)).toBe(300);
    // Ana got each of her two emails once; Olga's was tried on every delivery.
    const toAna = mail.sent.filter((one) => one.to.email === ws.address(ws.people.ana));
    expect(toAna).toHaveLength(2);
    expect(mail.sent.filter((one) => one.to.email === olgaAddress)).toHaveLength(
      MAX_EMAIL_ATTEMPTS - 1,
    );
    expect((await ws.timeline(incident)).map((row) => row.kind)).not.toContain("email_failed");

    // The last attempt gives up: Olga's email is recorded as failed, on the timeline and as an event.
    expect(await deliver([anaFailure], mail.sender, { attempts: MAX_EMAIL_ATTEMPTS })).toEqual({
      acked: ["msg-0"],
      retried: [],
    });
    const entries = (await ws.timeline(incident)).filter((row) => row.kind === "email_failed");
    expect(entries).toEqual([
      expect.objectContaining({
        kind: "email_failed",
        userId: ws.people.olga.id,
        reason: "undelivered",
        about: "nobody_paged",
        actor: "sys_notifier",
      }),
    ]);
    const emailFailures = (await ws.events("notification.failed")).filter(
      (e) => (e.data as { channel: string }).channel === "email",
    );
    expect(emailFailures.map((e) => e.data)).toEqual([
      {
        incidentId: incident,
        eventId: anaFailure.id,
        channel: "email",
        userId: ws.people.olga.id,
        reason: "undelivered",
        about: "nobody_paged",
      },
    ]);
    // An email's own failure never leads to another email.
    expect(asksForEmail(emailFailures[0]!)).toBe(false);
    const before = mail.sent.length;
    await deliver(emailFailures, mail.sender);
    // And a redelivery after it was given up sends nothing more.
    await deliver([anaFailure], mail.sender, { attempts: MAX_EMAIL_ATTEMPTS + 1 });
    expect(mail.sent).toHaveLength(before);
  });

  test("a refused address is recorded at once, without retrying", async () => {
    const ws = await workspace();
    await ws.device(ws.people.ana);
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    await deliver([event], undefined);
    const mail = recorder(() => ({ ok: false, retry: false, code: "E_RECIPIENT_SUPPRESSED" }));
    expect(await deliver(await ws.failures(), mail.sender)).toEqual({
      acked: ["msg-0"],
      retried: [],
    });
    expect((await ws.timeline(incident)).filter((row) => row.kind === "email_failed")).toEqual([
      expect.objectContaining({ userId: ws.people.bia.id, about: "unpaged" }),
    ]);
  });

  test("D1 failing is retried like a failed send", async () => {
    const ws = await workspace();
    await ws.device(ws.people.ana);
    const { event } = await ws.declare(MONITOR_ACTOR);
    await deliver([event], undefined);
    const mail = recorder();
    const noDb = { ...baseEnv, DB: undefined };
    expect(await deliver(await ws.failures(), mail.sender, { environment: noDb })).toEqual({
      acked: [],
      retried: [{ msgId: "msg-0", delaySeconds: emailRetryDelay(1) }],
    });
    expect(mail.sent).toEqual([]);
    await deliver(await ws.failures(), mail.sender, { attempts: 2 });
    expect(mail.to()).toEqual([ws.address(ws.people.bia)]);
  });
});

describe("push is never held up by email", () => {
  test("a page in the same batch as a hanging email goes out before the email finishes", async () => {
    const ws = await workspace();
    await ws.device(ws.people.ana);
    const first = await ws.declare(MONITOR_ACTOR);
    await deliver([first.event], undefined);
    const [failed] = await ws.failures();
    // A second incident to page, delivered with the first one's failure, whose email hangs until released.
    const second = await ws.declare(MONITOR_ACTOR);
    let release: () => void = () => {};
    const hanging = new Promise<void>((resolve) => {
      release = resolve;
    });
    let emailStarted = false;
    const mail = recorder(async () => {
      emailStarted = true;
      await hanging;
      return { ok: true };
    });
    let pushed = 0;
    const relay: Fetch = async (request) => {
      await request.body?.cancel();
      pushed++;
      return Response.json({ status: 200 });
    };
    const done = deliver([failed!, second.event], mail.sender, { relay });
    await vi.waitFor(() => {
      expect(emailStarted).toBe(true);
      expect(pushed).toBe(1);
    });
    release();
    expect((await done).acked.sort()).toEqual(["msg-0", "msg-1"]);
  });

  test("the push notifier never acts on email events, and email failures never page", async () => {
    const ws = await workspace();
    const { event } = await ws.declare(MONITOR_ACTOR);
    let pushed = 0;
    const relay: Fetch = async (request) => {
      await request.body?.cancel();
      pushed++;
      return Response.json({ status: 200 });
    };
    await deliver([event], undefined, { relay });
    const mail = recorder(() => ({ ok: false, retry: false, code: "E_RECIPIENT_SUPPRESSED" }));
    await deliver(await ws.failures(), mail.sender, { relay });
    await deliver(await ws.events("notification.failed"), mail.sender, { relay });
    expect(pushed).toBe(0);
  });
});
