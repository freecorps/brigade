// Workspace invitations end to end (src/invitations.ts): `/workspaces/:id/invitations` and `/invitations/:id`
// through the Worker, D1 first and then the shard's events through the outbox; who may invite whom; what an invitee
// must be to accept; expiry, revoking, duplicates and the caps; D1 and the shard failing; and the invitation email.
import { env, exports } from "cloudflare:workers";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import {
  INVITATION_RESEND_INTERVAL_MS,
  INVITATIONS_DAILY_CAP,
  isId,
  MAX_PENDING_INVITATIONS,
  newId,
} from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import type { EmailSender, OutgoingEmail } from "../src/email.ts";
import { Invitations } from "../src/invitations.ts";
import { Membership } from "../src/members.ts";
import { consumeEvents, type NotifyEnv } from "../src/notify.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { Shard } from "../src/shard.ts";
import type { WorkspaceDO } from "../src/workspace.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

let people = 0;
let clients = 0;
/** A new client IP (TEST-NET-2) per call: sign-up is rate-limited per IP. */
const clientIp = () => `198.51.${Math.floor(++clients / 250) % 250}.${(clients % 250) + 1}`;

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

async function signUp(name: string, { verified = true, email = "" } = {}): Promise<Person> {
  const address = email || `${name.toLowerCase()}-i${++people}@example.com`;
  const response = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name, email: address, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  if (verified) await verify(body.user.id);
  return { id: body.user.id, cookie, email: address };
}

const verify = (userId: string) =>
  env.DB.prepare(`update "user" set "emailVerified" = 1 where id = ?`).bind(userId).run();

async function addMember(workspaceId: string, userId: string, role: string) {
  await env.DB.prepare(
    `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, ?, ?)`,
  )
    .bind(newId("mem", Date.now(), random), workspaceId, userId, role, new Date().toISOString())
    .run();
}

/** Ana owns a new workspace; Bia is its admin, Caio a responder and Duda a viewer. All verified. */
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
  const withState = <R>(fn: (state: DurableObjectState) => R | Promise<R>) =>
    runInDurableObject(stub, (_instance: WorkspaceDO, state) => fn(state));
  return { id, stub, ana: ana!, bia: bia!, caio: caio!, duda: duda!, withState };
}

type Team = Awaited<ReturnType<typeof team>>;

const invite = (t: Team, by: Person, email: string, role: string) =>
  api(`/workspaces/${t.id}/invitations`, {
    method: "POST",
    headers: { Cookie: by.cookie },
    body: JSON.stringify({ email, role }),
  });

/** Invites `email` as `role` (as Ana unless said otherwise) and answers the new invitation's id. */
async function invited(t: Team, email: string, role = "responder", by: Person = t.ana) {
  const response = await invite(t, by, email, role);
  expect(response.status).toBe(201);
  const body = (await response.json()) as { invitation: { id: string } };
  return body.invitation.id;
}

const answer = (person: Person, id: string, action?: "accept" | "decline") =>
  api(action ? `/invitations/${id}/${action}` : `/invitations/${id}`, {
    method: action ? "POST" : "GET",
    headers: { Cookie: person.cookie },
  });

const row = (id: string) =>
  env.DB.prepare(`select * from invitation where id = ?`)
    .bind(id)
    .first<{ email: string; status: string; role: string; expiresAt: string }>();

const events = (t: Team, type: string) =>
  t.withState((state) =>
    state.storage.sql
      .exec<{ event: string }>("select event from outbox order by seq")
      .toArray()
      .map((one) => JSON.parse(one.event) as BrigadeEvent)
      .filter((event) => event.type === type),
  );

let invitees = 0;
const address = () => `guest-${++invitees}@example.com`;

