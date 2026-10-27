// Email verification (RFC 0002 "Auth"): the email sent at sign-up and on request, the dashboard link it carries,
// verifying with it (and with an expired or broken one), the limits on asking again, and what the email says.
import { env, exports } from "cloudflare:workers";
import { createEmailVerificationToken } from "better-auth/api";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import {
  createAuth,
  EMAIL_NOT_CONFIGURED_CODE,
  safeNext,
  VERIFICATION_DAILY_LIMIT,
  VERIFICATION_RESEND_LIMIT,
} from "../src/auth.ts";
import type { EmailSender, OutgoingEmail } from "../src/email.ts";
import { renderVerificationEmail } from "../src/email-templates.ts";
import { sessionCookie } from "./session.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";

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

afterEach(() => {
  vi.restoreAllMocks();
});

/** What the dev log double (`EMAIL_LOG=1`, set for the tests) printed, as emails. */
function outbox() {
  const spy = vi.spyOn(console, "log");
  return () =>
    spy.mock.calls.flatMap(([line]) => {
      if (typeof line !== "string" || !line.includes("email not sent (EMAIL_LOG)")) return [];
      return [JSON.parse(line) as { to: { email: string }; subject: string; text: string }];
    });
}

async function signUp(name: string, locale?: string, address?: string) {
  const email = address ?? `${name.toLowerCase()}-v${++people}@example.com`;
  const response = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name, email, password: PASSWORD, ...(locale ? { locale } : {}) }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  const cookie = await sessionCookie(email, PASSWORD);
  return { id: body.user.id, email, cookie };
}

const verified = (userId: string) =>
  env.DB.prepare(`select "emailVerified" as v from "user" where id = ?`)
    .bind(userId)
    .first<{ v: number }>()
    .then((row) => row?.v);

const resend = (person: { email: string; cookie: string }, callbackURL?: string) =>
  api("/auth/send-verification-email", {
    method: "POST",
    headers: { Cookie: person.cookie },
    body: JSON.stringify({ email: person.email, ...(callbackURL ? { callbackURL } : {}) }),
  });

describe("verifying an address", () => {
  test("sign-up sends a link to the dashboard's page; opening it verifies the address", async () => {
    const sent = outbox();
    const ana = await signUp("Ana", "pt-BR");
    expect(await verified(ana.id)).toBe(0);
    await vi.waitFor(() => expect(sent().some((one) => one.to.email === ana.email)).toBe(true));
    const email = sent().find((one) => one.to.email === ana.email)!;
    expect(email.subject).toBe("Confirme seu email no Brigade");
    // Nothing the person signing up typed but the address: it goes to an inbox nobody proved is theirs.
    expect(email.to).toEqual({ email: ana.email });
    expect(email.text).not.toContain("Ana");
    const link = /https?:\/\/\S+/.exec(email.text)![0];
    const url = new URL(link);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/verify-email");
    const token = url.searchParams.get("token")!;

    const response = await api(`/auth/verify-email?token=${encodeURIComponent(token)}`);
    expect(response.status).toBe(200);
    expect(await verified(ana.id)).toBe(1);
    // The session shows it.
    const session = await api("/auth/get-session", { headers: { Cookie: ana.cookie } });
    expect(await session.json()).toMatchObject({ user: { emailVerified: true } });
  });

  test("an expired or broken link verifies nothing", async () => {
    const bia = await signUp("Bia");
    const expired = await createEmailVerificationToken(
      env.BETTER_AUTH_SECRET,
      bia.email,
      undefined,
      -60,
    );
    const late = await api(`/auth/verify-email?token=${expired}`);
    expect(late.status).toBe(401);
    expect(await late.json()).toMatchObject({ code: "TOKEN_EXPIRED" });
    const broken = await api(`/auth/verify-email?token=${expired.slice(0, -4)}abcd`);
    expect(broken.status).toBe(401);
    expect(await broken.json()).toMatchObject({ code: "INVALID_TOKEN" });
    // Signed with another secret: someone else's server.
    const forged = await createEmailVerificationToken("another-secret", bia.email);
    expect((await api(`/auth/verify-email?token=${forged}`)).status).toBe(401);
    expect(await verified(bia.id)).toBe(0);
  });
});

