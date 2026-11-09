// The app's one call session, wired to the native module (modules/brigade-call), the signed-in member's sync client
// and, for a call from another instance than the one shown, that instance's session (RFC 0015 section 5).
import { getLocale } from "@freecorps/brigade-i18n";
import { randomUUID } from "expo-crypto";
import { BrigadeCall } from "../../modules/brigade-call";
import { CallSession } from "@/lib/call-session";
import { clientsFor, instances } from "@/lib/instance-clients";
import { activeInstance } from "@/lib/instances";
import { acknowledgeFromNotification, ackMutationOutcome, callAckRoute } from "@/lib/page-action";
import type { MutationOutcome } from "@freecorps/brigade-sync";
import { currentSync, type WorkspaceSync } from "@/lib/sync-client";

/** How long the socket gets to answer an ack: a socket iOS closed under a suspended app never would. */
const SOCKET_ACK_MS = 10_000;

/** `incident.ack` over the open workspace's socket, given up after `SOCKET_ACK_MS`. */
function socketAck(sync: WorkspaceSync, incident: string): Promise<MutationOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<MutationOutcome>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, error: { code: "closed", message: "No answer in time" } }),
      SOCKET_ACK_MS,
    );
  });
  return Promise.race([
    sync.client.mutate(sync.shard, "incident.ack", { id: incident }),
    late,
  ]).finally(() => clearTimeout(timer));
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
        // HTTPS could not get through (or the session could not be read), but the open workspace is the call's and
        // its socket may still: tried there before giving up.
        const active = activeInstance(list);
        if (
          (outcome === "failed" || outcome === "signed_out") &&
          sync?.shard === route.workspace &&
          active?.origin === route.instance.origin
        ) {
          return socketAck(sync, incident);
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
