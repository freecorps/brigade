// A Brigade workspace's functions on Ember (RFC 0016 "The workspace shard"). Brigade's named registries stay the one
// list of mutations and queries: `mutate({ name, args })` and `query({ name, args })` run any of them by name, as a
// Brigade Sync `mutate` frame and subscription do today, through `runMutation`/`runQuery` over `createEmberStore`.
// So every `apply` and every query runs unchanged, with the same RBAC, codes and validation.
//
// Results are values, not throws: `{ ok: true }` or `{ ok: false, error: { code, message, issues? } }`, Brigade's
// `MutationError`, so a refusal keeps its code (`forbidden`, `conflict`, …) on the wire. A refused mutation has
// written nothing: `runMutation` undid its writes through the store before returning.

import {
  internalMutationGeneric,
  mutationGeneric,
  queryGeneric,
  v,
  type Identity,
  type MutationCtx,
  type QueryCtx,
} from "@freecorps/ember-server";
import {
  createEmberStore,
  mutations,
  newId,
  queries,
  runMutation,
  runQuery,
  serverMutations,
  isRole,
  type Actor,
  type BrigadeTables,
  type DomainEvent,
  type MutationError,
  type QueryResult,
  type Store,
} from "@freecorps/brigade-schema";
import type { BrigadeEvent } from "../src/outbox.ts";
import { BRIGADE_TABLES } from "./schema.ts";

const TABLE_SET: ReadonlySet<string> = new Set(BRIGADE_TABLES);

export type MutateResult = { ok: true } | { ok: false; error: MutationError };

/**
 * The claims Brigade's auth hook puts on an identity (RFC 0016 "Auth"): `role`, the member's role in this workspace as
 * D1 holds it, checked when the socket is admitted and again on every token refresh (at most 5 minutes old, as the
 * role a socket's upgrade read from D1 is today); for an API token (RFC 0014) also `kind: "token"`, the subject being
 * the token id (`tok_…`) and `role` its creator's.
 */
export const TOKEN_KIND = "token";

/**
 * Who `identity` is: a member with the role its claims carry, or an API token, whose scopes and validity come from its
 * row in this shard (a revoked or expired token is no one). Undefined: not someone who may act here.
 */
export function actorOf(
  identity: Identity | null,
  store: Pick<Store<BrigadeTables>, "get">,
  now: number,
): Actor | undefined {
  const role = identity?.claims?.role;
  if (!identity || !isRole(role)) return undefined;
  if (identity.claims?.kind === TOKEN_KIND) {
    const token = store.get("api_tokens", identity.subject);
    if (!token || token.revokedAt !== null) return undefined;
    if (token.expiresAt !== null && token.expiresAt <= now) return undefined;
    return { kind: "token", id: token.id, role, by: token.createdBy, scopes: token.scopes };
  }
  return { kind: "user", id: identity.subject, role };
}

const notMember = (): MutateResult => ({
  ok: false,
  error: { code: "forbidden", message: "Not a member of this workspace" },
});

/** Bytes for Brigade's ids from the mutation's seeded random, so a replay makes the same ids. */
const bytesFrom =
  (random: () => number) =>
  (length: number): Uint8Array => {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = Math.floor(random() * 256);
    return out;
  };

/** The workspace this shard holds: its one `workspace` row, written when the workspace is provisioned. */
function workspaceId(store: Store<BrigadeTables>): string | undefined {
  return store.scan("workspace")[0]?.id;
}

/**
 * Runs `name` from `registry` as `actor`, and writes its events in the same transaction as `BrigadeEvent` envelopes
 * (RFC 0005). The envelope is the one `writeOutbox` builds for the Durable Object, with this shard as its source.
 */
