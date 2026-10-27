// The workspace shard's side of outbound webhooks (RFC 0005 "Outbound webhooks"): creating an endpoint and rotating
// its secret as the member who asked (the API made the secret and sealed it), and the delivery ledger that makes each
// event's delivery to each endpoint at-least-once, never twice at a time, with backoff and a cap. The queue consumer
// reaches it through `planWebhooks` / `recordWebhook` (src/notify-webhooks.ts). A delivery due again (its backoff ran
// out, or a claim nobody recorded) is brought back by the shard's alarm (`redrive`): a `webhook.redeliver` event
// through the outbox, so the backoff never rides the original event's Queue retries, which a page needs.

import {
  isWebhookEventType,
  NOTIFIER_ACTOR,
  WEBHOOK_REDELIVER_EVENT,
  WEBHOOK_REPLAY_EVENT,
  WEBHOOK_TEST_EVENT,
  webhookPayload,
  webhookSubject,
  webhookWants,
  type Actor,
  type Issue,
  type MutationErrorCode,
  type WebhookError,
  type WebhookHeader,
  type WebhookRow,
} from "@freecorps/brigade-schema";
import type { MutationResultMessage } from "@freecorps/brigade-sync/protocol";
import type { BrigadeEvent } from "./outbox.ts";
import { LEDGER_RETENTION_MS } from "./paging.ts";
import type { Shard } from "./shard.ts";
import type { RowChange } from "./store.ts";

/** Attempts per event and endpoint: the first, then one after each of `WEBHOOK_RETRY_DELAYS_MS`. */
export const WEBHOOK_RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 3_600_000, 14_400_000] as const;
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_MS.length + 1;
/** How long a plan holds an event's delivery to an endpoint, so two deliveries of one event never send it at once. */
export const WEBHOOK_CLAIM_MS = 30_000;
/** How long a plan holds the email that tells the owners an endpoint was turned off. */
export const WEBHOOK_EMAIL_CLAIM_MS = 60_000;
/** After the alarm re-enqueued a delivery, how long before it does again if no consumer planned it meanwhile. */
export const WEBHOOK_REQUEUE_MS = 10 * 60_000;
/** Events re-enqueued per alarm; more wait for the next one, set for right away. */
export const WEBHOOK_REDRIVE_BATCH = 50;
/** The client id the API's webhook mutations run under, and the notifier's. */
export const WEBHOOK_CLIENT_ID = "webhooks";
const NOTIFIER_CLIENT_ID = "webhook-notifier";

/**
 * Whether the webhook notifier acts on `event`: a catalog event, a test, a redelivery or a replay. Most events are none.
 */
export function asksForWebhooks(event: Pick<BrigadeEvent, "type">): boolean {
  return (
    event.type === WEBHOOK_TEST_EVENT ||
    event.type === WEBHOOK_REDELIVER_EVENT ||
    event.type === WEBHOOK_REPLAY_EVENT ||
    isWebhookEventType(event.type)
  );
}

/** Whether `event` asks for the email that tells the owners an endpoint was turned off for failing. */
export function asksForWebhookEmail(event: BrigadeEvent): boolean {
  return (
    event.type === "webhook.disabled" &&
    (event.data as { reason?: unknown } | null)?.reason === "failing"
  );
}

const SCHEMA = `
  create table if not exists webhook_events (
    event_id text primary key,
    event text not null,
    body text not null,
    at integer not null
  ) without rowid;
  create index if not exists webhook_events_at on webhook_events (at);
  create table if not exists webhook_sends (
    event_id text not null,
    webhook_id text not null,
    attempts integer not null,
    claimed_until integer not null,
    retry_at integer not null,
    queued_until integer not null default 0,
    done integer not null,
    at integer not null,
    primary key (event_id, webhook_id)
  ) without rowid;
  create index if not exists webhook_sends_at on webhook_sends (at);
  create index if not exists webhook_sends_open on webhook_sends (done, event_id);
  create table if not exists webhook_emails (
    event_id text primary key,
    claimed_until integer not null,
    done integer not null,
    at integer not null
  ) without rowid;
  create index if not exists webhook_emails_at on webhook_emails (at);
`;

