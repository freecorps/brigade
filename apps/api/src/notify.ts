// The `brigade-events` consumer (RFC 0005 "Delivery", RFC 0002 runtime map): routes each event to its notifiers:
// a page that failed to email (src/notify-email.ts), everything else to push, and an incident's events to Slack as
// well (src/notify-slack.ts), next to push and never ahead of it. Push: for an event that pages, the
// workspace shard plans who gets it, each device's push is sealed to its own key (HPKE, `packages/push`) and sent
// through the relay (RFC 0006), and the outcomes go back to the shard. Delivery is at-least-once, so the shard's page
// ledger, keyed by `event.id`, makes a redelivery page nobody twice. What the Queue gives up on lands in
// `brigade-events-dlq`, whose consumer (`consumeDeadLetters`) records it on the incident's timeline.

import { sealPush, type PushReceipt } from "@freecorps/brigade-push";
import { formatIncidentNumber, type DeliveryError } from "@freecorps/brigade-schema";
import { emailSender, type EmailEnv, type EmailSender } from "./email.ts";
import { asksForEmail } from "./mailer.ts";
import { emailRetryDelay, notifyEmail, type EmailNotifyEnv } from "./notify-email.ts";
import { asksForInvitation, notifyInvitation } from "./notify-invite.ts";
import { notifySlack, type SlackNotifyEnv } from "./notify-slack.ts";
import type { BrigadeEvent } from "./outbox.ts";
import {
  asksForPage,
  type DeviceOutcome,
  type PagePlan,
  type PageTarget,
  type SendFailure,
} from "./paging.ts";
import { asksForSlack } from "./slack.ts";
import { HEARTBEAT_EVENT, isSystemEvent, WATCHDOG_NAME, type RelayHealth } from "./watchdog.ts";
import { WORKSPACE_ID } from "./workspace.ts";

/**
 * Deliveries of a page before the members it missed are recorded as not paged (`notification.failed`). The
 * Queue's `max_retries` (wrangler.jsonc) is higher, so the consumer, not the Queue, decides when to give up.
 */
export const MAX_PAGE_ATTEMPTS = 5;
/**
 * The `brigade-events` consumer's `max_retries` (wrangler.jsonc): a message that fails on delivery
 * `QUEUE_MAX_RETRIES + 1` (the shard unreachable or throwing every time) goes to the dead-letter queue.
 */
export const QUEUE_MAX_RETRIES = 10;
/** Delay before redelivering a page that failed: 5, 10, 20, 40 s. Pages are urgent; giving up takes about 75 s. */
export const PAGE_RETRY_FIRST_SECONDS = 5;
export const PAGE_RETRY_MAX_SECONDS = 60;
/**
 * How long the consumer waits on Slack for one event before it lets the message go with a retry. A batch settles only
 * when its slowest message does, and the next batch (with its pages) waits for that; Slack must never be the reason.
 * The incident's claim and the Slack ledger (src/slack.ts) make the retry safe: it waits out the claim and re-plans.
 */
export const SLACK_BUDGET_MS = 3000;
/** How long the relay gets per send. */
export const RELAY_TIMEOUT_MS = 10_000;
/** How long the relay's token check gets when the dead-man switch's heartbeat comes through. */
export const RELAY_HEALTH_TIMEOUT_MS = 5000;

/** Optional: an instance without a relay still runs, and every page it would send is recorded as failed. */
export type NotifyEnv = EmailEnv &
  EmailNotifyEnv &
  SlackNotifyEnv & {
    WORKSPACE: Env["WORKSPACE"];
    /** The dead-man switch's watchdog (src/watchdog.ts); without it a heartbeat is logged and dropped. */
    WATCHDOG?: Env["WATCHDOG"];
    /** The relay's base URL, e.g. a `brigade-relay-<env>` Worker. A secret, so hostnames stay out of the repo. */
    RELAY_URL?: string;
    /** Bearer token for the relay's `POST /send`. */
    RELAY_SEND_TOKEN?: string;
  };

export type Fetch = (request: Request) => Promise<Response>;

