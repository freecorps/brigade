// The paging decisions of the native call module (spike S6, RFC 0010; paging paths need a fallback and a test,
// AGENTS.md). This file is their source of truth: CI runs its tests, and cannot run Kotlin or Swift ones. The
// native code mirrors it, each copy pointing back here:
// - `decideRoute`: modules/brigade-call/android/.../CallRoute.kt (`call-route.test.ts` checks the Kotlin branches).
// - `voipPushPlan`: `CallCenter.pushRegistry(_:didReceiveIncomingPushWith:…)` in modules/brigade-call/ios.
// - `ANSWERED_CALL_MAX_MS`: `Calls.ANSWERED_MAX_MS` (Android) and `CallCenter.answeredMaxLength` (iOS).

export const CALL_CHANNEL = "brigade_calls";
export const PAGE_CHANNEL = "brigade_pages";

/** What Android allows right now, read before every call (`Calls.conditions`). */
export type RingConditions = {
  notificationsEnabled: boolean;
  callChannelEnabled: boolean;
  pageChannelEnabled: boolean;
  /** `NotificationManager.canUseFullScreenIntent()` on Android 14+; always true before. */
  fullScreenAllowed: boolean;
  /** Android 8+ (self-managed calls) and `TelecomManager.isIncomingCallPermitted`. */
  telecomPermitted: boolean;
};

/** How an incoming page reaches this Android phone. */
export type CallRoute =
  | { kind: "ring" }
  | { kind: "notify"; channel: typeof CALL_CHANNEL | typeof PAGE_CHANNEL }
  /** Nothing can be shown (notifications are off): the instance must escalate without waiting for this phone. */
  | { kind: "blocked" };

export function decideRoute(c: RingConditions): CallRoute {
  if (!c.notificationsEnabled) return { kind: "blocked" };
  // A CallStyle notification needs a full-screen intent (or a foreground service) to be posted at all, and
  // without one a locked phone would only show a heads-up: ring only when all of it works.
  if (c.callChannelEnabled && c.fullScreenAllowed && c.telecomPermitted) return { kind: "ring" };
  if (c.pageChannelEnabled) return { kind: "notify", channel: PAGE_CHANNEL };
  if (c.callChannelEnabled) return { kind: "notify", channel: CALL_CHANNEL };
  return { kind: "blocked" };
}

/** What this iPhone knows about a VoIP push's call id. Repeats of one page share it (RFC 0006, 0010). */
export type KnownCall = "new" | "active" | "ended";

/**
 * What the PushKit handler does with a VoIP push. It always reports the call to CallKit first: iOS terminates an
 * app that returns from the handler without reporting, and stops delivering VoIP pushes after repeated misses.
 * - `new`: ring, and track the call.
 * - `active` (still ringing or answered): CallKit answers `callUUIDAlreadyExists`, which is success; keep the call.
 * - `ended` (declined, hung up, timed out, a few minutes ago): report, then end it at once, so a late repeat does
 *   not ring again for a page the responder already handled.
 */
export function voipPushPlan(known: KnownCall): { report: true; next: "ring" | "keep" | "end" } {
  switch (known) {
    case "new":
      return { report: true, next: "ring" };
    case "active":
      return { report: true, next: "keep" };
    case "ended":
      return { report: true, next: "end" };
  }
}

/**
 * An answered call hangs up natively this long after answering, ack or not: speech and the ack take well under a
 * minute, and on Android the app is shown over the lock screen while a call lasts, so the exposure is bounded too.
 */
export const ANSWERED_CALL_MAX_MS = 3 * 60_000;
