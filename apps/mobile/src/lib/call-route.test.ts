import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import {
  ANSWERED_CALL_MAX_MS,
  CALL_CHANNEL,
  decideRoute,
  PAGE_CHANNEL,
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
    const kotlin = native("android/src/main/java/app/freecorps/brigade/call/CallRoute.kt");
    const body = kotlin.slice(kotlin.indexOf("fun decideRoute"));
    const branches = [...body.matchAll(/^\s*(.+?) -> (CallRoute\.\w+(?:\(\w+\))?)$/gm)].map(
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

describe("voipPushPlan (iOS)", () => {
  test("every VoIP push is reported to CallKit, whatever the app knows about its call id", () => {
    expect(voipPushPlan("new")).toEqual({ report: true, next: "ring" });
    // A repeat of the page while it rings or is answered: CallKit's callUUIDAlreadyExists, kept as it is.
    expect(voipPushPlan("active")).toEqual({ report: true, next: "keep" });
    // A late repeat after the call ended: reported, then ended at once.
    expect(voipPushPlan("ended")).toEqual({ report: true, next: "end" });
  });

  test("CallCenter.swift handles every case and never returns from the handler without reporting", () => {
    const swift = native("ios/CallCenter.swift");
    expect(swift).toMatch(/case \.new: report\(call, completion: completion\)/);
    expect(swift).toMatch(/case \.active: reportRepeat\(call, completion: completion\)/);
    expect(swift).toMatch(/case \.ended: reportEnded\(call, completion: completion\)/);
    // The bug this guards against: an early `return completion()` that skipped reportNewIncomingCall.
    expect(swift).not.toMatch(/return completion\(\)/);
    expect(swift).toMatch(
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
