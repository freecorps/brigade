// The webhook notifier in the `brigade-events` consumer (RFC 0005 "Outbound webhooks"): for a catalog event (or a
// test), the shard plans which endpoints are due (src/webhooks.ts), this opens each one's secrets, signs the payload
// (Standard Webhooks, src/webhook-sign.ts), POSTs it under the target rules (https, a public host, no redirects
// followed, a timeout, a bounded read of the answer) and reports back. It runs next to push like Slack, within its own
// budget (src/notify.ts `WEBHOOK_BUDGET_MS`) and within the invocation's side connections (src/side-connections.ts),
// and never decides whether a page is retried; its own retries come back through the shard's alarm and the outbox
// (`webhook.redeliver`). Also here: the email that tells the owners Brigade turned an endpoint off.

import { resolveLocale } from "@freecorps/brigade-i18n";
import { v, WEBHOOK_SNIPPET_MAX, webhookTargetProblem } from "@freecorps/brigade-schema";
import { readPrefix } from "./check.ts";
import { dashboardLink, renderWebhookDisabledEmail } from "./email-templates.ts";
import type { EmailSender } from "./email.ts";
import {
  emailRetryDelay,
  MAX_EMAIL_ATTEMPTS,
  MAX_OWNER_RECIPIENTS,
  RECIPIENTS_TIMEOUT_MS,
} from "./notify-email.ts";
import type { BrigadeEvent } from "./outbox.ts";
import { isTokenKey, openToken, tokenBinding } from "./slack-token.ts";
import { NotStarted, SideConnections } from "./side-connections.ts";
import { headerBinding, signatureHeaders } from "./webhook-sign.ts";
import {
  asksForWebhooks,
  WEBHOOK_EMAIL_CLAIM_MS,
  type WebhookEventRef,
  type WebhookOutcome,
  type WebhookSend,
} from "./webhooks.ts";

/** How long one delivery may take, answer included. Receivers should answer at once and do the work later. */
export const WEBHOOK_TIMEOUT_MS = 5000;
/** At most this much of an answer is read, for the log's snippet; the rest is never read. */
export const WEBHOOK_RESPONSE_BYTES = 1024;
export const WEBHOOK_USER_AGENT = "Brigade-Webhooks/1 (+https://github.com/freecorps/brigade)";

export type WebhookNotifyEnv = {
  WORKSPACE: Env["WORKSPACE"];
  /** 32 random bytes, base64url, that seal signing secrets at rest. Without it webhooks are off. */
  WEBHOOK_SECRET_KEY?: string;
};

export type Fetch = (request: Request) => Promise<Response>;

/**
 * Delivers `event` (a catalog event, a test, or the ledger's `webhook.redeliver`) to every endpoint due, each within
 * one of `slots` (src/side-connections.ts) so a page's relay request always finds a connection free. A delivery still
 * waiting for a slot at `deadline` is not started: no attempt, its claim stands, and the shard's alarm brings it back
 * when the claim runs out. Retries are the ledger's (`WebhookDesk.redrive`), never the message's. A shard that cannot
 * be reached throws.
 */
export async function notifyWebhooks(
  event: BrigadeEvent,
  env: WebhookNotifyEnv,
  send: Fetch,
  slots: SideConnections = new SideConnections(),
  deadline?: number,
): Promise<void> {
  if (!asksForWebhooks(event) || !isTokenKey(env.WEBHOOK_SECRET_KEY)) return;
  const key = env.WEBHOOK_SECRET_KEY;
  const shard = env.WORKSPACE.getByName(event.workspaceId);
  const plan = await shard.planWebhooks(event);
  const { body, event: original } = plan;
  if (body === null || original === null) return;
  await Promise.all(
    plan.sends.map(async (one) => {
      let outcome: WebhookOutcome;
      try {
        outcome = await slots.run(() => deliver(original, body, one, key, send), deadline);
      } catch (error) {
        if (!(error instanceof NotStarted)) throw error;
        log("webhook delivery put off: no free connection", {
          event: original.id,
          webhook: one.webhookId,
        });
        return;
      }
      await shard.recordWebhook(original, one.webhookId, outcome);
    }),
  );
}