/** One delivery the consumer should make now. */
export type WebhookSend = {
  webhookId: string;
  url: string;
  /** The sealed secrets to sign with: the current one, then the previous one during its grace. */
  secrets: string[];
  /** The endpoint's custom headers, each value sealed. */
  headers: { name: string; value: string }[];
  /** 1 for the first try. */
  attempt: number;
};

/**
 * What the consumer should do for an event: `event` is the one delivered (for a redelivery, the original), `body` its
 * payload, the same bytes on every delivery; `sends` are due now. Anything else due later comes back on its own.
 */
export type WebhookPlan = {
  event: WebhookEventRef | null;
  body: string | null;
  sends: WebhookSend[];
};

/**
 * The event a delivery carries, as far as signing and the log need it. `ledger`: for a replay, the `webhook.replay`
 * event's id, which keys its own row in the ledger (the event's own row may be done long ago); the delivery still
 * carries `id` as its `webhook-id`.
 */
export type WebhookEventRef = Pick<BrigadeEvent, "id" | "type" | "workspaceId"> & {
  ledger?: string;
};

const refOf = (event: BrigadeEvent): WebhookEventRef => ({
  id: event.id,
  type: event.type,
  workspaceId: event.workspaceId,
});

/** What one delivery attempt did, as the consumer saw it. */
export type WebhookOutcome = {
  at: number;
  ok: boolean;
  status: number | null;
  ms: number | null;
  error: WebhookError | null;
  snippet: string | null;
};

/** The email that tells the owners an endpoint was turned off. */
export type WebhookEmailPlan =
  | { send: true; description: string; host: string; failures: number }
  | { send: false; reason: "held"; until: number }
  | { send: false; reason: "done" | "not_found" };

export type WebhookDeskOptions = {
  storage: DurableObjectStorage;
  shard: Shard;
  log: (message: string, fields: Record<string, unknown>) => void;
  committed: (version: number, changes: readonly RowChange[]) => void;
  /** Brings the shard's alarm forward to `at` (for `redrive`). Never throws. */
  wake: (at: number) => void;
};

type SendRow = { attempts: number; claimed_until: number; retry_at: number; done: number };

export class WebhookDesk {
  constructor(private readonly options: WebhookDeskOptions) {
    options.storage.sql.exec(SCHEMA);
  }

  private get sql() {
    return this.options.storage.sql;
  }

  /**
   * `webhook.create`, `webhook.rotateSecret` or `webhook.setHeaders` as the member or token who asked (RPC from the
   * API's routes), with what the API sealed. A header sent without a value (`value: null`) keeps the sealed value and
   * hint the endpoint has for that name (whatever its case); one it does not have is `invalid_args`. De-duplicated by
   * `key`, so a retried request gets the first answer.
   */
  run(
    actor: Actor,
    name: WebhookRunName,
    args: Record<string, unknown>,
    key: string,
    now: number,
  ): MutationResultMessage {
    const { shard } = this.options;
    const stored = shard.storedResult(actor.id, WEBHOOK_CLIENT_ID, key, now);
    if (stored) return stored;
    if (name === "webhook.setHeaders" && Array.isArray(args.headers)) {
      const id = typeof args.id === "string" ? args.id : "";
      const kept = shard.store.get("webhook_secrets", id)?.headers ?? [];
      const shown = shard.store.get("webhooks", id)?.headers ?? [];
      const headers: unknown[] = [];
      for (const [index, header] of (args.headers as WebhookHeaderArg[]).entries()) {
        if (header?.value !== null) {
          headers.push(header);
          continue;
        }
        const lower = String(header.name).toLowerCase();
        const value = kept.find((one) => one.name.toLowerCase() === lower)?.value;
        if (value === undefined) {
          return {
            type: "mutationResult",
            mutationId: key,
            ok: false,
            error: {
              code: "invalid_args",
              message: "A new header needs a value",
              issues: [{ path: `headers[${index}].value`, message: "Required" }],
            },
          };
        }
        const hint = shown.find((one) => one.name.toLowerCase() === lower)?.hint ?? null;
        headers.push({ name: header.name, value, hint });
      }
      args = { ...args, headers };
    }
    const { result, changes } = shard.mutate({
      clientId: WEBHOOK_CLIENT_ID,
      mutationId: key,
      actor,
      name,
      args,
      now,
      internal: true,
    });
    if (result.ok) this.options.committed(result.version, changes);
    return result;
  }