describe("inviting", () => {
  test("an owner invites by email: a prefixed id in D1, pending, and `member.invited` in the outbox", async () => {
    const t = await team();
    const email = address();
    const response = await invite(t, t.ana, `  ${email.toUpperCase()} `, "admin");
    expect(response.status).toBe(201);
    const { invitation } = (await response.json()) as {
      invitation: { id: string; email: string; role: string; expiresAt: number };
    };
    expect(isId("inv", invitation.id)).toBe(true);
    expect(invitation).toMatchObject({ email, role: "admin" });
    expect(await row(invitation.id)).toMatchObject({ email, status: "pending", role: "admin" });
    const [event] = await events(t, "member.invited");
    expect(event).toMatchObject({
      subject: invitation.id,
      data: { invitationId: invitation.id, role: "admin", invitedBy: t.ana.id, send: 1 },
    });
    // Never the address in the event: D1 keeps it.
    expect(JSON.stringify(event)).not.toContain(email);

    const list = await api(`/workspaces/${t.id}/invitations`, {
      headers: { Cookie: t.bia.cookie },
    });
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      invitations: [{ id: invitation.id, email, role: "admin", invitedBy: { name: "Ana" } }],
    });
  });

  test("admins invite anyone but owners; responders and viewers invite nobody and see no list", async () => {
    const t = await team();
    expect((await invite(t, t.bia, address(), "owner")).status).toBe(403);
    expect((await invite(t, t.bia, address(), "admin")).status).toBe(201);
    expect((await invite(t, t.ana, address(), "owner")).status).toBe(201);
    for (const person of [t.caio, t.duda]) {
      const refused = await invite(t, person, address(), "viewer");
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: "forbidden" });
      const list = await api(`/workspaces/${t.id}/invitations`, {
        headers: { Cookie: person.cookie },
      });
      expect(list.status).toBe(403);
    }
    const outsider = await signUp("Olga");
    expect((await invite(t, outsider, address(), "viewer")).status).toBe(403);
    expect((await events(t, "member.invited")).length).toBe(2);
  });

  test("an inviter whose own address is not verified is refused", async () => {
    const t = await team();
    await env.DB.prepare(`update "user" set "emailVerified" = 0 where id = ?`).bind(t.ana.id).run();
    const response = await invite(t, t.ana, address(), "viewer");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "unverified" });
  });

  test("a bad address or role, a member's address and a second pending invitation are refused", async () => {
    const t = await team();
    for (const email of [
      "",
      "not-an-address",
      "a@b",
      "a b@example.com",
      "x".repeat(250) + "@example.com",
    ]) {
      expect((await invite(t, t.ana, email, "viewer")).status).toBe(400);
    }
    expect((await invite(t, t.ana, address(), "member")).status).toBe(400);
    const member = await invite(t, t.ana, t.caio.email.toUpperCase(), "viewer");
    expect(member.status).toBe(409);
    expect(await member.json()).toEqual({ error: "already_member" });
    const email = address();
    await invited(t, email);
    const twice = await invite(t, t.bia, email, "viewer");
    expect(twice.status).toBe(409);
    expect(await twice.json()).toEqual({ error: "already_invited" });
  });

  test("Better Auth's own invitation routes stay refused", async () => {
    const t = await team();
    for (const route of [
      "invite-member",
      "accept-invitation",
      "reject-invitation",
      "cancel-invitation",
      "list-invitations",
      "get-invitation",
    ]) {
      const response = await api(`/auth/organization/${route}`, {
        method: "POST",
        headers: { Cookie: t.ana.cookie },
        body: JSON.stringify({ email: address(), role: "viewer", organizationId: t.id }),
      });
      expect(response.status, route).toBe(404);
    }
  });
});

