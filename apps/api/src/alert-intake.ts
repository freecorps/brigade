// The workspace shard's side of alert sources (RFC 0005 "Alert sources"): checking a payload's URL secret, header
// and signature, normalizing it (packages/schema, alert-normalize.ts) and running `alert.ingest` as the alerts'
// system actor, which routes each alert and opens incidents through `incident.declare`.

import { alert_incident_title, monitor_incident_title } from "@freecorps/brigade-i18n/messages";
import {
  ALERTS_ACTOR,
  alertIssues,
  newId,
  normalizeAlerts,
  alertsToReroute,
  REROUTE_CHUNK,
  type AlertHeaders,
  type AlertSourceRow,
  type IngestItem,
  type NormalizedAlert,
  type RandomBytes,
} from "@freecorps/brigade-schema";
import type { MutateOutcome, Shard } from "./shard.ts";
import type { RowChange } from "./store.ts";

/**
 * What the Worker answers the sender: `not_found` for every refusal alike (a wrong secret, header or signature, a
 * deleted source); `busy` when the shard cannot take it now (the source is over its rate, or storage failed), so the
 * sender retries. Nothing the payload says makes it `busy`: a payload the shard refuses pages its fallback alert.
 */
export type AlertIntakeResult =
  | { status: "not_found" }
  | { status: "accepted"; alerts: number; malformed: boolean }
  | { status: "ignored" }
  | { status: "busy" };

/**
 * Quiet alerts one `reroute` routes again at most, in chunks of `REROUTE_CHUNK`: what is left waits for the shard's
 * next alarm, so a workspace with hundreds of quiet monitors never holds the shard in one long run.
 */
export const REROUTE_PER_RUN = 200;
/** How long a quiet alert that failed to route again on its own is left alone before it is tried again. */
export const REROUTE_RETRY_MS = 10 * 60 * 1000;

/** Largest alert payload the Worker reads, in bytes: a Grafana group of many alerts fits, a flood does not. */
export const MAX_ALERT_BODY = 256 * 1024;

