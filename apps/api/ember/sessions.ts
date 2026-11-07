// A workspace's part when a Better Auth session or a whole account ends (RFC 0004 "Session revocation", RFC 0002
// "Taking back an address"), on Ember: what `WorkspaceDO.endSession` and `WorkspaceDO.signOutUser` do to the rows. The
// API Worker calls these as internal mutations and then closes the sockets with the runtime's `revokeSockets`
// (src/ember-workspace.ts), which Ember does outside any transaction.
//
// Each step is one of Brigade's server mutations run as the account (`ACCOUNT_ACTOR`), as the Durable Object runs
// them, and all of them are one Ember transaction: a step that fails rolls back the steps before it, and the Worker
// tries again. A shard that holds another workspace, or none yet, answers `not_found`.

import { internalMutationGeneric, v, type MutationCtx } from "@freecorps/ember-server";
import {
  ACCOUNT_ACTOR,
  createEmberStore,
  serverMutations,
  SLACK_ROW_ID,
  type BrigadeTables,
} from "@freecorps/brigade-schema";
import { BRIGADE_TABLES } from "./schema.ts";
import { run, workspaceId, workspaceLimits } from "./workspace.ts";

const TABLE_SET: ReadonlySet<string> = new Set(BRIGADE_TABLES);

/** The rows as they are now (a fresh store: every step below wrote through its own). */
const rows = (ctx: MutationCtx) => createEmberStore<BrigadeTables>(ctx.db as never, TABLE_SET);

/** One server mutation as the account; `conflict` is fine (already done), anything else fails the whole call. */
function step(ctx: MutationCtx, name: string, args: Record<string, unknown>): void {
  const out = run(ctx, serverMutations, name, args, () => ACCOUNT_ACTOR, workspaceLimits());
  if (!out.ok && out.error.code !== "conflict")
    throw new Error(`${name} refused: ${out.error.code}`);
}

type NotFound = { ok: false; code: "not_found" };
const notFound: NotFound = { ok: false, code: "not_found" };

/**
 * A session of `userId` ended. With `deviceId`, the phone signed out on comes off this workspace too, unless the
 * member registered it again after `endedAt` (`device.signOut`), as `WorkspaceDO.endSession` does.
 */
export const endSession = internalMutationGeneric({
  args: {
    workspaceId: v.string(),
    userId: v.string(),
    deviceId: v.optional(v.string()),
    endedAt: v.optional(v.number()),
  },
  handler: (ctx, input): { ok: true } | NotFound => {
    const c = ctx as MutationCtx;
    if (workspaceId(rows(c)) !== input.workspaceId) return notFound;
    if (input.deviceId !== undefined) {
      step(c, "device.signOut", {
        userId: input.userId,
        deviceId: input.deviceId,
        before: input.endedAt ?? c.now,
      });
    }
    return { ok: true };
  },
});

/** What `signOutUser` took over, as `WorkspaceDO`'s `SignOutResult`. */
export type SignOutUserResult =
  | {
      ok: true;
      paused?: string[];
      revoked?: number;
      sources?: number;
      routes?: number;
      slack?: string;
    }
  | NotFound;

/**
 * Every session of `userId` ended (a password reset): their phones come off (`device.signOut`). Its own transaction,
 * committed before any takeover step runs (`takeOver` below): a takeover step that fails must never put the phones
 * back, since nothing else takes them off again (on `WorkspaceDO` this step also commits first).
 */
export const signOutUser = internalMutationGeneric({
  args: { workspaceId: v.string(), userId: v.string() },
  handler: (ctx, input): { ok: true } | NotFound => {
    const c = ctx as MutationCtx;
    if (workspaceId(rows(c)) !== input.workspaceId) return notFound;
    step(c, "device.signOut", { userId: input.userId });
    return { ok: true };
  },
});

/**
 * After `signOutUser` with `takeOver`, when nobody else is a member here: what `WorkspaceDO.signOutUser` takes over.
 * Every alert source URL and the routes the account made (`alertSource.takeOver`), every monitor paused and heartbeat
 * URL revoked (`monitor.takeOver`), and a Slack connection the account made (`slack.takeOver`). Answers what it paused
 * and revoked, counted before each step so a retry after a step committed counts the same; with anyone else a member,
 * nothing is taken over (`{ ok: true }`).
 *
 * Not yet on Ember: routing again the alerts those routes kept quiet. On `WorkspaceDO` that is its alert engine's job
 * (`AlertIntake.reroute`, from its alarm); it comes with the alert engine's move (RFC 0016 "Parity").
 */
export const takeOver = internalMutationGeneric({
  args: { workspaceId: v.string(), userId: v.string() },
  handler: (ctx, input): SignOutUserResult => {
    const c = ctx as MutationCtx;
    const { userId } = input;
    if (workspaceId(rows(c)) !== input.workspaceId) return notFound;
    // The Worker counted the members in D1 a moment ago; someone who joined since is not the account's to act for.
    const others = rows(c)
      .scan("members")
      .some((member) => member.id !== userId);
    if (others) return { ok: true };
    // Random bytes, not the hash of a token: no heartbeat or alert source URL matches it, so every one is revoked.
    const tokenHash = Array.from({ length: 32 }, () =>
      Math.floor(c.random() * 256)
        .toString(16)
        .padStart(2, "0"),
    ).join("");
    const before = rows(c);
    const sources = before.scan("alert_source_secrets").length;
    const routes = before
      .scan("alert_routes")
      .filter(
        (route) => route.createdBy === userId && (!route.disabled || route.disabled === "takeover"),
      ).length;
    step(c, "alertSource.takeOver", { tokenHash, userId });
    const current = rows(c);
    const paused = current
      .scan("monitors")
      .filter((monitor) => !monitor.paused)
      .map((monitor) => monitor.name);
    const revoked = current.scan("heartbeats").length;
    step(c, "monitor.takeOver", { tokenHash });
    const slack = rows(c).get("slack", SLACK_ROW_ID);
    const slackTeam = slack?.connectedBy === userId ? slack.teamName : undefined;
    if (slackTeam !== undefined) step(c, "slack.takeOver", { userId });
    return {
      ok: true,
      paused,
      revoked,
      sources,
      routes,
      ...(slackTeam !== undefined ? { slack: slackTeam } : {}),
    };
  },
});