  /**
   * Plans `event`'s deliveries (see `WebhookPlan`), claiming each one due for `WEBHOOK_CLAIM_MS`. The payload is made
   * the first time from the event and the incident or monitor it is about as they are then, and kept, so every retry
   * carries the same bytes. A `webhook.redeliver` plans its original event again, for the endpoints the ledger still
   * has open; one turned off or deleted since is given up.
   */
  plan(event: BrigadeEvent, now: number): WebhookPlan {
    this.prune(now);
    const none: WebhookPlan = { event: null, body: null, sends: [] };
    if (event.type === WEBHOOK_REDELIVER_EVENT) return this.replan(event, now) ?? none;
    if (event.type === WEBHOOK_REPLAY_EVENT) return this.replay(event, now) ?? none;
    if (!asksForWebhooks(event)) return none;
    const { store } = this.options.shard;
    const endpoints = store.scan("webhooks").filter((row) => webhookWants(row, event));
    if (endpoints.length === 0) return none;
    const body = this.body(event, now);
    if (body === null) return none;
    return { event: refOf(event), body, sends: this.claim(event.id, endpoints, now) };
  }

  private replan(redeliver: BrigadeEvent, now: number): WebhookPlan | undefined {
    const eventId = (redeliver.data as { eventId?: unknown } | null)?.eventId;
    if (typeof eventId !== "string") return undefined;
    const [kept] = this.sql
      .exec<{ event: string; body: string }>(
        "select event, body from webhook_events where event_id = ?",
        eventId,
      )
      .toArray();
    if (!kept) return undefined;
    const event = JSON.parse(kept.event) as BrigadeEvent;
    // A replay the consumer never recorded (put off, or the consumer died) comes back as itself.
    if (event.type === WEBHOOK_REPLAY_EVENT) return this.replay(event, now);
    const { store } = this.options.shard;
    const endpoints: WebhookRow[] = [];
    for (const { webhook_id } of this.sql
      .exec<{ webhook_id: string }>(
        "select webhook_id from webhook_sends where event_id = ? and done = 0",
        eventId,
      )
      .toArray()) {
      const endpoint = store.get("webhooks", webhook_id);
      if (endpoint && webhookWants(endpoint, event)) {
        endpoints.push(endpoint);
        continue;
      }
      this.options.log("webhook retry dropped: endpoint gone or off", {
        event: eventId,
        webhook: webhook_id,
      });
      this.sql.exec(
        "update webhook_sends set done = 1 where event_id = ? and webhook_id = ?",
        eventId,
        webhook_id,
      );
    }
    return { event: refOf(event), body: kept.body, sends: this.claim(event.id, endpoints, now) };
  }

