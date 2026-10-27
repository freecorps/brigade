// Reminders of follow-ups due (RFC 0013 "Reminders"), run by the `brigade-events` consumer (src/notify.ts) for
// `follow_up.reminder_due`, which the shard's alarm emits at most once per member and day. The shard plans the email
// (src/mailer.ts `planReminder`: what is still due, claimed in the email ledger), this reads the member's address and
// language from D1, renders it (src/email-templates.ts), sends it within its caps and reports back. It
// shares the email notifier's ledger and retries but has caps of its own (src/mailer.ts `REMINDER_*_CAP`), which never
// spend the paging emails' caps, and is never on a paging path: nothing pages from here, and a
// page in the same batch goes out without waiting for it.

import { resolveLocale } from "@freecorps/brigade-i18n";
import { dashboardLink, renderReminderEmail } from "./email-templates.ts";
import type { EmailSender } from "./email.ts";
import { REMINDER_USER_DAILY_CAP, type EmailOutcome } from "./mailer.ts";
import {
  emailRetryDelay,
  heldDelay,
  lookUp,
  MAX_EMAIL_ATTEMPTS,
  type EmailNotifyEnv,
  type Recipient,
} from "./notify-email.ts";
import type { BrigadeEvent } from "./outbox.ts";

/**
 * The reminder for one event. Returns the seconds to wait before trying it again, or undefined when it is done:
 * retried when the send failed in a way that may pass (or D1 could not be read) and attempts remain, or when another
 * delivery holds it. Without a sender (email not set up) it does nothing. Throws only when the shard cannot be reached.
 */
export async function notifyReminder(
  event: BrigadeEvent,
  attempts: number,
  env: EmailNotifyEnv,
  sender: EmailSender | undefined,
): Promise<number | undefined> {
  if (!sender) return undefined;
  const workspace = env.WORKSPACE.getByName(event.workspaceId);
  const plan = await workspace.planReminder(event);
  if (!plan.send) {
    return plan.reason === "held" ? heldDelay(attempts, plan.until, Date.now()) : undefined;
  }
  const last = attempts >= MAX_EMAIL_ATTEMPTS;
  let recipient: Recipient | undefined;
  try {
    [recipient] = await lookUp(env.DB, event.workspaceId, { userIds: [plan.userId] });
  } catch (error) {
    log("reminder recipient could not be read", { event: event.id, error: String(error) });
    await workspace.recordReminder(event, { userId: plan.userId, ok: false }, last);
    return last ? undefined : emailRetryDelay(attempts);
  }
  // No longer a member, or their address is not verified: nobody to send it to, and nothing to retry.
  if (!recipient) {
    await workspace.recordReminder(event, { userId: plan.userId, ok: false }, true);
    return undefined;
  }
  const sends = plan.budget.users[plan.userId] ?? 0;
  if (plan.budget.workspace <= 0 || sends >= REMINDER_USER_DAILY_CAP) {
    await workspace.recordReminder(event, { userId: plan.userId, ok: false, capped: true }, true);
    return undefined;
  }
  // The dashboard's Email card (`id="email"` on the overview), where reminders are turned off.
  const home = dashboardLink("/", {}, env.DASHBOARD_URL, undefined);
  const email = renderReminderEmail(
    { workspace: plan.workspace, items: plan.items, total: plan.total },
    { email: recipient.email, ...(recipient.name ? { name: recipient.name } : {}) },
    dashboardLink("/follow-ups", {}, env.DASHBOARD_URL, undefined),
    resolveLocale(recipient.locale ?? undefined),
    home && `${home}#email`,
  );
  const result = await sender.send(email);
  if (!result.ok) {
    // Never the address or the content.
    log("reminder refused", {
      event: event.id,
      sender: sender.id,
      code: result.code,
      retry: result.retry,
    });
  }
  const outcome: EmailOutcome = { userId: plan.userId, ok: result.ok };
  const final = result.ok || !result.retry || last;
  await workspace.recordReminder(event, outcome, final);
  return final ? undefined : emailRetryDelay(attempts);
}

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, notifier: "reminder", ...fields }));
}
