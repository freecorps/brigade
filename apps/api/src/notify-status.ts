// Status page emails (RFC 0012 "Email subscriptions"), run by the `brigade-events` consumer (src/notify.ts): the
// confirmation an address asked for, and the page's notifications to its confirmed subscribers. The shard plans and
// keeps the ledger (src/status-mail.ts); this reads the addresses from D1, renders each email in the page's language
// (src/email-templates.ts), sends it and reports back. It runs within `STATUS_EMAIL_BUDGET_MS`, its sends share the
// side notifiers' connection slots (src/side-connections.ts), and nothing on the paging path waits for it.

import { resolveLocale } from "@freecorps/brigade-i18n";
import { renderStatusConfirmEmail, renderStatusEmail } from "./email-templates.ts";
import { linkFallback, type EmailSender } from "./email.ts";
import { emailRetryDelay, RECIPIENTS_TIMEOUT_MS } from "./notify-email.ts";
import type { BrigadeEvent } from "./outbox.ts";
import { NotStarted, type SideConnections } from "./side-connections.ts";
import { STATUS_EMAIL_CLAIM_MS, type StatusEmailPlan } from "./status-mail.ts";
import {
  signLink,
  STATUS_CONFIRM_DAILY_CAP,
  STATUS_CONFIRM_TTL_MS,
  subscriptionLink,
} from "./status-subscribers.ts";

/**
 * How long one delivery may spend starting sends. Past it the delivery returns (the queue moves on) while sends under
 * way finish under `waitUntil` and report; the rest are left to the next batch.
 */
export const STATUS_EMAIL_BUDGET_MS = 3000;

export type StatusNotifyEnv = {
  WORKSPACE: Env["WORKSPACE"];
  DB?: D1Database;
  /** The public page's origin for links (`/status/<slug>`); without it only the dev log sender links anywhere. */
  DASHBOARD_URL?: string;
  /** Signs the links in the emails (src/status-subscribers.ts). */
  BETTER_AUTH_SECRET?: string;
};

type Subscriber = { id: string; email: string; origin: string | null };

/**
 * The emails one status event asks for. Returns the seconds to wait before the message is delivered again, or
 * undefined when it is settled (sent, nothing to send, or given up; a long list carries on through the outbox, not
 * through this message). Without a sender nothing is sent. Throws only when the shard cannot be reached.
 */