  /**
   * A `webhook.replay` (`data`: the endpoint, the event and its type): the event's kept body, once, to that endpoint
   * while it is on, under the replay's own row in the ledger (keyed by the replay's id), so the event's own row, done
   * or not, is never touched. The body is kept again under the replay's id, so a replay the consumer never recorded
   * comes back through `redrive` like any delivery. Undefined when the payload is no longer kept, the endpoint is gone
   * or off, or the replay is done or held.
   */
  private replay(replay: BrigadeEvent, now: number): WebhookPlan | undefined {
    const data = replay.data as { id?: unknown; eventId?: unknown; type?: unknown } | null;
    const webhookId = data?.id;
    const eventId = data?.eventId;
    const type = data?.type;
    if (typeof webhookId !== "string" || typeof eventId !== "string" || typeof type !== "string") {
      return undefined;
    }
    const keptBody = (id: string) =>
      this.sql
        .exec<{ body: string }>("select body from webhook_events where event_id = ?", id)
        .toArray()[0]?.body;
    let body = keptBody(replay.id);
    if (body === undefined) {
      body = keptBody(eventId);
      if (body === undefined) {
        this.options.log("webhook replay dropped: payload no longer kept", {
          event: eventId,
          webhook: webhookId,
        });
        return undefined;
      }
      this.sql.exec(
        "insert into webhook_events (event_id, event, body, at) values (?, ?, ?, ?)",
        replay.id,
        JSON.stringify(replay),
        body,
        now,
      );
    }
    const endpoint = this.options.shard.store.get("webhooks", webhookId);
    if (!endpoint?.enabled) {
      this.options.log("webhook replay dropped: endpoint gone or off", {
        event: eventId,
        webhook: webhookId,
      });
      this.sql.exec(
        `insert into webhook_sends (event_id, webhook_id, attempts, claimed_until, retry_at, queued_until, done, at)
         values (?, ?, 0, 0, 0, 0, 1, ?)
         on conflict (event_id, webhook_id) do update set done = 1`,
        replay.id,
        webhookId,
        now,
      );
      return undefined;
    }
    return {
      event: { id: eventId, type, workspaceId: replay.workspaceId, ledger: replay.id },
      body,
      sends: this.claim(replay.id, [endpoint], now),
    };
  }

  /**
   * Claims each of `endpoints` due now under ledger key `ledgerId` (the event's id, or a replay's); one held, waiting
   * out its backoff or done is skipped.
   */
  private claim(ledgerId: string, endpoints: readonly WebhookRow[], now: number): WebhookSend[] {
    const { store } = this.options.shard;
    const sends: WebhookSend[] = [];
    for (const endpoint of endpoints) {
      const ledger = this.send(ledgerId, endpoint.id);
      if (ledger?.done) continue;
      if (Math.max(ledger?.claimed_until ?? 0, ledger?.retry_at ?? 0) > now) continue;
      const secrets = store.get("webhook_secrets", endpoint.id);
      if (!secrets) continue;
      this.sql.exec(
        `insert into webhook_sends (event_id, webhook_id, attempts, claimed_until, retry_at, queued_until, done, at)
         values (?, ?, 0, ?, 0, 0, 0, ?)
         on conflict (event_id, webhook_id) do update set claimed_until = excluded.claimed_until,
           queued_until = 0`,
        ledgerId,
        endpoint.id,
        now + WEBHOOK_CLAIM_MS,
        now,
      );
      const previous =
        secrets.previous && (secrets.previousUntil ?? 0) > now ? [secrets.previous] : [];
      sends.push({
        webhookId: endpoint.id,
        url: endpoint.url,
        secrets: [secrets.secret, ...previous],
        headers: secrets.headers ?? [],
        attempt: (ledger?.attempts ?? 0) + 1,
      });
    }
    // A consumer that dies (or puts a send off) never records: the alarm brings those back once the claim runs out.
    if (sends.length > 0) this.options.wake(now + WEBHOOK_CLAIM_MS);
    return sends;
  }

  /**
   * From the shard's alarm: every event with a delivery due again (a backoff that ran out, or a claim nobody recorded)
   * goes back to the queue as `webhook.redeliver` (a mutation, so through the outbox), and is not re-enqueued for
   * `WEBHOOK_REQUEUE_MS` unless a consumer plans it. Returns how many events went.
   */
  redrive(now: number): number {
    const { shard } = this.options;
    const due = this.sql
      .exec<{ event_id: string }>(
        `select distinct event_id from webhook_sends
         where done = 0 and claimed_until <= ? and retry_at <= ? and queued_until <= ?
         limit ?`,
        now,
        now,
        now,
        WEBHOOK_REDRIVE_BATCH,
      )
      .toArray();
    let sent = 0;
    for (const { event_id: eventId } of due) {
      // Set first, so one that fails to queue is tried again later, never in a loop.
      this.sql.exec(
        "update webhook_sends set queued_until = ? where event_id = ? and done = 0",
        now + WEBHOOK_REQUEUE_MS,
        eventId,
      );
      const mutationId = `redeliver:${eventId}:${now}`;
      if (!shard.storedResult(NOTIFIER_ACTOR.id, NOTIFIER_CLIENT_ID, mutationId, now)) {
        const { result, changes } = shard.mutate({
          clientId: NOTIFIER_CLIENT_ID,
          mutationId,
          actor: NOTIFIER_ACTOR,
          name: "webhook.redeliver",
          args: { eventId },
          now,
          internal: true,
        });
        if (!result.ok) {
          this.options.log("webhook redelivery not queued", {
            event: eventId,
            code: result.error.code,
          });
          continue;
        }
        this.options.committed(result.version, changes);
      }
      sent++;
    }
    return sent;
  }