describe("accepting and declining", () => {
  test("the invitee, signed in with that address and verified, joins with the role: `member.added`", async () => {
    const t = await team();
    const email = address();
    const id = await invited(t, email, "responder");
    const guest = await signUp("Gil", { email: email.toUpperCase(), verified: false });

    const preview = await answer(guest, id);
    expect(await preview.json()).toMatchObject({
      invitation: {
        workspace: { id: t.id, name: "Acme" },
        invitedBy: "Ana",
        role: "responder",
        status: "pending",
        forYou: true,
      },
    });
    // Not verified yet.
    const early = await answer(guest, id, "accept");
    expect(early.status).toBe(403);
    expect(await early.json()).toEqual({ error: "unverified" });
    expect((await row(id))?.status).toBe("pending");

    await verify(guest.id);
    const accepted = await answer(guest, id, "accept");
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ ok: true, role: "responder", workspaceId: t.id });
    expect((await row(id))?.status).toBe("accepted");
    const member = await env.DB.prepare(
      `select id, role from member where "organizationId" = ? and "userId" = ?`,
    )
      .bind(t.id, guest.id)
      .first<{ id: string; role: string }>();
    expect(member?.role).toBe("responder");
    expect(isId("mem", member?.id)).toBe(true);
    expect(await events(t, "member.added")).toMatchObject([
      { subject: guest.id, data: { userId: guest.id, role: "responder", invitationId: id } },
    ]);
    // In the shard's member list already, so they can be put on call before they open Brigade.
    expect(
      await t.withState((state) =>
        new Shard(state.storage, {
          shard: "workspace",
          randomBytes: random,
          log: () => {},
        }).store.get("members", guest.id),
      ),
    ).toMatchObject({ name: "Gil", role: "responder" });
    // Once is enough.
    expect((await answer(guest, id, "accept")).status).toBe(404);
  });

  test("someone signed in with another address is refused, and never learns the invited one", async () => {
    const t = await team();
    const email = address();
    const id = await invited(t, email);
    const other = await signUp("Hugo");
    const preview = await answer(other, id);
    const body = await preview.text();
    expect(body).not.toContain(email);
    expect(JSON.parse(body)).toMatchObject({ invitation: { forYou: false } });
    for (const action of ["accept", "decline"] as const) {
      const refused = await answer(other, id, action);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: "wrong_email" });
    }
    expect((await row(id))?.status).toBe("pending");
    expect(await events(t, "member.added")).toEqual([]);
  });

  test("an invitation that ran out cannot be accepted; resending brings it back with a new expiry", async () => {
    const t = await team();
    const email = address();
    const id = await invited(t, email);
    const guest = await signUp("Ivo", { email });
    await env.DB.prepare(`update invitation set "expiresAt" = ? where id = ?`)
      .bind(new Date(Date.now() - 1000).toISOString(), id)
      .run();
    expect(await (await answer(guest, id)).json()).toMatchObject({
      invitation: { status: "expired" },
    });
    const late = await answer(guest, id, "accept");
    expect(late.status).toBe(410);
    expect(await late.json()).toEqual({ error: "expired" });

    // Sent once just now: too soon to send again.
    const soon = await api(`/workspaces/${t.id}/invitations/${id}/resend`, {
      method: "POST",
      headers: { Cookie: t.ana.cookie },
    });
    expect(soon.status).toBe(429);
    expect(await soon.json()).toEqual({ error: "too_soon" });
    await t.withState((state) =>
      state.storage.sql.exec(
        "update invitation_sends set at = ? where invitation_id = ?",
        Date.now() - INVITATION_RESEND_INTERVAL_MS - 1,
        id,
      ),
    );
    const resent = await api(`/workspaces/${t.id}/invitations/${id}/resend`, {
      method: "POST",
      headers: { Cookie: t.ana.cookie },
    });
    expect(resent.status).toBe(200);
    expect(Date.parse((await row(id))!.expiresAt)).toBeGreaterThan(Date.now());
    expect(
      (await events(t, "member.invited")).map((event) => (event.data as { send: number }).send),
    ).toEqual([1, 2]);
    expect((await answer(guest, id, "accept")).status).toBe(200);
  });

  test("inviting an address whose invitation ran out replaces it", async () => {
    const t = await team();
    const email = address();
    const first = await invited(t, email);
    await env.DB.prepare(`update invitation set "expiresAt" = ? where id = ?`)
      .bind(new Date(Date.now() - 1000).toISOString(), first)
      .run();
    const second = await invited(t, email);
    expect((await row(first))?.status).toBe("expired");
    expect((await row(second))?.status).toBe("pending");
  });

  test("declining marks it rejected and emits `invitation.declined`; it cannot be accepted after", async () => {
    const t = await team();
    const email = address();
    const id = await invited(t, email);
    const guest = await signUp("Juca", { email });
    expect((await answer(guest, id, "decline")).status).toBe(200);
    expect((await row(id))?.status).toBe("rejected");
    expect(await events(t, "invitation.declined")).toMatchObject([
      { subject: id, data: { invitationId: id, userId: guest.id } },
    ]);
    expect((await answer(guest, id, "accept")).status).toBe(404);
  });

  test("signed out, a made-up id, or another site: refused", async () => {
    const t = await team();
    const id = await invited(t, address());
    expect((await api(`/invitations/${id}`)).status).toBe(401);
    expect((await api(`/invitations/${id}/accept`, { method: "POST" })).status).toBe(401);
    const guest = await signUp("Lia");
    expect((await answer(guest, newId("inv", Date.now(), random))).status).toBe(404);
    expect((await answer(guest, "inv_bad")).status).toBe(404);
    const crossSite = await api(`/invitations/${id}/accept`, {
      method: "POST",
      headers: { Cookie: guest.cookie, Origin: "https://elsewhere.example.com" },
    });
    expect(crossSite.status).toBe(403);
  });
});

