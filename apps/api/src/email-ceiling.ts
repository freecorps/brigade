// The Brigade-wide daily email ceiling (RFC 0005 "Abuse", Q21): every email the instance sends, from every workspace
// and of every kind, is counted in D1 (`email_day`, one row per UTC day), and past `EMAIL_DAILY_CEILING` an email is
// dropped and logged rather than sent. It sits below the per-feature caps and below the sender's own quota (Cloudflare
// Email Sending answers `E_RATE_LIMIT_EXCEEDED` past it), so one busy or abused workspace cannot use up the sends of
// the others. Emails about a page that failed (`priority: "paging"`) are counted but never dropped: a day of sign-ups
// or status page subscribers must never cost a missed page its email.
//
// Kept free of Workers imports: the database comes in as an argument.

import type { EmailResult, EmailSender, OutgoingEmail } from "./email.ts";

/** The emails a day an instance sends at most when `EMAIL_DAILY_CEILING` is not set. */
export const EMAIL_DAILY_CEILING_DEFAULT = 2000;
/** The highest ceiling `EMAIL_DAILY_CEILING` may set; anything above is taken as this. */
export const EMAIL_DAILY_CEILING_MAX = 1_000_000;
/** How many days of counts the cron keeps (`pruneEmailDays`). */
const KEEP_DAYS = 7;
/**
 * How long a send waits for D1 to count it. Past this it is sent anyway, as when D1 fails: every wait on the email
 * path is bounded, and a D1 that hangs must not hold up a verification, a reset, or anything else.
 */
export const CEILING_COUNT_TIMEOUT_MS = 1500;
/** The code a dropped email answers with; never retried. */
export const CEILING_CODE = "E_BRIGADE_DAILY_CEILING";

/**
 * The ceiling from the `EMAIL_DAILY_CEILING` variable: a whole number from 1 to `EMAIL_DAILY_CEILING_MAX`. Unset or
 * unreadable is `EMAIL_DAILY_CEILING_DEFAULT`, so a typo never turns the ceiling off.
 */
export function emailDailyCeiling(value: unknown): number {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,9}$/.test(text)) return EMAIL_DAILY_CEILING_DEFAULT;
  const ceiling = Number(text);
  if (ceiling < 1) return EMAIL_DAILY_CEILING_DEFAULT;
  return Math.min(ceiling, EMAIL_DAILY_CEILING_MAX);
}

/** The UTC day `at` falls on, `YYYY-MM-DD`: the row it counts in. */
const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);

/**
 * `sender` under the instance's daily ceiling, counted in `db`. Each send first counts itself with one upsert, which
 * only goes through below the ceiling (so isolates sending at once never overshoot it); one that does not is dropped,
 * logged and answered `{ ok: false, retry: false }`. A `priority: "paging"` email is sent first and never waits on D1:
 * it is counted alongside the send (a lost count is fine), so a D1 that hangs, the very outage the operators' email
 * is about, never holds it up. If D1 cannot count another email within `CEILING_COUNT_TIMEOUT_MS`, or fails, it is
 * sent anyway and the failure logged: the per-feature caps still hold, and a D1 outage must not stop a verification or
 * a reset. Counted before the send, so an attempt that fails and is retried counts each time.
 */
export function withEmailCeiling(
  sender: EmailSender,
  db: D1Database,
  ceiling: number,
  now: () => number = Date.now,
): EmailSender {
  return {
    id: sender.id,
    async send(email: OutgoingEmail): Promise<EmailResult> {
      const paging = email.priority === "paging";
      const day = dayOf(now());
      const count = (async () => {
        const row = await db
          .prepare(
            paging
              ? `insert into "email_day" ("day", "sent") values (?1, 1)
                 on conflict ("day") do update set "sent" = "sent" + 1 returning "sent"`
              : `insert into "email_day" ("day", "sent") values (?1, 1)
                 on conflict ("day") do update set "sent" = "sent" + 1 where "sent" < ?2 returning "sent"`,
          )
          .bind(day, ...(paging ? [] : [ceiling]))
          .first<{ sent: number }>();
        return row !== null;
      })();
      if (paging) {
        const [result] = await Promise.all([
          sender.send(email),
          bounded(count).catch((error: unknown) => {
            log("email ceiling not counted", { day, error: String(error) });
          }),
        ]);
        return result;
      }
      let counted: boolean;
      try {
        counted = await bounded(count);
      } catch (error) {
        log("email ceiling not counted: sending anyway", { day, error: String(error) });
        counted = true;
      }
      if (!counted) {
        // Never the address or the content.
        log("email dropped: the instance's daily ceiling is reached", {
          day,
          ceiling,
          sender: sender.id,
        });
        return { ok: false, retry: false, code: CEILING_CODE };
      }
      return sender.send(email);
    },
  };
}

/** `promise`, or a rejection once `CEILING_COUNT_TIMEOUT_MS` passed. */
function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("D1 timed out")), CEILING_COUNT_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Deletes the counts of days older than `KEEP_DAYS` (the cron). Never throws. */
export async function pruneEmailDays(db: D1Database, now: number): Promise<void> {
  try {
    await db
      .prepare(`delete from "email_day" where "day" < ?`)
      .bind(dayOf(now - KEEP_DAYS * 24 * 60 * 60 * 1000))
      .run();
  } catch (error) {
    log("pruning the email ceiling's days failed", { error: String(error) });
  }
}

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, notifier: "email", ...fields }));
}
