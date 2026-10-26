// Delivery receipts (RFC 0006 "Delivery receipts"): the shard's side. Each page sealed for a device carries a token
// the shard minted for that one page and device; the phone's Notification Service Extension posts it back after it
// opened the page (`POST /receipts`, src/index.ts), with no session. The token is an HMAC under a key only this shard
// holds (random, made on first use, never leaves its storage), over the key's id, the workspace, incident, page event,
// device and an expiry: it cannot be forged, names exactly one page on one device, and is useless after `RECEIPT_TTL_MS`. A
// receipt is recorded once (`delivery.confirm`); a replay changes nothing. Nothing here is on the paging path: a
// failure to mint a token sends the page without one.

import { deliveryId, NOTIFIER_ACTOR } from "@freecorps/brigade-schema";
import { fromBase64url, toBase64url } from "@freecorps/brigade-push";
import type { Shard } from "./shard.ts";
import type { RowChange } from "./store.ts";
import { WORKSPACE_ID } from "./workspace.ts";

/** How long a page's token is good for: APNs keeps a page 15 minutes, a retry adds about a minute. */
export const RECEIPT_TTL_MS = 30 * 60 * 1000;
/** Receipts one device may send in a minute; a page is one each, so more is a broken or hostile client. */
export const RECEIPT_RATE_PER_MINUTE = 30;
/** Longest token the Worker reads. */
export const RECEIPT_TOKEN_MAX_LENGTH = 300;

const VERSION = "v1";
/**
 * The id of the key a token was minted under, so a key can rotate later without guessing which one signed a token.
 * One key today: a token naming any other is refused.
 */
const KEY_ID = "k1";
const RATE_WINDOW_MS = 60 * 1000;

const SCHEMA = `
  create table if not exists receipt_key (id integer primary key check (id = 1), key blob not null);
  create table if not exists receipt_rate (
    device_id text primary key,
    window_start integer not null,
    count integer not null
  ) without rowid;
`;

/** What a receipt's token names. `expiresAt` in whole seconds, as the token carries it. */
export type ReceiptClaim = {
  keyId: string;
  workspaceId: string;
  incidentId: string;
  eventId: string;
  deviceId: string;
  expiresAt: number;
};

const ID = /^[a-z]{2,8}_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/**
 * Splits a token into what it claims and its MAC, or returns undefined when it is not one. Pure: says nothing about
 * whether it is genuine.
 */
export function parseReceiptToken(
  token: unknown,
): { claim: ReceiptClaim; mac: Uint8Array } | undefined {
  if (typeof token !== "string" || token.length > RECEIPT_TOKEN_MAX_LENGTH) return undefined;
  const parts = token.split(".");
  if (parts.length !== 8 || parts[0] !== VERSION) return undefined;
  const [, keyId, workspaceId, incidentId, eventId, deviceId, expires, mac] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (
    !/^k[1-9][0-9]{0,3}$/.test(keyId) ||
    !WORKSPACE_ID.test(workspaceId) ||
    !ID.test(incidentId) ||
    !incidentId.startsWith("inc_") ||
    !ID.test(eventId) ||
    !eventId.startsWith("evt_") ||
    !ID.test(deviceId) ||
    !deviceId.startsWith("dev_") ||
    !/^[1-9][0-9]{0,11}$/.test(expires) ||
    !/^[A-Za-z0-9_-]{43}$/.test(mac)
  ) {
    return undefined;
  }
  let bytes: Uint8Array;
  try {
    bytes = fromBase64url(mac);
  } catch {
    return undefined;
  }
  if (bytes.length !== 32) return undefined;
  return {
    claim: { keyId, workspaceId, incidentId, eventId, deviceId, expiresAt: Number(expires) },
    mac: bytes,
  };
}

/** The workspace a token names, so the Worker knows which shard to ask; undefined for anything malformed. */
export function receiptWorkspace(token: unknown): string | undefined {
  return parseReceiptToken(token)?.claim.workspaceId;
}

const signed = (claim: ReceiptClaim) =>
  new TextEncoder().encode(
    [
      "brigade receipt",
      VERSION,
      claim.keyId,
      claim.workspaceId,
      claim.incidentId,
      claim.eventId,
      claim.deviceId,
      claim.expiresAt,
    ].join("\n"),
  );

/**
 * What a receipt did: `recorded` the first time, `already` for a replay; `invalid` for a token this shard did not
 * mint (forged, altered, another workspace's, under a key it does not hold) or that is malformed, `expired`, `not_found` when the page was never
 * planned for that device (or its row is gone), `rate_limited` past `RECEIPT_RATE_PER_MINUTE`.
 */
export type ReceiptResult =
  | "recorded"
  | "already"
  | "invalid"
  | "expired"
  | "not_found"
  | "rate_limited";

