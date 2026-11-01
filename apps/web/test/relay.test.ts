// Which relay pages go through and its state (RFC 0015 section 8): the API's `relay` read, the watchdog's reasons
// mapped to one state each with its hint and fix, and which app the "Use the app" card points to.
import { describe, expect, test } from "vite-plus/test";
import {
  DEGRADED_REASONS,
  parseRelay,
  UNREACHABLE,
  type DegradedReason,
  type PagingHealth,
} from "../src/lib/paging-health";
import { appAdvice, relayState, SETUP_RELAY, stateView, type RelayState } from "../src/lib/relay";

const health = (
  status: PagingHealth["status"],
  reasons: DegradedReason[] = [],
  relay: PagingHealth["relay"] = { kind: "freecorps" },
): PagingHealth => ({ status, reasons, lastOkAt: null, relay });

describe("parseRelay", () => {
  test("reads the three kinds", () => {
    expect(parseRelay({ kind: "none" })).toEqual({ kind: "none" });
    expect(parseRelay({ kind: "freecorps" })).toEqual({ kind: "freecorps" });
    expect(
      parseRelay({ kind: "own", host: "relay.acme.example", app: "https://apps.example.com/x" }),
    ).toEqual({ kind: "own", host: "relay.acme.example", app: "https://apps.example.com/x" });
  });

  test("a link is https or nothing, and only an own relay has a host or a link", () => {
    for (const app of ["javascript:alert(1)", "http://apps.example.com", "not a url", 7]) {
      expect(parseRelay({ kind: "own", host: null, app }), String(app)).toEqual({
        kind: "own",
        host: null,
        app: null,
      });
    }
    expect(
      parseRelay({ kind: "freecorps", host: "relay.example.com", app: "https://apps.example.com" }),
    ).toEqual({ kind: "freecorps" });
  });

  test("anything else is not said, never shown as a relay", () => {
    for (const body of [undefined, null, "own", {}, { kind: "mine" }]) {
      expect(parseRelay(body), JSON.stringify(body)).toBeNull();
    }
  });
});

describe("relayState", () => {
  test("loading, no answer, working and not checked yet", () => {
    expect(relayState(undefined)).toBeUndefined();
    expect(relayState(UNREACHABLE)).toBe("no_answer");
    expect(relayState(health("ok"))).toBe("working");
    expect(relayState(health("unknown"))).toBe("not_checked");
  });

  test("each relay reason has its state", () => {
    const expected: [DegradedReason, RelayState][] = [
      ["relay_bad_signature", "bad_signature"],
      ["relay_instance_revoked", "revoked"],
      ["relay_unauthorized", "unauthorized"],
      ["relay_instance_unregistered", "unregistered"],
      ["relay_unreachable", "unreachable"],
      ["relay_handles_unavailable", "handles_unavailable"],
      ["apns_failing", "providers"],
      ["fcm_failing", "providers"],
      ["relay_rate_limited", "rate_limited"],
      ["no_beat", "pipeline"],
      ["pipeline_stalled", "pipeline"],
      ["pipeline_slow", "pipeline"],
      ["d1_failing", "database"],
    ];
    for (const [reason, state] of expected) {
      expect(relayState(health("degraded", [reason])), reason).toBe(state);
    }
    // Every reason the dashboard knows is mapped, but the one that means "no relay" (shown as such, not as a state).
    const mapped = new Set(expected.map(([reason]) => reason));
    expect(DEGRADED_REASONS.filter((reason) => !mapped.has(reason))).toEqual([
      "relay_not_configured",
    ]);
  });

  test("a refusal wins over limits and a slow pipeline; degraded with no reason given is an answer without details", () => {
    expect(
      relayState(
        health("degraded", ["relay_rate_limited", "pipeline_slow", "relay_bad_signature"]),
      ),
    ).toBe("bad_signature");
    expect(relayState(health("degraded", ["relay_rate_limited", "pipeline_slow"]))).toBe(
      "rate_limited",
    );
    expect(relayState(health("degraded", ["relay_unreachable", "fcm_failing"]))).toBe(
      "unreachable",
    );
    // Beats that stopped win: the relay's reasons are from its last proof, never cleared, so stale by then.
    expect(relayState(health("degraded", ["no_beat", "relay_bad_signature"]))).toBe("pipeline");
    expect(relayState(health("degraded", ["pipeline_stalled", "relay_instance_revoked"]))).toBe(
      "pipeline",
    );
    // A slow pipeline still proves beats, so the relay's reasons are current and win.
    expect(relayState(health("degraded", ["pipeline_slow", "relay_bad_signature"]))).toBe(
      "bad_signature",
    );
    // The database alone: the relay answered.
    expect(relayState(health("degraded", ["d1_failing"]))).toBe("database");
    // Brigade answered (without the session's details): not "didn't answer".
    expect(relayState(health("degraded", [], null))).toBe("no_details");
    expect(relayState(health("degraded", ["relay_not_configured"]))).toBe("no_details");
  });
});

