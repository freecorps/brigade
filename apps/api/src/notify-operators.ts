// The instance operators' email (RFC 0007 "Watching the watcher", Q19): each `brigade.status_changed` the watchdog
// writes (the paging self-check turned degraded, back to ok, or unknown) goes by email to the addresses in
// `OPERATOR_EMAILS`, through the same sender as every other email. Capped by the watchdog
// (`OPERATOR_EMAIL_HOURLY_CAP` events an hour, each once), never retried, and never in a page's way: the consumer runs
// it alongside the batch's pages and acks the event whatever happens.

import type { EmailSender } from "./email.ts";
import { renderOperatorStatusEmail } from "./email-templates.ts";
import type { BrigadeEvent } from "./outbox.ts";
import { STATUS_EVENT, WATCHDOG_NAME } from "./watchdog.ts";

/** The most operators one status change is emailed to. */
export const MAX_OPERATOR_RECIPIENTS = 10;

export type OperatorEnv = {
  WATCHDOG?: Env["WATCHDOG"];
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

/** Emails the operators about a status change. Never throws. */
export async function notifyOperators(
  event: BrigadeEvent,
  env: OperatorEnv,
  mail: EmailSender | undefined,
): Promise<void> {
  if (event.type !== STATUS_EVENT) return;
  const to = operatorAddresses(env.OPERATOR_EMAILS);
  if (to.length === 0 || !mail || !env.WATCHDOG) return;
  const data = (event.data ?? {}) as { status?: unknown; reasons?: unknown };
  const status =
    data.status === "ok" || data.status === "degraded" || data.status === "unknown"
      ? data.status
      : undefined;
  if (!status) return;
  const reasons = Array.isArray(data.reasons)
    ? data.reasons.filter((one): one is string => typeof one === "string")
    : [];
  try {
    if (!(await env.WATCHDOG.getByName(WATCHDOG_NAME).claimOperatorEmail(event.id))) {
      log("operator email not sent: capped or sent already", { event: event.id });
      return;
    }
  } catch (error) {
    log("operator email not sent: the watchdog could not be asked", { error: String(error) });
    return;
  }
  const results = await Promise.all(
    to.map((email) =>
      mail
        .send(renderOperatorStatusEmail({ status, reasons }, { email }, "en"))
        .catch((error: unknown) => ({ ok: false as const, retry: false, code: String(error) })),
    ),
  );
  const failed = results.filter((result) => !result.ok).length;
  if (failed > 0) log("operator email failed", { event: event.id, failed, of: to.length });
}

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, notifier: "operators", ...fields }));
}
