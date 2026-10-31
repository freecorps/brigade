// The `brigade-events` consumer (RFC 0005 "Delivery", RFC 0002 runtime map): routes each event to its notifiers:
// a page that failed to email (src/notify-email.ts), a status page's subscribers (src/notify-status.ts), everything else to push, and an incident's events to Slack as
// well (src/notify-slack.ts), next to push and never ahead of it. Push: for an event that pages, the
// workspace shard plans who gets it, each device's push is sealed to its own key (HPKE, `packages/push`) and sent
// through the relay (RFC 0006), a page that rings rings as a call after its alert push (RFC 0010), and the outcomes
// go back to the shard. Delivery is at-least-once, so the shard's page
// ledger, keyed by `event.id`, makes a redelivery page nobody twice. What the Queue gives up on lands in
// `brigade-events-dlq`, whose consumer (`consumeDeadLetters`) records it on the incident's timeline.

import { sealPush, type PushContent, type PushReceipt } from "@freecorps/brigade-push";
import { formatIncidentNumber, type DeliveryError } from "@freecorps/brigade-schema";
import { within } from "./deadline.ts";
import { emailSender, type EmailEnv, type EmailSender } from "./email.ts";
import { asksForEmail, asksForReminder, asksForRotationEmail } from "./mailer.ts";
import { emailRetryDelay, notifyEmail, type EmailNotifyEnv } from "./notify-email.ts";
import { notifyReminder } from "./notify-reminder.ts";
import { notifyRotation } from "./notify-rotation.ts";
import { asksForInvitation, notifyInvitation } from "./notify-invite.ts";
import { notifySlack, type SlackNotifyEnv } from "./notify-slack.ts";
import { notifyStatus, STATUS_EMAIL_BUDGET_MS, type StatusNotifyEnv } from "./notify-status.ts";
import { asksForStatusHost, notifyStatusHost } from "./status-domain.ts";
import type { SaasEnv } from "./status-domain-cf.ts";
import type { DedicatedEnv } from "./status-domain-edge.ts";
import {
  notifyWebhookDisabled,
  notifyWebhooks,
  WEBHOOK_TIMEOUT_MS,
  type WebhookNotifyEnv,
} from "./notify-webhooks.ts";
import type { BrigadeEvent } from "./outbox.ts";
import {
  asksForPage,
  type CallOutcome,
  type DeviceOutcome,
  type PagePlan,
  type SkippedMember,
  type PageTarget,
  type SendFailure,
  sendsCritical,
  type Urgency,
} from "./paging.ts";
import { SideConnections, SLACK_CONNECTIONS } from "./side-connections.ts";
import { asksForSlack } from "./slack.ts";
import { asksForStatusEmail } from "./status-mail.ts";
import { asksForWebhookEmail, asksForWebhooks } from "./webhooks.ts";
import {
  HEARTBEAT_EVENT,
  isSystemEvent,
  STATUS_EVENT,
  WATCHDOG_NAME,
  type BeatCheck,
  type BeatChecks,
  type RelayHealth,
} from "./watchdog.ts";
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
/**
 * The same for outbound webhooks (src/notify-webhooks.ts): every endpoint due for one event gets this long in all,
 * however slow a receiver is. Past it the consumer moves on without a retry of its own: a delivery under way finishes
 * under `waitUntil` and records its outcome, one not started keeps its claim, and the shard's alarm brings back
 * whatever is due (src/webhooks.ts `redrive`).
 */
export const WEBHOOK_BUDGET_MS = 3000;
/**
 * The consumer's own time limits, in one place: `CONSUMER_TIMING` in production. Tests of a side notifier that never
 * answers pass shorter ones in the same proportions (the budget under the webhook timeout), so they prove the same
 * order of events without waiting seconds of real time for each.
 */