export type AlertIntakeOptions = {
  shard: Shard;
  randomBytes: RandomBytes;
  log: (message: string, fields: Record<string, unknown>) => void;
  /** Sends the patches of a committed system mutation to the shard's sockets. */
  committed: (version: number, changes: readonly RowChange[]) => void;
  /**
   * Whether a payload the shard has verified may go on (`ALERT_LIMIT`, per source): checked only once the secrets
   * matched, so requests with a wrong secret never spend the real source's budget. Fails open.
   */
  allow: (sourceId: string) => Promise<boolean>;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function hexBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/**
 * Constant-time equality of two byte strings; a length mismatch is simply false. Workers have
 * `crypto.subtle.timingSafeEqual` (https://developers.cloudflare.com/workers/runtime-apis/web-crypto/#timingsafeequal);
 * anywhere else this runs (Node, a test runner), the loop below compares every byte whatever the first difference.
 */
export function same(a: ArrayBuffer | Uint8Array, b: ArrayBuffer | Uint8Array): boolean {
  const left = a instanceof Uint8Array ? a : new Uint8Array(a);
  const right = b instanceof Uint8Array ? b : new Uint8Array(b);
  if (left.byteLength !== right.byteLength) return false;
  // Optional here: the types say workerd, but code that runs elsewhere has no such method.
  const subtle: { timingSafeEqual?: SubtleCrypto["timingSafeEqual"] } = crypto.subtle;
  if (typeof subtle.timingSafeEqual === "function") return subtle.timingSafeEqual(left, right);
  let diff = 0;
  for (let i = 0; i < left.byteLength; i++) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

/** HMAC-SHA256 of the raw `body` bytes (text is UTF-8 encoded) under `secret`, as the lower-case hex providers send. */
export async function hmacHex(
  secret: string,
  body: string | ArrayBuffer | Uint8Array<ArrayBuffer>,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    typeof body === "string" ? encoder.encode(body) : body,
  );
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The header each signing provider puts its HMAC in (Grafana's is its default name). */
export const SIGNATURE_HEADER = {
  sentry: "sentry-hook-signature",
  grafana: "x-grafana-alerting-signature",
} as const;

/**
 * The alert that stands for a payload Brigade cannot read (or the shard refused, or that was too large to read): it
 * pages through the default. One key whatever the reason, so a broken sender is one alert.
 */
function unreadable(
  source: AlertSourceRow,
  part: "malformed" | "too_large" = "malformed",
): NormalizedAlert {
  return {
    dedupKey: "malformed",
    // TODO(RFC 0008): the workspace's default locale, once workspaces have one.
    title: alert_incident_title({ part, name: source.name }, { locale: "en" }),
    severity: "high",
    status: "firing",
    link: null,
    labels: {},
  };
}

const CAPACITY_TITLE = () => alert_incident_title({ part: "capacity", name: "" }, { locale: "en" });

export class AlertIntake {
  /** Quiet rows that failed to route again on their own, and when they may be tried again (`REROUTE_RETRY_MS`). */
  private readonly rerouteFailed = new Map<string, number>();

  constructor(private readonly options: AlertIntakeOptions) {}

  /**
   * One payload for `sourceId`, with the SHA-256 of its URL secret, its raw bytes and its headers (lower-cased).
   * Everything that is not the right source with the right secrets is `not_found`, checked in constant time; the
   * signature is over the bytes as sent. A payload Brigade cannot read still pages: it becomes one alert of its own
   * ("Unreadable alert from …", keyed `malformed`) that skips the routes, so a broken sender is never silence. An
   * alert the shard would refuse is left out and that alert pages too; a payload it refuses all the same pages that
   * alert alone. Only a source over its rate, or storage failing, is `busy`.
   */
  async receive(
    sourceId: string,
    digest: ArrayBuffer,
    body: ArrayBuffer,
    headers: AlertHeaders,
  ): Promise<AlertIntakeResult> {
    const { shard, log } = this.options;
    const source = await this.verified(sourceId, digest, headers);
    if (!source) return { status: "not_found" };
    const secret = shard.store.get("alert_source_secrets", sourceId)!;
    if (secret.signingSecret !== null && (source.kind === "sentry" || source.kind === "grafana")) {
      const sent = headers[SIGNATURE_HEADER[source.kind]]?.trim().toLowerCase();
      if (!sent || !/^[0-9a-f]{64}$/.test(sent)) return { status: "not_found" };
      const expected = await hmacHex(secret.signingSecret, body);
      if (!same(encoder.encode(expected), encoder.encode(sent))) return { status: "not_found" };
    }
    if (!(await this.options.allow(sourceId))) {
      log("alert source over its rate", { source: sourceId });
      return { status: "busy" };
    }

    const normalized = normalizeAlerts(source.kind, decoder.decode(body), headers);
    if (normalized.kind === "ignored") return { status: "ignored" };
    let malformed = normalized.kind === "malformed";
    let alerts: NormalizedAlert[] = [];
    // Readable alerts, and some that were not: those page as the unreadable alert, past every route.
    let partly = false;
    if (normalized.kind === "malformed") {
      log("alert payload unreadable; paging through the default route", {
        source: sourceId,
        kind: source.kind,
        reason: normalized.reason,
      });
    } else {
      if (normalized.skipped > 0) {
        log("alerts left out of a payload", { source: sourceId, skipped: normalized.skipped });
      }
      // One alert the shard would refuse must not keep the rest of a Grafana group from paging.
      const refused = normalized.alerts.filter((alert) => alertIssues(alert).length > 0);
      alerts = normalized.alerts.filter((alert) => !refused.includes(alert));
      if (refused.length > 0 || normalized.unreadable > 0) {
        log("unreadable alerts left out of a payload; paging the unreadable alert", {
          source: sourceId,
          unreadable: normalized.unreadable,
          refused: refused.length,
          ...(refused.length > 0 && { issues: alertIssues(refused[0]).slice(0, 3) }),
        });
      }
      // Nothing readable left: the payload pages as malformed (through the default, past every route).
      malformed = alerts.length === 0;
      partly = (refused.length > 0 || normalized.unreadable > 0) && !malformed;
    }
    if (malformed) alerts = [unreadable(source)];

    const first = this.ingest(
      source.id,
      alerts,
      malformed,
      partly ? unreadable(source) : undefined,
    );
    if (first.ok)
      return { status: "accepted", alerts: alerts.length + (partly ? 1 : 0), malformed };
    if (first.error.code === "not_found") return { status: "not_found" };
    // Refused for what the payload holds (a declare it could not make, an alert it would not take): retrying would
    // be refused the same way, so the payload pages as one unreadable alert instead, and the log says why.
    log("alert payload refused; paging the unreadable alert", {
      source: sourceId,
      code: first.error.code,
      message: first.error.message,
    });
    const fallback = this.ingest(source.id, [unreadable(source)], true);
    if (fallback.ok) return { status: "accepted", alerts: 1, malformed: true };
    if (fallback.error.code === "not_found") return { status: "not_found" };
    log("the unreadable alert was refused too", {
      source: sourceId,
      code: fallback.error.code,
      message: fallback.error.message,
    });
    return { status: "busy" };
  }

  /**
   * A payload of `sourceId` the Worker would not read: past `MAX_ALERT_BODY`. It still pages, as the unreadable alert
   * ("… (payload too large)"), when the URL's secret and the source's header (if it has one) check out. A provider's
   * signature cannot be checked without the body, so for a signed source the secret URL alone authenticates it: the
   * most someone holding that URL can do is what they could do with any body, page this alert.
   */
  async receiveTooLarge(
    sourceId: string,
    digest: ArrayBuffer,
    headers: AlertHeaders,
  ): Promise<AlertIntakeResult> {
    const { log } = this.options;
    const source = await this.verified(sourceId, digest, headers);
    if (!source) return { status: "not_found" };
    if (!(await this.options.allow(sourceId))) {
      log("alert source over its rate", { source: sourceId });
      return { status: "busy" };
    }
    log("alert payload too large; paging the unreadable alert", {
      source: sourceId,
      kind: source.kind,
    });
    const result = this.ingest(source.id, [unreadable(source, "too_large")], true);
    if (result.ok) return { status: "accepted", alerts: 1, malformed: true };
    if (result.error.code === "not_found") return { status: "not_found" };
    log("the unreadable alert was refused", {
      source: sourceId,
      code: result.error.code,
      message: result.error.message,
    });
    return { status: "busy" };
  }

  /**
   * The source, when `digest` is its URL secret's and the request carries its header (if it has one), both compared
   * in constant time; undefined for every refusal alike. The provider's signature is the caller's to check.
   */
  private async verified(
    sourceId: string,
    digest: ArrayBuffer,
    headers: AlertHeaders,
  ): Promise<AlertSourceRow | undefined> {
    const { shard } = this.options;
    const source = shard.store.get("alert_sources", sourceId);
    const secret = shard.store.get("alert_source_secrets", sourceId);
    if (!source || !secret || !same(hexBytes(secret.tokenHash), digest)) return undefined;
    if (secret.headerHash !== null && source.headerName !== null) {
      const value = headers[source.headerName];
      if (value === undefined) return undefined;
      const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
      if (!same(hexBytes(secret.headerHash), hash)) return undefined;
    }
    return source;
  }

  /**
   * Runs `alert.ingest` with fresh ids, `unread` (the unreadable alert, for a payload that was only partly readable)
   * last and past every route, and sends what it changed to the sockets. A storage failure throws.
   */
  private ingest(
    sourceId: string,
    alerts: NormalizedAlert[],
    malformed: boolean,
    unread?: NormalizedAlert,
  ): MutateOutcome["result"] {
    const { shard, randomBytes: random } = this.options;
    const now = Date.now();
    const item = (alert: NormalizedAlert): IngestItem => ({
      alert,
      alertId: newId("alt", now, random),
      incidentId: newId("inc", now, random),
    });
    const items = alerts.map(item);
    if (unread) items.push({ ...item(unread), malformed: true });
    const { result, changes } = shard.mutate({
      clientId: `alerts:${sourceId}`,
      mutationId: newId("ing", now, random),
      actor: ALERTS_ACTOR,
      name: "alert.ingest",
      args: { sourceId, malformed, alerts: items, capacityTitle: CAPACITY_TITLE() },
      now,
      internal: true,
    });
    if (result.ok) this.options.committed(result.version, changes);
    return result;
  }

  /**
   * The quiet alerts (an alert source's or a monitor's, suppressed or dropped and still firing) the routes would now
   * page, less those left alone after failing on their own (`REROUTE_RETRY_MS`): what `reroute` takes next.
   */
  rerouteDue(now = Date.now()): ReturnType<typeof alertsToReroute> {
    for (const [id, at] of this.rerouteFailed) if (at <= now) this.rerouteFailed.delete(id);
    return alertsToReroute(this.options.shard.store).filter(
      (one) => !this.rerouteFailed.has(one.row.id),
    );
  }

  /**
   * When the alarm should route quiet alerts again: now while any is due, else when the first one left alone after
   * failing may be tried again; null when there is none.
   */
  rerouteAt(now: number): number | null {
    if (this.rerouteDue(now).length > 0) return now;
    let at: number | null = null;
    for (const retry of this.rerouteFailed.values()) at = at === null ? retry : Math.min(at, retry);
    return at;
  }

  /**
   * After the routes changed, and on the shard's alarm while any is left: routes the quiet alerts the routes would now
   * page again (`alert.reroute`), so one a deleted or changed route kept quiet pages now. At most `perRun` of them, in
   * chunks of `chunk` (one mutation each); the rest wait for the alarm. A chunk refused or failing is run again one row
   * at a time, and a row that fails alone is logged and left for `REROUTE_RETRY_MS`, so one bad row never holds the
   * others back. Never throws. Returns whether any is left for the alarm to route.
   */
  reroute(chunk = REROUTE_CHUNK, perRun = REROUTE_PER_RUN): boolean {
    const { log } = this.options;
    try {
      const due = this.rerouteDue();
      const now = Date.now();
      const batch = due.slice(0, perRun);
      for (let at = 0; at < batch.length; at += chunk) {
        const rows = batch.slice(at, at + chunk);
        if (rows.length === 1) this.rerouteRows(rows, now, true);
        else if (this.rerouteRows(rows, now) === "failed") {
          for (const one of rows) this.rerouteRows([one], now, true);
        }
      }
      return due.length > batch.length;
    } catch (error) {
      log("routing quiet alerts again failed", { error: String(error) });
      return true;
    }
  }

  /**
   * One `alert.reroute` of `rows`: `done` (or nothing to route, a `conflict`), else `failed`. `alone`: a single row run
   * on its own after its chunk failed, recorded so it is left alone for a while.
   */
  private rerouteRows(
    rows: ReturnType<typeof alertsToReroute>,
    now: number,
    alone = false,
  ): "done" | "failed" {
    const { shard, randomBytes: random, log } = this.options;
    const store = shard.store;
    let outcome: "done" | "failed" = "failed";
    let reason: Record<string, unknown> = {};
    try {
      const { result, changes } = shard.mutate({
        clientId: "alerts:reroute",
        mutationId: newId("rrt", now, random),
        actor: ALERTS_ACTOR,
        name: "alert.reroute",
        args: {
          rows: rows.map((one) => ({
            rowId: one.row.id,
            alertId: newId("alt", now, random),
            incidentId: newId("inc", now, random),
            ...(one.kind === "monitor" && {
              // TODO(RFC 0008): the workspace's default locale, as for the incidents monitors open.
              title: monitor_incident_title(
                { name: store.get("monitors", one.row.monitorId)?.name ?? one.row.monitorId },
                { locale: "en" },
              ),
            }),
          })),
          capacityTitle: CAPACITY_TITLE(),
        },
        now,
        internal: true,
      });
      if (result.ok) this.options.committed(result.version, changes);
      if (result.ok || result.error.code === "conflict") outcome = "done";
      else reason = { code: result.error.code, message: result.error.message };
    } catch (error) {
      reason = { error: String(error) };
    }
    if (outcome === "failed" && alone) {
      const id = rows[0]!.row.id;
      this.rerouteFailed.set(id, now + REROUTE_RETRY_MS);
      log("routing a quiet alert again failed; tried again later", { row: id, ...reason });
    }
    return outcome;
  }
}
