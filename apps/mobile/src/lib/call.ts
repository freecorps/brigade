// The app's one call session, wired to the native module (modules/brigade-call) and the sync client.
import { getLocale } from "@freecorps/brigade-i18n";
import { BrigadeCall } from "../../modules/brigade-call";
import { CallSession } from "@/lib/call-session";
import { SHARD } from "@/lib/sync";
import { syncClient } from "@/lib/sync-client";

export const callSession = new CallSession(
  {
    // A named mutation through Brigade Sync, like every write (RFC 0004). The socket is live while the call is
    // in the foreground; notification actions will use plain HTTPS (RFC 0004, "Clients").
    ack: (incident) => syncClient.mutate(SHARD, "incident.ack", { id: incident }),
    speak: (text, language) => BrigadeCall?.speak(text, language),
    endCall: (id) => BrigadeCall?.endCall(id),
  },
  getLocale,
);
