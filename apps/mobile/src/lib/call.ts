// The app's one call session, wired to the native module (modules/brigade-call), the signed-in member's sync client
// and, for a call from another instance than the one shown, that instance's session (RFC 0015 section 5).
import { getLocale } from "@freecorps/brigade-i18n";
import { randomUUID } from "expo-crypto";
import { BrigadeCall } from "../../modules/brigade-call";
import { CallSession } from "@/lib/call-session";
import { clientsFor, instances } from "@/lib/instance-clients";
import { activeInstance } from "@/lib/instances";
import { acknowledgeFromNotification, ackMutationOutcome, callAckRoute } from "@/lib/page-action";
import { currentSync } from "@/lib/sync-client";

export const callSession = new CallSession(
  {
    // A named mutation through Brigade Sync, like every write (RFC 0004), on the member's workspace. The socket is
    // live while the call is in the foreground. A call from another instance or workspace goes over HTTPS as the
    // Acknowledge action does, with that instance's session. Signed out, there is no one to ack as: the call screen
    // says it failed.
    ack: async (incident, call) => {
      const list = await instances.load();
      const sync = currentSync();
      const route = callAckRoute(call, list.instances, activeInstance(list), sync?.shard);
      if (route.kind === "none") {
        return { ok: false, error: { code: "forbidden", message: "Not signed in there" } };
      }
      if (route.kind === "http") {
        const clients = clientsFor(route.instance);
        const outcome = await acknowledgeFromNotification(
          { incident, workspace: route.workspace, origin: route.instance.origin },
          {
            url: (workspaceId, incidentId) => clients.server.ack(workspaceId, incidentId),
            origin: route.instance.origin,
            cookie: () => clients.authClient.getCookie(),
            fetch: (url, init) => fetch(url, init),
            key: () => `ack-${randomUUID()}`,
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          },
        );
        return ackMutationOutcome(outcome);
      }
      if (!sync) return { ok: false, error: { code: "closed", message: "Signed out" } };
      return sync.client.mutate(sync.shard, "incident.ack", { id: incident });
    },
    speak: (text, language) => BrigadeCall?.speak(text, language),
    endCall: (id) => BrigadeCall?.endCall(id),
  },
  getLocale,
);