/**
 * The queue handler: one message per event; each is acked or retried on its own, all of a batch's at once, so a
 * page never waits for an email in the same batch. Never throws. `mail` is the email sender (`emailSender`, none
 * when email is not set up). `waitUntil` is the invocation's: a Slack call past its budget runs on under it.
 */
export async function consumeEvents(
  batch: MessageBatch<unknown>,
  env: NotifyEnv,
  send: Fetch = (request) => fetch(request),
  mail: EmailSender | undefined = emailSender(env),
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<void> {
  const seen = new Set<string>();
  await Promise.all(
    batch.messages.map(async (message) => {
      // The dead-man switch's own events (src/watchdog.ts): never a shard's, never a page.
      if (isSystemEvent(message.body)) {
        await proveHeartbeat(message.body, env, send);
        return message.ack();
      }
      const event = parseEvent(message.body);
      if (!event) {
        log("event dropped: not a Brigade event", { messageId: message.id });
        return message.ack();
      }
      // The same event twice in one batch (a redelivery next to the original): once is enough.
      if (seen.has(event.id)) return message.ack();
      seen.add(event.id);
      const email = asksForEmail(event);
      const invitation = asksForInvitation(event);
      const delay = email || invitation ? emailRetryDelay : retryDelay;
      // Slack runs alongside push, never before it, and its failures stay its own: a Slack outage or a shard error on
      // its side only asks for a later delivery, which the page ledger makes a no-op for push.
      const slack = asksForSlack(event)
        ? withinSlackBudget(
            notifySlack(event, env, send).catch((error: unknown) => {
              log("slack notifier failed", { event: event.id, error: String(error) });
              return retryDelay(message.attempts);
            }),
            event,
            message.attempts,
            waitUntil,
          ).then((seconds) => {
            // Past the Queue's retries, give Slack up rather than send a page event to the dead-letter queue.
            if (seconds === undefined || message.attempts <= QUEUE_MAX_RETRIES) return seconds;
            log("slack given up: out of queue retries", {
              event: event.id,
              attempts: message.attempts,
            });
            return undefined;
          })
        : Promise.resolve(undefined);
      try {
        const delaySeconds = email
          ? await notifyEmail(event, message.attempts, env, mail)
          : invitation
            ? await notifyInvitation(event, message.attempts, env, mail)
            : (await notifyPush(event, message.attempts, env, send))
              ? retryDelay(message.attempts)
              : undefined;
        // Slack's work always finishes (within its budget) before the message is settled. A page's own retry comes
        // first: never put off behind Slack's backoff, and an early Slack retry only finds its event held again.
        const slackSeconds = await slack;
        const next = delaySeconds ?? slackSeconds;
        if (next !== undefined) message.retry({ delaySeconds: next });
        else message.ack();
      } catch (error) {
        await slack;
        // The shard was unreachable or threw: nothing was recorded, so the whole page runs again.
        log("event handling failed", { event: event.id, type: event.type, error: String(error) });
        if (message.attempts > QUEUE_MAX_RETRIES) {
          // This retry sends it to the dead-letter queue; its consumer records it if it can.
          log(asksForPage(event) ? "page dead-lettered" : "event dead-lettered", {
            event: event.id,
            type: event.type,
            incident: event.subject,
            workspace: event.workspaceId,
            attempts: message.attempts,
          });
        }
        message.retry({ delaySeconds: delay(message.attempts) });
      }
    }),
  );
}

/**
 * Slack's answer for one event, or a retry once `SLACK_BUDGET_MS` has passed without one. The late call runs on under
 * `waitUntil`, so a message Slack accepted still has its `ts` recorded and the retry updates it rather than posting
 * again; until then its claim stands, so the retry neither posts twice at once nor waits forever.
 */
async function withinSlackBudget(
  slack: Promise<number | undefined>,
  event: BrigadeEvent,
  attempts: number,
  waitUntil: ((promise: Promise<unknown>) => void) | undefined,
): Promise<number | undefined> {
  waitUntil?.(slack);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const overrun = new Promise<number>((resolve) => {
    timer = setTimeout(() => {
      log("slack notifier overran its budget: retrying later", { event: event.id });
      resolve(retryDelay(attempts));
    }, SLACK_BUDGET_MS);
  });
  try {
    return await Promise.race([slack, overrun]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The `brigade-events-dlq` consumer: events the Queue gave up on. Each page is recorded once on its incident's
 * timeline (`dead_lettered`). If the shard cannot be reached, the message is retried after
 * `DEAD_LETTER_RETRY_SECONDS`; the consumer's `max_retries` is 5 and it has no dead-letter queue of its own
 * (wrangler.jsonc), so spent retries delete it and nothing loops. Malformed events and events that do not page are
 * acked at once.
 */
export async function consumeDeadLetters(
  batch: MessageBatch<unknown>,
  env: Pick<NotifyEnv, "WORKSPACE">,
): Promise<void> {
  await Promise.all(
    batch.messages.map(async (message) => {
      const event = parseEvent(message.body);
      if (!event || !asksForPage(event)) {
        log("dead-lettered event dropped", { messageId: message.id, event: event?.id });
        return message.ack();
      }
      try {
        const result = await env.WORKSPACE.getByName(event.workspaceId).recordDeadLetter(event);
        log("dead-lettered page handled", { event: event.id, incident: event.subject, result });
        message.ack();
      } catch (error) {
        // The shard is likely still down (that is how the page got here): try again later rather than drop the
        // only record. With no dead-letter queue of its own, spent retries delete the message, so nothing loops.
        log("dead-lettered page could not be recorded", {
          event: event.id,
          incident: event.subject,
          workspace: event.workspaceId,
          attempts: message.attempts,
          error: String(error),
        });
        message.retry({ delaySeconds: DEAD_LETTER_RETRY_SECONDS });
      }
    }),
  );
}

/**
 * A `brigade.heartbeat` came through the outbox and the Queue: checks the relay is up and takes the send token, and
 * tells the watchdog, which pings the external check. Never throws, and the message is acked either way: a lost heartbeat is a minute of
 * silence, and the next one is already on its way. Other system events (`brigade.status_changed`) have no notifier
 * yet.
 */
export async function proveHeartbeat(
  event: BrigadeEvent,
  env: Pick<NotifyEnv, "WATCHDOG" | "RELAY_URL" | "RELAY_SEND_TOKEN">,
  send: Fetch,
): Promise<void> {
  if (event.type !== HEARTBEAT_EVENT) return;
  if (!env.WATCHDOG) {
    log("heartbeat dropped: no watchdog binding", { event: event.id });
    return;
  }
  const relay = await relayHealth(env, send);
  try {
    await env.WATCHDOG.getByName(WATCHDOG_NAME).proved(event.time, relay);
  } catch (error) {
    log("heartbeat could not be recorded", { event: event.id, error: String(error) });
  }
}

/**
 * Whether a page could get past this Worker right now: `POST /send` with the send token and an empty body. The relay
 * checks the token before it reads the body (apps/relay src/index.ts), so `400 invalid_body` means it took the token
 * without calling APNs or logging anything, `401` that it refused it (a rotated or mistyped `RELAY_SEND_TOKEN`), and
 * anything else that it is not answering as a relay. Its `/health` would say nothing about the token.
 */
async function relayHealth(
  env: Pick<NotifyEnv, "RELAY_URL" | "RELAY_SEND_TOKEN">,
  send: Fetch,
): Promise<RelayHealth> {
  // No token is the same as no relay for paging (`pushOne` says `not_configured`), so say that, not "refused".
  if (!env.RELAY_URL || !env.RELAY_SEND_TOKEN) return "not_configured";
  try {
    const response = await send(
      new Request(new URL("/send", env.RELAY_URL), {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RELAY_SEND_TOKEN ?? ""}` },
        signal: AbortSignal.timeout(RELAY_HEALTH_TIMEOUT_MS),
      }),
    );
    const status = response.status;
    const body: unknown = await response.json().catch(() => null);
    if (status === 400 && Reflect.get(Object(body), "error") === "invalid_body") return "ok";
    if (status === 401) {
      log("relay refused the send token", { status });
      return "unauthorized";
    }
    log("relay token check failed", { status });
  } catch (error) {
    log("relay health unreachable", { error: String(error) });
  }
  return "unreachable";
}

/** How long the dead-letter consumer waits before trying a shard again. */
export const DEAD_LETTER_RETRY_SECONDS = 120;

/** Seconds before the next delivery of a message on its `attempts`-th try (1 the first time). */
export function retryDelay(attempts: number): number {
  return Math.min(
    PAGE_RETRY_MAX_SECONDS,
    PAGE_RETRY_FIRST_SECONDS * 2 ** Math.max(0, attempts - 1),
  );
}

/**
 * The push notifier for one event. Returns true when the page should be tried again later (some device failed in
 * a way that may pass and attempts remain); the outcomes so far are recorded either way.
 */
export async function notifyPush(
  event: BrigadeEvent,
  attempts: number,
  env: NotifyEnv,
  send: Fetch,
): Promise<boolean> {
  // Most events page nobody (the delivery rows' own `notification.*` among them): no shard call for those.
  if (!asksForPage(event)) return false;
  const workspace = env.WORKSPACE.getByName(event.workspaceId);
  const plan = await workspace.planPage(event);
  if (!plan.send) return false;
  const receipts = receiptUrl(env.DASHBOARD_URL);
  const sent = await Promise.all(
    plan.targets.map((target) => pushOne(event.workspaceId, plan, target, env, send, receipts)),
  );
  const final = !sent.some((one) => one.retry) || attempts >= MAX_PAGE_ATTEMPTS;
  await workspace.recordPage(
    event,
    sent.map((one) => one.outcome),
    final,
    plan.skipped,
  );
  return !final;
}

/**
 * Where phones post delivery receipts: the dashboard's origin (`DASHBOARD_URL`, which proxies `/api` to this Worker)
 * plus `/api/receipts`. Undefined without an http(s) origin: pages then carry no receipt.
 */
export function receiptUrl(dashboard: string | undefined): string | undefined {
  if (!dashboard) return undefined;
  try {
    const url = new URL(dashboard);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return new URL("/api/receipts", url.origin).href;
  } catch {
    return undefined;
  }
}

/** One device's outcome, and whether trying again may help. */
type Sent = { outcome: DeviceOutcome; retry: boolean };

/** Seals and sends one device's push; classifies the relay's answer. Never throws. */
async function pushOne(
  workspaceId: string,
  plan: Extract<PagePlan, { send: true }>,
  target: PageTarget,
  env: NotifyEnv,
  send: Fetch,
  receipts: string | undefined,
): Promise<Sent> {
  const { deviceId, userId } = target;
  let ms: number | undefined;
  const failed = (
    reason: SendFailure,
    error: DeliveryError,
    more: { retry?: boolean; expired?: boolean; apnsReason?: string } = {},
  ): Sent => ({
    outcome: {
      deviceId,
      userId,
      ok: false,
      reason,
      // The token this push went to, so a device registered again meanwhile is not dropped.
      ...(more.expired ? { expiredToken: target.pushToken } : {}),
      error,
      ...(more.apnsReason === undefined ? {} : { apnsReason: more.apnsReason }),
      ...(ms === undefined ? {} : { ms }),
    },
    retry: more.retry ?? false,
  });
  if (!env.RELAY_URL || !env.RELAY_SEND_TOKEN) return failed("not_configured", "not_configured");
  // The relay speaks APNs only; Android needs FCM (RFC 0006).
  if (target.platform !== "ios") return failed("unsupported", "unsupported");

  const { incident } = plan;
  const content = {
    // Codes, not words, so the title needs no locale; the body is the incident's own title.
    title: [incident.severity.toUpperCase(), formatIncidentNumber(incident.number)]
      .filter(Boolean)
      .join(" · "),
    body: incident.title,
    incident: incident.id,
    // For the notification's Acknowledge action (RFC 0004 "Clients").
    workspace: workspaceId,
  };
  const receipt: PushReceipt | undefined =
    receipts && target.receipt ? { url: receipts, token: target.receipt } : undefined;
  let envelope;
  try {
    envelope = await sealPush(target.publicKey, receipt ? { ...content, receipt } : content);
  } catch (error) {
    try {
      // The receipt must never cost the page: a title too long to fit both goes without it.
      if (!receipt) throw error;
      envelope = await sealPush(target.publicKey, content);
    } catch (again) {
      // A key `device.register` accepted but WebCrypto refuses (not on the curve): retrying cannot help.
      log("sealing a push failed", { device: deviceId, error: String(again) });
      return failed("undelivered", "seal_failed");
    }
  }

  let response: Response;
  const started = Date.now();
  try {
    response = await send(
      new Request(new URL("/send", env.RELAY_URL), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RELAY_SEND_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deviceToken: target.pushToken,
          envelope,
          urgency: plan.urgency,
          environment: target.environment,
          // A redelivered page replaces the one on screen instead of stacking.
          collapseId: incident.id,
        }),
        signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
      }),
    );
  } catch (error) {
    ms = Date.now() - started;
    // The relay is down or slow: the paging path's first fallback is trying again.
    log("relay unreachable", { device: deviceId, error: String(error) });
    return failed("undelivered", "relay_unreachable", { retry: true });
  }
  ms = Date.now() - started;
  if (response.ok) {
    await response.body?.cancel();
    return { outcome: { deviceId, userId, ok: true, ms }, retry: false };
  }
  const answer = (await response.json().catch(() => ({}))) as {
    error?: string;
    status?: number;
    reason?: string;
  };
  // Never the token or the envelope.
  log("relay refused a push", {
    device: deviceId,
    status: response.status,
    error: answer.error,
    apnsStatus: answer.status,
    reason: answer.reason,
  });
  // APNs says the token is gone: drop the device, and retry the page while attempts remain, so the next plan sees
  // this member without that device (a commander's page then falls back to everyone who can respond).
  // APNs' own reason, for the delivery row: letters only, as APNs sends them.
  const apnsReason =
    typeof answer.reason === "string" && /^[A-Za-z]{1,64}$/.test(answer.reason)
      ? answer.reason
      : undefined;
  if (
    answer.status === 410 ||
    answer.reason === "BadDeviceToken" ||
    answer.reason === "Unregistered" ||
    answer.reason === "DeviceTokenNotForTopic"
  ) {
    return failed("undelivered", "token_invalid", { expired: true, retry: true, apnsReason });
  }
  // A request the relay or APNs will refuse again (bad body, bad credentials, a wrong relay URL) is not retried, so
  // the failure reaches the timeline at once; the relay being unreachable, APNs throttling or failing, or anything
  // unknown is.
  const apnsRefused =
    answer.status !== undefined &&
    answer.status >= 400 &&
    answer.status < 500 &&
    answer.status !== 429;
  const permanent = [400, 401, 403, 404].includes(response.status) || apnsRefused;
  // For the delivery row: who said no. APNs (with its status), the relay itself (its token, the body, its own
  // configuration), APNs out of the relay's reach, or something in front of the relay.
  const error: DeliveryError = apnsRefused
    ? "apns_refused"
    : answer.status !== undefined || answer.error === "apns_unreachable"
      ? "apns_unavailable"
      : permanent || answer.error === "relay_misconfigured"
        ? "relay_refused"
        : "relay_unreachable";
  return failed("undelivered", error, { ...(permanent ? {} : { retry: true }), apnsReason });
}

/** An event off the queue: the envelope's fields the consumer relies on, checked. */
export function parseEvent(body: unknown): BrigadeEvent | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const event = body as Partial<BrigadeEvent>;
  if (
    typeof event.id !== "string" ||
    !event.id.startsWith("evt_") ||
    typeof event.type !== "string" ||
    typeof event.workspaceId !== "string" ||
    !WORKSPACE_ID.test(event.workspaceId) ||
    (event.subject !== undefined && typeof event.subject !== "string") ||
    typeof event.actor !== "object" ||
    event.actor === null ||
    typeof event.actor.id !== "string" ||
    event.specversion !== "1.0"
  ) {
    return undefined;
  }
  return event as BrigadeEvent;
}

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, notifier: "push", ...fields }));
}
