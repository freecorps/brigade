import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import {
  ANSWERED_CALL_MAX_MS,
  CALL_CHANNEL,
  type CallEndReason,
  decideRoute,
  ENDED_CALL_MEMORY_MS,
  fallbackChannel,
  knownCall,
  SYSTEM_END_MS,
  unansweredEndReason,
  PAGE_CHANNEL,
  postsPageOnEnd,
  REPEAT_SUPPRESSING_END_REASONS,
  voipPushPlan,
  type RingConditions,
} from "./call-route";

const all: RingConditions = {
  notificationsEnabled: true,
  callChannelEnabled: true,
  pageChannelEnabled: true,
  fullScreenAllowed: true,
  telecomPermitted: true,
};

const native = (path: string) =>
  readFileSync(new URL(`../../modules/brigade-call/${path}`, import.meta.url), "utf8");
const kotlinFile = (name: string) =>
  native(`android/src/main/java/app/freecorps/brigade/call/${name}`);

const combinations = () =>
  Array.from({ length: 32 }, (_, bits): RingConditions => ({
    notificationsEnabled: (bits & 1) !== 0,
    callChannelEnabled: (bits & 2) !== 0,
    pageChannelEnabled: (bits & 4) !== 0,
    fullScreenAllowed: (bits & 8) !== 0,
    telecomPermitted: (bits & 16) !== 0,
  }));

/**
 * The body of a Swift or Kotlin member function, without `//` comments: from its declaration to the first closing
 * brace at `indent`.
 */
const body = (source: string, declaration: string, indent = "  ") => {
  const start = source.indexOf(declaration);
  expect(start, declaration).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf(`\n${indent}}\n`, start)).replaceAll(/\/\/.*$/gm, "");
};

describe("decideRoute (Android)", () => {
  test("rings when everything is allowed", () => {
    expect(decideRoute(all)).toEqual({ kind: "ring" });
  });

  test("falls back to a page notification without a full-screen intent, Telecom or the call channel", () => {
    for (const missing of [
      "fullScreenAllowed",
      "telecomPermitted",
      "callChannelEnabled",
    ] as const) {
      expect(decideRoute({ ...all, [missing]: false }), missing).toEqual({
        kind: "notify",
        channel: PAGE_CHANNEL,
      });
    }
  });

  test("a muted page channel uses the call channel for the notification", () => {
    expect(decideRoute({ ...all, pageChannelEnabled: false, fullScreenAllowed: false })).toEqual({
      kind: "notify",
      channel: CALL_CHANNEL,
    });
  });

  test("blocked only when nothing can be shown", () => {
    expect(decideRoute({ ...all, notificationsEnabled: false })).toEqual({ kind: "blocked" });
    expect(decideRoute({ ...all, callChannelEnabled: false, pageChannelEnabled: false })).toEqual({
      kind: "blocked",
    });
  });

  test("every combination that can show something does, and rings only with all three", () => {
    for (let bits = 0; bits < 32; bits++) {
      const c: RingConditions = {
        notificationsEnabled: (bits & 1) !== 0,
        callChannelEnabled: (bits & 2) !== 0,
        pageChannelEnabled: (bits & 4) !== 0,
        fullScreenAllowed: (bits & 8) !== 0,
        telecomPermitted: (bits & 16) !== 0,
      };
      const route = decideRoute(c);
      const canShow = c.notificationsEnabled && (c.callChannelEnabled || c.pageChannelEnabled);
      expect(route.kind !== "blocked", JSON.stringify(c)).toBe(canShow);
      const canRing =
        c.notificationsEnabled && c.callChannelEnabled && c.fullScreenAllowed && c.telecomPermitted;
      expect(route.kind === "ring", JSON.stringify(c)).toBe(canRing);
    }
  });

  test("CallRoute.kt mirrors it branch for branch", () => {
    const kotlin = kotlinFile("CallRoute.kt");
    const decide = kotlin.slice(
      kotlin.indexOf("fun decideRoute"),
      kotlin.indexOf("fun fallbackChannel"),
    );
    const branches = [...decide.matchAll(/^\s*(.+?) -> (CallRoute\.\w+(?:\(\w+\))?)$/gm)].map(
      ([, when, route]) => `${when} -> ${route}`,
    );
    expect(branches).toEqual([
      "!c.notificationsEnabled -> CallRoute.Blocked",
      "c.callChannelEnabled && c.fullScreenAllowed && c.telecomPermitted -> CallRoute.Ring",
      "c.pageChannelEnabled -> CallRoute.Notify(PAGE_CHANNEL)",
      "c.callChannelEnabled -> CallRoute.Notify(CALL_CHANNEL)",
      "else -> CallRoute.Blocked",
    ]);
    expect(kotlin).toContain(`const val CALL_CHANNEL = "${CALL_CHANNEL}"`);
    expect(kotlin).toContain(`const val PAGE_CHANNEL = "${PAGE_CHANNEL}"`);
  });
});

