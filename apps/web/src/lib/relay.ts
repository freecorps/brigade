// Which relay pages go through and how it is doing, for the settings' "Phones and pages" and the account's "Use the
// app" (RFC 0015 section 8). Pure functions over `GET /health/paging` (src/lib/paging-health.ts): the relay comes from
// its `relay`, the state from the watchdog's reasons (apps/api src/watchdog.ts, RFC 0007).
import type { DegradedReason, PagingHealth, RelaySetup } from "@/lib/paging-health";

/** The command that sets up, fixes or switches the relay (apps/relay scripts/setup-relay, RFC 0015 section 8). */
export const SETUP_RELAY = "vp run setup:relay";

export type RelayState =
  | "working"
  | "not_checked"
  | "unregistered"
  | "bad_signature"
  | "revoked"
  | "unauthorized"
  | "unreachable"
  | "handles_unavailable"
  | "providers"
  | "rate_limited"
  | "pipeline"
  | "no_answer";

/** How a state reads at a glance: green, grey, amber or red. */
export type RelayTone = "ok" | "neutral" | "warning" | "error";

export const STATE_TONE: Record<RelayState, RelayTone> = {
  working: "ok",
  not_checked: "neutral",
  unregistered: "error",
  bad_signature: "error",
  revoked: "error",
  unauthorized: "error",
  unreachable: "error",
  handles_unavailable: "error",
  providers: "error",
  rate_limited: "warning",
  pipeline: "warning",
  no_answer: "warning",
};

/**
 * The relay's reasons, most telling first: one headline per card, so a refusal (which no retry fixes) wins over a
 * relay that does not answer, and both over limits that pass by themselves. The pipeline's own reasons come last: with
 * beats stuck before the relay, what the relay said last is stale.
 */
const BY_REASON: [DegradedReason[], RelayState][] = [
  [["relay_bad_signature"], "bad_signature"],
  [["relay_instance_revoked"], "revoked"],
  [["relay_unauthorized"], "unauthorized"],
  [["relay_instance_unregistered"], "unregistered"],
  [["relay_unreachable"], "unreachable"],
  [["relay_handles_unavailable"], "handles_unavailable"],
  [["apns_failing", "fcm_failing"], "providers"],
  [["relay_rate_limited"], "rate_limited"],
  [["no_beat", "pipeline_stalled", "pipeline_slow", "d1_failing"], "pipeline"],
];

/**
 * The relay's state from the self-check: `undefined` while the first answer is on its way. `relay_not_configured`
 * maps to nothing here: it is the `none` relay, which has no state to show.
 */
export function relayState(
  health: PagingHealth | "unreachable" | undefined,
): RelayState | undefined {
  if (health === undefined) return undefined;
  if (health === "unreachable") return "no_answer";
  if (health.status === "ok") return "working";
  if (health.status === "unknown") return "not_checked";
  for (const [reasons, state] of BY_REASON) {
    if (reasons.some((reason) => health.reasons.includes(reason))) return state;
  }
  // Degraded with no reason given (an answer without the session's details) or only `relay_not_configured`.
  return "no_answer";
}

/** What a hint says differs between Freecorps' relay and an own one where the fix is the operator's. */
export type HintKey =
  | "hint_working"
  | "hint_not_checked"
  | "hint_unregistered_freecorps"
  | "hint_unregistered_own"
  | "hint_bad_signature"
  | "hint_revoked_freecorps"
  | "hint_revoked_own"
  | "hint_unauthorized"
  | "hint_unreachable_freecorps"
  | "hint_unreachable_own"
  | "hint_rate_limited"
  | "hint_handles_freecorps"
  | "hint_handles_own"
  | "hint_providers_freecorps"
  | "hint_providers_own"
  | "hint_pipeline"
  | "hint_no_answer";

export type LabelKey =
  | "state_working"
  | "state_not_checked"
  | "state_unregistered"
  | "state_refused"
  | "state_unreachable"
  | "state_rate_limited"
  | "state_handles_unavailable"
  | "state_providers"
  | "state_pipeline"
  | "state_no_answer";

/** One state as shown: its label, its hint and, when there is one, the command that fixes it. */
export type StateView = {
  state: RelayState;
  tone: RelayTone;
  label: LabelKey;
  hint: HintKey;
  command: string | null;
};

export function stateView(state: RelayState, kind: "freecorps" | "own"): StateView {
  const own = kind === "own";
  const view = (label: LabelKey, hint: HintKey, command: string | null = null): StateView => ({
    state,
    tone: STATE_TONE[state],
    label,
    hint,
    command,
  });
  switch (state) {
    case "working":
      return view("state_working", "hint_working");
    case "not_checked":
      return view("state_not_checked", "hint_not_checked");
    case "unregistered":
      return view(
        "state_unregistered",
        own ? "hint_unregistered_own" : "hint_unregistered_freecorps",
        SETUP_RELAY,
      );
    case "bad_signature":
      return view(
        "state_refused",
        "hint_bad_signature",
        `${SETUP_RELAY} --instance-key-file <file>`,
      );
    case "revoked":
      // Freecorps revoked it on purpose: registering again before asking why only gets it revoked again.
      return own
        ? view("state_refused", "hint_revoked_own", SETUP_RELAY)
        : view("state_refused", "hint_revoked_freecorps");
    case "unauthorized":
      return view("state_refused", "hint_unauthorized", SETUP_RELAY);
    case "unreachable":
      return view("state_unreachable", own ? "hint_unreachable_own" : "hint_unreachable_freecorps");
    case "handles_unavailable":
      return own
        ? view("state_handles_unavailable", "hint_handles_own", SETUP_RELAY)
        : view("state_handles_unavailable", "hint_handles_freecorps");
    case "providers":
      return own
        ? view("state_providers", "hint_providers_own", `${SETUP_RELAY} --replace-credentials`)
        : view("state_providers", "hint_providers_freecorps");
    case "rate_limited":
      return view("state_rate_limited", "hint_rate_limited");
    case "pipeline":
      return view("state_pipeline", "hint_pipeline");
    case "no_answer":
      return view("state_no_answer", "hint_no_answer");
  }
}

/**
 * Which app the "Use the app" card points to: the store app (Freecorps' relay), the company's own build with its
 * link (own relay), the store app with nothing about pages (no relay), or `unknown` when the API could not say.
 */
export type AppAdvice =
  | { kind: "checking" }
  | { kind: "store" }
  | { kind: "store_no_push" }
  | { kind: "own"; app: string | null }
  | { kind: "unknown" };

export function appAdvice(health: PagingHealth | "unreachable" | undefined): AppAdvice {
  if (health === undefined) return { kind: "checking" };
  const relay: RelaySetup | null = health === "unreachable" ? null : health.relay;
  if (relay === null) return { kind: "unknown" };
  if (relay.kind === "none") return { kind: "store_no_push" };
  if (relay.kind === "own") return { kind: "own", app: relay.app };
  return { kind: "store" };
}