export async function notifyStatus(
  event: BrigadeEvent,
  attempts: number,
  env: StatusNotifyEnv,
  sender: EmailSender | undefined,
  slots: SideConnections,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<number | undefined> {
  if (!sender || !env.BETTER_AUTH_SECRET) return undefined;
  const workspace = env.WORKSPACE.getByName(event.workspaceId);
  const plan = await workspace.planStatusEmail(event);
  if (!plan.send) {
    return plan.reason === "held"
      ? Math.max(
          emailRetryDelay(attempts),
          Math.ceil(Math.max(STATUS_EMAIL_CLAIM_MS, plan.until - Date.now()) / 1000),
        )
      : undefined;
  }
  const deadline = Date.now() + STATUS_EMAIL_BUDGET_MS;
  const work = run(event, plan, env, env.BETTER_AUTH_SECRET, sender, slots, deadline).then(
    async (report) => {
      const { retry } = await workspace.recordStatusEmail(event, plan.key, report);
      return retry ? emailRetryDelay(attempts) : undefined;
    },
  );
  waitUntil?.(work.catch(() => undefined));
  // Past the budget plus one send's own bound the delivery lets go: the claim holds the batch until it reports.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<number>((resolve) => {
    timer = setTimeout(
      () => resolve(Math.ceil(STATUS_EMAIL_CLAIM_MS / 1000)),
      STATUS_EMAIL_BUDGET_MS + 2000,
    );
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

type Report = { cursor: string; sent: number; more: boolean; failed: boolean };

async function run(
  event: BrigadeEvent,
  plan: Extract<StatusEmailPlan, { send: true }>,
  env: StatusNotifyEnv,
  secret: string,
  sender: EmailSender,
  slots: SideConnections,
  deadline: number,
): Promise<Report> {
  const locale = resolveLocale(plan.page.locale);
  const { slug } = plan.page;
  const base = (subscriber: Subscriber) =>
    env.DASHBOARD_URL ? env.DASHBOARD_URL : linkFallback(sender, subscriber.origin);
  if (plan.confirm) {
    let subscriber: Subscriber | null;
    try {
      subscriber = await withTimeout(
        env.DB?.prepare(
          "select id, email, origin from status_subscriber where id = ? and workspace_id = ? and status = 'pending'",
        )
          .bind(plan.confirm.subscriberId, event.workspaceId)
          .first<Subscriber>(),
      );
    } catch (error) {
      log("status confirmation: D1 could not be read", { event: event.id, error: String(error) });
      return { cursor: "", sent: 0, more: false, failed: true };
    }
    const origin = subscriber ? base(subscriber) : undefined;
    if (!subscriber || !origin) {
      if (subscriber)
        log("status confirmation not sent: DASHBOARD_URL is not set", { event: event.id });
      return { cursor: "", sent: 0, more: false, failed: false };
    }
    if (!(await underAddressCap(env.DB!, subscriber.email))) {
      log("status confirmation capped for this address today", { event: event.id });
      return { cursor: "", sent: 0, more: false, failed: false };
    }
    const token = await signLink(secret, {
      kind: "c",
      workspaceId: event.workspaceId,
      subscriberId: subscriber.id,
      expires: Date.now() + STATUS_CONFIRM_TTL_MS,
    });
    const email = renderStatusConfirmEmail(
      plan.page.title,
      { email: subscriber.email },
      subscriptionLink(origin, slug, "confirm", token),
      locale,
    );
    const result = await sender.send(email);
    if (result.ok) return { cursor: "", sent: 1, more: false, failed: false };
    log("status confirmation refused", { event: event.id, code: result.code, retry: result.retry });
    return { cursor: "", sent: 0, more: false, failed: result.retry };
  }
  const notify = plan.notify!;
  let subscribers: Subscriber[];
  try {
    const rows = await withTimeout(
      env.DB?.prepare(
        `select id, email, origin from status_subscriber
         where workspace_id = ? and status = 'confirmed' and id > ? order by id limit ?`,
      )
        .bind(event.workspaceId, notify.cursor, notify.limit + 1)
        .all<Subscriber>(),
    );
    subscribers = rows?.results ?? [];
  } catch (error) {
    log("status email: D1 could not be read", { event: event.id, error: String(error) });
    return { cursor: notify.cursor, sent: 0, more: true, failed: true };
  }
  const more = subscribers.length > notify.limit;
  const batch = subscribers.slice(0, notify.limit);
  // Each send in a side slot, started only before the deadline. A send refused for good counts as handled.
  const outcomes = await Promise.all(
    batch.map(async (subscriber): Promise<"sent" | "dropped" | "again" | "later"> => {
      const origin = base(subscriber);
      if (!origin) return "dropped";
      const manage = await signLink(secret, {
        kind: "m",
        workspaceId: event.workspaceId,
        subscriberId: subscriber.id,
        expires: 0,
      });
      const email = renderStatusEmail(
        plan.page.title,
        notify.content,
        { email: subscriber.email },
        {
          page: new URL(`/status/${slug}`, origin).href,
          manage: subscriptionLink(origin, slug, "manage", manage),
          unsubscribe: subscriptionLink(origin, slug, "unsubscribe", manage),
        },
        locale,
      );
      try {
        const result = await slots.run(() => sender.send(email), deadline);
        if (result.ok) return "sent";
        // Never the address.
        log("status email refused", { event: event.id, code: result.code, retry: result.retry });
        return result.retry ? "again" : "dropped";
      } catch (error) {
        if (error instanceof NotStarted) return "later";
        throw error;
      }
    }),
  );
  if (
    batch.length > 0 &&
    outcomes.every((outcome) => outcome === "dropped") &&
    !env.DASHBOARD_URL
  ) {
    log("status emails not sent: DASHBOARD_URL is not set", { event: event.id });
  }
  // The cursor moves past the leading run of handled subscribers; the rest go in the next batch. One sent after the
  // first that was not may go twice: at least once is the rule, as for every delivery here.
  const stop = outcomes.findIndex((outcome) => outcome === "again" || outcome === "later");
  const handled = stop < 0 ? batch.length : stop;
  const cursor = handled > 0 ? batch[handled - 1]!.id : notify.cursor;
  const sent = outcomes.slice(0, handled).filter((outcome) => outcome === "sent").length;
  // A refusal a retry may fix backs off; sends that only ran out of budget carry on at once.
  const failed = outcomes.includes("again");
  return { cursor, sent, more: more || stop >= 0, failed };
}

/** Counts one confirmation to `email` today in D1; false when the address had `STATUS_CONFIRM_DAILY_CAP` already. */
async function underAddressCap(db: D1Database, email: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const row = await withTimeout(
    db
      .prepare(
        `insert into status_confirmation_send (email, day, count) values (?, ?, 1)
         on conflict (email, day) do update set count = count + 1 where count < ?
         returning count`,
      )
      .bind(email, day, STATUS_CONFIRM_DAILY_CAP)
      .first<{ count: number }>(),
  );
  return row !== null && row !== undefined;
}

async function withTimeout<T>(promise: Promise<T> | undefined): Promise<T> {
  if (!promise) throw new Error("no D1 binding");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("D1 timed out")), RECIPIENTS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, notifier: "status-email", ...fields }));
}