export type ReceiptsOptions = {
  storage: DurableObjectStorage;
  shard: Shard;
  randomBytes: (length: number) => Uint8Array;
  log: (message: string, fields: Record<string, unknown>) => void;
  committed: (version: number, changes: readonly RowChange[]) => void;
};

export class Receipts {
  private key: Promise<CryptoKey> | undefined;

  constructor(private readonly options: ReceiptsOptions) {
    options.storage.sql.exec(SCHEMA);
  }

  /** A token for each device of one page, good for `RECEIPT_TTL_MS` from `now`. */
  async mint(
    claim: Omit<ReceiptClaim, "keyId" | "deviceId" | "expiresAt">,
    deviceIds: readonly string[],
    now: number,
  ): Promise<Map<string, string>> {
    const key = await this.hmacKey();
    const expiresAt = Math.ceil((now + RECEIPT_TTL_MS) / 1000);
    const tokens = new Map<string, string>();
    for (const deviceId of deviceIds) {
      const full = { ...claim, keyId: KEY_ID, deviceId, expiresAt };
      const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, signed(full)));
      tokens.set(
        deviceId,
        [
          VERSION,
          full.keyId,
          full.workspaceId,
          full.incidentId,
          full.eventId,
          full.deviceId,
          expiresAt,
          toBase64url(mac),
        ].join("."),
      );
    }
    return tokens;
  }

  /** Checks a receipt's token and records the delivery once. Never throws for a bad token. */
  async receive(token: unknown, now: number): Promise<ReceiptResult> {
    const parsed = parseReceiptToken(token);
    if (
      !parsed ||
      parsed.claim.keyId !== KEY_ID ||
      parsed.claim.workspaceId !== this.options.shard.workspace()
    ) {
      return "invalid";
    }
    const { claim, mac } = parsed;
    // `verify` compares in constant time.
    const genuine = await crypto.subtle.verify(
      "HMAC",
      await this.hmacKey(),
      new Uint8Array(mac),
      signed(claim),
    );
    if (!genuine) return "invalid";
    if (claim.expiresAt * 1000 < now) return "expired";
    if (!this.allow(claim.deviceId, now)) return "rate_limited";

    const id = deliveryId(claim.incidentId, claim.eventId, claim.deviceId);
    const { shard } = this.options;
    const mutationId = `receipt:${id}`;
    const stored = shard.storedResult(NOTIFIER_ACTOR.id, "receipts", mutationId, now);
    if (stored) return stored.ok ? "already" : this.answer(stored.error.code);
    const { result, changes } = shard.mutate({
      clientId: "receipts",
      mutationId,
      actor: NOTIFIER_ACTOR,
      name: "delivery.confirm",
      args: { id },
      now,
      internal: true,
    });
    if (result.ok) {
      this.options.committed(result.version, changes);
      return "recorded";
    }
    return this.answer(result.error.code);
  }

  private answer(code: string): ReceiptResult {
    if (code === "conflict") return "already";
    if (code === "not_found") return "not_found";
    this.options.log("receipt refused", { code });
    return "invalid";
  }

  /** A fixed one-minute window per device; old windows are dropped as they are met. */
  private allow(deviceId: string, now: number): boolean {
    const { sql } = this.options.storage;
    const window = now - (now % RATE_WINDOW_MS);
    sql.exec("delete from receipt_rate where window_start < ?", window);
    const row = sql
      .exec<{ count: number }>("select count from receipt_rate where device_id = ?", deviceId)
      .toArray()[0];
    if (row && row.count >= RECEIPT_RATE_PER_MINUTE) return false;
    sql.exec(
      `insert into receipt_rate (device_id, window_start, count) values (?, ?, 1)
       on conflict (device_id) do update set count = count + 1`,
      deviceId,
      window,
    );
    return true;
  }

  /** The shard's HMAC key: made once, kept in its storage, never sent anywhere. */
  private hmacKey(): Promise<CryptoKey> {
    this.key ??= (async () => {
      const { sql } = this.options.storage;
      let raw = sql
        .exec<{ key: ArrayBuffer }>("select key from receipt_key where id = 1")
        .toArray()[0]?.key;
      if (!raw) {
        const fresh = this.options.randomBytes(32);
        sql.exec(
          "insert into receipt_key (id, key) values (1, ?) on conflict do nothing",
          fresh.buffer,
        );
        raw = sql.exec<{ key: ArrayBuffer }>("select key from receipt_key where id = 1").one().key;
      }
      return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, [
        "sign",
        "verify",
      ]);
    })().catch((error: unknown) => {
      this.key = undefined;
      throw error;
    });
    return this.key;
  }
}
