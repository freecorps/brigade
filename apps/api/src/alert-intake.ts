// The workspace shard's side of alert sources (RFC 0005 "Alert sources"): checking a payload's URL secret, header
// and signature, normalizing it (packages/schema, alert-normalize.ts) and running `alert.ingest` as the alerts'
// system actor, which routes each alert and opens incidents through `incident.declare`.

import { alert_incident_title } from "@freecorps/brigade-i18n/messages";
import {
  ALERTS_ACTOR,
  alertIssues,
  newId,
  normalizeAlerts,
  quietAlerts,
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

/** The alert that stands for a payload Brigade cannot read (or the shard refused): it pages through the default. */
function unreadable(source: AlertSourceRow): NormalizedAlert {
  return {
    dedupKey: "malformed",
    // TODO(RFC 0008): the workspace's default locale, once workspaces have one.
    title: alert_incident_title({ part: "malformed", name: source.name }, { locale: "en" }),
    severity: "high",
    status: "firing",
    link: null,
    labels: {},
  };
}

const CAPACITY_TITLE = () => alert_incident_title({ part: "capacity", name: "" }, { locale: "en" });

export class AlertIntake {
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
    const source = shard.store.get("alert_sources", sourceId);
    const secret = shard.store.get("alert_source_secrets", sourceId);
    if (!source || !secret || !same(hexBytes(secret.tokenHash), digest)) {
      return { status: "not_found" };
    }
    if (secret.headerHash !== null && source.headerName !== null) {
      const value = headers[source.headerName];
      if (value === undefined) return { status: "not_found" };
      const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
      if (!same(hexBytes(secret.headerHash), hash)) return { status: "not_found" };
    }
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
   * After the routes changed: routes every suppressed or dropped alert still firing again (`alert.reroute`), so one a
   * deleted or changed route kept quiet pages now. Never throws: the route change is committed, and if this fails,
   * each alert's next repeat routes it again anyway.
   */
  reroute(): void {
    const { shard, randomBytes: random, log } = this.options;
    try {
      const quiet = quietAlerts(shard.store);
      if (quiet.length === 0) return;
      const now = Date.now();
      const { result, changes } = shard.mutate({
        clientId: "alerts:reroute",
        mutationId: newId("rrt", now, random),
        actor: ALERTS_ACTOR,
        name: "alert.reroute",
        args: {
          rows: quiet.map((row) => ({
            rowId: row.id,
            alertId: newId("alt", now, random),
            incidentId: newId("inc", now, random),
          })),
          capacityTitle: CAPACITY_TITLE(),
        },
        now,
        internal: true,
      });
      if (result.ok) this.options.committed(result.version, changes);
      else if (result.error.code !== "conflict") {
        log("routing quiet alerts again refused", {
          code: result.error.code,
          message: result.error.message,
        });
      }
    } catch (error) {
      log("routing quiet alerts again failed", { error: String(error) });
    }
  }
}
