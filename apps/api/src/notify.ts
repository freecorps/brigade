// The `brigade-events` consumer (RFC 0005 "Delivery", RFC 0002 runtime map): routes each event to its notifiers.
// The first is push: for an event that pages, the workspace shard plans who gets it, each device's push is sealed
// to its own key (HPKE, `packages/push`) and sent through the relay (RFC 0006), and the outcomes go back to the
// shard. Delivery is at-least-once, so the shard's page ledger, keyed by `event.id`, makes a redelivery page nobody
// twice.

import { sealPush } from "@freecorps/brigade-push";
import { formatIncidentNumber } from "@freecorps/brigade-schema";
import type { BrigadeEvent } from "./outbox.ts";
import type { DeviceOutcome, PagePlan, PageTarget } from "./paging.ts";
import { WORKSPACE_ID } from "./workspace.ts";

/**
 * Deliveries of a page before the members it missed are recorded as not paged (`notification.failed`). The
 * Queue's `max_retries` (wrangler.jsonc) is higher, so the consumer, not the Queue, decides when to give up.
 */
export const MAX_PAGE_ATTEMPTS = 5;
/** Delay before redelivering a page that failed: 5, 10, 20, 40 s. Pages are urgent; giving up takes about 75 s. */
export const PAGE_RETRY_FIRST_SECONDS = 5;
export const PAGE_RETRY_MAX_SECONDS = 60;
/** How long the relay gets per send. */
export const RELAY_TIMEOUT_MS = 10_000;

/** Optional: an instance without a relay still runs, and every page it would send is recorded as failed. */
export type NotifyEnv = {
  WORKSPACE: Env["WORKSPACE"];
  /** The relay's base URL, e.g. a `brigade-relay-<env>` Worker. A secret, so hostnames stay out of the repo. */
  RELAY_URL?: string;
  /** Bearer token for the relay's `POST /send`. */
  RELAY_SEND_TOKEN?: string;
};

export type Fetch = (request: Request) => Promise<Response>;

/** The queue handler: one message per event; each is acked or retried on its own. Never throws. */
export async function consumeEvents(
  batch: MessageBatch<unknown>,
  env: NotifyEnv,
  send: Fetch = (request) => fetch(request),
): Promise<void> {
  const seen = new Set<string>();
  await Promise.all(
    batch.messages.map(async (message) => {
      const event = parseEvent(message.body);
      if (!event) {
        log("event dropped: not a Brigade event", { messageId: message.id });
        return message.ack();
      }
      // The same event twice in one batch (a redelivery next to the original): once is enough.
      if (seen.has(event.id)) return message.ack();
      seen.add(event.id);
      try {
        const retry = await notifyPush(event, message.attempts, env, send);
        if (retry) message.retry({ delaySeconds: retryDelay(message.attempts) });
        else message.ack();
      } catch (error) {
        // The shard was unreachable or threw: nothing was recorded, so the whole page runs again.
        log("event handling failed", { event: event.id, type: event.type, error: String(error) });
        message.retry({ delaySeconds: retryDelay(message.attempts) });
      }
    }),
  );
}

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
  const workspace = env.WORKSPACE.getByName(event.workspaceId);
  const plan = await workspace.planPage(event);
  if (!plan.send) return false;
  const sent = await Promise.all(plan.targets.map((target) => pushOne(plan, target, env, send)));
  const final = !sent.some((one) => one.retry) || attempts >= MAX_PAGE_ATTEMPTS;
  await workspace.recordPage(
    event,
    sent.map((one) => one.outcome),
    final,
  );
  return !final;
}

/** One device's outcome, and whether trying again may help. */
type Sent = { outcome: DeviceOutcome; retry: boolean };

/** Seals and sends one device's push; classifies the relay's answer. Never throws. */
async function pushOne(
  plan: Extract<PagePlan, { send: true }>,
  target: PageTarget,
  env: NotifyEnv,
  send: Fetch,
): Promise<Sent> {
  const { deviceId, userId } = target;
  const failed = (
    reason: "undelivered" | "unsupported" | "not_configured",
    more: { retry?: boolean; expired?: boolean } = {},
  ): Sent => ({
    outcome: {
      deviceId,
      userId,
      ok: false,
      reason,
      ...(more.expired ? { expired: true } : {}),
    },
    retry: more.retry ?? false,
  });
  if (!env.RELAY_URL || !env.RELAY_SEND_TOKEN) return failed("not_configured");
  // The relay speaks APNs only; Android needs FCM (RFC 0006).
  if (target.platform !== "ios") return failed("unsupported");

  const { incident } = plan;
  let envelope;
  try {
    envelope = await sealPush(target.publicKey, {
      // Codes, not words, so the title needs no locale; the body is the incident's own title.
      title: [incident.severity.toUpperCase(), formatIncidentNumber(incident.number)]
        .filter(Boolean)
        .join(" · "),
      body: incident.title,
      incident: incident.id,
    });
  } catch (error) {
    // A key `device.register` accepted but WebCrypto refuses (not on the curve): retrying cannot help.
    log("sealing a push failed", { device: deviceId, error: String(error) });
    return failed("undelivered");
  }

  let response: Response;
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
    // The relay is down or slow: the paging path's first fallback is trying again.
    log("relay unreachable", { device: deviceId, error: String(error) });
    return failed("undelivered", { retry: true });
  }
  if (response.ok) {
    await response.body?.cancel();
    return { outcome: { deviceId, userId, ok: true }, retry: false };
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
  // APNs says the token is gone: drop the device, do not retry.
  if (
    answer.status === 410 ||
    answer.reason === "BadDeviceToken" ||
    answer.reason === "Unregistered" ||
    answer.reason === "DeviceTokenNotForTopic"
  ) {
    return failed("undelivered", { expired: true });
  }
  // A request the relay or APNs will refuse again (bad body, bad credentials on our side) is not retried; the
  // relay being unreachable, APNs throttling or failing, or anything unknown is.
  const permanent =
    response.status === 400 ||
    response.status === 401 ||
    (answer.status !== undefined &&
      answer.status >= 400 &&
      answer.status < 500 &&
      answer.status !== 429);
  return failed("undelivered", permanent ? {} : { retry: true });
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