  /** When `redrive` has something to do next; null when no delivery is open. */
  nextAt(): number | null {
    const [row] = this.sql
      .exec<{ at: number | null }>(
        `select min(max(claimed_until, retry_at, queued_until)) as at from webhook_sends where done = 0`,
      )
      .toArray();
    return row?.at ?? null;
  }

  /**
   * What one attempt did: kept in the endpoint's log (`webhook.record`, which may turn it off), and in the ledger.
   * Returns when to try again, or null when this event is done at this endpoint: delivered, given up after
   * `WEBHOOK_MAX_ATTEMPTS`, refused for good (a blocked URL, a secret that does not open) or the endpoint gone. A
   * replay (`event.ledger`) is one attempt: never retried by itself, since a member can replay it again.
   */
  record(
    event: WebhookEventRef,
    webhookId: string,
    outcome: WebhookOutcome,
    now: number,
  ): { retryAt: number | null } {
    const ledgerId = event.ledger ?? event.id;
    const replay = event.ledger !== undefined;
    const attempts = (this.send(ledgerId, webhookId)?.attempts ?? 0) + 1;
    const { shard } = this.options;
    const mutationId = `record:${ledgerId}:${webhookId}:${attempts}`;
    let gone = false;
    if (!shard.storedResult(NOTIFIER_ACTOR.id, NOTIFIER_CLIENT_ID, mutationId, now)) {
      const { result, changes } = shard.mutate({
        clientId: NOTIFIER_CLIENT_ID,
        mutationId,
        actor: NOTIFIER_ACTOR,
        name: "webhook.record",
        args: {
          id: webhookId,
          attempt: {
            eventId: event.id,
            type: event.type,
            attempt: attempts,
            ...outcome,
            ...(replay ? { replay } : {}),
          },
        },
        now,
        internal: true,
      });
      if (result.ok) this.options.committed(result.version, changes);
      else if (result.error.code === "not_found") gone = true;
      else this.options.log("webhook attempt not recorded", { code: result.error.code });
    }
    const retryable = outcome.error !== "blocked" && outcome.error !== "secret";
    const retryAt =
      !outcome.ok && !gone && !replay && retryable && attempts < WEBHOOK_MAX_ATTEMPTS
        ? now + WEBHOOK_RETRY_DELAYS_MS[attempts - 1]!
        : null;
    if (!outcome.ok) {
      this.options.log(retryAt === null ? "webhook given up" : "webhook failed", {
        event: event.id,
        webhook: webhookId,
        ...(replay ? { replay: ledgerId } : {}),
        attempts,
        status: outcome.status,
        error: outcome.error,
      });
    }
    this.sql.exec(
      `insert into webhook_sends (event_id, webhook_id, attempts, claimed_until, retry_at, queued_until, done, at)
       values (?, ?, ?, 0, ?, 0, ?, ?)
       on conflict (event_id, webhook_id) do update set attempts = excluded.attempts,
         claimed_until = 0, retry_at = excluded.retry_at, queued_until = 0, done = excluded.done`,
      ledgerId,
      webhookId,
      attempts,
      retryAt ?? 0,
      retryAt === null ? 1 : 0,
      now,
    );
    if (retryAt !== null) this.options.wake(retryAt);
    return { retryAt };
  }

