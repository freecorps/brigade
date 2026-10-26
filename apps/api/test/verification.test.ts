// Email verification (RFC 0002 "Auth"): the email sent at sign-up and on request, the dashboard link it carries,
// verifying with it (and with an expired or broken one), the limits on asking again, and what the email says.
import { env, exports } from "cloudflare:workers";
import { createEmailVerificationToken } from "better-auth/api";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import {
  createAuth,
  EMAIL_NOT_CONFIGURED_CODE,
  safeNext,
  VERIFICATION_RESEND_LIMIT,
} from "../src/auth.ts";
import { renderVerificationEmail } from "../src/email-templates.ts";

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

async function signUp(name: string, locale?: string) {
  const email = `${name.toLowerCase()}-v${++people}@example.com`;
  const response = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name, email, password: PASSWORD, ...(locale ? { locale } : {}) }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
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
    const other = await resend({ email: "someone-else@example.com", cookie: caio.cookie });
    expect(other.status).toBe(400);

    const sent = outbox();
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
  test("in the user's language, with what they typed escaped in the HTML", () => {
    const name = `<img src=x onerror="alert(1)"> & Co`;
    const link = "https://brigade.example.com/verify-email?token=a.b.c&next=%2Finvitations%2Finv_x";
    const en = renderVerificationEmail({ email: "ana@example.com", name }, link, "en");
    expect(en.subject).toBe("Confirm your email for Brigade");
    expect(en.to).toEqual({ email: "ana@example.com", name });
    expect(en.text).toContain(`Hi ${name},`);
    expect(en.text).toContain(link);
    expect(en.html).not.toContain("<img");
    expect(en.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Co");
    expect(en.html).toContain(`href="${link.replace(/&/g, "&amp;")}"`);
    const pt = renderVerificationEmail({ email: "ana@example.com" }, link, "pt-BR");
    expect(pt.subject).toBe("Confirme seu email no Brigade");
    expect(pt.text).not.toContain("Olá");
    expect(pt.html).toContain('lang="pt-BR"');
  });

  test("a name with line breaks cannot add headers", () => {
    const email = renderVerificationEmail(
      { email: "ana@example.com", name: "Ana\r\nBcc: someone@example.com" },
      "https://brigade.example.com/verify-email?token=t",
      "en",
    );
    expect(email.to.name).toBe("Ana Bcc: someone@example.com");
    expect(email.subject).not.toMatch(/[\r\n]/);
  });
});
