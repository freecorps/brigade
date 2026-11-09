// The workspace's sync client: one per signed-in member and workspace, made by the session (src/components/
// session.tsx) and closed when they sign out or the workspace changes, so no socket or row outlives its session.
// Ember's (RFC 0016 step 5, src/lib/ember-client.ts) under the app's hooks. Changes the shard has not confirmed are
// kept in the member's queue (src/lib/pending.ts, src/lib/ember-queue.ts) and survive a restart.
import type { SyncClientLike } from "@freecorps/brigade-sync";
import type { MemberQueue, RestoredChanges } from "@/lib/pending";

export type WorkspaceSync = {
  client: SyncClientLike;
  shard: string;
  /** The member's kept queue; none for a client that only finishes a sign-out. */
  queue?: MemberQueue;
  /** The changes the queue gave back at launch, for the screens that made them; none until `restore`. */
  restored: RestoredChanges;
  /**
   * Puts the queue's changes back, applied as the actor's role is then: call it once the member's role is known
   * (a role still loading reads as viewer, and the changes would drop out of the view). Once; later calls do nothing.
   */
  restore: () => void;
};

let current: WorkspaceSync | null = null;

/**
 * The signed-in member's sync client, for code outside React (the call screen's "press 1" ack, src/lib/call.ts);
 * null while signed out.
 */
export function currentSync(): WorkspaceSync | null {
  return current;
}

export function setCurrentSync(sync: WorkspaceSync | null): void {
  current = sync;
}
