// The email notifier (RFC 0005 "Email"), run by the `brigade-events` consumer (src/notify.ts) next to push: for a
// page that failed (`notification.failed`), the workspace shard plans who is emailed (src/mailer.ts), this looks the
// recipients' addresses and locales up in D1, renders each email (src/email-templates.ts), sends it through the
// configured `EmailSender` (src/email.ts) and reports back. Email never sits in front of a page: it only acts on
// failures the push notifier already recorded, each message is handled on its own (a page in the same batch goes
// out in parallel), and every wait here is bounded.

import { resolveLocale } from "@freecorps/brigade-i18n";
import { renderEmail } from "./email-templates.ts";
import type { EmailSender } from "./email.ts";
import type { EmailJob, EmailOutcome, EmailPlan } from "./mailer.ts";
import type { BrigadeEvent } from "./outbox.ts";

/**
 * Deliveries of a failed page's event before an email that keeps failing is recorded on the timeline. Below the
 * Queue's `max_retries` (`QUEUE_MAX_RETRIES`), so the consumer gives up first, and records it.
 */
export const MAX_EMAIL_ATTEMPTS = 5;
/** Delay before trying an email again: 30 s, 1, 2, 4 minutes. Not urgent like a page; a limit needs time to pass. */
export const EMAIL_RETRY_FIRST_SECONDS = 30;
export const EMAIL_RETRY_MAX_SECONDS = 300;
/** How long the D1 read of the recipients may take. */
export const RECIPIENTS_TIMEOUT_MS = 5000;
/** The most owners one email goes to. */
export const MAX_OWNER_RECIPIENTS = 50;

export type EmailNotifyEnv = {
  WORKSPACE: Env["WORKSPACE"];
  /** D1: the recipients' addresses, names and locales (Better Auth's `user` and `member`). */
  DB?: D1Database;
  /** The dashboard's origin, for a link to the incident (a secret like `RELAY_URL`); no link without it. */
  DASHBOARD_URL?: string;
};

/** Seconds before the next delivery of an email's event on its `attempts`-th try (1 the first time). */
export function emailRetryDelay(attempts: number): number {
  return Math.min(
    EMAIL_RETRY_MAX_SECONDS,
    EMAIL_RETRY_FIRST_SECONDS * 2 ** Math.max(0, attempts - 1),
  );
}

/**
 * The email notifier for one event. Returns true when it should be tried again later (some email failed in a way
 * that may pass and attempts remain, or another delivery holds an email it asks for); what was sent is recorded
 * either way. Without a sender (email not set up) it does nothing. Throws only when the shard cannot be reached.
 */
export async function notifyEmail(
  event: BrigadeEvent,
  attempts: number,
  env: EmailNotifyEnv,
  sender: EmailSender | undefined,
): Promise<boolean> {
  if (!sender) return false;
  const workspace = env.WORKSPACE.getByName(event.workspaceId);
  const plan = await workspace.planEmail(event);
  if (!plan.send) {
    // Another delivery is sending it; this one comes back to find it done (or to take it over if that one died).
    return plan.reason === "busy" && attempts < MAX_EMAIL_ATTEMPTS;
  }
  const retries = await Promise.all(
    plan.jobs.map(async (job) => {
      const outcomes = await sendJob(event, job, plan, env, sender);
      const final = !outcomes.some((one) => one.retry) || attempts >= MAX_EMAIL_ATTEMPTS;
      await workspace.recordEmail(
        event,
        job.key,
        job.about,
        outcomes.map(({ userId, ok }): EmailOutcome => ({ userId, ok })),
        final,
      );
      return !final;
    }),
  );
  return retries.some(Boolean);
}

type Sent = EmailOutcome & { retry: boolean };

/** Sends one planned email to each of its recipients not reached yet. Never throws. */
async function sendJob(
  event: BrigadeEvent,
  job: EmailJob,
  plan: Extract<EmailPlan, { send: true }>,
  env: EmailNotifyEnv,
  sender: EmailSender,
): Promise<Sent[]> {
  let recipients: Recipient[];
  try {
    recipients = await lookUp(env.DB, event.workspaceId, job.to);
  } catch (error) {
    log("email recipients could not be read", {
      event: event.id,
      about: job.about,
      error: String(error),
    });
    // Known recipients count as failed (and are recorded if this was the last try); owners are only known from D1.
    const ids = "userIds" in job.to ? job.to.userIds : [];
    return ids
      .filter((userId) => !job.sent.includes(userId))
      .map((userId) => ({ userId, ok: false, retry: true }));
  }
  const pending = recipients.filter((recipient) => !job.sent.includes(recipient.userId));
  return Promise.all(
    pending.map(async (recipient): Promise<Sent> => {
      const email = renderEmail(
        job.about === "unpaged"
          ? { about: "unpaged", reason: job.reason ?? "undelivered" }
          : { about: "nobody_paged" },
        { incident: plan.incident, workspace: plan.workspace, dashboardUrl: env.DASHBOARD_URL },
        { email: recipient.email, ...(recipient.name ? { name: recipient.name } : {}) },
        resolveLocale(recipient.locale ?? undefined),
      );
      const result = await sender.send(email);
      if (result.ok) return { userId: recipient.userId, ok: true, retry: false };
      // Never the address or the content.
      log("email refused", {
        event: event.id,
        incident: plan.incident.id,
        about: job.about,
        sender: sender.id,
        code: result.code,
        retry: result.retry,
      });
      return { userId: recipient.userId, ok: false, retry: result.retry };
    }),
  );
}

type Recipient = { userId: string; email: string; name: string | null; locale: string | null };

/**
 * The recipients' addresses, names and locales from D1, for members of the workspace only: a member removed since
 * the page is not emailed about it. D1 is the authority for addresses (the shard keeps none) and for who the owners
 * are (the shard's list has only those who opened Brigade).
 */
async function lookUp(
  db: D1Database | undefined,
  workspaceId: string,
  to: EmailJob["to"],
): Promise<Recipient[]> {
  if (!db) throw new Error("no D1 binding");
  if ("userIds" in to && to.userIds.length === 0) return [];
  const select = `select u.id as userId, u.email as email, u.name as name, u.locale as locale
    from "member" m join "user" u on u.id = m.userId where m.organizationId = ?`;
  const query =
    "owners" in to
      ? db
          .prepare(`${select} and m.role = 'owner' order by m.createdAt limit ?`)
          .bind(workspaceId, MAX_OWNER_RECIPIENTS)
      : db
          .prepare(`${select} and m.userId in (${to.userIds.map(() => "?").join(", ")})`)
          .bind(workspaceId, ...to.userIds);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { results } = await Promise.race([
      query.all<Recipient>(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("D1 timed out")), RECIPIENTS_TIMEOUT_MS);
      }),
    ]);
    return results;
  } finally {
    clearTimeout(timer);
  }
}

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, notifier: "email", ...fields }));
}
