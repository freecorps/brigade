import { useRouter } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { BrigadeCall } from "../../modules/brigade-call";
import { useSessionView } from "@/components/session";
import { answeredCallStep, pendingCall } from "@/lib/answered-call";
import { callSession } from "@/lib/call";

/**
 * Mounted once at the root: an answered call waits to open the call screen (useAnsweredCallScreen), 1 on CallKit's
 * keypad acknowledges even when the screen is not in front (a locked iPhone), so does 1 on a hardware keyboard on
 * Android while the app is in front, and the platform's end of a call reaches the session.
 */
export function useIncomingCalls(): void {
  useEffect(() => {
    const module = BrigadeCall;
    if (!module) return;
    // Answered before React started (a cold start from the ringing screen), with 1 already pressed on iOS.
    const answered = module.getAnsweredCall();
    if (answered) {
      callSession.answered(answered);
      pendingCall.answered(answered.id);
    }
    const subscriptions = [
      module.addListener("onAnswer", (call) => {
        callSession.answered(call);
        pendingCall.answered(call.id);
      }),
      module.addListener("onAcknowledgeKey", ({ id }) => void callSession.acknowledge(id)),
      module.addListener("onKey", ({ id, keyCode }) => callSession.keyPressed(id, keyCode)),
      module.addListener("onEnd", ({ id }) => callSession.ended(id)),
      module.addListener("onSpoken", () => callSession.spoken()),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);
}

/**
 * Mounted under the session: the answered call's screen opens once a member is ready, which on a cold start is after
 * the session was read; it is dropped (the call goes on in the system's call screen) when the call ends first or
 * nobody is signed in (src/lib/answered-call.ts).
 */
export function useAnsweredCallScreen(): void {
  const router = useRouter();
  const session = useSessionView().kind;
  const waiting = useSyncExternalStore(pendingCall.subscribe, pendingCall.current);
  const call = useSyncExternalStore(callSession.subscribe, callSession.getState);
  useEffect(() => {
    if (waiting === null) return;
    const step = answeredCallStep(waiting, session, call);
    if (step === "drop") {
      pendingCall.take(waiting);
      return;
    }
    if (step === "wait") return;
    // After this render's guards have moved the stack (sign-in to the tabs): `/call` then opens above them.
    const timer = setTimeout(() => {
      if (pendingCall.take(waiting)) router.navigate("/call");
    }, 0);
    return () => clearTimeout(timer);
  }, [waiting, session, call, router]);
}