describe("fallbackChannel (Android)", () => {
  test("the page channel unless it is muted", () => {
    expect(fallbackChannel({ pageChannelEnabled: true })).toBe(PAGE_CHANNEL);
    expect(fallbackChannel({ pageChannelEnabled: false })).toBe(CALL_CHANNEL);
  });

  test("whenever a call would ring, it picks the channel decideRoute would notify on without ringing", () => {
    for (const c of combinations().filter((c) => decideRoute(c).kind === "ring")) {
      expect(decideRoute({ ...c, fullScreenAllowed: false }), JSON.stringify(c)).toEqual({
        kind: "notify",
        channel: fallbackChannel(c),
      });
    }
  });

  test("CallRoute.kt mirrors it, and every fallback in Calls.kt goes through it", () => {
    expect(kotlinFile("CallRoute.kt")).toContain(
      "fun fallbackChannel(c: RingConditions): String = if (c.pageChannelEnabled) PAGE_CHANNEL else CALL_CHANNEL",
    );
    const calls = kotlinFile("Calls.kt");
    // Telecom throws, Telecom creates no connection, the ringing notification is refused.
    expect(calls.match(/notifyFallback\((?:app|context), (?:call|state\.call)\)/g)).toHaveLength(3);
    expect(calls).toContain("val channel = fallbackChannel(conditions(context))");
    // The bug this guards against: a fallback hard-wired to a channel the user may have muted.
    expect(calls).not.toMatch(/notifyPage\([^)]*PAGE_CHANNEL\)/);
  });
});