/** One POST to one endpoint. Never throws: every failure is an outcome. */
export async function deliver(
  event: WebhookEventRef,
  body: string,
  target: WebhookSend,
  key: string,
  send: Fetch,
): Promise<WebhookOutcome> {
  const at = Date.now();
  const failed = (
    error: WebhookOutcome["error"],
    more: Partial<WebhookOutcome> = {},
  ): WebhookOutcome => ({
    at,
    ok: false,
    status: null,
    ms: null,
    error,
    snippet: null,
    ...more,
  });
  // Checked again before every delivery, in case the rules got stricter since it was saved.
  if (webhookTargetProblem(target.url) !== null) return failed("blocked");
  let secrets: string[];
  let custom: [string, string][];
  try {
    const binding = tokenBinding(event.workspaceId, target.webhookId);
    secrets = await Promise.all(target.secrets.map((sealed) => openToken(key, sealed, binding)));
    custom = await Promise.all(
      (target.headers ?? []).map(async ({ name, value }): Promise<[string, string]> => [
        name,
        await openToken(key, value, headerBinding(event.workspaceId, target.webhookId, name)),
      ]),
    );
  } catch (error) {
    // The key was changed without re-sealing, or the row is not this workspace's: retrying cannot open it.
    log("webhook secret could not be opened", {
      event: event.id,
      webhook: target.webhookId,
      error: String(error),
    });
    return failed("secret");
  }
  let headers: Record<string, string>;
  try {
    headers = await signatureHeaders(secrets, event.id, Math.floor(Date.now() / 1000), body);
  } catch (error) {
    // A secret that opened but is no key (a damaged row): retrying cannot sign with it either.
    log("webhook secret could not sign", {
      event: event.id,
      webhook: target.webhookId,
      error: String(error),
    });
    return failed("secret");
  }
  const signal = AbortSignal.timeout(WEBHOOK_TIMEOUT_MS);
  const started = Date.now();
  let response: Response;
  // The timeout ends the wait even if a fetch ignored the signal: the delivery is bounded either way.
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  aborted.catch(() => undefined);
  try {
    const request = send(
      new Request(target.url, {
        method: "POST",
        // The endpoint's own headers first: none of them may be one of Brigade's (`webhookHeaderNameProblem`), and
        // Brigade's are set after them anyway.
        headers: {
          ...Object.fromEntries(custom),
          ...headers,
          "Content-Type": "application/json",
          "User-Agent": WEBHOOK_USER_AGENT,
        },
        body,
        // A redirect is the answer: following it could lead to a host the rules refuse.
        redirect: "manual",
        signal,
      }),
    );
    request.catch(() => undefined);
    response = await Promise.race([request, aborted]);
  } catch (error) {
    const timedOut = signal.aborted || (error instanceof Error && error.name === "TimeoutError");
    return failed(timedOut ? "timeout" : "network");
  }
  const status = response.status;
  if (status >= 200 && status < 300) {
    await response.body?.cancel().catch(() => undefined);
    return {
      at,
      ok: true,
      status,
      ms: Math.max(0, Date.now() - started),
      error: null,
      snippet: null,
    };
  }
  let text = "";
  try {
    // Bounded by the same timeout as the request: a receiver that sends its headers and then stalls the body never
    // holds the delivery past `WEBHOOK_TIMEOUT_MS`.
    text = await Promise.race([readPrefix(response, WEBHOOK_RESPONSE_BYTES), aborted]);
  } catch {
    // The answer stopped mid-read (or the timeout hit): its status is what counts.
    await response.body?.cancel().catch(() => undefined);
  }
  return failed(status >= 300 && status < 400 ? "redirect" : "status", {
    status: status >= 100 && status <= 599 ? status : null,
    ms: Math.max(0, Date.now() - started),
    snippet: snippet(text),
  });
}

const snippetText = v.string({ max: WEBHOOK_SNIPPET_MAX });

