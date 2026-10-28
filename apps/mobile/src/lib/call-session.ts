// The answered call, as the call screen and the keypad see it (spike S6, RFC 0010): read the incident aloud,
// take the ack (the screen's button, or 1 on CallKit's keypad) and send it as `incident.ack` through Brigade Sync.
// Pure: the native module and the sync client come in as `CallDeps`, so tests run it in Node.
import { m, type Locale } from "@freecorps/brigade-i18n";
import type { MutationOutcome } from "@freecorps/brigade-sync";
import { mutationErrorReason } from "@freecorps/brigade-i18n/incident";

export type ActiveCall = {
  id: string;
  title: string;
  body: string;
  incident?: string | null;
  /** iOS: 1 was pressed on CallKit's keypad before JavaScript was listening (a cold launch). */
  ackKeyPressed?: boolean;
};

export type AckState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "acknowledged" }
  | { kind: "failed"; reason: string }
  | { kind: "unavailable" };

export type CallState = { call: ActiveCall; ack: AckState; ended: boolean } | null;

export type CallDeps = {
  ack(incident: string): Promise<MutationOutcome>;
  speak(text: string, language: string): void;
  endCall(id: string): void;
};

/** The voice the call reads in: the app's language, as a BCP 47 tag platform TTS knows. */
export function speechLanguage(locale: Locale): string {
  return locale === "pt-BR" ? "pt-BR" : "en-US";
}

/** What the call says on answering: the incident, then how to acknowledge. */
export function callScript(call: Pick<ActiveCall, "title" | "body">, locale: Locale): string {
  const intro = m.call_script(
    { title: trimStop(call.title), body: trimStop(call.body) },
    { locale },
  );
  return `${intro}. ${m.call_script_prompt({}, { locale })}`;
}

const trimStop = (text: string) => text.trim().replace(/[.!?。]+$/u, "");

/**
 * Android's key codes for 1: the number row's (`KEYCODE_1`) and the numeric keypad's (`KEYCODE_NUMPAD_1`). A
 * hardware keyboard's 1 on the call screen acknowledges, as 1 on CallKit's keypad does on iOS.
 */
export const ACK_KEY_CODES: readonly number[] = [8, 145];

/** What the call screen says under the incident: how the ack went and, once over, that the call ended. */
export function callStatus(state: NonNullable<CallState>): string {
  const { ack, ended } = state;
  if (ended) return ack.kind === "acknowledged" ? m.call_ended_acknowledged() : m.call_ended();
  switch (ack.kind) {
    case "sending":
      return m.call_acknowledging();
    case "acknowledged":
      return m.call_acknowledged();
    case "failed":
      return m.call_ack_failed({ reason: ack.reason });
    case "unavailable":
      return m.call_no_incident();
    case "idle":
      return m.call_speaking();
  }
}

export class CallSession {
  #state: CallState = null;
  /** Whether the call screen is the focused screen (`focused`): the only place a hardware key acknowledges. */
  #screenFocused = false;
  readonly #listeners = new Set<() => void>();

  constructor(
    private readonly deps: CallDeps,
    private readonly locale: () => Locale,
  ) {}

  get state(): CallState {
    return this.#state;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getState = (): CallState => this.#state;

  /**
   * The call was answered: show it and read the incident aloud. A repeat for the same call does not read it again.
   * A key pressed before JavaScript was listening (`ackKeyPressed`) is acknowledged now.
   */
  answered(call: ActiveCall): void {
    if (this.#state?.call.id !== call.id) {
      this.#set({
        call,
        ack: call.incident ? { kind: "idle" } : { kind: "unavailable" },
        ended: false,
      });
      const locale = this.locale();
      this.deps.speak(callScript(call, locale), speechLanguage(locale));
    }
    if (call.ackKeyPressed) void this.acknowledge(call.id);
  }

  /**
   * Sends `incident.ack` once. `conflict` means someone already acknowledged: paging stopped, which is all the
   * responder needs to know. Any other failure can be retried.
   */
  async acknowledge(callId?: string): Promise<void> {
    const state = this.#state;
    if (!state || (callId !== undefined && callId !== state.call.id)) return;
    const incident = state.call.incident;
    if (!incident || state.ack.kind === "sending" || state.ack.kind === "acknowledged") return;
    this.#update({ kind: "sending" });
    const outcome = await this.deps.ack(incident);
    if (this.#state?.call.id !== state.call.id) return;
    if (outcome.ok || outcome.error.code === "conflict") {
      this.#update({ kind: "acknowledged" });
      const locale = this.locale();
      this.deps.speak(m.call_script_acked({}, { locale }), speechLanguage(locale));
    } else {
      this.#update({ kind: "failed", reason: mutationErrorReason(outcome.error.code) });
    }
  }

  /** The call screen gained (true) or lost (false) focus: set on focus, cleared on blur. */
  focused(focused: boolean): void {
    this.#screenFocused = focused;
  }

  /**
   * Android: a hardware key released while the call is answered (`keyCode`, Android's `KeyEvent` code). 1
   * acknowledges, as the screen's button does, while the call lasts and only while the call screen is focused: a 1
   * typed anywhere else in the app (an incident note, say) is the member's text, never an acknowledgement. Every
   * other key does nothing.
   */
  keyPressed(callId: string, keyCode: number): void {
    if (!ACK_KEY_CODES.includes(keyCode) || !this.#screenFocused || this.#state?.ended) return;
    void this.acknowledge(callId);
  }

  hangUp(): void {
    if (this.#state && !this.#state.ended) this.deps.endCall(this.#state.call.id);
  }

  /** The platform ended the call (hung up here, from CallKit, or by Telecom). */
  ended(callId: string): void {
    if (this.#state?.call.id !== callId) return;
    this.#set({ ...this.#state, ended: true });
  }

  /** After the acknowledgement was read out, the call has done its job. */
  spoken(): void {
    if (this.#state?.ack.kind === "acknowledged" && !this.#state.ended) this.hangUp();
  }

  #update(ack: AckState): void {
    if (this.#state) this.#set({ ...this.#state, ack });
  }

  #set(state: CallState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}
