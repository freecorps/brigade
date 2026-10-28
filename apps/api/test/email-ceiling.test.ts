// The Brigade-wide daily email ceiling (RFC 0005 "Abuse", Q21; src/email-ceiling.ts): counted in D1 across every
// workspace, past it emails are dropped and logged, and an email about a page that failed is never dropped.
import { env } from "cloudflare:workers";
import { describe, expect, test, vi } from "vite-plus/test";
import {
  CEILING_CODE,
  CEILING_COUNT_TIMEOUT_MS,
  EMAIL_DAILY_CEILING_DEFAULT,
  emailDailyCeiling,
  pruneEmailDays,
  withEmailCeiling,
} from "../src/email-ceiling.ts";
import { emailSender, type EmailSender, type OutgoingEmail } from "../src/email.ts";

let days = 0;
/** A day of its own per test (far from today), so no test sees another's counts. */
const day = () => Date.UTC(2001, 0, 1) + ++days * 30 * 24 * 60 * 60 * 1000;

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

const email = (to: string, priority?: "paging"): OutgoingEmail => ({
  to: { email: to },
  subject: "Hello",
  text: "Hello",
  html: "<p>Hello</p>",
  ...(priority ? { priority } : {}),
});

const counted = async (at: number) =>
  (
    await env.DB.prepare(`select "sent" from "email_day" where "day" = ?`)
      .bind(new Date(at).toISOString().slice(0, 10))
      .first<{ sent: number }>()
  )?.sent ?? 0;

describe("the instance's daily email ceiling", () => {
  test("EMAIL_DAILY_CEILING: a whole number, else the default; a typo never turns it off", () => {
    expect(emailDailyCeiling(undefined)).toBe(EMAIL_DAILY_CEILING_DEFAULT);
    expect(emailDailyCeiling("500")).toBe(500);
    expect(emailDailyCeiling(" 20 ")).toBe(20);
    for (const wrong of ["0", "-5", "lots", "1e3", "", "2.5"]) {
      expect(emailDailyCeiling(wrong), wrong).toBe(EMAIL_DAILY_CEILING_DEFAULT);
    }
  });

  test("past the ceiling an email is dropped and logged, never retried; a new day starts again", async () => {
    let now = day();
    const mail = recorder();
    const capped = withEmailCeiling(mail.sender, env.DB, 2, () => now);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await capped.send(email("a@example.com"))).toEqual({ ok: true });
      expect(await capped.send(email("b@example.com"))).toEqual({ ok: true });
      expect(await capped.send(email("c@example.com"))).toEqual({
        ok: false,
        retry: false,
        code: CEILING_CODE,
      });
      expect(mail.sent.map((one) => one.to.email)).toEqual(["a@example.com", "b@example.com"]);
      // Logged without the address.
      const logged = error.mock.calls.map((call) => String(call[0]));
      expect(logged.some((line) => line.includes("daily ceiling is reached"))).toBe(true);
      expect(logged.some((line) => line.includes("c@example.com"))).toBe(false);
      expect(await counted(now)).toBe(2);
      now += 24 * 60 * 60 * 1000;
      expect(await capped.send(email("d@example.com"))).toEqual({ ok: true });
    } finally {
      error.mockRestore();
    }
  });

  test("an email about a failed page is never dropped: counted, and sent past the ceiling", async () => {
    const now = day();
    const mail = recorder();
    const capped = withEmailCeiling(mail.sender, env.DB, 1, () => now);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await capped.send(email("signup@example.com"))).toEqual({ ok: true });
      expect((await capped.send(email("status@example.com"))).ok).toBe(false);
      for (const to of ["oncall@example.com", "owner@example.com", "admin@example.com"]) {
        expect(await capped.send(email(to, "paging"))).toEqual({ ok: true });
      }
      expect(mail.sent.map((one) => one.to.email)).toEqual([
        "signup@example.com",
        "oncall@example.com",
        "owner@example.com",
        "admin@example.com",
      ]);
      // They count, so the rest of the day stays closed.
      expect(await counted(now)).toBe(4);
      expect((await capped.send(email("late@example.com"))).ok).toBe(false);
    } finally {
      error.mockRestore();
    }
  });

  test("sends at once from many isolates never overshoot it", async () => {
    const now = day();
    const mail = recorder();
    const capped = withEmailCeiling(mail.sender, env.DB, 5, () => now);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) => capped.send(email(`p${i}@example.com`))),
      );
      expect(results.filter((one) => one.ok)).toHaveLength(5);
      expect(mail.sent).toHaveLength(5);
      expect(await counted(now)).toBe(5);
    } finally {
      error.mockRestore();
    }
  });

  test("D1 failing sends anyway, logged: the ceiling never stops a page's email or a reset", async () => {
    const mail = recorder();
    const broken = {
      prepare: () => {
        throw new Error("D1 is down");
      },
    } as unknown as D1Database;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const capped = withEmailCeiling(mail.sender, broken, 1);
      expect(await capped.send(email("a@example.com"))).toEqual({ ok: true });
      expect(await capped.send(email("b@example.com", "paging"))).toEqual({ ok: true });
      expect(mail.sent).toHaveLength(2);
    } finally {
      error.mockRestore();
    }
  });

  test("a D1 that hangs never holds up an email: a page's at once, any other after a bounded wait", async () => {
    const mail = recorder();
    const hung = {
      prepare: () => ({
        bind: () => ({ first: () => new Promise(() => {}) }),
      }),
    } as unknown as D1Database;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const capped = withEmailCeiling(mail.sender, hung, 1);
      // The page's email goes out before D1 answers; its count is let go after the bounded wait.
      const page = capped.send(email("a@example.com", "paging"));
      await vi.advanceTimersByTimeAsync(0);
      expect(mail.sent).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(CEILING_COUNT_TIMEOUT_MS);
      expect(await page).toEqual({ ok: true });
      // Any other waits for the count only so long, then is sent anyway.
      const reset = capped.send(email("b@example.com"));
      await vi.advanceTimersByTimeAsync(CEILING_COUNT_TIMEOUT_MS - 1);
      expect(mail.sent).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await reset).toEqual({ ok: true });
      expect(mail.sent).toHaveLength(2);
    } finally {
      vi.useRealTimers();
      error.mockRestore();
    }
  });

  test("every sender the Worker picks with D1 is under the ceiling, keeping its id", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const sender = emailSender({ EMAIL_LOG: "1", DB: env.DB, EMAIL_DAILY_CEILING: "1" })!;
      expect(sender.id).toBe("log");
      // Today's count may already hold other sends of this file; fill it to the ceiling first.
      await sender.send(email("first@example.com"));
      expect(await sender.send(email("second@example.com"))).toMatchObject({
        ok: false,
        code: CEILING_CODE,
      });
      expect(await sender.send(email("page@example.com", "paging"))).toEqual({ ok: true });
    } finally {
      error.mockRestore();
      log.mockRestore();
    }
  });

  test("the cron keeps a week of days", async () => {
    const now = day();
    const old = now - 8 * 24 * 60 * 60 * 1000;
    const recent = now - 6 * 24 * 60 * 60 * 1000;
    const mail = recorder();
    await withEmailCeiling(mail.sender, env.DB, 10, () => old).send(email("a@example.com"));
    await withEmailCeiling(mail.sender, env.DB, 10, () => recent).send(email("b@example.com"));
    await pruneEmailDays(env.DB, now);
    expect(await counted(old)).toBe(0);
    expect(await counted(recent)).toBe(1);
  });
});
