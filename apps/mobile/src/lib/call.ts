// The app's one call session, wired to the native module (modules/brigade-call) and the signed-in member's sync
// client.
import { getLocale } from "@freecorps/brigade-i18n";
import { BrigadeCall } from "../../modules/brigade-call";
import { CallSession } from "@/lib/call-session";
import { currentSync } from "@/lib/sync-client";

export const callSession = new CallSession(
  {
    // A named mutation through Brigade Sync, like every write (RFC 0004), on the member's workspace. The socket is
    // live while the call is in the foreground; notification actions will use plain HTTPS (RFC 0004, "Clients").
    // Signed out, there is no one to ack as: the call screen says it failed.
    ack: async (incident) => {
      const sync = currentSync();
      if (!sync) return { ok: false, error: { code: "closed", message: "Signed out" } };
      return sync.client.mutate(sync.shard, "incident.ack", { id: incident });
    },
    speak: (text, language) => BrigadeCall?.speak(text, language),
    endCall: (id) => BrigadeCall?.endCall(id),
  },
  getLocale,
);
