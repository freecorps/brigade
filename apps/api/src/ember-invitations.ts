// Invitations and provisioning for a workspace, on the engine D1's `workspace_engine` names (RFC 0003 "Invitations",
// RFC 0016 "Parity"): its `WorkspaceDO`, or its Ember shard. On Ember the same `Invitations` the DO runs does D1's
// part here, in the Worker, over the shard's side by RPC (ember/invitations.ts). Without the DO's member lock, D1's
// conditional writes are the guard (every write re-checks its condition in SQL); a shard step that fails after D1
// committed is owed to `invitations:repair` and answers `not_applied`, as on the DO.

import { type Actor, type Role, type WorkspaceLocale } from "@freecorps/brigade-schema";
import { setWorkspaceEngine, workspaceEngine } from "./ember.ts";
import { emberMutation } from "./ember-workspace.ts";
import {
  Invitations,
  type InvitationEmailPlan,
  type InvitationResult,
  type InvitationShardSide,
  type Invitee,
  type ListedInvitation,
} from "./invitations.ts";
import type { BrigadeEvent } from "./outbox.ts";
import type { MutateResult } from "../ember/workspace.ts";
import type { TokenRefused } from "./workspace.ts";

type InvitationsEnv = Pick<Env, "WORKSPACE"> & { DB?: Env["DB"]; SHARD?: Env["SHARD"] };
type EmberInvitationsEnv = Pick<Env, "DB" | "WORKSPACE" | "SHARD">;

const TOKEN_REFUSED: TokenRefused = { ok: false, code: "unauthenticated" };
const NOT_FOUND = { ok: false, code: "not_found" } as const;

const log = (message: string, fields: Record<string, unknown>) =>
  console.error(
    JSON.stringify({
      message,
      ...Object.fromEntries(
        Object.entries(fields).map(([k, value]) => [
          k,
          value instanceof Error ? value.message : value,
        ]),
      ),
    }),
  );

const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

/** A workspace's invitation calls and its email plan, with `WorkspaceDO`'s signatures. */
export type WorkspaceInvitations = {
  invite(
    workspaceId: string,
    actorId: string,
    email: string,
    role: Role,
    origin: string | null,
    token?: Actor,
  ): Promise<InvitationResult<{ invitation: ListedInvitation }> | TokenRefused>;
  resendInvitation(
    workspaceId: string,
    actorId: string,
    invitationId: string,
    origin: string | null,
    token?: Actor,
  ): Promise<InvitationResult<{ expiresAt: number }> | TokenRefused>;
  revokeInvitation(
    workspaceId: string,
    actorId: string,
    invitationId: string,
    token?: Actor,
  ): Promise<InvitationResult | TokenRefused>;
  acceptInvitation(
    workspaceId: string,
    invitationId: string,
    invitee: Invitee,
  ): Promise<InvitationResult<{ role: Role }>>;
  declineInvitation(
    workspaceId: string,
    invitationId: string,
    invitee: Invitee,
  ): Promise<InvitationResult>;
  planInvitationEmail(event: BrigadeEvent): Promise<InvitationEmailPlan>;
  recordInvitationEmail(event: BrigadeEvent, key: string, done: boolean): Promise<void>;
};

/** `workspaceId`'s invitation calls, on `WorkspaceDO` or on Ember as D1 says. */
export async function workspaceInvitations(
  env: InvitationsEnv,
  workspaceId: string,
): Promise<WorkspaceInvitations> {
  const { DB, SHARD } = env;
  if (DB && SHARD && (await workspaceEngine(DB, workspaceId)) === "ember") {
    return emberInvitations({ WORKSPACE: env.WORKSPACE, DB, SHARD });
  }
  const stub = env.WORKSPACE.getByName(workspaceId);
  return {
    invite: async (...args) => stub.invite(...args),
    resendInvitation: async (...args) => stub.resendInvitation(...args),
    revokeInvitation: async (...args) => stub.revokeInvitation(...args),
    acceptInvitation: async (...args) => stub.acceptInvitation(...args),
    declineInvitation: async (...args) => stub.declineInvitation(...args),
    planInvitationEmail: async (event) => stub.planInvitationEmail(event),
    recordInvitationEmail: async (event, key, done) => stub.recordInvitationEmail(event, key, done),
  };
}

