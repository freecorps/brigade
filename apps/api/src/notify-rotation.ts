// The owners' email about a member taken out of on-call schedules (RFC 0003 "Schedules", Q20), run by the
// `brigade-events` consumer (src/notify.ts) for `member.removed`, or `member.role_changed` to a viewer, that lists the
// schedules they left. The shard plans it (src/mailer.ts `planRotation`: claimed in the email ledger, within the
// paging emails' caps), this reads the owners (verified addresses only) and the member's name from D1, renders it in
// each owner's language (src/email-templates.ts), sends and reports back. Never on a paging path: nothing pages from
// here, and a page in the same batch goes out without waiting for it.

import { resolveLocale } from "@freecorps/brigade-i18n";
import { dashboardLink, renderRotationEmail } from "./email-templates.ts";
import type { EmailSender } from "./email.ts";
import { EMAIL_USER_HOURLY_CAP, type EmailOutcome } from "./mailer.ts";
import {
  emailRetryDelay,
  heldDelay,
  lookUp,
  MAX_EMAIL_ATTEMPTS,
  withinRecipientsTimeout,
  type EmailNotifyEnv,
  type Recipient,
} from "./notify-email.ts";
import type { BrigadeEvent } from "./outbox.ts";

/**
 * The owners' email for one member event. Returns the seconds to wait before trying it again, or undefined when it is
 * done: retried when some send failed in a way that may pass (or D1 could not be read) and attempts remain, or when
 * another delivery holds it. Without a sender (email not set up) it does nothing. Throws only when the shard cannot be
 * reached.
 */
export async function notifyRotation(
  event: BrigadeEvent,
  attempts: number,
  env: EmailNotifyEnv,
  sender: EmailSender | undefined,
): Promise<number | undefined> {
  if (!sender) return undefined;
  const workspace = env.WORKSPACE.getByName(event.workspaceId);
  const plan = await workspace.planRotationEmail(event);
  if (!plan.send) {
    return plan.reason === "held" ? heldDelay(attempts, plan.until, Date.now()) : undefined;
  }
  const last = attempts >= MAX_EMAIL_ATTEMPTS;
  let owners: Recipient[];
  let member: string | null;
  try {
    [owners, member] = await Promise.all([
      lookUp(env.DB, event.workspaceId, { ownersOnly: true }),
      memberName(env.DB, plan.userId),
    ]);
  } catch (error) {
    // Who the owners are is what could not be read: only logged after the last attempt.
    log("rotation email recipients could not be read", { event: event.id, error: String(error) });
    await workspace.recordRotationEmail(event, [], last);
    return last ? undefined : emailRetryDelay(attempts);
  }
  // The On-call card on the overview (`id="oncall"`).
  const home = dashboardLink("/", {}, env.DASHBOARD_URL, undefined);
  const url = home && `${home}#oncall`;
  const users = { ...plan.budget.users };
  let left = plan.budget.workspace;
  const outcomes = await Promise.all(
    owners
      .filter((owner) => !plan.sent.includes(owner.userId))
      .map(async (owner): Promise<EmailOutcome & { retry: boolean }> => {
        // Spent before the first await, so the sends in parallel never overdraw the caps.
        const sends = users[owner.userId] ?? 0;
        if (left <= 0 || sends >= EMAIL_USER_HOURLY_CAP) {
          return { userId: owner.userId, ok: false, capped: true, retry: false };
        }
        left--;
        users[owner.userId] = sends + 1;
        const result = await sender.send(
          renderRotationEmail(
            {
              workspace: plan.workspace,
              member,
              cause: plan.cause,
              schedules: plan.schedules,
            },
            { email: owner.email, ...(owner.name ? { name: owner.name } : {}) },
            url,
            resolveLocale(owner.locale ?? undefined),
          ),
        );
        if (result.ok) return { userId: owner.userId, ok: true, retry: false };
        // Never the address or the content.
        log("rotation email refused", {
          event: event.id,
          sender: sender.id,
          code: result.code,
          retry: result.retry,
        });
        return { userId: owner.userId, ok: false, retry: result.retry };
      }),
  );
  const final = last || !outcomes.some((one) => one.retry);
  await workspace.recordRotationEmail(
    event,
    outcomes.map(({ userId, ok, capped }) => (capped ? { userId, ok, capped } : { userId, ok })),
    final,
  );
  return final ? undefined : emailRetryDelay(attempts);
}

/**
 * The member's name from D1's `user` (not `member`: a member removed is no longer in it), or null when they have
 * none or the account is gone. Their name is all the email says about them.
 */
async function memberName(db: D1Database | undefined, userId: string): Promise<string | null> {
  if (!db) throw new Error("no D1 binding");
  const row = await withinRecipientsTimeout(
    db
      .prepare(`select name from "user" where id = ?`)
      .bind(userId)
      .first<{ name: string | null }>(),
  );
  return row?.name ?? null;
}

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, notifier: "rotation", ...fields }));
}
