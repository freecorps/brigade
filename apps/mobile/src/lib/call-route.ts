// The paging decisions of the native call module (spike S6, RFC 0010; paging paths need a fallback and a test,
// AGENTS.md). This file is their source of truth: CI runs its tests, and cannot run Kotlin or Swift ones. The
// native code mirrors it, each copy pointing back here:
// - `decideRoute`: modules/brigade-call/android/.../CallRoute.kt (`call-route.test.ts` checks the Kotlin branches).
// - `fallbackChannel`: `fallbackChannel` in CallRoute.kt, for every fallback in Calls.kt (`Calls.notifyFallback`).
// - `knownCall`, `REPEAT_SUPPRESSING_END_REASONS`, `ENDED_CALL_MEMORY_MS`: `knownCall` in CallRoute.kt (used by
//   `Calls.ring`) and `CallCenter.known(_:)` in modules/brigade-call/ios.
// - `voipPushPlan`: `CallCenter.pushRegistry(_:didReceiveIncomingPushWith:…)` in modules/brigade-call/ios.
// - `ANSWERED_CALL_MAX_MS`: `Calls.ANSWERED_MAX_MS` (Android) and `CallCenter.answeredMaxLength` (iOS).
// - `unansweredEndReason`, `postsPageOnEnd`: `CallCenter.provider(_:perform: CXEndCallAction)` in
//   modules/brigade-call/ios.

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

/**
 * The channel for a page notification when a call that was going to ring cannot (Telecom creates no connection or
 * throws, the ringing notification is refused): the page channel unless the user muted it, like `decideRoute`'s
 * notify branches. Ringing needed the call channel on, so the call channel is the one left.
 */
export function fallbackChannel(
  c: Pick<RingConditions, "pageChannelEnabled">,
): typeof CALL_CHANNEL | typeof PAGE_CHANNEL {
  return c.pageChannelEnabled ? PAGE_CHANNEL : CALL_CHANNEL;
}

/**
 * How a call ended, as the native module reports it (`onEnd`). An acknowledged call arrives as `hung_up`: the call
 * session hangs up after the ack.
 * - `declined`: rejected while ringing.
 * - `failed` also covers, on iOS, a ringing call ended within `SYSTEM_END_MS` of CallKit accepting it: no person
 *   declines that fast, so it is the system ending a call it took (seen on the Simulator), and a repeat rings.
 * - `hung_up`: answered, then ended by the responder, the call screen or the system.
 * - `timed_out`: answered, then hung up natively after `ANSWERED_CALL_MAX_MS`.
 * - `missed`: nobody answered within the ring timeout (60 s).
 * - `failed`: the ringing UI could not be shown, or CallKit reset.
 */
export type CallEndReason = "declined" | "hung_up" | "timed_out" | "missed" | "failed";

/** An unanswered call ended sooner than this after it started ringing was ended by the system, not a person. */
export const SYSTEM_END_MS = 2_000;

/**
 * The reason for an unanswered call's end on iOS, where CallKit reports a person's decline and the system ending
 * the call the same way. `msSinceRinging` is undefined if CallKit never confirmed the call.
 */
export function unansweredEndReason(msSinceRinging: number | undefined): CallEndReason {
  return msSinceRinging !== undefined && msSinceRinging < SYSTEM_END_MS ? "failed" : "declined";
}

/**
 * Whether an unanswered call that ended for `reason` posts the time-sensitive page notification at once (iOS, Q14
 * decided). Only `failed`: the system ended the call before anyone could see it, so the page is shown now rather
 * than waiting for the instance's repeat, which may be minutes away or never come (the run moved on). A person who
 * declined saw it; a missed call rang its full minute and the instance escalates on its own timeout.
 */
export function postsPageOnEnd(reason: CallEndReason): boolean {
  return reason === "failed";
}

/**
 * Ends after which a repeat of the same page (same call id) does not ring again: the responder saw the call and
 * chose (declined) or was reached (answered). After `missed` or `failed` nobody was reached, so a repeat rings.
 */
export const REPEAT_SUPPRESSING_END_REASONS: readonly CallEndReason[] = [
  "declined",
  "hung_up",
  "timed_out",
];

/**
 * How long an ended call's id and end reason are remembered. The relay never repeats on its own; the instance
 * re-sends a page, with the same call id, and each send expires `ttlSeconds` after it was sent (60 s by default,
 * 5 minutes at most: apps/relay/src/index.ts). So a push sent before the call ended arrives at most 5 minutes after
 * the end: remembering for 5 minutes covers every copy in flight. A send after that is the instance paging again on
 * purpose and rings. The memory is in RAM only: a process that was killed treats a repeat as new, and rings.
 */
export const ENDED_CALL_MEMORY_MS = 5 * 60_000;

/** What the phone knows about an incoming push's call id. Repeats of one page share it (RFC 0006, 0010). */
export type KnownCall = "new" | "active" | "ended";

export type EndedCall = { reason: CallEndReason; atMs: number };

/**
 * Classifies an incoming call id. `ended` only for an end that suppresses a repeat, within the memory; a repeat
 * of a missed or failed call, or one remembered too long ago, is `new` and rings again.
 */
export function knownCall(active: boolean, ended: EndedCall | undefined, nowMs: number): KnownCall {
  if (active) return "active";
  if (
    ended !== undefined &&
    nowMs - ended.atMs < ENDED_CALL_MEMORY_MS &&
    REPEAT_SUPPRESSING_END_REASONS.includes(ended.reason)
  ) {
    return "ended";
  }
  return "new";
}

/**
 * What the PushKit handler does with a VoIP push. It always reports the call to CallKit first: iOS terminates an
 * app that returns from the handler without reporting, and stops delivering VoIP pushes after repeated misses.
 * - `new`: ring, and track the call.
 * - `active` (still ringing or answered): CallKit answers `callUUIDAlreadyExists`, which is success; keep the call.
 * - `ended` (see `knownCall`: declined or answered, within `ENDED_CALL_MEMORY_MS`): report, then end it at once, so
 *   a late repeat does not ring again for a page the responder already handled.
 * Android has no report rule: there `new` rings, `active` is ignored and `ended` shows nothing (`Calls.ring`).
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
