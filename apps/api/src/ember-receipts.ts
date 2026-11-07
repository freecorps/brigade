// Delivery receipts for a workspace on Ember (RFC 0006 "Delivery receipts", RFC 0016 "Parity"). The DO mints and checks
// receipt tokens under a random key kept in its own storage; an Ember mutation cannot run crypto (it is synchronous),
// so on Ember the Worker does both, under a key derived from `BETTER_AUTH_SECRET` for this one purpose and this one
// workspace (HKDF, as the Ember token's key is), and the shard only records what a genuine token names
// (`paging:receipt`). Its tokens carry key id `k2`, so one the DO minted (`k1`) is told apart and refused: a page
// planned before the switch loses its delivered stage, accepted with the copy (RFC 0016 "Data migration").

import { checkReceiptToken, mintReceiptTokens, type ReceiptResult } from "./receipts.ts";
import type { PagePlan } from "./paging.ts";

/** The key id of tokens minted on Ember. */
export const EMBER_RECEIPT_KEY_ID = "k2";

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

/** `workspaceId`'s receipt key: HKDF of `secret`, kept per isolate. */
function receiptKey(secret: string, workspaceId: string): Promise<CryptoKey> {
  const cacheKey = `${workspaceId}\n${secret}`;
  let key = keys.get(cacheKey);
  if (!key) {
    key = crypto.subtle
      .importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"])
      .then((base) =>
        crypto.subtle.deriveKey(
          {
            name: "HKDF",
            hash: "SHA-256",
            salt: new Uint8Array(),
            info: encoder.encode(`brigade-receipt:v1:${workspaceId}`),
          },
          base,
          { name: "HMAC", hash: "SHA-256", length: 256 },
          false,
          ["sign", "verify"],
        ),
      );
    // A failed derivation is not kept: the next call tries again.
    key.catch(() => keys.delete(cacheKey));
    keys.set(cacheKey, key);
  }
  return key;
}

const log = (message: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ message, ...fields }));

/**
 * `plan` with each device's receipt token, as `WorkspaceDO.plan` mints them. Never in the page's way: without a
 * token the page goes out all the same, and only its delivered stage stays unknown.
 */
export async function withReceipts(
  env: { BETTER_AUTH_SECRET?: string },
  workspaceId: string,
  eventId: string,
  plan: PagePlan,
  now: number,
): Promise<PagePlan> {
  if (!plan.send || !env.BETTER_AUTH_SECRET) return plan;
  try {
    const tokens = await mintReceiptTokens(
      await receiptKey(env.BETTER_AUTH_SECRET, workspaceId),
      EMBER_RECEIPT_KEY_ID,
      { workspaceId, incidentId: plan.incident.id, eventId },
      plan.targets.map((target) => target.deviceId),
      now,
    );
    return {
      ...plan,
      targets: plan.targets.map((target) => ({ ...target, receipt: tokens.get(target.deviceId) })),
    };
  } catch (error) {
    log("minting receipt tokens failed; paging without them", {
      workspace: workspaceId,
      event: eventId,
      error: String(error),
    });
    return plan;
  }
}

/**
 * A receipt for a workspace on Ember: the token checked here (`invalid`, `expired`), then recorded on the shard by
 * `record` (`paging:receipt`: the device's rate, once per delivery).
 */
export async function emberReceipt(
  env: { BETTER_AUTH_SECRET: string },
  workspaceId: string,
  token: string,
  now: number,
  record: (claim: {
    workspaceId: string;
    incidentId: string;
    eventId: string;
    deviceId: string;
  }) => Promise<ReceiptResult>,
): Promise<ReceiptResult> {
  const checked = await checkReceiptToken(
    await receiptKey(env.BETTER_AUTH_SECRET, workspaceId),
    EMBER_RECEIPT_KEY_ID,
    token,
    workspaceId,
    now,
  );
  if (!checked.ok) return checked.result;
  const { incidentId, eventId, deviceId } = checked.claim;
  return record({ workspaceId, incidentId, eventId, deviceId });
}
