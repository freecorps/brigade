// The instance operators' email (RFC 0007 "Watching the watcher", Q19): each `brigade.status_changed` the watchdog
// writes (the paging self-check turned degraded, back to ok, or unknown) goes by email to the addresses in
// `OPERATOR_EMAILS`, through the same sender as every other email. The watchdog sends it itself as the status changes
// (src/watchdog.ts `emailOperators`), not the Queue's consumer: a stalled Queue is one of the things it reports. It
// caps them (`OPERATOR_EMAIL_HOURLY_CAP` an hour) and tries a failed one again on the next beats.

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

/** What one attempt came to: `sent` to at least one operator; `skipped`, nobody to email or no sender; `failed`. */
export type OperatorEmailOutcome = "sent" | "skipped" | "failed";

/** Emails the operators about a status change (a `brigade.status_changed` event). Never throws. */
export async function notifyOperators(
  event: BrigadeEvent,
  env: OperatorEnv,
  mail: EmailSender | undefined,
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
  const results = await Promise.all(
    to.map(async (email) => {
      try {
        // About paging itself failing: never dropped by the daily ceiling (src/email-ceiling.ts).
        return await mail.send({
          ...renderOperatorStatusEmail({ status, reasons }, { email }, "en"),
          priority: "paging",
        });
      } catch (error) {
        return { ok: false as const, retry: false, code: String(error) };
      }
    }),
  );
  const failed = results.filter((result) => !result.ok).length;
  if (failed > 0) log("operator email failed", { event: event.id, failed, of: to.length });
  return failed < to.length ? "sent" : "failed";
}

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, notifier: "operators", ...fields }));
}
