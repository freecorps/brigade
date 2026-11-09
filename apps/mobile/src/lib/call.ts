// The app's one call session, wired to the native module (modules/brigade-call), the signed-in member's sync client
// and, for a call from another instance than the one shown, that instance's session (RFC 0015 section 5).
import { getLocale } from "@freecorps/brigade-i18n";
import { randomUUID } from "expo-crypto";
import { BrigadeCall } from "../../modules/brigade-call";
import { CallSession } from "@/lib/call-session";
import { clientsFor, instances } from "@/lib/instance-clients";
import { activeInstance } from "@/lib/instances";
import {
  acknowledgeFromNotification,
  ackMutationOutcome,
  callAckRoute,
  socketFallback,
} from "@/lib/page-action";
import type { MutationOutcome } from "@freecorps/brigade-sync";
import { currentSync, type WorkspaceSync } from "@/lib/sync-client";

/**
 * `incident.ack` over the open workspace's socket. Not given up on a timer: a change sent there stays queued and goes
 * out once the socket is back (after a restart too), so saying "failed" meanwhile would be wrong, and a responder who
 * then hung up to pass the page on could still acknowledge it later without knowing. The call screen says
 * "Acknowledging…" until the shard answers.
 */
function socketAck(sync: WorkspaceSync, incident: string): Promise<MutationOutcome> {
  return sync.client.mutate(sync.shard, "incident.ack", { id: incident });
}

export const callSession = new CallSession(
  {
    // Over HTTPS as the Acknowledge action does, with the session of the instance the call came from
    // (`callAckRoute`): a call often wakes the app on the lock screen or from suspension, before the workspace's socket
    // is open, and the session is readable there (src/lib/locked-store.ts). When HTTPS cannot get through, the open
    // workspace's socket is tried if it is the call's. Only an older instance's call, which names no workspace, goes
    // over that socket first. Signed out, there is no one to ack as: the call screen says it failed.
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
        // HTTPS could not get through (or the session could not be read), but the open workspace may be the call's
        // and its socket may still: tried there, as they are now, after the seconds HTTPS took.
        const open = currentSync();
        const shown = activeInstance(instances.current());
        if (
          open &&
          socketFallback(outcome, route, { shard: open.shard, activeOrigin: shown?.origin })
        ) {
          return socketAck(open, incident);
        }
        return ackMutationOutcome(outcome);
      }
      if (!sync) return { ok: false, error: { code: "closed", message: "Signed out" } };
      return socketAck(sync, incident);
    },
    speak: (text, language) => BrigadeCall?.speak(text, language),
    endCall: (id) => BrigadeCall?.endCall(id),
  },
  getLocale,
);
