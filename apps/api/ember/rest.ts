// The public HTTP API's reads and writes, and API tokens' list, on a workspace's Ember shard (RFC 0014, RFC 0016
// "Parity"): `WorkspaceDO.restRead`, `restWrite`, `apiTokenRun` and `apiTokenUsed`, with the same code (src/rest.ts)
// over the shard facade (ember/shard-facade.ts), its request keys in Ember's private SQL tables. The Worker's route
// read the member's role in D1 already (the DO's member tombstone has nothing to add), computed what a write's ids
// and idempotency are made of (`keySeed`, `requestDigest`: crypto, which a mutation cannot run), and closes a revoked
// token's sockets itself (src/ember-rest.ts).

import { internalMutationGeneric, v, type MutationCtx } from "@freecorps/ember-server";
import { TOKENS_ACTOR, type Actor, type MutationErrorCode } from "@freecorps/brigade-schema";
import {
  readRest,
  writeRest,
  type RestRead,
  type RestResult,
  type RestWrite,
} from "../src/rest.ts";
import { emberWorkspace } from "./shard-facade.ts";

const REFUSED = { ok: false, code: "unauthenticated" } as const;

/** `WorkspaceDO.restRead`. */
export const read = internalMutationGeneric({
  args: { workspaceId: v.string(), actor: v.any(), read: v.any() },
  handler: (ctx, input: { workspaceId: string; actor: Actor; read: RestRead }): RestResult => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== input.workspaceId) return { ok: false, code: "not_found" };
    const acting = shard.tokenActor(input.actor, c.now);
    if (!acting) return REFUSED;
    const out = readRest(shard as never, acting, input.read);
    shard.check();
    return out;
  },
});

/** `WorkspaceDO.restWrite`: `seed` and `request` as the Worker computed them for this actor (`acting.id`). */
export const write = internalMutationGeneric({
  args: {
    workspaceId: v.string(),
    actor: v.any(),
    write: v.any(),
    key: v.string(),
    seed: v.array(v.number()),
    request: v.string(),
  },
  handler: (
    ctx,
    input: {
      workspaceId: string;
      actor: Actor;
      write: RestWrite;
      key: string;
      seed: number[];
      request: string;
    },
  ): RestResult => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== input.workspaceId) return { ok: false, code: "not_found" };
    const acting = shard.tokenActor(input.actor, c.now);
    if (!acting) return REFUSED;
    const out = writeRest(
      {
        shard: shard as never,
        actor: acting,
        key: input.key,
        seed: Uint8Array.from(input.seed),
        request: input.request,
        now: c.now,
        // Ember's subscriptions follow the rows: nothing to broadcast.
        committed: () => {},
      },
      input.write,
    );
    shard.check();
    return out;
  },
});

/** `WorkspaceDO.apiTokenRun`: an API token listed or revoked, as the member who asked (the route read D1). */
export const tokenRun = internalMutationGeneric({
  args: {
    workspaceId: v.string(),
    actor: v.any(),
    name: v.union(v.literal("apiToken.create"), v.literal("apiToken.revoke")),
    args: v.any(),
    mutationId: v.string(),
  },
  handler: (
    ctx,
    input: {
      workspaceId: string;
      actor: Actor;
      name: "apiToken.create" | "apiToken.revoke";
      args: Record<string, unknown>;
      mutationId: string;
    },
  ): { ok: true } | { ok: false; code: MutationErrorCode } => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== input.workspaceId) return { ok: false, code: "not_found" };
    const { result } = shard.mutate({
      clientId: "api",
      mutationId: input.mutationId,
      actor: input.actor,
      name: input.name,
      args: input.args,
      now: c.now,
      internal: true,
    });
    shard.check();
    return result.ok ? { ok: true } : { ok: false, code: result.error.code };
  },
});

/** `WorkspaceDO.apiTokenUsed`: a token's last use as D1 has it, copied into the list (`apiToken.touch`, silent). */
export const tokenUsed = internalMutationGeneric({
  args: { workspaceId: v.string(), tokenId: v.string(), at: v.number(), mutationId: v.string() },
  handler: (
    ctx,
    input: { workspaceId: string; tokenId: string; at: number; mutationId: string },
  ): null => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== input.workspaceId) return null;
    shard.mutate({
      clientId: "api",
      mutationId: input.mutationId,
      actor: TOKENS_ACTOR,
      name: "apiToken.touch",
      args: { id: input.tokenId, at: input.at },
      now: c.now,
      internal: true,
    });
    shard.check();
    return null;
  },
});