describe("stateView", () => {
  test("hints say what to do, and differ where the fix is the operator's own relay", () => {
    expect(stateView("working", "freecorps")).toMatchObject({
      tone: "ok",
      label: "state_working",
      command: null,
    });
    expect(stateView("unregistered", "freecorps")).toMatchObject({
      tone: "error",
      label: "state_unregistered",
      hint: "hint_unregistered_freecorps",
      command: SETUP_RELAY,
    });
    expect(stateView("unregistered", "own").hint).toBe("hint_unregistered_own");
    // No command for a bad signature: setting a key up again removes RELAY_INSTANCE_ID (a rotated instance would sign
    // as another id and every handle would be refused); the fix is the secrets, which the hint names.
    for (const kind of ["own", "freecorps", null] as const) {
      expect(stateView("bad_signature", kind), String(kind)).toMatchObject({
        label: "state_refused",
        hint: "hint_bad_signature",
        command: null,
      });
    }
    expect(stateView("database", "own")).toMatchObject({
      tone: "error",
      label: "state_database",
      hint: "hint_database",
      command: null,
    });
    // Freecorps revoked it on purpose: ask, don't register again.
    expect(stateView("revoked", "freecorps")).toMatchObject({
      label: "state_refused",
      hint: "hint_revoked_freecorps",
      command: null,
    });
    expect(stateView("revoked", "own").command).toBe(SETUP_RELAY);
    expect(stateView("unreachable", "own")).toMatchObject({
      label: "state_unreachable",
      hint: "hint_unreachable_own",
    });
    // A refused send token: only the own-relay flow sets one (on both Workers), so only there is the script the fix.
    expect(stateView("unauthorized", "own")).toMatchObject({
      label: "state_refused",
      hint: "hint_unauthorized_own",
      command: SETUP_RELAY,
    });
    expect(stateView("unauthorized", "freecorps")).toMatchObject({
      label: "state_refused",
      hint: "hint_unauthorized_freecorps",
      command: null,
    });
    expect(stateView("no_details", "freecorps")).toMatchObject({
      label: "state_no_answer",
      hint: "hint_no_details",
      command: null,
    });
    expect(stateView("providers", "own").command).toBe(`${SETUP_RELAY} --replace-credentials`);
    expect(stateView("providers", "freecorps").command).toBeNull();
    expect(stateView("handles_unavailable", "freecorps").command).toBeNull();
    expect(stateView("rate_limited", "own")).toMatchObject({ tone: "warning", command: null });
    expect(stateView("not_checked", "own").tone).toBe("neutral");
  });

  test("with the relay unknown, a hint that depends on whose relay it is says so instead of guessing", () => {
    for (const state of [
      "unregistered",
      "revoked",
      "unauthorized",
      "unreachable",
      "handles_unavailable",
      "providers",
    ] as const) {
      const view = stateView(state, null);
      expect(view.hint, state).toBe("hint_unknown_relay");
      expect(view.command, state).toBeNull();
      expect(view.label, state).toBe(stateView(state, "own").label);
    }
    // States whose hint is the same whoever runs the relay keep it.
    expect(stateView("rate_limited", null).hint).toBe("hint_rate_limited");
    expect(stateView("pipeline", null).hint).toBe("hint_pipeline");
  });
});

describe("appAdvice", () => {
  test("the store app, the company's own build, or nothing about pages", () => {
    expect(appAdvice(undefined)).toEqual({ kind: "checking" });
    expect(appAdvice(UNREACHABLE)).toEqual({ kind: "unknown" });
    // The watchdog down: the relay still comes with the 503, and the advice does not depend on the watchdog.
    expect(
      appAdvice({
        status: "unreachable",
        relay: { kind: "own", host: null, app: "https://a.example/x" },
      }),
    ).toEqual({ kind: "own", app: "https://a.example/x" });
    expect(appAdvice({ status: "unreachable", relay: { kind: "freecorps" } })).toEqual({
      kind: "store",
    });
    expect(appAdvice(health("ok", [], null))).toEqual({ kind: "unknown" });
    expect(appAdvice(health("ok"))).toEqual({ kind: "store" });
    expect(appAdvice(health("degraded", [], { kind: "none" }))).toEqual({ kind: "store_no_push" });
    expect(
      appAdvice(health("ok", [], { kind: "own", host: null, app: "https://apps.example.com/x" })),
    ).toEqual({ kind: "own", app: "https://apps.example.com/x" });
    // The relay's state does not change which app to install.
    expect(appAdvice(health("degraded", ["relay_unreachable"]))).toEqual({ kind: "store" });
  });
});