export type ConsumerTiming = {
  slackBudgetMs: number;
  webhookBudgetMs: number;
  /** One webhook delivery's own bound (src/notify-webhooks.ts). */
  webhookTimeoutMs: number;
  /** Status page emails, all of one event's (src/notify-status.ts). */
  statusEmailBudgetMs: number;
};
/** How long the relay gets per send. */
export const RELAY_TIMEOUT_MS = 10_000;
/**
 * How long the workspace's shard gets to plan a page or record its outcome. A shard that hangs (a Durable Objects
 * incident) would otherwise hold the whole batch, pages and all, until the runtime ends the invocation; past this the
 * call is an error like any other, and the page is retried. Planning and recording are safe to repeat.
 */
export const SHARD_CALL_TIMEOUT_MS = 20_000;
/** How long the watchdog gets to record a proved heartbeat; past it the beat is logged as not recorded. */
export const WATCHDOG_CALL_TIMEOUT_MS = 10_000;
/** How long the relay's token check gets when the dead-man switch's heartbeat comes through. */
export const RELAY_HEALTH_TIMEOUT_MS = 5000;
/** How long the beat's one D1 read gets. */
export const D1_HEALTH_TIMEOUT_MS = 3000;

/** Optional: an instance without a relay still runs, and every page it would send is recorded as failed. */
export type NotifyEnv = EmailEnv &
  SaasEnv &
  DedicatedEnv &
  EmailNotifyEnv &
  SlackNotifyEnv &
  StatusNotifyEnv &
  WebhookNotifyEnv & {
    WORKSPACE: Env["WORKSPACE"];
    /** The status pages' snapshots and custom hostname lookups (src/status-domain.ts `syncStatusHost`). */
    STATUS?: Env["STATUS"];
    DB?: Env["DB"];
    /** The dead-man switch's watchdog (src/watchdog.ts); without it a heartbeat is logged and dropped. */
    WATCHDOG?: Env["WATCHDOG"];
    /**
     * The relay Worker on this account, as a service binding: when bound, every relay call goes through it and
     * `RELAY_URL` is not used. A Worker's subrequest to another workers.dev Worker on the same account is answered 404,
     * so a relay deployed next to the API must be reached this way.
     */
    RELAY?: Env["RELAY"];
    /**
     * The relay's base URL when it is not bound, e.g. Freecorps' hosted relay for a self-hosted instance (RFC 0006). A
     * secret, so hostnames stay out of the repo.
     */
    RELAY_URL?: string;
    /** Bearer token for the relay's `POST /send`. */
    RELAY_SEND_TOKEN?: string;
  };

export type Fetch = (request: Request) => Promise<Response>;

/** The URL of a relay call through the `RELAY` binding: the host is never resolved, only the path matters. */
export const RELAY_BINDING_SEND_URL = "https://relay.internal/send";
/** The relay's deep health check (RFC 0007 "Watching the watcher"), through the binding or `RELAY_URL`. */
export const RELAY_DEEP_HEALTH_PATH = "/health?deep=1";

/**
 * Posts to the relay's `POST /send`: through the `RELAY` binding when bound, otherwise to `RELAY_URL` through `send`
 * (global `fetch`). Undefined without either or without the send token: paging is not configured. A bad `RELAY_URL`
 * rejects like an unreachable relay.
 */
function relayPost(
  env: Pick<NotifyEnv, "RELAY" | "RELAY_URL" | "RELAY_SEND_TOKEN">,
  send: Fetch,
): ((init: RequestInit) => Promise<Response>) | undefined {
  if (!env.RELAY_SEND_TOKEN) return undefined;
  const binding = env.RELAY;
  if (binding) return async (init) => binding.fetch(new Request(RELAY_BINDING_SEND_URL, init));
  const base = env.RELAY_URL;
  if (base) return async (init) => send(new Request(new URL("/send", base), init));
  return undefined;
}