describe("asking again", () => {
  test("only signed in, for one's own address, a few times per window", async () => {
    const caio = await signUp("Caio");
    const signedOut = await api("/auth/send-verification-email", {
      method: "POST",
      body: JSON.stringify({ email: caio.email }),
    });
    expect(signedOut.status).toBe(401);
    const sent = outbox();
    const other = await resend({ email: "someone-else@example.com", cookie: caio.cookie });
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ code: "FORBIDDEN" });
    const missing = await api("/auth/send-verification-email", {
      method: "POST",
      headers: { Cookie: caio.cookie },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(403);
    // Neither counts against the person's own limit, and nothing goes to the other address.

    for (let i = 0; i < VERIFICATION_RESEND_LIMIT.max; i++) {
      expect((await resend(caio)).status).toBe(200);
    }
    const limited = await resend(caio);
    expect(limited.status).toBe(429);
    await vi.waitFor(() =>
      expect(sent().filter((one) => one.to.email === caio.email)).toHaveLength(
        VERIFICATION_RESEND_LIMIT.max,
      ),
    );
    expect(sent().some((one) => one.to.email === "someone-else@example.com")).toBe(false);
  });

  test("at most `VERIFICATION_DAILY_LIMIT` a day, however the short window resets", async () => {
    const gil = await signUp("Gil");
    const sent = outbox();
    for (let i = 0; i < VERIFICATION_DAILY_LIMIT.max; i++) {
      if (i > 0 && i % VERIFICATION_RESEND_LIMIT.max === 0) {
        // The 15-minute window passed.
        await env.DB.prepare(`update "rateLimit" set "lastRequest" = ? where key = ?`)
          .bind(Date.now() - VERIFICATION_RESEND_LIMIT.window * 1000 - 1, `verify:${gil.id}`)
          .run();
      }
      expect((await resend(gil)).status).toBe(200);
    }
    await env.DB.prepare(`update "rateLimit" set "lastRequest" = ? where key = ?`)
      .bind(Date.now() - VERIFICATION_RESEND_LIMIT.window * 1000 - 1, `verify:${gil.id}`)
      .run();
    expect((await resend(gil)).status).toBe(429);
    await vi.waitFor(() =>
      expect(sent().filter((one) => one.to.email === gil.email)).toHaveLength(
        VERIFICATION_DAILY_LIMIT.max,
      ),
    );
  });

  test("requests at once each count: no more than the limit go out", async () => {
    const hana = await signUp("Hana");
    const statuses = await Promise.all(
      Array.from({ length: VERIFICATION_RESEND_LIMIT.max + 3 }, () => resend(hana)),
    );
    expect(statuses.filter((response) => response.status === 200)).toHaveLength(
      VERIFICATION_RESEND_LIMIT.max,
    );
  });

  test("the invitation being answered rides along; any other place is dropped", async () => {
    const duda = await signUp("Duda");
    const sent = outbox();
    const invitation = "/invitations/inv_01JB0000000000000000000000";
    expect((await resend(duda, invitation)).status).toBe(200);
    await vi.waitFor(() => expect(sent().length).toBe(1));
    const link = new URL(/https?:\/\/\S+/.exec(sent()[0]!.text)![0]);
    expect(link.searchParams.get("next")).toBe(invitation);

    expect(
      safeNext("https://elsewhere.example.com/invitations/inv_01JB0000000000000000000000"),
    ).toBe(undefined);
    expect(safeNext("//elsewhere.example.com")).toBe(undefined);
    expect(safeNext("/invitations/inv_x")).toBe(undefined);
    expect(safeNext(invitation)).toBe(invitation);
  });

  test("signing up from an invitation sends a link that comes back to it", async () => {
    const sent = outbox();
    const invitation = "/invitations/inv_01JB0000000000000000000000";
    const email = `pia-v${++people}@example.com`;
    const response = await api("/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ name: "Pia", email, password: PASSWORD, callbackURL: invitation }),
    });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(sent().some((one) => one.to.email === email)).toBe(true));
    const link = new URL(
      /https?:\/\/\S+/.exec(sent().find((one) => one.to.email === email)!.text)![0],
    );
    expect(link.pathname).toBe("/verify-email");
    expect(link.searchParams.get("next")).toBe(invitation);
  });

  test("an address already verified is not sent another", async () => {
    const eva = await signUp("Eva");
    await env.DB.prepare(`update "user" set "emailVerified" = 1 where id = ?`).bind(eva.id).run();
    const response = await resend(eva);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "EMAIL_ALREADY_VERIFIED" });
  });

  test("without a sender, asking says email is not set up", async () => {
    const fia = await signUp("Fia");
    const auth = createAuth({
      database: env.DB,
      secret: env.BETTER_AUTH_SECRET,
      email: { sender: undefined },
    });
    const response = await auth.handler(
      new Request(`${ORIGIN}/auth/send-verification-email`, {
        method: "POST",
        headers: {
          Origin: ORIGIN,
          Cookie: fia.cookie,
          "Content-Type": "application/json",
          "cf-connecting-ip": clientIp(),
        },
        body: JSON.stringify({ email: fia.email }),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: EMAIL_NOT_CONFIGURED_CODE });
  });
});

