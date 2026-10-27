// The email notifier (RFC 0005 "Email"), run by the `brigade-events` consumer (src/notify.ts) next to push: for a
// page that failed (`notification.failed`), the workspace shard plans who is emailed (src/mailer.ts), this looks the
// recipients' addresses and locales up in D1, renders each email (src/email-templates.ts), sends it through the
// configured `EmailSender` (src/email.ts) and reports back. Email never sits in front of a page: it only acts on
// failures the push notifier already recorded, each message is handled on its own (a page in the same batch goes
// out in parallel), and every wait here is bounded.

import { resolveLocale } from "@freecorps/brigade-i18n";
import { renderEmail } from "./email-templates.ts";
import type { EmailSender } from "./email.ts";
import {
  EMAIL_CLAIM_MS,
  EMAIL_USER_HOURLY_CAP,
  type EmailBudget,
  type EmailJob,
  type EmailOutcome,
  type EmailPlan,
} from "./mailer.ts";
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

/** Seconds before retrying an event whose email another delivery holds until `until`: never less than a hold. */
export function heldDelay(attempts: number, until: number, now: number): number {
  return Math.max(
    emailRetryDelay(attempts),
    Math.ceil(Math.max(EMAIL_CLAIM_MS, until - now) / 1000),
  );
}

/**
 * The email notifier for one event. Returns the seconds to wait before trying it again, or undefined when it is
 * done: retried when some email failed in a way that may pass and attempts remain, or when an email it asks for is
 * held by another delivery (which may die); what was sent is recorded either way. Without a sender (email not set
 * up) it does nothing. Throws only when the shard cannot be reached.
 */
export async function notifyEmail(
  event: BrigadeEvent,
  attempts: number,
  env: EmailNotifyEnv,
  sender: EmailSender | undefined,
): Promise<number | undefined> {
  if (!sender) return undefined;
  const workspace = env.WORKSPACE.getByName(event.workspaceId);
  const plan = await workspace.planEmail(event);
  if (!plan.send) {
    return plan.reason === "held" ? heldDelay(attempts, plan.until, Date.now()) : undefined;
  }
  // Shared by the plan's jobs, so one user in two of them (an owner the page missed) counts once per email.
  const budget: EmailBudget = { workspace: plan.budget.workspace, users: { ...plan.budget.users } };
  const retries = await Promise.all(
    plan.jobs.map(async (job) => {
      const { outcomes, unread } = await sendJob(event, job, plan, budget, env, sender);
      const final =
        (!unread && !outcomes.some((one) => one.retry)) || attempts >= MAX_EMAIL_ATTEMPTS;
      if (final && unread && "owners" in job.to) {
        // Nobody to put on the timeline: the owners are only known from D1.
        log("email failed", { event: event.id, incident: plan.incident.id, about: job.about });
      }
      await workspace.recordEmail(
        event,
        job.key,
        job.about,
        outcomes.map(({ userId, ok, capped }): EmailOutcome =>
          capped ? { userId, ok, capped } : { userId, ok },
        ),
        final,
      );
      return !final;
    }),
  );
  if (plan.heldUntil !== undefined) return heldDelay(attempts, plan.heldUntil, Date.now());
  return retries.some(Boolean) ? emailRetryDelay(attempts) : undefined;
}

type Sent = EmailOutcome & { retry: boolean };

/**
 * Sends one planned email to each of its recipients not reached yet, within `budget` (which it spends). `unread`:
 * the recipients could not be read from D1, so it is worth retrying even when nobody is known to have missed it.
 * Never throws.
 */
async function sendJob(
  event: BrigadeEvent,
  job: EmailJob,
  plan: Extract<EmailPlan, { send: true }>,
  budget: EmailBudget,
  env: EmailNotifyEnv,
  sender: EmailSender,
): Promise<{ outcomes: Sent[]; unread: boolean }> {
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
    const outcomes = ids
      .filter((userId) => !job.sent.includes(userId))
      .map((userId) => ({ userId, ok: false, retry: true }));
    return { outcomes, unread: true };
  }
  const pending = recipients.filter((recipient) => !job.sent.includes(recipient.userId));
  const outcomes = await Promise.all(
    pending.map(async (recipient): Promise<Sent> => {
      // Spent before the first await, so the plan's jobs, sending in parallel, never overdraw it.
      const sends = budget.users[recipient.userId] ?? 0;
      if (budget.workspace <= 0 || sends >= EMAIL_USER_HOURLY_CAP) {
        return { userId: recipient.userId, ok: false, capped: true, retry: false };
      }
      budget.workspace--;
      budget.users[recipient.userId] = sends + 1;
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
  return { outcomes, unread: false };
}

export type Recipient = {
  userId: string;
  email: string;
  name: string | null;
  locale: string | null;
};

/**
 * The recipients' addresses, names and locales from D1, for members of the workspace whose address is verified
 * only: a member removed since the page is not emailed about it, nor one who never proved their address (nothing is
 * recorded for them: there is no email to retry). D1 is the authority for addresses (the shard keeps none) and for who the owners
 * are (the shard's list has only those who opened Brigade).
 */
export async function lookUp(
  db: D1Database | undefined,
  workspaceId: string,
  to: EmailJob["to"],
): Promise<Recipient[]> {
  if (!db) throw new Error("no D1 binding");
  if ("userIds" in to && to.userIds.length === 0) return [];
  // Verified addresses only (RFC 0005 "Abuse"): an unproven address may be someone else's.
  const select = `select u.id as userId, u.email as email, u.name as name, u.locale as locale
    from "member" m join "user" u on u.id = m.userId
    where m.organizationId = ? and u.emailVerified = 1`;
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