describe("knownCall: a repeat of an ended page", () => {
  const at = 1_000_000;
  const allReasons: CallEndReason[] = ["declined", "hung_up", "timed_out", "missed", "failed"];

  test("declined, hung up (acknowledged included) and timed out after answering do not ring again", () => {
    for (const reason of ["declined", "hung_up", "timed_out"] as const) {
      expect(knownCall(false, { reason, atMs: at }, at + 1), reason).toBe("ended");
      expect(knownCall(false, { reason, atMs: at }, at + ENDED_CALL_MEMORY_MS - 1), reason).toBe(
        "ended",
      );
    }
  });

  test("missed and failed ring again: nobody was reached", () => {
    for (const reason of ["missed", "failed"] as const) {
      expect(knownCall(false, { reason, atMs: at }, at + 1), reason).toBe("new");
    }
  });

  test("an end is forgotten after the memory, and an unknown id is new", () => {
    for (const reason of allReasons) {
      expect(knownCall(false, { reason, atMs: at }, at + ENDED_CALL_MEMORY_MS), reason).toBe("new");
    }
    expect(knownCall(false, undefined, at)).toBe("new");
  });

  test("a call still ringing or answered is active, whatever ended before", () => {
    expect(knownCall(true, undefined, at)).toBe("active");
    expect(knownCall(true, { reason: "declined", atMs: at }, at + 1)).toBe("active");
  });

  test("the memory covers the relay's longest call expiry, counted from each send", () => {
    // A push sent just before the call ended can arrive up to the relay's maximum TTL later.
    const relay = readFileSync(new URL("../../../relay/src/send.ts", import.meta.url), "utf8");
    const maxTtl = /const MAX_CALL_TTL_SECONDS = ([\d* ]+);/.exec(relay)?.[1];
    const maxTtlMs =
      (maxTtl ?? "0").split("*").reduce((product, factor) => product * Number(factor.trim()), 1) *
      1000;
    expect(ENDED_CALL_MEMORY_MS).toBe(maxTtlMs);
  });

  test("an unanswered call the system ends at once counts as failed, so its repeat rings", () => {
    expect(unansweredEndReason(60)).toBe("failed");
    expect(unansweredEndReason(SYSTEM_END_MS - 1)).toBe("failed");
    expect(unansweredEndReason(SYSTEM_END_MS)).toBe("declined");
    expect(unansweredEndReason(15_000)).toBe("declined");
    // Ended before CallKit confirmed it: nobody saw it.
    expect(unansweredEndReason(undefined)).toBe("failed");
    expect(knownCall(false, { reason: unansweredEndReason(60), atMs: 0 }, 1_000)).toBe("new");
    const swift = native("ios/CallCenter.swift");
    expect(swift).toContain(`static let systemEnd: TimeInterval = ${SYSTEM_END_MS / 1000}`);
    expect(swift).toMatch(
      /call\.answered\s+\? "hung_up"\s+: call\.ringingSince\.map \{ Date\(\)\.timeIntervalSince\(\$0\) < Self\.systemEnd \} \?\? true \? "failed" : "declined"/,
    );
    expect(swift).toContain("self.calls[call.id]?.ringingSince = Date()");
  });

  test("a call the system ends at once posts the page notification now; any other end does not", () => {
    expect(postsPageOnEnd(unansweredEndReason(60))).toBe(true);
    expect(postsPageOnEnd(unansweredEndReason(SYSTEM_END_MS - 1))).toBe(true);
    for (const reason of ["declined", "hung_up", "timed_out", "missed"] as const) {
      expect(postsPageOnEnd(reason)).toBe(false);
    }
    expect(postsPageOnEnd(unansweredEndReason(undefined))).toBe(true);
    const swift = native("ios/CallCenter.swift");
    expect(swift).toContain(
      'static func postsPageOnEnd(_ reason: String) -> Bool { reason == "failed" }',
    );
    // In the end action, after the reason is decided, on the call it removed.
    expect(swift).toMatch(
      /emit\?\("onEnd", \["id": action\.callUUID[^\n]*\n\s*action\.fulfill\(\)\n(\s*\/\/[^\n]*\n)*\s*if Self\.postsPageOnEnd\(reason\) \{ notifyPage\(call\) \}/,
    );
  });

  test("CallRoute.kt and CallCenter.swift use the same reasons, memory and branches", () => {
    const expected = new Set(REPEAT_SUPPRESSING_END_REASONS);
    const kotlin = kotlinFile("CallRoute.kt");
    const kotlinReasons = /val REPEAT_SUPPRESSING_END_REASONS = setOf\(([^)]*)\)/.exec(kotlin)?.[1];
    expect(new Set([...(kotlinReasons ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]))).toEqual(
      expected,
    );
    const kotlinMs = /const val ENDED_MEMORY_MS = ([\d_]+)L/.exec(kotlin)?.[1]?.replaceAll("_", "");
    expect(Number(kotlinMs)).toBe(ENDED_CALL_MEMORY_MS);
    expect(kotlin).toMatch(
      /active -> KnownCall\.Active\s+ended != null && nowMs - ended\.atMs < ENDED_MEMORY_MS && ended\.reason in REPEAT_SUPPRESSING_END_REASONS ->\s+KnownCall\.Ended\s+else -> KnownCall\.New/,
    );
    const swift = native("ios/CallCenter.swift");
    const swiftReasons = /static let repeatSuppressingReasons: Set<String> = \[([^\]]*)\]/.exec(
      swift,
    )?.[1];
    expect(new Set([...(swiftReasons ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]))).toEqual(
      expected,
    );
    expect(swift).toContain(
      `static let endedMemory: TimeInterval = ${ENDED_CALL_MEMORY_MS / 1000}`,
    );
    expect(swift).toMatch(
      /if active \{ return \.active \}\s+if let ended, now\.timeIntervalSince\(ended\.at\) < endedMemory, repeatSuppressingReasons\.contains\(ended\.reason\) \{\s+return \.ended\s+\}\s+return \.new/,
    );
  });

  test("both platforms remember every end with its reason, and Android consults the rule before ringing", () => {
    const calls = kotlinFile("Calls.kt");
    expect(body(calls, "fun end(")).toContain(
      "ended[id] = EndedCall(reason, SystemClock.elapsedRealtime())",
    );
    expect(body(calls, "fun ring(")).toMatch(
      /when \(knownCall\(calls\.containsKey\(call\.id\), ended\[call\.id\], now\)\)/,
    );
    const swift = native("ios/CallCenter.swift");
    expect(body(swift, "private func finish(")).toContain("rememberEnded(id, reason: event)");
    expect(
      body(swift, "func provider(_ provider: CXProvider, perform action: CXEndCallAction)"),
    ).toContain("rememberEnded(action.callUUID, reason: reason)");
  });
});

describe("iOS timers", () => {
  test("act only on the call instance that scheduled them, as on Android", () => {
    const swift = native("ios/CallCenter.swift");
    expect(swift).toContain("let instance = UUID()");
    expect(swift).toContain("self.timeOut(call.id, instance: call.instance)");
    expect(body(swift, "private func timeOut(")).toContain(
      "guard let call = calls[id], call.instance == instance, !call.answered else { return }",
    );
    expect(
      body(swift, "func provider(_ provider: CXProvider, perform action: CXAnswerCallAction)"),
    ).toContain(
      "guard let self, let call = self.calls[id], call.instance == instance, call.answered else { return }",
    );
    // The bug this guards against: a timer that looked the call up by id alone.
    expect(swift).not.toMatch(/self\.calls\[id\]\?\.answered == true/);
  });
});