describe("what the verification email says", () => {
  test("in the user's language, the address and the link escaped in the HTML", () => {
    const email = `o'brien+<b>@example.com`;
    const link = "https://brigade.example.com/verify-email?token=a.b.c&next=%2Finvitations%2Finv_x";
    const en = renderVerificationEmail({ email }, link, "en");
    expect(en.subject).toBe("Confirm your email for Brigade");
    expect(en.to).toEqual({ email });
    expect(en.text).toContain(`Confirm that ${email} is your address.`);
    expect(en.text).toContain(link);
    expect(en.html).not.toContain("<b>");
    expect(en.html).toContain("o&#39;brien+&lt;b&gt;@example.com");
    expect(en.html).toContain(`href="${link.replace(/&/g, "&amp;")}"`);
    const pt = renderVerificationEmail({ email: "ana@example.com" }, link, "pt-BR");
    expect(pt.subject).toBe("Confirme seu email no Brigade");
    expect(pt.html).toContain('lang="pt-BR"');
  });

  test("a sender that delivers needs `DASHBOARD_URL`: without it, no link from the request's origin", async () => {
    const sent: OutgoingEmail[] = [];
    const sender: EmailSender = {
      id: "test",
      async send(email) {
        sent.push(email);
        return { ok: true };
      },
    };
    const signUpThrough = async (dashboardUrl: string | undefined, email: string) => {
      const auth = createAuth({
        database: env.DB,
        secret: env.BETTER_AUTH_SECRET,
        email: { sender, ...(dashboardUrl ? { dashboardUrl } : {}) },
      });
      const response = await auth.handler(
        new Request(`${ORIGIN}/auth/sign-up/email`, {
          method: "POST",
          headers: {
            Origin: ORIGIN,
            "Content-Type": "application/json",
            "cf-connecting-ip": clientIp(),
          },
          body: JSON.stringify({ name: "Ivo", email, password: PASSWORD }),
        }),
      );
      expect(response.status).toBe(200);
    };
    const without = `ivo-v${++people}@example.com`;
    const configured = `ivo-v${++people}@example.com`;
    await signUpThrough(undefined, without);
    await signUpThrough("https://brigade.example.com", configured);
    await vi.waitFor(() => expect(sent.map((one) => one.to.email)).toContain(configured));
    expect(sent.find((one) => one.to.email === configured)!.text).toContain(
      "https://brigade.example.com/verify-email?token=",
    );
    expect(sent.map((one) => one.to.email)).not.toContain(without);
  });
});

describe("an address held by an account nobody verified", () => {
  // A verification link holds only the address (Better Auth's token), so it is safe only while one account holds
  // that address for good: nothing frees an address, and an old link can never reach a newer account (RFC 0002
  // "Auth"). Pinned here, since the earlier release of unverified accounts let exactly that happen.
  test("stays taken, and its link verifies that account only", async () => {
    const sent = outbox();
    const first = await signUp("Jon");
    await vi.waitFor(() => expect(sent().some((one) => one.to.email === first.email)).toBe(true));
    const link = /https?:\/\/\S+/.exec(
      sent().find((one) => one.to.email === first.email)!.text,
    )![0];
    const token = new URL(link).searchParams.get("token")!;

    // A sign-up with the address creates nothing, however old the account is (it answers as for a new one, RFC 0002
    // "Auth").
    await env.DB.prepare(`update "user" set "createdAt" = ? where id = ?`)
      .bind(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), first.id)
      .run();
    const again = await api("/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ name: "Jo", email: first.email, password: PASSWORD }),
    });
    expect(again.status).toBe(200);
    const accounts = await env.DB.prepare(`select id from "user" where email = ?`)
      .bind(first.email)
      .all<{ id: string }>();
    expect(accounts.results.map((row) => row.id)).toEqual([first.id]);
    // Nor can the account be deleted or moved off the address, the other ways a newer account could get it.
    const deleted = await api("/auth/delete-user", {
      method: "POST",
      headers: { Cookie: first.cookie },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(deleted.ok).toBe(false);
    const moved = await api("/auth/change-email", {
      method: "POST",
      headers: { Cookie: first.cookie },
      body: JSON.stringify({ newEmail: `moved-v${++people}@example.com` }),
    });
    expect(moved.ok).toBe(false);
    const holders = await env.DB.prepare(`select id from "user" where email = ?`)
      .bind(first.email)
      .all<{ id: string }>();
    expect(holders.results).toEqual([{ id: first.id }]);

    // The old link verifies the one account that ever held the address, and nobody else.
    const bystander = await signUp("Kai");
    expect((await api(`/auth/verify-email?token=${encodeURIComponent(token)}`)).status).toBe(200);
    expect(await verified(first.id)).toBe(1);
    expect(await verified(bystander.id)).toBe(0);
  });
});