export const CONSUMER_TIMING: ConsumerTiming = {
  slackBudgetMs: SLACK_BUDGET_MS,
  webhookBudgetMs: WEBHOOK_BUDGET_MS,
  webhookTimeoutMs: WEBHOOK_TIMEOUT_MS,
  statusEmailBudgetMs: STATUS_EMAIL_BUDGET_MS,
};

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
  timing: ConsumerTiming = CONSUMER_TIMING,
): Promise<void> {
  const seen = new Set<string>();
  // Slack and webhooks share a few of the invocation's six connections, so a page's relay request never waits for
  // them (src/side-connections.ts).
  const slots = new SideConnections();
  const sideSend = slots.wrap(send);
  // Slack's calls (messages, channels, the timeline mirror) hold at most `SLACK_CONNECTIONS` of those side slots.
  const slackSend = new SideConnections(SLACK_CONNECTIONS).wrap(sideSend);
  await Promise.all(
    batch.messages.map(async (message) => {
      // The dead-man switch's own events (src/watchdog.ts): never a shard's, never a page.
      if (isSystemEvent(message.body)) {
        // `brigade.status_changed` is emailed by the watchdog itself (src/notify-operators.ts); nothing to do here.
        if (message.body.type !== STATUS_EVENT) await proveHeartbeat(message.body, env, send);
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
      const webhookEmail = asksForWebhookEmail(event);
      const statusEmail = asksForStatusEmail(event);
      const reminder = asksForReminder(event);
      const rotation = asksForRotationEmail(event);
      const delay =
        email || invitation || webhookEmail || statusEmail || reminder || rotation
          ? emailRetryDelay
          : retryDelay;
      // Slack and webhooks run alongside push, never before it, each within its own budget, and their failures stay
      // their own: an outage or a shard error on their side only asks for a later delivery, which the page ledger makes
      // a no-op for push. Webhooks never ask for one past their budget: their retries are the shard's.
      const side = (
        name: "slack" | "webhooks",
        wanted: boolean,
        work: () => Promise<number | undefined>,
      ) =>
        wanted
          ? withinBudget(
              name,
              work().catch((error: unknown) => {
                log(`${name} notifier failed`, { event: event.id, error: String(error) });
                return retryDelay(message.attempts);
              }),
              event,
              name === "slack" ? retryDelay(message.attempts) : undefined,
              waitUntil,
              name === "slack" ? timing.slackBudgetMs : timing.webhookBudgetMs,
            ).then((seconds) => {
              // Past the Queue's retries, give it up rather than send a page event to the dead-letter queue.
              if (seconds === undefined || message.attempts <= QUEUE_MAX_RETRIES) return seconds;
              log(`${name} given up: out of queue retries`, {
                event: event.id,
                attempts: message.attempts,
              });
              return undefined;
            })
          : Promise.resolve(undefined);
      const slack = side("slack", asksForSlack(event), () => notifySlack(event, env, slackSend));
      const webhooks = side("webhooks", asksForWebhooks(event), async () => {
        await notifyWebhooks(
          event,
          env,
          send,
          slots,
          Date.now() + timing.webhookBudgetMs,
          timing.webhookTimeoutMs,
        );
        return undefined;
      });
      const sides = Promise.all([slack, webhooks]);
      try {
        const delaySeconds = email
          ? await notifyEmail(event, message.attempts, env, mail)
          : invitation
            ? await notifyInvitation(event, message.attempts, env, mail)
            : webhookEmail
              ? await notifyWebhookDisabled(event, message.attempts, env, mail)
              : statusEmail
                ? await notifyStatus(
                    event,
                    message.attempts,
                    env,
                    mail,
                    slots,
                    waitUntil,
                    timing.statusEmailBudgetMs,
                  )
                : asksForStatusHost(event)
                  ? await notifyStatusHost(event, env)
                  : reminder
                    ? await notifyReminder(event, message.attempts, env, mail)
                    : rotation
                      ? await notifyRotation(event, message.attempts, env, mail)
                      : (await notifyPush(event, message.attempts, env, send))
                        ? retryDelay(message.attempts)
                        : undefined;
        // Slack's and the webhooks' work always finishes (within its budget) before the message is settled. A page's
        // own retry comes first: never put off behind their backoff, and an early retry only finds their work held.
        const [slackSeconds, webhookSeconds] = await sides;
        const later = [slackSeconds, webhookSeconds].filter(
          (seconds): seconds is number => seconds !== undefined,
        );
        const next = delaySeconds ?? (later.length ? Math.min(...later) : undefined);
        if (next !== undefined) message.retry({ delaySeconds: next });
        else message.ack();
      } catch (error) {
        await sides;
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
 * A side notifier's answer for one event (Slack, webhooks), or `late` once its budget (`SLACK_BUDGET_MS`,
 * `WEBHOOK_BUDGET_MS`) has passed without one: Slack's retry delay, nothing for webhooks. The late call runs on under
 * `waitUntil`, so a message Slack accepted still has its `ts` recorded (and a delivery its outcome) and a retry
 * updates it rather than sending again; until then its claim stands, so nothing sends twice at once or waits forever.
 */
async function withinBudget(
  name: "slack" | "webhooks",
  work: Promise<number | undefined>,
  event: BrigadeEvent,
  late: number | undefined,
  waitUntil: ((promise: Promise<unknown>) => void) | undefined,
  budgetMs: number,
): Promise<number | undefined> {
  waitUntil?.(work);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const overrun = new Promise<number | undefined>((resolve) => {
    timer = setTimeout(() => {
      log(`${name} notifier overran its budget`, {
        event: event.id,
        ...(late === undefined ? {} : { retryIn: late }),
      });
      resolve(late);
    }, budgetMs);
  });
  try {
    return await Promise.race([work, overrun]);
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
 * silence, and the next one is already on its way. With it go the beat's deeper checks (Q19): the push providers,
 * through the relay's `GET /health?deep=1`, and one cheap D1 read, side by side.
 */
export async function proveHeartbeat(
  event: BrigadeEvent,
  env: Pick<NotifyEnv, "WATCHDOG" | "RELAY" | "RELAY_URL" | "RELAY_SEND_TOKEN" | "DB">,
  send: Fetch,
): Promise<void> {
  if (event.type !== HEARTBEAT_EVENT) return;
  if (!env.WATCHDOG) {
    log("heartbeat dropped: no watchdog binding", { event: event.id });
    return;
  }
  const [relay, d1] = await Promise.all([relayHealth(env, send), d1Health(env.DB)]);
  const checks: BeatChecks = { apns: relay.apns, fcm: relay.fcm, d1 };
  try {
    await within(
      env.WATCHDOG.getByName(WATCHDOG_NAME).proved(event.time, relay.relay, undefined, checks),
      WATCHDOG_CALL_TIMEOUT_MS,
      "proved",
    );
  } catch (error) {
    log("heartbeat could not be recorded", { event: event.id, error: String(error) });
  }
}

/**
 * Whether a page could get past this Worker right now, and on to the push providers: `GET /health?deep=1` with the
 * send token (apps/relay src/deep-health.ts). `401` is a refused token (a rotated or mistyped `RELAY_SEND_TOKEN`); an
 * answer naming `apns` means the relay took the token, and says whether APNs took the relay's provider token and FCM
 * gave it an access token, without a push to anyone. Anything else is a relay not answering as one. A relay from
 * before the deep check answers its plain `/health` there (no `apns`): then the token is proved as before
 * (`relayTokenHealth`), and the providers are `unknown`.
 */
async function relayHealth(
  env: Pick<NotifyEnv, "RELAY" | "RELAY_URL" | "RELAY_SEND_TOKEN">,
  send: Fetch,
): Promise<{ relay: RelayHealth; apns: BeatCheck; fcm: BeatCheck }> {
  const unknown = { apns: "unknown", fcm: "unknown" } as const;
  if (!env.RELAY_SEND_TOKEN || (!env.RELAY && !env.RELAY_URL)) {
    return { relay: "not_configured", ...unknown };
  }
  const init: RequestInit = {
    method: "GET",
    headers: { Authorization: `Bearer ${env.RELAY_SEND_TOKEN}` },
    signal: AbortSignal.timeout(RELAY_HEALTH_TIMEOUT_MS),
  };
  try {
    const response = env.RELAY
      ? await env.RELAY.fetch(
          new Request(new URL(RELAY_DEEP_HEALTH_PATH, RELAY_BINDING_SEND_URL), init),
        )
      : await send(new Request(new URL(RELAY_DEEP_HEALTH_PATH, env.RELAY_URL), init));
    if (response.status === 401) {
      await response.body?.cancel();
      log("relay refused the send token", { status: 401 });
      return { relay: "unauthorized", ...unknown };
    }
    const body: unknown = await response.json().catch(() => null);
    const provider = (key: string): BeatCheck | undefined => {
      const check = Object(Reflect.get(Object(body), key));
      const status = Reflect.get(check, "status");
      // An error that may pass by itself (a timeout, a 5xx): the watchdog waits for a few in a row.
      if (status === "error" && Reflect.get(check, "transient") === true) return "transient";
      return status === "ok" || status === "error" || status === "not_configured"
        ? status
        : undefined;
    };
    const apns = provider("apns");
    if (apns !== undefined) {
      const fcm = provider("fcm") ?? "unknown";
      if ([apns, fcm].some((check) => check === "error" || check === "transient")) {
        log("push provider check failed", { apns, fcm });
      }
      return { relay: "ok", apns, fcm };
    }
  } catch (error) {
    log("relay deep health unreachable", { error: String(error) });
    return { relay: "unreachable", ...unknown };
  }
  return { relay: await relayTokenHealth(env, send), ...unknown };
}

/**
 * The beat's one D1 read (Q19): `select 1`, within `D1_HEALTH_TIMEOUT_MS`. Nothing pages on it (the page path fails
 * open on D1); a failure is `transient` (the watchdog degrades the status and tells the operators after a few in a
 * row).
 */
async function d1Health(db: D1Database | undefined): Promise<BeatCheck> {
  if (!db) return "not_configured";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.prepare("select 1").first(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("D1 timed out")), D1_HEALTH_TIMEOUT_MS);
      }),
    ]);
    return "ok";
  } catch (error) {
    log("D1 health read failed", { error: String(error) });
    return "transient";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * For a relay without the deep check: `POST /send` with the send token and an empty body. The relay checks the token
 * before it reads the body (apps/relay src/index.ts), so `400 invalid_body` means it took the token without calling
 * APNs or logging anything, `401` that it refused it, and anything else that it is not answering as a relay.
 */
async function relayTokenHealth(
  env: Pick<NotifyEnv, "RELAY" | "RELAY_URL" | "RELAY_SEND_TOKEN">,
  send: Fetch,
): Promise<RelayHealth> {
  // No token is the same as no relay for paging (`pushOne` says `not_configured`), so say that, not "refused".
  const post = relayPost(env, send);
  if (!post) return "not_configured";
  try {
    const response = await post({
      method: "POST",
      headers: { Authorization: `Bearer ${env.RELAY_SEND_TOKEN ?? ""}` },
      signal: AbortSignal.timeout(RELAY_HEALTH_TIMEOUT_MS),
    });
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

/** The shard's side of a page: its plan, and what each device did. */
export type PageShard = {
  planPage(event: BrigadeEvent): Promise<PagePlan>;
  recordPage(
    event: BrigadeEvent,
    outcomes: DeviceOutcome[],
    final: boolean,
    skipped: SkippedMember[],
  ): Promise<void> | void;
};

/**
 * The push notifier for one event. Returns true when the page should be tried again later (some device failed in
 * a way that may pass and attempts remain); the outcomes so far are recorded either way. `shard` is the event's
 * workspace shard by RPC; the shard passes itself when it sends a page the Queue has not brought
 * (`WorkspaceDO.pageLocally`).
 */
export async function notifyPush(
  event: BrigadeEvent,
  attempts: number,
  env: NotifyEnv,
  send: Fetch,
  shard?: PageShard,
): Promise<boolean> {
  // Most events page nobody (the delivery rows' own `notification.*` among them): no shard call for those.
  if (!asksForPage(event)) return false;
  const workspace: PageShard = shard ?? env.WORKSPACE.getByName(event.workspaceId);
  const plan = await within<PagePlan>(workspace.planPage(event), SHARD_CALL_TIMEOUT_MS, "planPage");
  if (!plan.send) return false;
  const receipts = receiptUrl(env.DASHBOARD_URL);
  // Every redelivery of this event rings under the same call id, so a phone rings for it once (RFC 0010).
  const callId = plan.call && plan.urgency === "page" ? await callIdOf(event.id) : undefined;
  const sent = await Promise.all(
    plan.targets.map((target) =>
      pushOne(event.workspaceId, plan, target, env, send, receipts, callId),
    ),
  );
  const final = !sent.some((one) => one.retry) || attempts >= MAX_PAGE_ATTEMPTS;
  await within(
    Promise.resolve(
      workspace.recordPage(
        event,
        sent.map((one) => one.outcome),
        final,
        plan.skipped,
      ),
    ),
    SHARD_CALL_TIMEOUT_MS,
    "recordPage",
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

/**
 * A page's CallKit call id: a UUID (version 8, lowercase, as the relay takes it) from the event's id, so every
 * redelivery of a page shares it and a later page (another event) rings anew.
 */
export async function callIdOf(eventId: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`brigade-call:${eventId}`)),
  );
  const bytes = digest.subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A push's `apns-collapse-id`: the incident id for a page, so its repeats replace each other on screen, and apart from
 * it for anything less urgent, so a later SEV3 push about the same incident never takes a page's place.
 */
export function collapseIdOf(incidentId: string, urgency: Urgency): string {
  return urgency === "page" ? incidentId : `${incidentId}:${urgency}`;
}

/**
 * APNs' and FCM's reasons for a token that will never work again: the device is dropped, or for a call its VoIP token
 * cleared. The relay also flags FCM's (`tokenInvalid`): an `INVALID_ARGUMENT` is about the token only sometimes.
 */
const TOKEN_GONE: readonly string[] = [
  "BadDeviceToken",
  "Unregistered",
  "DeviceTokenNotForTopic",
  "UNREGISTERED",
];

/**
 * The relay's answer to a send it did not take: its own `error`, or the push service's `status` and `reason` (APNs'
 * or FCM's), and for FCM whether the token is done.
 */
type RelayAnswer = { error?: string; status?: number; reason?: string; tokenInvalid?: boolean };

/**
 * What a send the relay did not take (a push or a call) says, for its delivery row: who said no (`error`), APNs' own
 * `apnsReason`, whether the token is `gone` and whether the same request would be refused again (`permanent`).
 */
function refusal(
  httpStatus: number,
  answer: RelayAnswer,
): { error: DeliveryError; apnsReason?: string; gone: boolean; permanent: boolean } {
  // The push service's own reason, for the delivery row: letters only as APNs sends them, or FCM's codes
  // (`QUOTA_EXCEEDED`).
  const apnsReason =
    typeof answer.reason === "string" && /^[A-Za-z_]{1,64}$/.test(answer.reason)
      ? answer.reason
      : undefined;
  const reason = apnsReason === undefined ? {} : { apnsReason };
  if (
    answer.status === 410 ||
    TOKEN_GONE.includes(answer.reason as string) ||
    // A token of another Firebase project is the relay's service account, not a dead phone: never dropped.
    (answer.tokenInvalid === true && answer.reason !== "SENDER_ID_MISMATCH")
  ) {
    return { error: "token_invalid", ...reason, gone: true, permanent: true };
  }
  // A request the relay or APNs will refuse again (bad body, bad credentials, a wrong relay URL); the relay being
  // unreachable, APNs throttling or failing, or anything unknown may pass.
  const apnsRefused =
    answer.status !== undefined &&
    answer.status >= 400 &&
    answer.status < 500 &&
    answer.status !== 429;
  const permanent = [400, 401, 403, 404].includes(httpStatus) || apnsRefused;
  // Who said no: APNs (with its status), the relay itself (its token, the body, its own configuration), APNs out of
  // the relay's reach, or something in front of the relay.
  const error: DeliveryError = apnsRefused
    ? "apns_refused"
    : answer.status !== undefined ||
        answer.error === "apns_unreachable" ||
        answer.error === "fcm_unreachable"
      ? "apns_unavailable"
      : permanent || answer.error === "relay_misconfigured"
        ? "relay_refused"
        : "relay_unreachable";
  return { error, ...reason, gone: false, permanent };
}

/** One device's outcome, and whether trying again may help. */
type Sent = { outcome: DeviceOutcome; retry: boolean };

/**
 * Seals and sends one device's push; classifies the relay's answer. Once the relay took the alert, rings the device
 * as well when `callId` is given and the plan rings it (`ringOne`), and reports the call with the alert's outcome
 * without letting it change it. Never throws.
 */
async function pushOne(
  workspaceId: string,
  plan: Extract<PagePlan, { send: true }>,
  target: PageTarget,
  env: NotifyEnv,
  send: Fetch,
  receipts: string | undefined,
  callId: string | undefined,
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
  const post = relayPost(env, send);
  if (!post) return failed("not_configured", "not_configured");

  const { incident } = plan;
  const content: PushContent = {
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
  const alert = (critical: boolean) =>
    post({
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RELAY_SEND_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deviceToken: target.pushToken,
        // The relay sends an Android device's push through FCM, an iPhone's through APNs (RFC 0006).
        ...platformOf(target),
        envelope,
        urgency: plan.urgency,
        environment: target.environment,
        // A redelivered page replaces the one on screen instead of stacking; a lower-urgency push never replaces a
        // page (RFC 0006 "Offline phones"; the shard also holds it back while the page may be undelivered).
        collapseId: collapseIdOf(incident.id, plan.urgency),
        // Rings through silent mode (RFC 0006 "Critical Alerts"); only sent when true.
        ...(critical ? { critical: true } : {}),
      }),
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
  try {
    const critical = sendsCritical(plan, target);
    response = await alert(critical);
    // The fallback: a Critical Alert the relay (400) or APNs (its 400, in a 502) refuses as a request goes out at
    // once as the time-sensitive page every phone gets, so asking for more never costs the page. A token APNs says
    // is gone is handled below, as for any push.
    if (critical && !response.ok) {
      const answer = (await response.json().catch(() => ({}))) as {
        status?: unknown;
        reason?: unknown;
      };
      const refused = response.status === 400 || answer.status === 400;
      if (refused && !TOKEN_GONE.includes(answer.reason as string)) {
        log("relay refused a critical push, sending it time-sensitive", {
          device: deviceId,
          status: response.status,
          reason: typeof answer.reason === "string" ? answer.reason : undefined,
        });
        response = await alert(false);
      } else {
        response = Response.json(answer, { status: response.status });
      }
    }
  } catch (error) {
    ms = Date.now() - started;
    // The relay is down or slow: the paging path's first fallback is trying again.
    log("relay unreachable", { device: deviceId, error: String(error) });
    return failed("undelivered", "relay_unreachable", { retry: true });
  }
  ms = Date.now() - started;
  if (response.ok) {
    await response.body?.cancel();
    // Step 2 of the ladder (RFC 0010): the alert is out, so the phone can ring. Whatever the call does, the alert's
    // outcome stands.
    // A shard from before the member's choice of calls leaves `call` out: its plan's `call` decides.
    const call =
      callId !== undefined && target.call !== false
        ? await ringOne(callId, target, content, env, post)
        : undefined;
    return {
      outcome: { deviceId, userId, ok: true, ms, ...(call === undefined ? {} : { call }) },
      retry: false,
    };
  }
  const answer = (await response.json().catch(() => ({}))) as RelayAnswer;
  // Never the token or the envelope.
  log("relay refused a push", {
    device: deviceId,
    status: response.status,
    error: answer.error,
    apnsStatus: answer.status,
    reason: answer.reason,
  });
  const { error, apnsReason, gone, permanent } = refusal(response.status, answer);
  // APNs says the token is gone: drop the device, and retry the page while attempts remain, so the next plan sees
  // this member without that device (a commander's page then falls back to everyone who can respond).
  if (gone) {
    return failed("token_invalid", "token_invalid", { expired: true, retry: true, apnsReason });
  }
  // A request the relay or APNs will refuse again is not retried, so the failure reaches the timeline at once.
  return failed("undelivered", error, { ...(permanent ? {} : { retry: true }), apnsReason });
}

/**
 * `platform` for the relay's body: only for Android, so an iPhone's send is the body every relay takes (one from
 * before FCM refuses an Android token as a malformed APNs one, `400`, which drops nothing).
 */
function platformOf(target: Pick<PageTarget, "platform">): { platform?: "android" } {
  return target.platform === "android" ? { platform: "android" } : {};
}

/**
 * Rings one device as a call (RFC 0010) through the relay (`kind: "call"`): on iOS a VoIP push to its PushKit token,
 * on Android a data message to its FCM token, which the app registers as its call token when it can ring (the
 * ConnectionService). Only a device with a call token: PushKit requires the app to report every VoIP push to
 * CallKit, which the app does for every push it gets (a malformed one included), so a call goes only to a token the
 * app itself registered. The
 * call carries no receipt token (the extension, which reports receipts, never sees it). Best effort: never throws;
 * what the relay answered goes on the call's own delivery row (and a token APNs says is gone is cleared), while the
 * page is retried, escalated and recorded on the alert's outcome alone. Undefined when no call was sent.
 */
async function ringOne(
  callId: string,
  target: PageTarget,
  content: PushContent,
  env: NotifyEnv,
  post: (init: RequestInit) => Promise<Response>,
): Promise<CallOutcome | undefined> {
  const { deviceId, voipToken } = target;
  if (!voipToken) return undefined;
  let envelope;
  try {
    envelope = await sealPush(target.publicKey, content);
  } catch (error) {
    log("sealing a call failed", { device: deviceId, error: String(error) });
    return { ok: false, error: "seal_failed" };
  }
  const started = Date.now();
  try {
    const response = await post({
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RELAY_SEND_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        kind: "call",
        callId,
        deviceToken: voipToken,
        ...platformOf(target),
        envelope,
        urgency: "page",
        environment: target.environment,
      }),
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
    const ms = Date.now() - started;
    if (response.ok) {
      await response.body?.cancel();
      log("call sent", { device: deviceId });
      return { ok: true, ms };
    }
    const answer = (await response.json().catch(() => ({}))) as RelayAnswer;
    // Never the token or the envelope.
    log("relay refused a call", {
      device: deviceId,
      status: response.status,
      error: answer.error,
      apnsStatus: answer.status,
      reason: answer.reason,
    });
    const { error, apnsReason, gone } = refusal(response.status, answer);
    return {
      ok: false,
      error,
      ms,
      ...(apnsReason === undefined ? {} : { apnsReason }),
      // The token the call went to, so a device that registered a new one meanwhile keeps it.
      ...(gone ? { expiredVoipToken: voipToken } : {}),
    };
  } catch (error) {
    log("call not sent", { device: deviceId, error: String(error) });
    return { ok: false, error: "relay_unreachable", ms: Date.now() - started };
  }
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