/** The shard's side of `Invitations` on `workspaceId`'s Ember shard, by RPC. */
function emberSide(env: EmberInvitationsEnv, workspaceId: string): InvitationShardSide {
  const call = <T>(fn: string, args: Record<string, unknown>) =>
    emberMutation<T>(env, workspaceId, fn, { workspaceId, ...args });
  return {
    prune: async (now) => {
      // Best effort, as on the DO: a ledger that cannot be pruned never holds up an invitation.
      try {
        await call("invitations:prune", { now });
      } catch (error) {
        log("pruning the invitation ledger failed", { error });
      }
    },
    sentToday: (now) => call<number>("invitations:sentToday", { now }),
    sends: (invitationId) =>
      call<{ count: number; last: number | null }>("invitations:sends", { invitationId }),
    recordSend: async (invitationId, send, now, origin) => {
      // Without its row the email is not sent (the plan finds nothing); the dashboard's Resend is the way back.
      try {
        await call("invitations:recordSend", { invitationId, send, now, origin });
      } catch (error) {
        log("recording an invitation send failed", { error });
      }
    },
    apply: async (actor, name, args, now) => {
      try {
        return await call<InvitationResult>("invitations:apply", { actor, name, args, now });
      } catch (error) {
        // The shard failed mid-call (its own rollback took any record of the debt): owe it now, so the repair
        // brings the copy along with what D1 already has.
        log("invitation change not applied to the Ember shard", { name, error });
        try {
          await call("invitations:owe", { name, args, now });
        } catch (owing) {
          log("arming the invitation repair failed", { error: owing });
        }
        return { ok: false, code: "not_applied" };
      }
    },
  };
}

/** The invitation calls on a workspace's Ember shard. */
export function emberInvitations(env: EmberInvitationsEnv): WorkspaceInvitations {
  const orchestrator = (workspaceId: string) =>
    new Invitations({
      db: env.DB,
      randomBytes,
      log,
      shard: emberSide(env, workspaceId),
      // No member lock on Ember: D1's conditional writes are the guard.
      locked: (fn) => fn(),
    });
  /** The DO's checks first: the shard holds the workspace, and backs the API token. */
  const refused = async (
    workspaceId: string,
    token?: Actor,
  ): Promise<typeof NOT_FOUND | TokenRefused | undefined> => {
    const held = await emberMutation<{ found: boolean; tokenBacked: boolean }>(
      env,
      workspaceId,
      "invitations:check",
      { workspaceId, ...(token ? { token } : {}) },
    );
    if (!held.found) return NOT_FOUND;
    if (!held.tokenBacked) return TOKEN_REFUSED;
    return undefined;
  };
  return {
    async invite(workspaceId, actorId, email, role, origin, token) {
      return (
        (await refused(workspaceId, token)) ??
        orchestrator(workspaceId).invite(workspaceId, actorId, email, role, origin, token)
      );
    },
    async resendInvitation(workspaceId, actorId, invitationId, origin, token) {
      return (
        (await refused(workspaceId, token)) ??
        orchestrator(workspaceId).resend(workspaceId, actorId, invitationId, origin, token)
      );
    },
    async revokeInvitation(workspaceId, actorId, invitationId, token) {
      return (
        (await refused(workspaceId, token)) ??
        orchestrator(workspaceId).revoke(workspaceId, actorId, invitationId, token)
      );
    },
    async acceptInvitation(workspaceId, invitationId, invitee) {
      // No token here: only the workspace can be missing.
      if (await refused(workspaceId)) return NOT_FOUND;
      return orchestrator(workspaceId).accept(workspaceId, invitationId, invitee);
    },
    async declineInvitation(workspaceId, invitationId, invitee) {
      if (await refused(workspaceId)) return NOT_FOUND;
      return orchestrator(workspaceId).decline(workspaceId, invitationId, invitee);
    },
    planInvitationEmail: (event) =>
      emberMutation<InvitationEmailPlan>(env, event.workspaceId, "invitations:planEmail", {
        event,
      }),
    async recordInvitationEmail(event, key, done) {
      await emberMutation(env, event.workspaceId, "invitations:recordEmail", { event, key, done });
    },
  };
}

/**
 * Where a new workspace goes (`NEW_WORKSPACE_ENGINE`): `WorkspaceDO` until the switch (RFC 0016 "Data migration"),
 * then its Ember shard, with D1's `workspace_engine` saying so.
 */
export type ProvisionEnv = Pick<Env, "DB" | "WORKSPACE"> & {
  SHARD?: Env["SHARD"];
  NEW_WORKSPACE_ENGINE?: string;
};

/** `WorkspaceDO.provision`, on the engine new workspaces go to. */
export async function provisionWorkspace(
  env: ProvisionEnv,
  workspace: { id: string; name: string; locale?: WorkspaceLocale },
  actor: Actor,
): Promise<{ ok: boolean; code?: string }> {
  if (env.NEW_WORKSPACE_ENGINE !== "ember" || !env.SHARD) {
    return env.WORKSPACE.getByName(workspace.id).provision(workspace, actor);
  }
  const result = await emberMutation<MutateResult>(
    { SHARD: env.SHARD },
    workspace.id,
    "workspace:serverMutate",
    { name: "workspace.create", args: workspace, actor },
  );
  // Already provisioned (a retry): fine, as on the DO.
  if (!result.ok && result.error.code !== "conflict") return { ok: false, code: result.error.code };
  await setWorkspaceEngine(env.DB, workspace.id, "ember", Date.now());
  return { ok: true };
}