function run(
  ctx: MutationCtx,
  registry: typeof mutations | typeof serverMutations,
  name: unknown,
  args: unknown,
  actor: (store: Store<BrigadeTables>) => Actor | undefined,
  limits?: { monitors?: number },
): MutateResult {
  const store = createEmberStore<BrigadeTables>(ctx.db as never, TABLE_SET);
  const who = actor(store);
  if (!who) return notMember();
  const randomBytes = bytesFrom(() => ctx.random());
  // Event rows are written straight to `ctx.db`, outside the store's undo log: if writing them fails, the mutation
  // must not commit its rows' rollback next to the events already written, so the whole Ember mutation fails instead.
  let committing = false;
  const outcome = runMutation(
    registry,
    name,
    args,
    store,
    { actor: who, now: ctx.now, server: true, ...(limits ? { limits } : {}) },
    {
      commit: (events: DomainEvent[]) => {
        committing = true;
        // Read here, not before `apply`: `workspace.create` is what writes it.
        const ws = workspaceId(store);
        if (ws === undefined) throw new Error("This shard holds no workspace");
        for (const event of events) {
          const envelope: BrigadeEvent = {
            id: newId("evt", ctx.now, randomBytes),
            type: event.type,
            source: `brigade://${ws}/workspace`,
            workspaceId: ws,
            time: new Date(ctx.now).toISOString(),
            actor: { kind: who.kind, id: who.id },
            ...(event.subject === undefined ? {} : { subject: event.subject }),
            data: event.data,
            specversion: "1.0",
          };
          (ctx.db as never as EventsWriter).insert("events", {
            id: envelope.id,
            type: envelope.type,
            at: ctx.now,
            event: JSON.stringify(envelope),
          });
        }
      },
      onError: (error, mutation) => console.error("mutation failed", { mutation, error }),
    },
  );
  if (committing && !outcome.ok)
    throw new Error(`${String(name)}: its events could not be written`);
  return outcome.ok ? { ok: true } : { ok: false, error: outcome.error };
}

type EventsWriter = {
  insert(table: "events", value: { id: string; type: string; at: number; event: string }): string;
};

/** A client's mutation (`mutations`), as the caller's identity. */
export const mutate = mutationGeneric({
  args: { name: v.string(), args: v.any() },
  handler: (ctx: MutationCtx, { name, args }: { name: string; args: unknown }) => {
    const identity = ctx.auth.getUserIdentity();
    return run(ctx, mutations, name, args, (store) => actorOf(identity, store, ctx.now));
  },
});

/**
 * A server-only mutation (`serverMutations`: provisioning, monitor reports, member changes), run only by the API's own
 * code with the actor it resolved (a system or integration actor, or a member the API checked in D1).
 */
export const serverMutate = internalMutationGeneric({
  args: {
    name: v.string(),
    args: v.any(),
    actor: v.object({
      kind: v.union(
        v.literal("user"),
        v.literal("system"),
        v.literal("integration"),
        v.literal("token"),
      ),
      id: v.string(),
      role: v.string(),
      by: v.optional(v.string()),
      scopes: v.optional(v.array(v.string())),
    }),
    limits: v.optional(v.object({ monitors: v.optional(v.number()) })),
  },
  handler: (ctx, input) => {
    // The API's own code built this actor; a role or scope it got wrong is a bug, refused rather than run.
    if (!isRole(input.actor.role)) throw new Error(`Not a Brigade role: ${input.actor.role}`);
    const actor = input.actor as Actor;
    return run(
      ctx as MutationCtx,
      serverMutations,
      input.name,
      input.args,
      () => actor,
      input.limits,
    );
  },
});

/** A named query (`queries`), as the caller's identity; reactive through the rows it reads. */
export const query = queryGeneric({
  args: { name: v.string(), args: v.any() },
  handler: (ctx: QueryCtx, { name, args }: { name: string; args: unknown }): QueryResult => {
    const store = createEmberStore<BrigadeTables>(ctx.db as never, TABLE_SET);
    const actor = actorOf(ctx.auth.getUserIdentity(), store, ctx.now);
    if (!actor) {
      return { ok: false, error: { code: "forbidden", message: "Not a member of this workspace" } };
    }
    return runQuery(queries, name, args, store, actor.role, {
      onError: (error, q) => console.error("query failed", { query: q, error }),
      ...(actor.kind === "token" ? { scopes: actor.scopes ?? [] } : {}),
    });
  },
});