/**
 * A receiver's answer as the log keeps it: letters, digits, punctuation, symbols and spaces only (controls and
 * invisible characters become spaces), on one line, at most `WEBHOOK_SNIPPET_MAX` characters; null when nothing is left.
 */
export function snippet(text: string): string | null {
  const printable = text
    .replace(/[^\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const clipped = Array.from(printable).slice(0, WEBHOOK_SNIPPET_MAX).join("").trim();
  if (clipped === "") return null;
  const checked = snippetText(clipped);
  return checked.ok ? checked.value : null;
}

// ---- The owners' email -------------------------------------------------------------------------------------------

export type WebhookEmailEnv = {
  WORKSPACE: Env["WORKSPACE"];
  DB?: D1Database;
  DASHBOARD_URL?: string;
};

type Owner = { email: string; name: string | null; locale: string | null; workspace: string };

/**
 * For `webhook.disabled` (`failing`): emails the workspace's owners (verified addresses, at most
 * `MAX_OWNER_RECIPIENTS`) that Brigade turned the endpoint off, each in their language. Claimed in the shard so a
 * redelivery sends nobody twice; a failed send is retried like the other emails, then only logged (the dashboard's
 * card says it is off). Returns the seconds before trying again, or undefined when done.
 */
export async function notifyWebhookDisabled(
  event: BrigadeEvent,
  attempts: number,
  env: WebhookEmailEnv,
  sender: EmailSender | undefined,
): Promise<number | undefined> {
  if (!sender) return undefined;
  const shard = env.WORKSPACE.getByName(event.workspaceId);
  const plan = await shard.planWebhookEmail(event);
  if (!plan.send) {
    return plan.reason === "held"
      ? Math.max(
          emailRetryDelay(attempts),
          Math.ceil(Math.max(WEBHOOK_EMAIL_CLAIM_MS, plan.until - Date.now()) / 1000),
        )
      : undefined;
  }
  const last = attempts >= MAX_EMAIL_ATTEMPTS;
  let owners: Owner[];
  try {
    owners = await readOwners(env.DB, event.workspaceId);
  } catch (error) {
    log("webhook email: owners could not be read", { event: event.id, error: String(error) });
    await shard.recordWebhookEmail(event, last);
    return last ? undefined : emailRetryDelay(attempts);
  }
  const url = dashboardLink("/", {}, env.DASHBOARD_URL, undefined);
  const results = await Promise.all(
    owners.map((owner) =>
      sender.send(
        renderWebhookDisabledEmail(
          {
            workspace: owner.workspace,
            webhook: plan.description || plan.host,
            failures: plan.failures,
          },
          { email: owner.email, ...(owner.name ? { name: owner.name } : {}) },
          url,
          resolveLocale(owner.locale ?? undefined),
        ),
      ),
    ),
  );
  // Owners it reached would be emailed again on a retry, so only retry when it reached none of them.
  const retry =
    results.length > 0 && results.every((result) => !result.ok && result.retry) && !last;
  for (const result of results) {
    if (!result.ok)
      log("webhook email refused", { event: event.id, sender: sender.id, code: result.code });
  }
  await shard.recordWebhookEmail(event, !retry);
  return retry ? emailRetryDelay(attempts) : undefined;
}

/** The workspace's owners whose address is verified, with the workspace's name, from D1. */
async function readOwners(db: D1Database | undefined, workspaceId: string): Promise<Owner[]> {
  if (!db) throw new Error("no D1 binding");
  const query = db
    .prepare(
      `select u.email as email, u.name as name, u.locale as locale, o.name as workspace
       from "member" m join "user" u on u.id = m."userId" join organization o on o.id = m."organizationId"
       where m."organizationId" = ? and m.role = 'owner' and u."emailVerified" = 1
       order by m."createdAt" limit ?`,
    )
    .bind(workspaceId, MAX_OWNER_RECIPIENTS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { results } = await Promise.race([
      query.all<Owner>(),
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
  console.error(JSON.stringify({ message, notifier: "webhooks", ...fields }));
}
