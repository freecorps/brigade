// The public HTTP API's calls into a workspace's shard and API tokens' (RFC 0014, RFC 0016 "Parity"), sent to the
// engine D1's `workspace_engine` names: its `WorkspaceDO`, or its Ember shard (ember/rest.ts). Each has the
// signature of the `WorkspaceDO` method it stands for. Its routes read D1 already (the session or the token, the
// member's role), so the engine is read fresh there too: a route that could not read D1 answered before this.

import type { EmberEnv } from "@freecorps/ember-runtime";
import { newId, type Actor, type MutationErrorCode } from "@freecorps/brigade-schema";
import { ember, workspaceEngine, workspaceShard } from "./ember.ts";
import { emberMutation } from "./ember-workspace.ts";
import { keySeed, requestDigest, type RestRead, type RestResult, type RestWrite } from "./rest.ts";

type TokenName = "apiToken.create" | "apiToken.revoke";
type TokenRunResult = { ok: true } | { ok: false; code: MutationErrorCode | "not_a_member" };

/** The REST and API-token calls of a workspace, with `WorkspaceDO`'s signatures. */
export type WorkspaceRest = {
  restRead(workspaceId: string, actor: Actor, read: RestRead): Promise<RestResult>;
  restWrite(workspaceId: string, actor: Actor, write: RestWrite, key: string): Promise<RestResult>;
  apiTokenRun(
    workspaceId: string,
    actor: Actor,
    name: TokenName,
    args: Record<string, unknown>,
  ): Promise<TokenRunResult>;
  apiTokenUsed(workspaceId: string, tokenId: string, at: number): Promise<void>;
};

type RestEnv = Pick<Env, "DB" | "WORKSPACE"> & { SHARD?: Env["SHARD"] };

const mutationId = () =>
  newId("mut", Date.now(), (length) => crypto.getRandomValues(new Uint8Array(length)));

/** `workspaceId`'s REST and token calls, on `WorkspaceDO` or on Ember as D1 says. */
export async function workspaceRest(env: RestEnv, workspaceId: string): Promise<WorkspaceRest> {
  if (env.SHARD && (await workspaceEngine(env.DB, workspaceId)) === "ember") {
    return emberRest({ ...env, SHARD: env.SHARD });
  }
  const stub = env.WORKSPACE.getByName(workspaceId);
  return {
    restRead: async (id, actor, read) => stub.restRead(id, actor, read),
    restWrite: async (id, actor, write, key) => stub.restWrite(id, actor, write, key),
    apiTokenRun: async (id, actor, name, args) => stub.apiTokenRun(id, actor, name, args),
    apiTokenUsed: async (id, tokenId, at) => stub.apiTokenUsed(id, tokenId, at),
  };
}

/** The calls on a workspace's Ember shard. */
export function emberRest(env: RestEnv & { SHARD: Env["SHARD"] }): WorkspaceRest {
  return {
    restRead: (workspaceId, actor, read) =>
      emberMutation<RestResult>(env, workspaceId, "rest:read", { workspaceId, actor, read }),
    async restWrite(workspaceId, actor, write, key) {
      // What the write's ids and idempotency are made of, as the DO makes them: by the actor the route resolved (a
      // token's role may be lowered by the shard, never its id).
      const [seed, request] = await Promise.all([
        keySeed(write.kind, actor.id, key),
        requestDigest(write),
      ]);
      return emberMutation<RestResult>(env, workspaceId, "rest:write", {
        workspaceId,
        actor,
        write,
        key,
        seed: [...seed],
        request,
      });
    },
    async apiTokenRun(workspaceId, actor, name, args) {
      const result = await emberMutation<TokenRunResult>(env, workspaceId, "rest:tokenRun", {
        workspaceId,
        actor,
        name,
        args,
        mutationId: mutationId(),
      });
      // A revoked token's sockets close now (the DO's `closeSockets`); its next token refresh would refuse it anyway.
      if (name === "apiToken.revoke" && (result.ok || result.code === "conflict")) {
        await ember.revokeSockets(
          env as unknown as EmberEnv,
          workspaceShard(workspaceId),
          { subject: String(args.id) },
          { close: true },
        );
      }
      return result;
    },
    async apiTokenUsed(workspaceId, tokenId, at) {
      await emberMutation(env, workspaceId, "rest:tokenUsed", {
        workspaceId,
        tokenId,
        at,
        mutationId: mutationId(),
      });
    },
  };
}