describe("revoking", () => {
  test("an admin revokes a pending invitation (`invitation.revoked`), never an owner's", async () => {
    const t = await team();
    const forAdmin = await invited(t, address(), "admin");
    const forOwner = await invited(t, address(), "owner");
    const revoke = (by: Person, id: string) =>
      api(`/workspaces/${t.id}/invitations/${id}`, {
        method: "DELETE",
        headers: { Cookie: by.cookie },
      });
    expect((await revoke(t.bia, forOwner)).status).toBe(403);
    expect((await revoke(t.caio, forAdmin)).status).toBe(403);
    expect((await revoke(t.bia, forAdmin)).status).toBe(200);
    expect((await row(forAdmin))?.status).toBe("canceled");
    expect((await row(forOwner))?.status).toBe("pending");
    expect(await events(t, "invitation.revoked")).toMatchObject([
      { subject: forAdmin, data: { invitationId: forAdmin, revokedBy: t.bia.id } },
    ]);
    expect((await revoke(t.bia, forAdmin)).status).toBe(404);
    // Its link no longer works.
    const guest = await signUp("Mel");
    expect(await (await answer(guest, forAdmin)).json()).toMatchObject({
      invitation: { status: "canceled" },
    });
  });
});

describe("the limits", () => {
  test("at most `INVITATIONS_DAILY_CAP` invitation emails a day per workspace", async () => {
    const t = await team();
    await t.withState((state) => {
      for (let i = 0; i < INVITATIONS_DAILY_CAP; i++) {
        state.storage.sql.exec(
          "insert into invitation_sends (key, invitation_id, at) values (?, ?, ?)",
          `inv_x${i}:1`,
          `inv_x${i}`,
          Date.now() - 1000,
        );
      }
    });
    const capped = await invite(t, t.ana, address(), "viewer");
    expect(capped.status).toBe(429);
    expect(await capped.json()).toEqual({ error: "rate_limited" });
    expect(await events(t, "member.invited")).toEqual([]);
  });

  test("at most `MAX_PENDING_INVITATIONS` pending at once", async () => {
    const t = await team();
    const now = Date.now();
    await env.DB.batch(
      Array.from({ length: MAX_PENDING_INVITATIONS }, (_, i) =>
        env.DB.prepare(
          `insert into invitation (id, "organizationId", email, role, status, "expiresAt", "createdAt", "inviterId")
           values (?, ?, ?, 'viewer', 'pending', ?, ?, ?)`,
        ).bind(
          newId("inv", now, random),
          t.id,
          `crowd-${i}-${t.id.slice(-6)}@example.com`.toLowerCase(),
          new Date(now + 60_000).toISOString(),
          new Date(now).toISOString(),
          t.ana.id,
        ),
      ),
    );
    const full = await invite(t, t.ana, address(), "viewer");
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ error: "limit_reached" });
  });
});

