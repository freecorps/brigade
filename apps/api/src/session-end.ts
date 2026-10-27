// Ending a Better Auth session in every workspace of its user (RFC 0004 "Session revocation", RFC 0006 "Device
// registration"), durably. Before the session's row is deleted, D1's `session_end` gets one row per workspace the
// user is in (`recordSessionEnd`, one statement); right after, the session hook asks each shard to act on it
// (`WorkspaceDO.endSession`: close the session's sockets, take the phone that signed out off the member's devices)
// and deletes the row of each that did. A shard that could not be reached keeps its row, and the row is acted on by
// whichever comes first: the shard itself before a phone registers in it or after a sync upgrade
// (`WorkspaceDO.catchUpSessionEnds`), or the Worker's cron (`sweepSessionEnds`).

import type { EndingSession } from "./auth.ts";

/** How long after a session ended the cron takes over its rows: by then the session hook has had its tries. */
export const SESSION_END_SWEEP_AFTER_MS = 60 * 1000;
/** Rows still there this long after (a shard that never answers, a workspace never provisioned) are dropped. */
export const SESSION_END_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Workspaces the cron catches up per run. */
const SWEEP_WORKSPACES = 50;

/**
 * Records that `session` ended, for each workspace its user is in (D1's `member`), before Better Auth deletes it.
 * Throws when D1 fails: a sign-out then keeps its session and answers 503 (src/auth.ts `onSessionEnding`).
 */
export async function recordSessionEnd(db: D1Database, session: EndingSession): Promise<void> {
  await db
    .prepare(
      `insert into session_end ("workspaceId", "sessionId", "userId", "deviceId", "endedAt")
       select "organizationId", ?1, ?2, ?3, ?4 from member where "userId" = ?2
       on conflict ("workspaceId", "sessionId") do update set
         "deviceId" = coalesce(excluded."deviceId", session_end."deviceId"),
         "endedAt" = excluded."endedAt"`,
    )
    .bind(session.sessionId, session.userId, session.deviceId ?? null, session.endedAt)
    .run();
}

/** Deletes the row of a workspace whose shard acted on the session. A failure is logged: the cron acts on it again. */
export async function forgetSessionEnd(
  db: D1Database,
  workspaceId: string,
  sessionId: string,
): Promise<void> {
  try {
    await db
      .prepare(`delete from session_end where "workspaceId" = ? and "sessionId" = ?`)
      .bind(workspaceId, sessionId)
      .run();
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "deleting an ended session's row failed",
        workspace: workspaceId,
        error: String(error),
      }),
    );
  }
}

/**
 * The cron's part (src/index.ts `scheduled`): asks each workspace with rows older than `SESSION_END_SWEEP_AFTER_MS`
 * to act on them (`WorkspaceDO.catchUpSessionEnds`, which deletes what it acted on), and drops rows older than
 * `SESSION_END_TTL_MS`. Never throws.
 */
export async function sweepSessionEnds(
  env: Pick<Env, "DB" | "WORKSPACE">,
  now: number,
): Promise<void> {
  let workspaces: string[];
  try {
    await env.DB.prepare(`delete from session_end where "endedAt" < ?`)
      .bind(now - SESSION_END_TTL_MS)
      .run();
    // Oldest first: the phone waiting longest to be freed is freed first. A workspace whose shard serves none has its
    // rows deleted by the catch-up, so it never holds a place here.
    const { results } = await env.DB.prepare(
      `select "workspaceId" as id from session_end where "endedAt" < ?
       group by "workspaceId" order by min("endedAt") limit ?`,
    )
      .bind(now - SESSION_END_SWEEP_AFTER_MS, SWEEP_WORKSPACES)
      .all<{ id: string }>();
    workspaces = results.map((row) => row.id);
  } catch (error) {
    console.error(
      JSON.stringify({ message: "reading the sessions to end failed", error: String(error) }),
    );
    return;
  }
  await Promise.all(
    workspaces.map(async (workspaceId) => {
      try {
        await env.WORKSPACE.getByName(workspaceId).catchUpSessionEnds(workspaceId);
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "catching up on ended sessions failed",
            workspace: workspaceId,
            error: String(error),
          }),
        );
      }
    }),
  );
}
