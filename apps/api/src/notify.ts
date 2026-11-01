// The `brigade-events` consumer (RFC 0005 "Delivery", RFC 0002 runtime map): routes each event to its notifiers:
// a page that failed to email (src/notify-email.ts), a status page's subscribers (src/notify-status.ts), everything else to push, and an incident's events to Slack as
// well (src/notify-slack.ts), next to push and never ahead of it. Push: for an event that pages, the
// workspace shard plans who gets it, each device's push is sealed to its own key (HPKE, `packages/push`) and sent
// through the relay (RFC 0006), a page that rings rings as a call after its alert push (RFC 0010), and the outcomes
// go back to the shard. Delivery is at-least-once, so the shard's page
// ledger, keyed by `event.id`, makes a redelivery page nobody twice. What the Queue gives up on lands in
// `brigade-events-dlq`, whose consumer (`consumeDeadLetters`) records it on the incident's timeline.

import {
  parseOrigin,
  sealPush,
  sealPushV2,
  type PushContent,
  type PushEnvelope,
  type PushReceipt,
} from "@freecorps/brigade-push";
import type { InstanceKey } from "@freecorps/brigade-push/instance";
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
  instanceKey,
  relayReachable,
  RELAY_V1_DEEP_HEALTH_PATH,
  RELAY_V1_SEND_PATH,
  signedRelayCall,
  type RelayInstanceEnv,
} from "./relay-instance.ts";
import {
  asksForPage,
  type CallOutcome,
  type DeviceOutcome,
  type HandleExpiry,
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
  WebhookNotifyEnv &
  RelayInstanceEnv & {
    WORKSPACE: Env["WORKSPACE"];
    /** The status pages' snapshots and custom hostname lookups (src/status-domain.ts `syncStatusHost`). */
    STATUS?: Env["STATUS"];
    DB?: Env["DB"];
    /** The dead-man switch's watchdog (src/watchdog.ts); without it a heartbeat is logged and dropped. */
    WATCHDOG?: Env["WATCHDOG"];
    /**
     * The relay Worker on this account, as a service binding: when bound, every relay call goes through it and
     * `RELAY_URL` is only the address `GET /config` gives the app. A Worker's subrequest to another workers.dev Worker
     * on the same account is answered 404, so a relay deployed next to the API must be reached this way.
     */
    RELAY?: Env["RELAY"];
    /**
     * The relay's base URL when it is not bound, e.g. Freecorps' hosted relay for a self-hosted instance (RFC 0006). A
     * secret, so hostnames stay out of the repo.
     */
    RELAY_URL?: string;
    /**
     * Bearer token for the relay's `POST /send`, which pages devices registered with raw tokens (RFC 0006). Devices
     * registered with a relay handle are paged through `POST /v1/send`, signed with `RELAY_INSTANCE_KEY` instead (RFC
     * 0015).
     */
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
                      : pushRetryDelay(
                          await notifyPush(event, message.attempts, env, send),
                          message.attempts,
                        );
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
 * A `brigade.heartbeat` came through the outbox and the Queue: checks the relay is up and takes this instance (its
 * signature, or its send token), and tells the watchdog, which pings the external check. Never throws, and the
 * message is acked either way: a lost heartbeat is a minute of silence, and the next one is already on its way. With
 * it go the beat's deeper checks (Q19): the push providers, through the relay's deep health, and one cheap D1 read,
 * side by side.
 */
export async function proveHeartbeat(
  event: BrigadeEvent,
  env: Pick<
    NotifyEnv,
    | "WATCHDOG"
    | "RELAY"
    | "RELAY_URL"
    | "RELAY_SEND_TOKEN"
    | "RELAY_INSTANCE_KEY"
    | "RELAY_INSTANCE_ID"
    | "DB"
  >,
  send: Fetch,
): Promise<void> {
  if (event.type !== HEARTBEAT_EVENT) return;
  if (!env.WATCHDOG) {
    log("heartbeat dropped: no watchdog binding", { event: event.id });
    return;
  }
  const [relay, d1] = await Promise.all([relayHealth(env, send), d1Health(env.DB)]);
  const checks: BeatChecks = {
    apns: relay.apns,
    fcm: relay.fcm,
    d1,
    ...(relay.sendToken === undefined ? {} : { sendToken: relay.sendToken }),
  };
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

/** What the relay said; `sendToken` is the send token's own check beside the signed one (both configured). */
type RelayCheck = { relay: RelayHealth; apns: BeatCheck; fcm: BeatCheck; sendToken?: RelayHealth };
const UNKNOWN_PROVIDERS = { apns: "unknown", fcm: "unknown" } as const;

/**
 * What the relay's deep health says of APNs and FCM (`{ apns: { status, transient? }, fcm }`), or undefined when the
 * answer names no `apns` (not a deep health answer).
 */
function providersOf(body: unknown): { apns: BeatCheck; fcm: BeatCheck } | undefined {
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
  if (apns === undefined) return undefined;
  const fcm = provider("fcm") ?? "unknown";
  if ([apns, fcm].some((check) => check === "error" || check === "transient")) {
    log("push provider check failed", { apns, fcm });
  }
  return { apns, fcm };
}

/**
 * Whether a page could get past this Worker right now, and on to the push providers. With an instance key
 * (`RELAY_INSTANCE_KEY`, RFC 0015) the signed `GET /v1/health?deep=1` (`signedRelayHealth`), and beside it the send
 * token's cheap check when `RELAY_SEND_TOKEN` is set too (`sendToken`); a relay without `/v1`
 * is `handles_unavailable`, with the send token's old check (`sendToken`) when there is one. Otherwise `GET /health?deep=1` with the send token
 * (apps/relay src/deep-health.ts): `401` is a refused token (a rotated or mistyped `RELAY_SEND_TOKEN`); an answer
 * naming `apns` means the relay took the token, and says whether APNs took the relay's provider token and FCM gave it
 * an access token, without a push to anyone. Anything else is a relay not answering as one. A relay from before the
 * deep check answers its plain `/health` there (no `apns`): then the token is proved as before (`relayTokenHealth`),
 * and the providers are `unknown`.
 */
async function relayHealth(
  env: Pick<
    NotifyEnv,
    "RELAY" | "RELAY_URL" | "RELAY_SEND_TOKEN" | "RELAY_INSTANCE_KEY" | "RELAY_INSTANCE_ID"
  >,
  send: Fetch,
): Promise<RelayCheck> {
  if (relayReachable(env) && env.RELAY_INSTANCE_KEY?.trim()) {
    const key = await instanceKey(env);
    // A key that does not read signs nothing: every handle's page fails as a refused signature would.
    if (!key) {
      const sendToken = env.RELAY_SEND_TOKEN ? await relayTokenHealth(env, send) : undefined;
      return {
        relay: "bad_signature",
        ...UNKNOWN_PROVIDERS,
        ...(sendToken === undefined ? {} : { sendToken }),
      };
    }
    // With the send token too (an instance moving, RFC 0015 section 9: most phones still page through `/send`), its
    // cheap check runs beside the signed one, and both say what they found.
    const [signed, sendToken] = await Promise.all([
      signedRelayHealth(env, send, key),
      env.RELAY_SEND_TOKEN ? relayTokenHealth(env, send) : undefined,
    ]);
    if (signed !== "no_v1") return sendToken === undefined ? signed : { ...signed, sendToken };
    // A relay without `/v1` (an older one): raw-token phones page through `/send` as before, which its old check
    // proves (`sendToken`); phones with a handle alone cannot be paged at all, which that check must not hide.
    log("relay has no /v1: phones registered with a handle cannot be paged", {});
    if (!env.RELAY_SEND_TOKEN) return { relay: "handles_unavailable", ...UNKNOWN_PROVIDERS };
    const legacy = await tokenDeepHealth(env, send);
    return {
      relay: "handles_unavailable",
      apns: legacy.apns,
      fcm: legacy.fcm,
      sendToken: legacy.relay,
    };
  }
  return tokenDeepHealth(env, send);
}

/** The send token's deep check (`relayHealth` without an instance key). */
async function tokenDeepHealth(
  env: Pick<NotifyEnv, "RELAY" | "RELAY_URL" | "RELAY_SEND_TOKEN">,
  send: Fetch,
): Promise<RelayCheck> {
  if (!env.RELAY_SEND_TOKEN || !relayReachable(env)) {
    return { relay: "not_configured", ...UNKNOWN_PROVIDERS };
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
      return { relay: "unauthorized", ...UNKNOWN_PROVIDERS };
    }
    const providers = providersOf(await response.json().catch(() => null));
    if (providers) return { relay: "ok", ...providers };
  } catch (error) {
    log("relay deep health unreachable", { error: String(error) });
    return { relay: "unreachable", ...UNKNOWN_PROVIDERS };
  }
  return { relay: await relayTokenHealth(env, send), ...UNKNOWN_PROVIDERS };
}

/**
 * The relay's signed deep health (RFC 0015 sections 3 and 7): the instance's own state first, then the providers'.
 * `401` (`bad_signature`, `missing_signature`, `stale_timestamp`) is a key the relay does not take; `403
 * instance_unregistered` or `instance_revoked` an instance it will not page for; `429` its limits (per IP or per
 * instance); an answer naming `apns` says the instance is admitted, with the providers' state and whether the relay
 * can open handles (`handles`). `404` is a relay without `/v1` (`no_v1`); anything else (`503 registry_unavailable`
 * included) a relay not answering as one.
 */
async function signedRelayHealth(
  env: Pick<NotifyEnv, "RELAY" | "RELAY_URL">,
  send: Fetch,
  key: InstanceKey,
): Promise<RelayCheck | "no_v1"> {
  let response: Response;
  try {
    response = await signedRelayCall(env, send, key, {
      method: "GET",
      path: RELAY_V1_DEEP_HEALTH_PATH,
      signal: AbortSignal.timeout(RELAY_HEALTH_TIMEOUT_MS),
    });
  } catch (error) {
    log("relay deep health unreachable", { error: String(error) });
    return { relay: "unreachable", ...UNKNOWN_PROVIDERS };
  }
  const body: unknown = await response.json().catch(() => null);
  const error = Reflect.get(Object(body), "error");
  const refused = (relay: RelayHealth): RelayCheck => {
    log("relay refused this instance", { status: response.status, error, instance: key.instance });
    return { relay, ...UNKNOWN_PROVIDERS };
  };
  if (response.status === 401) return refused("bad_signature");
  if (response.status === 403 && error === "instance_revoked") return refused("instance_revoked");
  if (response.status === 403 && error === "instance_unregistered") {
    return refused("instance_unregistered");
  }
  if (response.status === 429) return refused("rate_limited");
  const providers = providersOf(body);
  if (providers) {
    if (Reflect.get(Object(body), "handles") === false) {
      log("relay cannot open handles", { instance: key.instance });
      return { relay: "handles_unavailable", ...providers };
    }
    return { relay: "ok", ...providers };
  }
  if (response.status === 404) return "no_v1";
  log("relay signed deep health failed", { status: response.status, error });
  return { relay: "unreachable", ...UNKNOWN_PROVIDERS };
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

/** The longest `Retry-After` a page waits out (the relay says 60 s): past it, the page's own backoff decides. */
export const RETRY_AFTER_MAX_SECONDS = 300;

/**
 * A page to try again (`notifyPush`): `retryAfter` is the longest `Retry-After` the relay gave one of its devices (a
 * `429 rate_limited`), which the retry waits out.
 */
export type PushAgain = { retryAfter?: number };

/** Seconds before a page is tried again: its backoff, or the relay's `Retry-After` when longer. None when done. */
export function pushRetryDelay(again: false | PushAgain, attempts: number): number | undefined {
  if (!again) return undefined;
  const after = Math.min(RETRY_AFTER_MAX_SECONDS, again.retryAfter ?? 0);
  return Math.max(retryDelay(attempts), after);
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
 * The push notifier for one event. Returns what to try again later (some device failed in a way that may pass and
 * attempts remain), or false; the outcomes so far are recorded either way. `shard` is the event's workspace shard by
 * RPC; the shard passes itself when it sends a page the Queue has not brought (`WorkspaceDO.pageLocally`).
 */
export async function notifyPush(
  event: BrigadeEvent,
  attempts: number,
  env: NotifyEnv,
  send: Fetch,
  shard?: PageShard,
): Promise<false | PushAgain> {
  // Most events page nobody (the delivery rows' own `notification.*` among them): no shard call for those.
  if (!asksForPage(event)) return false;
  const workspace: PageShard = shard ?? env.WORKSPACE.getByName(event.workspaceId);
  const plan = await within<PagePlan>(workspace.planPage(event), SHARD_CALL_TIMEOUT_MS, "planPage");
  if (!plan.send) return false;
  const receipts = receiptUrl(env.DASHBOARD_URL);
  // Every redelivery of this event rings under the same call id, so a phone rings for it once (RFC 0010).
  const callId = plan.call && plan.urgency === "page" ? await callIdOf(event.id) : undefined;
  const routes = await relayRoutes(env, send);
  const origin = env.DASHBOARD_URL ? parseOrigin(env.DASHBOARD_URL) : undefined;
  const sent = await Promise.all(
    plan.targets.map((target) =>
      pushOne(event.workspaceId, plan, target, routes, origin, receipts, callId),
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
  if (final) return false;
  const after = Math.max(0, ...sent.map((one) => one.retryAfter ?? 0));
  return after > 0 ? { retryAfter: after } : {};
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

/**
 * One device's outcome, whether trying again may help, and how long the relay asked to wait first (`Retry-After` of a
 * `429 rate_limited`).
 */
type Sent = { outcome: DeviceOutcome; retry: boolean; retryAfter?: number };

/**
 * One way to the relay: `token` is `POST /send` with the send token and a device's raw tokens (RFC 0006), `handle`
 * is `POST /v1/send` with a device's relay handle, signed with the instance key (RFC 0015). `post` takes the JSON body.
 */
type RelayRoute = {
  kind: "token" | "handle";
  post: (body: Record<string, unknown>) => Promise<Response>;
};
type RelayRoutes = { token?: RelayRoute; handle?: RelayRoute };

/**
 * The ways to the relay this instance has: `/send` with `RELAY_SEND_TOKEN`, `/v1/send` with `RELAY_INSTANCE_KEY`,
 * either through the `RELAY` binding or at `RELAY_URL`. Neither without a relay.
 */
async function relayRoutes(env: NotifyEnv, send: Fetch): Promise<RelayRoutes> {
  const post = relayPost(env, send);
  const key = relayReachable(env) ? await instanceKey(env) : undefined;
  return {
    ...(post && {
      token: {
        kind: "token",
        post: (body) =>
          post({
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.RELAY_SEND_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
          }),
      },
    }),
    ...(key && {
      handle: {
        kind: "handle",
        post: (body) =>
          signedRelayCall(env, send, key, {
            method: "POST",
            path: RELAY_V1_SEND_PATH,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
          }),
      },
    }),
  };
}

/**
 * How long a push may wait for an offline phone, by urgency, as the relay defaults it (apps/relay src/send.ts): the
 * instance says it outright for a version 2 envelope, whose sealed `exp` is `iat` plus this (RFC 0015 section 4).
 */
export const PUSH_TTL_SECONDS: Record<Urgency, number> = { page: 15 * 60, high: 60 * 60 };
/** A call rings now or not at all (apps/relay `CALL_TTL_SECONDS`). */
export const CALL_TTL_SECONDS = 60;

/** The relay's answer to one send, read once: whether it took it, and if not what it said. */
type RelayResult = { ok: boolean; status: number; answer: RelayAnswer; retryAfter?: number };

async function settle(response: Response): Promise<RelayResult> {
  if (response.ok) {
    await response.body?.cancel();
    return { ok: true, status: response.status, answer: {} };
  }
  const answer = (await response.json().catch(() => ({}))) as RelayAnswer;
  const header = Number(response.headers.get("Retry-After"));
  return {
    ok: false,
    status: response.status,
    answer: typeof answer === "object" && answer !== null ? answer : {},
    ...(Number.isFinite(header) && header > 0 ? { retryAfter: Math.ceil(header) } : {}),
  };
}

/**
 * Whether `/v1/send` refused this instance or failed as a relay, not the device (RFC 0015 section 3): a signature the
 * relay does not take (`401 bad_signature`, `missing_signature`, `stale_timestamp`), an instance revoked or unknown
 * (`403`, anything but `handle_not_yours`), a relay without `/v1` (`404`, an older relay), handle keys it cannot use
 * (`500 relay_misconfigured`), a relay that cannot check (`503 registry_unavailable`, `not_configured`), or a handle
 * it cannot open (`400 bad_handle`). The last is the relay's word, not the phone's: a handle this instance was given
 * by the relay stops opening only when the relay's `RELAY_HANDLE_KEYS` lost its key (a bad deploy or an early
 * retirement), and on the hosted relay that would drop every instance's phones at once; a phone that moved to another
 * relay registers a new handle when it opens. Every device fails the same way: retried, never expired, through
 * `/send` when it has a raw token, and the watchdog's signed deep check says why when it can.
 */
function refusedInstance(result: RelayResult): boolean {
  return (
    result.status === 401 ||
    (result.status === 403 && result.answer.error !== "handle_not_yours") ||
    result.status === 404 ||
    (result.status === 500 && result.answer.error === "relay_misconfigured") ||
    result.status === 503 ||
    (result.status === 400 && result.answer.error === "bad_handle")
  );
}

/**
 * Whether `/v1/send` says the handle is sealed for another instance (`403 handle_not_yours`, after a lost instance
 * key, RFC 0015 "Dead ends"): the handle will never work here. Only the handle goes (`device.expire` with
 * `handleOnly`): a device with a raw token keeps it and is paged through `/send`; one with the handle alone is
 * dropped, and the app registers again with a new handle when it next opens.
 */
function handleNotYours(result: RelayResult): boolean {
  return result.status === 403 && result.answer.error === "handle_not_yours";
}

/**
 * How one device's pages are sealed: version 2 (RFC 0015 section 4) when its app opens it (`envelope: 2`) and this
 * instance knows its own origin (`DASHBOARD_URL`), else version 1, which every app opens. Throws like `sealPush` for a
 * key WebCrypto refuses.
 */
function sealerFor(
  target: PageTarget,
  origin: string | undefined,
): {
  v2: boolean;
  seal: (content: PushContent, ttlSeconds: number, urgency: Urgency) => Promise<PushEnvelope>;
} {
  if (target.envelope === 2 && origin !== undefined) {
    return {
      v2: true,
      seal: (content, ttlSeconds, urgency) =>
        sealPushV2(target.publicKey, content, { origin, urgency, ttlSeconds }),
    };
  }
  if (target.envelope === 2) {
    log("sealing version 1 for an app that opens version 2: DASHBOARD_URL is not set", {
      device: target.deviceId,
    });
  }
  return { v2: false, seal: (content) => sealPush(target.publicKey, content) };
}

/**
 * Seals and sends one device's push; classifies the relay's answer. A device with a relay handle goes to `/v1/send`
 * when the instance key is set; one with a raw token to `/send` when the send token is; a device with both (an
 * instance moving, RFC 0015 section 9) goes through `/send` when `/v1/send` refuses the instance itself, so a revoked
 * or mistyped instance key never costs a page `/send` can still deliver. Once the relay took the alert, rings the
 * device as well when `callId` is given and the plan rings it (`ringOne`), the same way the alert went, and reports
 * the call with the alert's outcome without letting it change it. Never throws.
 */
async function pushOne(
  workspaceId: string,
  plan: Extract<PagePlan, { send: true }>,
  target: PageTarget,
  routes: RelayRoutes,
  origin: string | undefined,
  receipts: string | undefined,
  callId: string | undefined,
): Promise<Sent> {
  const { deviceId, userId } = target;
  let ms: number | undefined;
  const viaHandle = target.handle !== undefined ? routes.handle : undefined;
  const viaToken = target.pushToken !== null ? routes.token : undefined;
  let route = viaHandle ?? viaToken;
  // Set when `/v1/send` said the handle is not this instance's and the page went on through `/send`.
  let notYours: HandleExpiry = {};
  const failed = (
    reason: SendFailure,
    error: DeliveryError,
    more: {
      retry?: boolean;
      expired?: boolean;
      handleOnly?: boolean;
      apnsReason?: string;
      retryAfter?: number;
    } = {},
  ): Sent => ({
    outcome: {
      deviceId,
      userId,
      ok: false,
      reason,
      // The token (or handle) this push went to, so a device registered again meanwhile is not dropped.
      ...(more.expired && route?.kind === "handle" && target.handle !== undefined
        ? { expiredHandle: target.handle, ...(more.handleOnly ? { handleOnly: true } : {}) }
        : more.expired && target.pushToken !== null
          ? { expiredToken: target.pushToken }
          : notYours),
      error,
      ...(more.apnsReason === undefined ? {} : { apnsReason: more.apnsReason }),
      ...(ms === undefined ? {} : { ms }),
    },
    retry: more.retry ?? false,
    ...(more.retryAfter === undefined ? {} : { retryAfter: more.retryAfter }),
  });
  if (!route) {
    if (target.handle !== undefined && !routes.handle) {
      log("device registered with a relay handle, but RELAY_INSTANCE_KEY is not set", {
        device: deviceId,
      });
    }
    return failed("not_configured", "not_configured");
  }

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
  const sealer = sealerFor(target, origin);
  const ttlSeconds = PUSH_TTL_SECONDS[plan.urgency];
  let envelope: PushEnvelope;
  try {
    envelope = await sealer.seal(
      receipt ? { ...content, receipt } : content,
      ttlSeconds,
      plan.urgency,
    );
  } catch (error) {
    try {
      // The receipt must never cost the page: a title too long to fit both goes without it.
      if (!receipt) throw error;
      envelope = await sealer.seal(content, ttlSeconds, plan.urgency);
    } catch (again) {
      // A key `device.register` accepted but WebCrypto refuses (not on the curve): retrying cannot help.
      log("sealing a push failed", { device: deviceId, error: String(again) });
      return failed("undelivered", "seal_failed");
    }
  }

  const alert = async (via: RelayRoute, critical: boolean) =>
    settle(
      await via.post({
        ...(via.kind === "handle"
          ? { handle: target.handle }
          : {
              deviceToken: target.pushToken,
              // The relay sends an Android device's push through FCM, an iPhone's through APNs (RFC 0006).
              ...platformOf(target),
              environment: target.environment,
            }),
        envelope,
        urgency: plan.urgency,
        // A redelivered page replaces the one on screen instead of stacking; a lower-urgency push never replaces a
        // page (RFC 0006 "Offline phones"; the shard also holds it back while the page may be undelivered).
        collapseId: collapseIdOf(incident.id, plan.urgency),
        // Rings through silent mode (RFC 0006 "Critical Alerts"); only sent when true.
        ...(critical ? { critical: true } : {}),
        // What a version 2 envelope sealed as its `exp`; the relay's default otherwise.
        ...(sealer.v2 ? { ttlSeconds } : {}),
      }),
    );
  const attempt = async (via: RelayRoute): Promise<RelayResult> => {
    const critical = sendsCritical(plan, target);
    let result = await alert(via, critical);
    // The fallback: a Critical Alert the relay (400) or APNs (its 400, in a 502) refuses as a request goes out at
    // once as the time-sensitive page every phone gets, so asking for more never costs the page. A token APNs says
    // is gone, or a handle the relay cannot open, is handled below, as for any push.
    if (critical && !result.ok) {
      const refused =
        (result.status === 400 && result.answer.error !== "bad_handle") ||
        result.answer.status === 400;
      if (refused && !TOKEN_GONE.includes(result.answer.reason as string)) {
        log("relay refused a critical push, sending it time-sensitive", {
          device: deviceId,
          status: result.status,
          reason: typeof result.answer.reason === "string" ? result.answer.reason : undefined,
        });
        result = await alert(via, false);
      }
    }
    return result;
  };

  let result: RelayResult;
  const started = Date.now();
  try {
    result = await attempt(route);
    if (
      route.kind === "handle" &&
      !result.ok &&
      (refusedInstance(result) || handleNotYours(result)) &&
      viaToken
    ) {
      // The handle is not this instance's: it goes, whatever `/send` does with the raw token.
      if (handleNotYours(result)) notYours = { expiredHandle: target.handle!, handleOnly: true };
      // Never the token, the handle or the envelope.
      log("relay refused the handle or this instance, paging the device through /send", {
        device: deviceId,
        status: result.status,
        error: result.answer.error,
      });
      route = viaToken;
      result = await attempt(route);
    }
  } catch (error) {
    ms = Date.now() - started;
    // The relay is down or slow: the paging path's first fallback is trying again.
    log("relay unreachable", { device: deviceId, error: String(error) });
    return failed("undelivered", "relay_unreachable", { retry: true });
  }
  ms = Date.now() - started;
  if (result.ok) {
    // Step 2 of the ladder (RFC 0010): the alert is out, so the phone can ring. Whatever the call does, the alert's
    // outcome stands.
    // A shard from before the member's choice of calls leaves `call` out: its plan's `call` decides.
    const call =
      callId !== undefined && target.call !== false
        ? await ringOne(callId, target, content, sealer, route)
        : undefined;
    return {
      outcome: {
        deviceId,
        userId,
        ok: true,
        ms,
        ...(call === undefined ? {} : { call }),
        ...notYours,
      },
      retry: false,
    };
  }
  const { answer } = result;
  // Never the token, the handle or the envelope.
  log("relay refused a push", {
    device: deviceId,
    route: route.kind,
    status: result.status,
    error: answer.error,
    apnsStatus: answer.status,
    reason: answer.reason,
  });
  if (route.kind === "handle") {
    // The handle is not this instance's (a lost instance key): dropped like a token gone, and the page retried so
    // the next plan sees this member without that device.
    if (handleNotYours(result)) {
      return failed("token_invalid", "token_invalid", {
        expired: true,
        handleOnly: true,
        retry: true,
      });
    }
    if (refusedInstance(result)) {
      log("relay refused this instance", { status: result.status, error: answer.error });
      return failed("undelivered", result.status === 503 ? "relay_unreachable" : "relay_refused", {
        retry: true,
      });
    }
  }
  if (result.status === 429) {
    // The relay's limits (RFC 0015 section 3): tried again once its window has passed.
    return failed("undelivered", "relay_refused", {
      retry: true,
      ...(result.retryAfter === undefined ? {} : { retryAfter: result.retryAfter }),
    });
  }
  const { error, apnsReason, gone, permanent } = refusal(result.status, answer);
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
 * Rings one device as a call (RFC 0010) through the relay (`kind: "call"`), the way its alert went (`route`): on iOS
 * a VoIP push to its PushKit token, on Android a data message to its FCM token, which the app registers as its call
 * token when it can ring (the ConnectionService); with a relay handle, the handle when it says it can ring (`voip`).
 * Only a device that can ring: PushKit requires the app to report every VoIP push to CallKit, which the app does for
 * every push it gets (a malformed one included), so a call goes only to a token the app itself registered. The call
 * carries no receipt token (the extension, which reports receipts, never sees it). Best effort: never throws; what
 * the relay answered goes on the call's own delivery row (and a token APNs says is gone is cleared), while the page
 * is retried, escalated and recorded on the alert's outcome alone. Undefined when no call was sent.
 */
async function ringOne(
  callId: string,
  target: PageTarget,
  content: PushContent,
  sealer: ReturnType<typeof sealerFor>,
  route: RelayRoute,
): Promise<CallOutcome | undefined> {
  const { deviceId, voipToken, handle } = target;
  const viaHandle = route.kind === "handle";
  if (viaHandle ? target.voip !== true : !voipToken) return undefined;
  let envelope;
  try {
    envelope = await sealer.seal(content, CALL_TTL_SECONDS, "page");
  } catch (error) {
    log("sealing a call failed", { device: deviceId, error: String(error) });
    return { ok: false, error: "seal_failed" };
  }
  const started = Date.now();
  try {
    const result = await settle(
      await route.post({
        kind: "call",
        callId,
        ...(viaHandle
          ? { handle }
          : { deviceToken: voipToken, ...platformOf(target), environment: target.environment }),
        envelope,
        urgency: "page",
        ...(sealer.v2 ? { ttlSeconds: CALL_TTL_SECONDS } : {}),
      }),
    );
    const ms = Date.now() - started;
    if (result.ok) {
      log("call sent", { device: deviceId });
      return { ok: true, ms };
    }
    const { answer } = result;
    // Never the token, the handle or the envelope.
    log("relay refused a call", {
      device: deviceId,
      route: route.kind,
      status: result.status,
      error: answer.error,
      apnsStatus: answer.status,
      reason: answer.reason,
    });
    const { error, apnsReason, gone } = refusal(result.status, answer);
    return {
      ok: false,
      error,
      ms,
      ...(apnsReason === undefined ? {} : { apnsReason }),
      // The token (or handle) the call went to, so a device that registered a new one meanwhile keeps it.
      ...(gone
        ? viaHandle
          ? { expiredVoipHandle: handle! }
          : { expiredVoipToken: voipToken! }
        : {}),
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