  /**
   * The email that tells the owners endpoint `event.subject` was turned off for failing, claimed for
   * `WEBHOOK_EMAIL_CLAIM_MS`: what it says about the endpoint (its description and host, never its path or query,
   * which may carry a token).
   */
  planEmail(event: BrigadeEvent, now: number): WebhookEmailPlan {
    const [row] = this.sql
      .exec<{ claimed_until: number; done: number }>(
        "select claimed_until, done from webhook_emails where event_id = ?",
        event.id,
      )
      .toArray();
    if (row?.done) return { send: false, reason: "done" };
    if (row && row.claimed_until > now)
      return { send: false, reason: "held", until: row.claimed_until };
    const endpoint = event.subject
      ? this.options.shard.store.get("webhooks", event.subject)
      : undefined;
    if (!endpoint) return { send: false, reason: "not_found" };
    this.sql.exec(
      `insert into webhook_emails (event_id, claimed_until, done, at) values (?, ?, 0, ?)
       on conflict (event_id) do update set claimed_until = excluded.claimed_until`,
      event.id,
      now + WEBHOOK_EMAIL_CLAIM_MS,
      now,
    );
    const failures = Number((event.data as { failures?: unknown } | null)?.failures ?? 0);
    return {
      send: true,
      description: endpoint.description,
      host: new URL(endpoint.url).host,
      failures: Number.isSafeInteger(failures) ? failures : 0,
    };
  }

  /** The email went out or was given up (`done`), or failed and may be tried again (its hold is released). */
  recordEmail(event: BrigadeEvent, done: boolean, now: number): void {
    this.sql.exec(
      `insert into webhook_emails (event_id, claimed_until, done, at) values (?, 0, ?, ?)
       on conflict (event_id) do update set claimed_until = 0, done = excluded.done`,
      event.id,
      done ? 1 : 0,
      now,
    );
  }

  /** The kept payload of `event`, made and kept now if this is its first delivery; null when there is none. */
  private body(event: BrigadeEvent, now: number): string | null {
    const [kept] = this.sql
      .exec<{ body: string }>("select body from webhook_events where event_id = ?", event.id)
      .toArray();
    if (kept) return kept.body;
    const { store } = this.options.shard;
    const subject = webhookSubject(event);
    const payload = webhookPayload(event, {
      ...(subject && "incidentId" in subject
        ? { incident: store.get("incidents", subject.incidentId) }
        : {}),
      ...(subject && "monitorId" in subject
        ? { monitor: store.get("monitors", subject.monitorId) }
        : {}),
    });
    if (!payload) return null;
    const body = JSON.stringify(payload);
    this.sql.exec(
      "insert into webhook_events (event_id, event, body, at) values (?, ?, ?, ?)",
      event.id,
      JSON.stringify(event),
      body,
      now,
    );
    return body;
  }

  private send(eventId: string, webhookId: string): SendRow | undefined {
    return this.sql
      .exec<SendRow>(
        "select attempts, claimed_until, retry_at, done from webhook_sends where event_id = ? and webhook_id = ?",
        eventId,
        webhookId,
      )
      .toArray()[0];
  }

  private prune(now: number): void {
    try {
      const before = now - LEDGER_RETENTION_MS;
      this.sql.exec("delete from webhook_events where at < ?", before);
      this.sql.exec("delete from webhook_sends where at < ?", before);
      this.sql.exec("delete from webhook_emails where at < ?", before);
    } catch (error) {
      this.options.log("pruning the webhook ledger failed", { error: String(error) });
    }
  }
}

/** What the API's webhook routes run in the shard (src/webhook-routes.ts). */
export type WebhookRunName = "webhook.create" | "webhook.rotateSecret" | "webhook.setHeaders";

/** A custom header as the routes send it: its value sealed, or null to keep the one the endpoint has. */
export type WebhookHeaderArg = { name: string; value: string | null; hint: string | null };

/** A mutation's outcome, as the API's webhook routes answer it; `headers`: the endpoint's, after `setHeaders`. */
export type WebhookRunResult =
  | { ok: true; headers?: WebhookHeader[] }
  | { ok: false; code: MutationErrorCode | "not_a_member" | "unauthenticated"; issues?: Issue[] };
