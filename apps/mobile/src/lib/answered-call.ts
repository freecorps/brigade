// An answered call waiting for its screen. The call screen is a signed-in screen (the root layout's guard), and a
// cold start from the ringing screen answers before the session is read: opening `/call` then would be sent to
// sign-in by the guard and lost. So the answered call waits here, outside React (the session remounts the app's
// screens), and opens once a member is ready. CallKit (or Android's call screen) has the call meanwhile, and 1 on its
// keypad still acknowledges (src/hooks/use-incoming-calls.ts).
import type { CallState } from "@/lib/call-session";

/** The session as the root layout sees it (src/components/session.tsx `SessionView["kind"]`). */
export type SessionKind =
  | "loading"
  | "signed-out"
  | "no-server"
  | "unavailable"
  | "no-workspace"
  | "ready";

/**
 * What to do with the waiting call `id` now: `open` its screen (a member is ready and the call is the one answered),
 * `wait` (the session is still being read, or could not be read and may come back), or `drop` it: the call ended or
 * another replaced it, or nobody will be signed in to show it to (signed out, no server, no workspace). Dropped, the
 * call goes on in the system's call screen.
 */
export function answeredCallStep(
  id: string,
  session: SessionKind,
  call: CallState,
): "open" | "wait" | "drop" {
  if (!call || call.call.id !== id || call.ended) return "drop";
  if (session === "ready") return "open";
  if (session === "loading" || session === "unavailable") return "wait";
  return "drop";
}

/** The id of the answered call waiting for its screen, with listeners for React (`useSyncExternalStore`). */
export function pendingCallStore() {
  let id: string | null = null;
  const listeners = new Set<() => void>();
  const set = (next: string | null) => {
    if (next === id) return;
    id = next;
    for (const listener of listeners) listener();
  };
  return {
    current: (): string | null => id,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Call `callId` was answered: its screen opens once a member is ready. */
    answered: (callId: string) => set(callId),
    /** Takes call `callId` to open or drop it; false when it is no longer the one waiting (already taken). */
    take: (callId: string): boolean => {
      if (id !== callId) return false;
      set(null);
      return true;
    },
  };
}

export const pendingCall = pendingCallStore();
