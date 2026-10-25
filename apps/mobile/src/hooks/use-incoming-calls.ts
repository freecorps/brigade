import { useRouter } from "expo-router";
import { useEffect } from "react";
import { BrigadeCall } from "../../modules/brigade-call";
import { callSession } from "@/lib/call";

/**
 * Mounted once at the root: an answered call opens the call screen, 1 on CallKit's keypad acknowledges even when
 * the screen is not in front (a locked iPhone), and the platform's end of a call reaches the session.
 */
export function useIncomingCalls(): void {
  const router = useRouter();
  useEffect(() => {
    const module = BrigadeCall;
    if (!module) return;
    const open = () => router.navigate("/call");
    // Answered before React started (a cold start from the ringing screen).
    const answered = module.getAnsweredCall();
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (answered) {
      callSession.answered(answered);
      // After the stack has mounted: expo-router refuses to navigate before the root layout has.
      timer = setTimeout(open, 0);
    }
    const subscriptions = [
      module.addListener("onAnswer", (call) => {
        callSession.answered(call);
        open();
      }),
      module.addListener("onAcknowledgeKey", ({ id }) => void callSession.acknowledge(id)),
      module.addListener("onEnd", ({ id }) => callSession.ended(id)),
      module.addListener("onSpoken", () => callSession.spoken()),
    ];
    return () => {
      clearTimeout(timer);
      subscriptions.forEach((subscription) => subscription.remove());
    };
  }, [router]);
}
