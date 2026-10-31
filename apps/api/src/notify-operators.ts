// The instance operators' email (RFC 0007 "Watching the watcher", Q19): each `brigade.status_changed` the watchdog
// writes (the paging self-check turned degraded, back to ok, or unknown) goes by email to the addresses in
// `OPERATOR_EMAILS`, through the same sender as every other email. The watchdog sends it itself the moment the status
// changes (src/watchdog.ts), so a stalled Queue, the very thing it may be reporting, does not hold it back; the event
// also goes through the Queue, and the consumer sends it only when the watchdog's send did not go out. Capped by the
// watchdog (`OPERATOR_EMAIL_HOURLY_CAP` events an hour, each once), and never in a page's way: the consumer runs it
// alongside the batch's pages and acks the event whatever happens.

import type { EmailSender } from "./email.ts";
import { renderOperatorStatusEmail } from "./email-templates.ts";
import type { BrigadeEvent } from "./outbox.ts";

/** The most operators one status change is emailed to. */
export const MAX_OPERATOR_RECIPIENTS = 10;

export type OperatorEnv = {
  /**
   * The instance's operators, comma-separated addresses (a secret or a variable; no address is in the repo). Empty or
   * unset: nobody is emailed, and the logs still say it.
   */
  OPERATOR_EMAILS?: string;
};

/**
 * `OPERATOR_EMAILS` as addresses: trimmed, each once (lowercased, so one written twice in another case is emailed
 * once), things that are not an address dropped, at most 10.
 */
export function operatorAddresses(raw: string | undefined): string[] {
  const seen = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const address = part.trim().toLowerCase();
    if (!/^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(address)) continue;
    seen.add(address);
    if (seen.size === MAX_OPERATOR_RECIPIENTS) break;
  }
  return [...seen];
}

/**
 * What one attempt came to: `sent` to at least one operator; `skipped` (nobody to email, no sender, not a status
 * change, or the claim refused: capped or sent already); `failed`, claimed but no email went out.
 */
export type OperatorEmailOutcome = "sent" | "skipped" | "failed";

/**
 * Emails the operators about a status change (a `brigade.status_changed` event), once `claim` (the watchdog's
 * `claimOperatorEmail`) allows it. Never throws.
 */
export async function notifyOperators(
  event: BrigadeEvent,
  env: OperatorEnv,
  mail: EmailSender | undefined,
  claim: (eventId: string) => Promise<boolean>,
): Promise<OperatorEmailOutcome> {
  const to = operatorAddresses(env.OPERATOR_EMAILS);
  if (to.length === 0 || !mail) return "skipped";
  const data = (event.data ?? {}) as { status?: unknown; reasons?: unknown };
  const status =
    data.status === "ok" || data.status === "degraded" || data.status === "unknown"
      ? data.status
      : undefined;
  if (!status) return "skipped";
  const reasons = Array.isArray(data.reasons)
    ? data.reasons.filter((one): one is string => typeof one === "string")
    : [];
  try {
    if (!(await claim(event.id))) {
      log("operator email not sent: capped or sent already", { event: event.id });
      return "skipped";
    }
  } catch (error) {
    log("operator email not sent: the watchdog could not be asked", { error: String(error) });
    return "skipped";
  }
  const results = await Promise.all(
    to.map((email) =>
      mail
        // About paging itself failing: never dropped by the daily ceiling (src/email-ceiling.ts).
        .send({
          ...renderOperatorStatusEmail({ status, reasons }, { email }, "en"),
          priority: "paging",
        })
        .catch((error: unknown) => ({ ok: false as const, retry: false, code: String(error) })),
    ),
  );
  const failed = results.filter((result) => !result.ok).length;
  if (failed > 0) log("operator email failed", { event: event.id, failed, of: to.length });
  return failed < to.length ? "sent" : "failed";
}

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, notifier: "operators", ...fields }));
}