describe("Android timers", () => {
  test("act only on the call instance that scheduled them, and end() cancels them", () => {
    const calls = kotlinFile("Calls.kt");
    // The ring timeout and the answered maximum each take the call's State as the token and check identity.
    expect(calls).toContain(
      "HandlerCompat.postDelayed(main, { timeOut(app, state) }, state, RING_TIMEOUT_MS)",
    );
    expect(body(calls, "private fun timeOut(")).toContain(
      "timerApplies(state, calls[state.call.id])",
    );
    expect(body(calls, "fun answer(")).toMatch(
      /\{ if \(timerApplies\(state, calls\[id\]\)\) end\(context, id, "timed_out"\) \},\s+state,\s+ANSWERED_MAX_MS/,
    );
    expect(body(calls, "fun end(")).toContain("main.removeCallbacksAndMessages(state)");
    // The bug this guards against: a timer that looked the call up by id alone.
    expect(calls).not.toMatch(/calls\[id\]\?\.answered/);
    expect(kotlinFile("CallRoute.kt")).toContain(
      "fun <T : Any> timerApplies(scheduledFor: T, current: T?): Boolean = current === scheduledFor",
    );
  });
});

describe("voipPushPlan (iOS)", () => {
  test("every VoIP push is reported to CallKit, whatever the app knows about its call id", () => {
    expect(voipPushPlan("new")).toEqual({ report: true, next: "ring" });
    // A repeat of the page while it rings or is answered: CallKit's callUUIDAlreadyExists, kept as it is.
    expect(voipPushPlan("active")).toEqual({ report: true, next: "keep" });
    // A late repeat after the call ended: reported, then ended at once.
    expect(voipPushPlan("ended")).toEqual({ report: true, next: "end" });
  });

  test("CallCenter.swift reports every push before returning, and completes only from CallKit's callback", () => {
    // A check of the source, not of behaviour (no Swift tests in CI): it pins the structure that keeps iOS
    // from terminating the app.
    const swift = native("ios/CallCenter.swift");
    const handler = body(swift, "didReceiveIncomingPushWith payload");
    expect(handler).not.toMatch(/\breturn\b/);
    expect(handler).toMatch(
      /receive\(id, envelope: payload\["brigade"\], completion: completion\)/,
    );
    const receive = body(swift, "private func receive(");
    // `kind` is kept so a push sealed as less than a page ends only its own new call (RFC 0015 section 4).
    expect(receive).toContain("let kind = known(id)");
    const dispatch = receive.indexOf("switch kind {");
    expect(dispatch).toBeGreaterThan(0);
    expect(receive.slice(0, dispatch)).not.toMatch(/\breturn\b/);
    expect(receive).toMatch(/case \.new: report\(call, completion: completion\)/);
    expect(receive).toMatch(/case \.active: reportRepeat\(call, completion: completion\)/);
    expect(receive).toMatch(/case \.ended: reportEnded\(call, completion: completion\)/);
    for (const name of [
      "func report(",
      "private func reportRepeat(",
      "private func reportEnded(",
    ]) {
      const fn = body(swift, name);
      const reported = fn.indexOf("provider.reportNewIncomingCall(");
      expect(reported, name).toBeGreaterThan(0);
      // Nothing returns before the call is reported.
      expect(fn.slice(0, reported), name).not.toMatch(/\breturn\b/);
      // The handler completes once, from the defer inside CallKit's callback, after the report.
      expect(fn.match(/completion\(\)/g), name).toHaveLength(1);
      const completed = fn.indexOf("defer { completion() }");
      expect(completed, name).toBeGreaterThan(reported);
    }
    expect(body(swift, "private func reportEnded(")).toMatch(
      /reportCall\(with: call\.id, endedAt: nil, reason: \.answeredElsewhere\)/,
    );
  });
});

describe("ANSWERED_CALL_MAX_MS", () => {
  test("is about three minutes, and both platforms use the same value", () => {
    expect(ANSWERED_CALL_MAX_MS).toBe(180_000);
    const kotlin = native("android/src/main/java/app/freecorps/brigade/call/Calls.kt");
    const kotlinMs = /const val ANSWERED_MAX_MS = ([\d_]+)L/.exec(kotlin)?.[1]?.replaceAll("_", "");
    expect(Number(kotlinMs)).toBe(ANSWERED_CALL_MAX_MS);
    const swift = native("ios/CallCenter.swift");
    const swiftSeconds = /static let answeredMaxLength: TimeInterval = (\d+)/.exec(swift)?.[1];
    expect(Number(swiftSeconds) * 1000).toBe(ANSWERED_CALL_MAX_MS);
  });
});
