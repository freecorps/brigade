// The workspace shard's side of outbound webhooks (RFC 0005 "Outbound webhooks"): creating an endpoint and rotating
// its secret as the member who asked (the API made the secret and sealed it), and the delivery ledger that makes each
// event's delivery to each endpoint at-least-once, never twice at a time, with backoff and a cap. The queue consumer
// reaches it through `planWebhooks` / `recordWebhook` (src/notify-webhooks.ts).

import {
  isWebhookEventType,
  NOTIFIER_ACTOR,
  WEBHOOK_TEST_EVENT,
  webhookPayload,
  webhookSubject,
  webhookWants,
  type Actor,
  type Issue,
  type MutationErrorCode,
  type WebhookError,
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
/** The client id the API's webhook mutations run under, and the notifier's. */
export const WEBHOOK_CLIENT_ID = "webhooks";
const NOTIFIER_CLIENT_ID = "webhook-notifier";

/** Whether the webhook notifier acts on `event`: a catalog event, or a test. Most events are neither. */
export function asksForWebhooks(event: BrigadeEvent): boolean {
  return event.type === WEBHOOK_TEST_EVENT || isWebhookEventType(event.type);
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
    body text not null,
    at integer not null
  ) without rowid;
  create table if not exists webhook_sends (
    event_id text not null,
    webhook_id text not null,
    attempts integer not null,
    claimed_until integer not null,
    retry_at integer not null,
    done integer not null,
    at integer not null,
    primary key (event_id, webhook_id)
  ) without rowid;
  create table if not exists webhook_emails (
    event_id text primary key,
    claimed_until integer not null,
    done integer not null,
    at integer not null
  ) without rowid;
`;

/** One delivery the consumer should make now. */
export type WebhookSend = {
  webhookId: string;
  url: string;
  /** The sealed secrets to sign with: the current one, then the previous one during its grace. */
  secrets: string[];
  /** 1 for the first try. */
  attempt: number;
};

/**
 * What the consumer should do for an event: `body` is the payload, the same bytes on every delivery; `sends` are due
 * now; `waitUntil` is the earliest a send held by another delivery or waiting for its backoff is due again.
 */
export type WebhookPlan = { body: string | null; sends: WebhookSend[]; waitUntil: number | null };

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
   * `webhook.create` or `webhook.rotateSecret` as the member who asked (RPC from the API's routes), with the sealed
   * secret the API made. De-duplicated by `key`, so a retried request gets the first answer.
   */
  run(
    actor: Actor,
    name: "webhook.create" | "webhook.rotateSecret",
    args: Record<string, unknown>,
    key: string,
    now: number,
  ): MutationResultMessage {
    const { shard } = this.options;
    const stored = shard.storedResult(actor.id, WEBHOOK_CLIENT_ID, key, now);
    if (stored) return stored;
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
   * carries the same bytes.
   */
  plan(event: BrigadeEvent, now: number): WebhookPlan {
    this.prune(now);
    const none: WebhookPlan = { body: null, sends: [], waitUntil: null };
    if (!asksForWebhooks(event)) return none;
    const { store } = this.options.shard;
    const endpoints = store.scan("webhooks").filter((row) => webhookWants(row, event));
    if (endpoints.length === 0) return none;
    const body = this.body(event, now);
    if (body === null) return none;
    const sends: WebhookSend[] = [];
    let waitUntil: number | null = null;
    for (const endpoint of endpoints) {
      const ledger = this.send(event.id, endpoint.id);
      if (ledger?.done) continue;
      const due = Math.max(ledger?.claimed_until ?? 0, ledger?.retry_at ?? 0);
      if (due > now) {
        waitUntil = waitUntil === null ? due : Math.min(waitUntil, due);
        continue;
      }
      const secrets = store.get("webhook_secrets", endpoint.id);
      if (!secrets) continue;
      this.sql.exec(
        `insert into webhook_sends (event_id, webhook_id, attempts, claimed_until, retry_at, done, at)
         values (?, ?, 0, ?, 0, 0, ?)
         on conflict (event_id, webhook_id) do update set claimed_until = excluded.claimed_until`,
        event.id,
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
        attempt: (ledger?.attempts ?? 0) + 1,
      });
    }
    return { body, sends, waitUntil };
  }

  /**
   * What one attempt did: kept in the endpoint's log (`webhook.record`, which may turn it off), and in the ledger.
   * Returns when to try again, or null when this event is done at this endpoint: delivered, given up after
   * `WEBHOOK_MAX_ATTEMPTS`, refused for good (a blocked URL, a secret that does not open) or the endpoint gone.
   */
  record(
    event: BrigadeEvent,
    webhookId: string,
    outcome: WebhookOutcome,
    now: number,
  ): { retryAt: number | null } {
    const attempts = (this.send(event.id, webhookId)?.attempts ?? 0) + 1;
    const { shard } = this.options;
    const mutationId = `record:${event.id}:${webhookId}:${attempts}`;
    let gone = false;
    if (!shard.storedResult(NOTIFIER_ACTOR.id, NOTIFIER_CLIENT_ID, mutationId, now)) {
      const { result, changes } = shard.mutate({
        clientId: NOTIFIER_CLIENT_ID,
        mutationId,
        actor: NOTIFIER_ACTOR,
        name: "webhook.record",
        args: {
          id: webhookId,
          attempt: { eventId: event.id, type: event.type, attempt: attempts, ...outcome },
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
      !outcome.ok && !gone && retryable && attempts < WEBHOOK_MAX_ATTEMPTS
        ? now + WEBHOOK_RETRY_DELAYS_MS[attempts - 1]!
        : null;
    if (!outcome.ok) {
      this.options.log(retryAt === null ? "webhook given up" : "webhook failed", {
        event: event.id,
        webhook: webhookId,
        attempts,
        status: outcome.status,
        error: outcome.error,
      });
    }
    this.sql.exec(
      `insert into webhook_sends (event_id, webhook_id, attempts, claimed_until, retry_at, done, at)
       values (?, ?, ?, 0, ?, ?, ?)
       on conflict (event_id, webhook_id) do update set attempts = excluded.attempts,
         claimed_until = 0, retry_at = excluded.retry_at, done = excluded.done`,
      event.id,
      webhookId,
      attempts,
      retryAt ?? 0,
      retryAt === null ? 1 : 0,
      now,
    );
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
      "insert into webhook_events (event_id, body, at) values (?, ?, ?)",
      event.id,
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

/** A mutation's refusal, as the API's webhook routes answer it. */
export type WebhookRunResult =
  | { ok: true }
  | { ok: false; code: MutationErrorCode | "not_a_member"; issues?: Issue[] };