describe("failures", () => {
  /** An `Invitations` on the workspace's own storage, with D1 or the shard swapped for a failing one. */
  const invitations = (
    state: DurableObjectState,
    options: { db?: D1Database; shardFails?: boolean } = {},
  ) => {
    const shard = new Shard(state.storage, {
      shard: "workspace",
      randomBytes: random,
      log: () => {},
    });
    const failing = {
      store: shard.store,
      mutate: () => {
        throw new Error("storage failed");
      },
    } as unknown as Shard;
    const membership = new Membership({
      db: options.db ?? env.DB,
      shard,
      randomBytes: random,
      sql: state.storage.sql,
      log: () => {},
      committed: () => {},
      closeSockets: () => {},
      wake: (at) => void state.storage.setAlarm(at),
    });
    return new Invitations({
      db: options.db ?? env.DB,
      shard: options.shardFails ? failing : shard,
      sql: state.storage.sql,
      membership,
      randomBytes: random,
      log: () => {},
      committed: () => {},
    });
  };

  const brokenDb = {
    prepare: () => {
      throw new Error("D1 is down");
    },
    batch: () => Promise.reject(new Error("D1 is down")),
  } as unknown as D1Database;

  test("D1 failing changes nothing and answers `unavailable`", async () => {
    const t = await team();
    const email = address();
    const result = await t.withState((state) =>
      invitations(state, { db: brokenDb }).invite(t.id, t.ana.id, email, "viewer", ORIGIN),
    );
    expect(result).toEqual({ ok: false, code: "unavailable" });
    expect(await events(t, "member.invited")).toEqual([]);
    const pending = await env.DB.prepare(`select count(*) as n from invitation where email = ?`)
      .bind(email)
      .first<{ n: number }>();
    expect(pending?.n).toBe(0);
  });

  test("the shard failing after D1 answers `not_applied`, and the repair alarm emits what it owed", async () => {
    const t = await team();
    const email = address();
    const result = await t.withState((state) =>
      invitations(state, { shardFails: true }).invite(t.id, t.ana.id, email, "viewer", ORIGIN),
    );
    expect(result).toEqual({ ok: false, code: "not_applied" });
    const pending = await env.DB.prepare(`select id, status from invitation where email = ?`)
      .bind(email)
      .first<{ id: string; status: string }>();
    expect(pending?.status).toBe("pending");
    expect(await events(t, "member.invited")).toEqual([]);

    // The alarm the failure armed runs the owed `invitation.create` (as `sys_members`).
    await t.withState((state) =>
      state.storage.sql.exec("update member_repair set value = ? where key = 'at'", Date.now() - 1),
    );
    expect(await runDurableObjectAlarm(t.stub)).toBe(true);
    expect(await events(t, "member.invited")).toMatchObject([
      {
        subject: pending!.id,
        actor: { id: "sys_members" },
        data: { invitationId: pending!.id, send: 1 },
      },
    ]);
    expect(
      await t.withState((state) =>
        state.storage.sql.exec("select count(*) as n from invitation_repair").one(),
      ),
    ).toEqual({ n: 0 });
  });

  test("an acceptance whose shard step failed still joined: `not_applied`, then `member.added` from the repair", async () => {
    const t = await team();
    const email = address();
    const id = await invited(t, email);
    const guest = await signUp("Nia", { email });
    const result = await t.withState((state) =>
      invitations(state, { shardFails: true }).accept(t.id, id, { id: guest.id, email }),
    );
    expect(result).toEqual({ ok: false, code: "not_applied" });
    expect((await row(id))?.status).toBe("accepted");
    await t.withState((state) =>
      state.storage.sql.exec("update member_repair set value = ? where key = 'at'", Date.now() - 1),
    );
    expect(await runDurableObjectAlarm(t.stub)).toBe(true);
    expect(await events(t, "member.added")).toMatchObject([{ subject: guest.id }]);
  });
});

