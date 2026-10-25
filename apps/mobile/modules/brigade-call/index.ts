import { requireOptionalNativeModule, type EventSubscription } from "expo";

/** A page ringing as a call: decrypted content, and the incident the ack names. */
export type IncomingCall = {
  id: string;
  title: string;
  body: string;
  incident?: string | null;
  /** iOS: 1 was pressed on CallKit's keypad, maybe before JavaScript was listening. */
  ackKeyPressed?: boolean;
};

/** How a page reaches this phone now (Android decides per call; iOS always rings through CallKit). */
export type RingStatus = {
  route: "ring" | "notify" | "blocked";
  notificationsEnabled?: boolean;
  fullScreenAllowed?: boolean;
  telecomPermitted?: boolean;
  callChannelEnabled?: boolean;
  pageChannelEnabled?: boolean;
};

/** Each reason is described, with which ones keep a repeat of the page from ringing, in src/lib/call-route.ts. */
export type CallEndReason = "declined" | "hung_up" | "timed_out" | "missed" | "failed";

type Events = {
  onAnswer(call: IncomingCall): void;
  onEnd(event: { id: string; reason: CallEndReason }): void;
  /** iOS: 1 pressed on CallKit's keypad. */
  onAcknowledgeKey(event: { id: string }): void;
  onSpoken(): void;
};

interface BrigadeCallModule {
  getRingStatus(): RingStatus;
  getAnsweredCall(): IncomingCall | null;
  /** Development: rings a test call after `delayMs` through the path a push takes. Returns its id. */
  simulateIncomingCall(
    title: string,
    body: string,
    incident: string | null,
    delayMs: number,
  ): string;
  endCall(id: string): void;
  /** Platform text-to-speech in the call's audio (`language` is a BCP 47 tag). */
  speak(text: string, language: string): void;
  stopSpeaking(): void;
  openFullScreenIntentSettings(): void;
  getVoipToken(): Promise<string | null>;
  addListener<E extends keyof Events>(event: E, listener: Events[E]): EventSubscription;
}

/** Spike S6 (RFC 0010): null on web, and in builds without the module. */
export const BrigadeCall = requireOptionalNativeModule<BrigadeCallModule>("BrigadeCall");