describe("the invitation email", () => {
  function recorder() {
    const sent: OutgoingEmail[] = [];
    const sender: EmailSender = {
      id: "test",
      async send(email) {
        sent.push(email);
        return { ok: true };
      },
    };
    return { sent, sender };
  }

  const environment: NotifyEnv = {
    WORKSPACE: env.WORKSPACE,
    DB: env.DB,
    DASHBOARD_URL: "https://brigade.example.com",
  };

  async function deliver(events: BrigadeEvent[], sender: EmailSender, attempts = 1) {
    const batch = createMessageBatch(
      "brigade-events",
      events.map((body, i) => ({ id: `msg-${i}`, timestamp: new Date(), attempts, body })),
    );
    const ctx = createExecutionContext();
    await consumeEvents(batch, environment, async () => Response.json({}), sender);
    const result = await getQueueResult(batch, ctx);
    return { acked: result.explicitAcks, retried: result.retryMessages.map((m) => m.msgId) };
  }

  test("goes to the invited address once, links to the dashboard, and escapes what members typed", async () => {
    const t = await team();
    await env.DB.prepare(`update organization set name = ? where id = ?`)
      .bind(`<b>Acme & "Co"</b>`, t.id)
      .run();
    await env.DB.prepare(`update "user" set name = ?, locale = 'pt-BR' where id = ?`)
      .bind("<script>alert(1)</script>", t.ana.id)
      .run();
    const email = address();
    const id = await invited(t, email, "admin");
    const [event] = await events(t, "member.invited");
    const mail = recorder();
    expect(await deliver([event!, event!], mail.sender)).toEqual({
      acked: ["msg-0", "msg-1"],
      retried: [],
    });
    expect(mail.sent).toHaveLength(1);
    const [sent] = mail.sent;
    expect(sent!.to).toEqual({ email });
    // The inviter's language, as the invitee has no account.
    expect(sent!.subject).toBe(
      `<script>alert(1)</script> convidou você para <b>Acme & "Co"</b> no Brigade`,
    );
    expect(sent!.text).toContain(`https://brigade.example.com/invitations/${id}`);
    expect(sent!.text).toContain("Admin");
    expect(sent!.html).not.toContain("<script>");
    expect(sent!.html).not.toContain("<b>Acme");
    expect(sent!.html).toContain("&lt;b&gt;Acme &amp; &quot;Co&quot;&lt;/b&gt;");
    expect(sent!.html).toContain(`href="https://brigade.example.com/invitations/${id}"`);

    // A redelivery later finds it done.
    expect(await deliver([event!], mail.sender)).toEqual({ acked: ["msg-0"], retried: [] });
    expect(mail.sent).toHaveLength(1);
  });

  test("nothing goes out once the invitation was revoked", async () => {
    const t = await team();
    const id = await invited(t, address());
    const [event] = await events(t, "member.invited");
    await api(`/workspaces/${t.id}/invitations/${id}`, {
      method: "DELETE",
      headers: { Cookie: t.ana.cookie },
    });
    const mail = recorder();
    expect(await deliver([event!], mail.sender)).toEqual({ acked: ["msg-0"], retried: [] });
    expect(mail.sent).toEqual([]);
  });

  test("a send that may pass is retried, and the retry sends it", async () => {
    const t = await team();
    await invited(t, address());
    const [event] = await events(t, "member.invited");
    let calls = 0;
    const flaky: EmailSender = {
      id: "flaky",
      async send() {
        return ++calls === 1
          ? { ok: false, retry: true, code: "E_RATE_LIMIT_EXCEEDED" }
          : { ok: true };
      },
    };
    expect(await deliver([event!], flaky)).toEqual({ acked: [], retried: ["msg-0"] });
    expect(await deliver([event!], flaky, 2)).toEqual({ acked: ["msg-0"], retried: [] });
    expect(calls).toBe(2);
  });
});
