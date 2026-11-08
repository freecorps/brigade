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
  ROLES,
  type Actor,
  type BrigadeTables,
  type DomainEvent,
  type EmberStore,
  type MutationError,
  type QueryResult,
  type Role,
  type Store,
} from "@freecorps/brigade-schema";
import type { BrigadeEvent } from "../src/outbox.ts";
import { nextSeq, scheduleDrain } from "./events.ts";
import { armUpkeep, expectPages } from "./ticks.ts";
import { asksForPage } from "../src/paging.ts";
import { MEMBER_TOMBSTONE_MS } from "../src/members.ts";
import { bumpFence } from "./members.ts";
import { BRIGADE_TABLES } from "./schema.ts";

const TABLE_SET: ReadonlySet<string> = new Set(BRIGADE_TABLES);

export type MutateResult = { ok: true } | { ok: false; error: MutationError };

/**
 * The claims Brigade's auth hook puts on an identity (RFC 0016 "Auth"): `role`, the member's role in this workspace as
 * D1 holds it, checked when the socket is admitted and again on every token refresh (at most 5 minutes old, as the
 * role a socket's upgrade read from D1 is today); for an API token (RFC 0014) also `kind: "token"`, the subject being
 * the token id (`tok_…`) and `role` its creator's; and `ws`, the workspace the token is for (src/ember-token.ts).
 */
export const TOKEN_KIND = "token";

/**
 * The lower of `role` and the shard's copy of `memberId` (`members`, kept by `member.sync`, `member.changeRole`, …), as
 * `WorkspaceDO.tokenActor` does: a demotion the shard already ran holds at once, not only once the token's claims
 * catch up (up to 5 minutes). A member without a copy yet keeps the claim's role: their first `member.sync` writes it.
 */
function lowered(store: Pick<Store<BrigadeTables>, "get">, memberId: string, role: Role): Role {
  const copy = store.get("members", memberId);
  return copy && ROLES.indexOf(copy.role) > ROLES.indexOf(role) ? copy.role : role;
}

/**
 * Who `identity` is: a member with the role its claims carry, lowered to the shard's copy, or an API token, whose
 * scopes and validity come from its row in this shard (a revoked or expired token is no one) and whose role is its
 * creator's, lowered the same way. Undefined: not someone who may act here.
 */
export function actorOf(
  identity: Identity | null,
  store: Pick<Store<BrigadeTables>, "get" | "scan">,
  now: number,
): Actor | undefined {
  const role = identity?.claims?.role;
  if (!identity || !isRole(role)) return undefined;
  // A token names the one workspace it is for (`ws`): one for another workspace, or a shard holding none yet (not
  // migrated), is no one here, whatever role it carries.
  const ws = workspaceId(store);
  if (ws === undefined || identity.claims?.ws !== ws) return undefined;
  if (identity.claims?.kind === TOKEN_KIND) {
    const token = store.get("api_tokens", identity.subject);
    if (!token || token.revokedAt !== null) return undefined;
    if (token.expiresAt !== null && token.expiresAt <= now) return undefined;
    const creator = token.createdBy;
    return {
      kind: "token",
      id: token.id,
      role: lowered(store, creator, role),
      by: creator,
      scopes: token.scopes,
    };
  }
  return { kind: "user", id: identity.subject, role: lowered(store, identity.subject, role) };
}

/** What `MutationContext.limits` carries: the instance's caps, from the API's env (`instanceMonitorCap`). */
export type WorkspaceLimits = { monitors?: number };
let instanceLimits: WorkspaceLimits | undefined;

/** The caps `setWorkspaceLimits` set, for the server-side functions next to this file. */
export const workspaceLimits = (): WorkspaceLimits | undefined => instanceLimits;

/**
 * Sets the instance's caps for every mutation this isolate runs, as `WorkspaceDO` passes them from its env today:
 * Ember mutations have no `env`, so the Worker's entry calls this once with `instanceMonitorCap(env)` before serving.
 * Unset, mutations use packages/schema's defaults (`MAX_MONITORS_PER_WORKSPACE`).
 */
export function setWorkspaceLimits(limits: WorkspaceLimits | undefined): void {
  instanceLimits = limits;
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
export function workspaceId(store: Pick<Store<BrigadeTables>, "scan">): string | undefined {
  return store.scan("workspace")[0]?.id;
}

/**
 * Runs `name` from `registry` as `actor`, and writes its events in the same transaction as `BrigadeEvent` envelopes
 * (RFC 0005). The envelope is the one `writeOutbox` builds for the Durable Object, with this shard as its source.
 */
export function run(
  ctx: MutationCtx,
  registry: typeof mutations | typeof serverMutations,
  name: unknown,
  args: unknown,
  actor: (store: Store<BrigadeTables>) => Actor | undefined,
  limits?: { monitors?: number },
  /** A store the caller reads through too (ember/shard-facade.ts), so its reads see this mutation's writes. */
  shared?: EmberStore<BrigadeTables>,
): MutateResult {
  const base = shared ?? createEmberStore<BrigadeTables>(ctx.db as never, TABLE_SET);
  // The tables this mutation writes: a committed one that moved an escalation timer or a reminder arms the tick.
  const written = new Set<string>();
  const store: EmberStore<BrigadeTables> = {
    ...base,
    insert: (table, row) => (written.add(table), base.insert(table, row)),
    update: (table, id, patch) => (written.add(table), base.update(table, id, patch)),
    delete: (table, id) => (written.add(table), base.delete(table, id)),
  };
  const who = actor(store);
  if (!who) return notMember();
  const randomBytes = bytesFrom(() => ctx.random());
  // Event rows are written straight to `ctx.db`, outside the store's undo log: if writing them fails, the mutation
  // must not commit its rows' rollback next to the events already written, so the whole Ember mutation fails instead.
  let committing = false;
  // The pages this mutation wrote, watched for the Queue (`expectPages`).
  const pages: BrigadeEvent[] = [];
  const seq: { seq?: number } = {};
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
          if (asksForPage(envelope)) pages.push(envelope);
          (ctx.db as never as EventsWriter).insert("events", {
            id: envelope.id,
            seq: nextSeq(ctx.db, seq),
            type: envelope.type,
            at: ctx.now,
            event: JSON.stringify(envelope),
          });
        }
      },
      onError: (error, mutation) => console.error("mutation failed", { mutation, error }),
    },
  );
  // A rollback the store could not replay left rows half undone: fail the whole Ember mutation (`EmberStore`).
  const failure = store.undoFailure();
  if (failure) throw failure.error;
  if (committing && !outcome.ok) {
    throw new Error(`${String(name)}: its events could not be written`, { cause: outcome.error });
  }
  // The events go out after this transaction commits (ember/events.ts).
  if (seq.seq !== undefined) scheduleDrain(ctx);
  if (outcome.ok) {
    armUpkeep(ctx, base, written, name);
    expectPages(ctx, pages);
    tombstones(ctx, name, args);
  }
  return outcome.ok ? { ok: true } : { ok: false, error: outcome.error };
}

/**
 * A removed member's tombstone (`member_gone`, `MEMBER_TOMBSTONE_MS`, the DO's `Membership.tombstone`): a request the
 * Worker authenticated just before the removal is refused (`EmberShard.gone`). A member synced again clears it.
 */
function tombstones(ctx: MutationCtx, name: unknown, args: unknown): void {
  const id = (args as { id?: unknown } | null)?.id;
  if (typeof id !== "string") return;
  if (name === "member.remove") {
    markGone(ctx, [id]);
    // Fenced too: a D1 read taken before this removal proves nothing after it (ember/devices.ts).
    bumpFence(ctx.db);
  } else if (name === "member.sync") ctx.sql.exec("delete from member_gone where user_id = ?", id);
}

/** Tombstones for `userIds`, removed now. */
export function markGone(ctx: MutationCtx, userIds: readonly string[]): void {
  for (const userId of userIds) {
    ctx.sql.exec(
      `insert into member_gone (user_id, until) values (?, ?)
       on conflict (user_id) do update set until = excluded.until`,
      userId,
      ctx.now + MEMBER_TOMBSTONE_MS,
    );
  }
  ctx.sql.exec("delete from member_gone where until <= ?", ctx.now);
}

type EventsWriter = {
  insert(
    table: "events",
    value: { id: string; seq: number; type: string; at: number; event: string },
  ): string;
};

/** A client's mutation (`mutations`), as the caller's identity. */
export const mutate = mutationGeneric({
  args: { name: v.string(), args: v.any() },
  handler: (ctx: MutationCtx, { name, args }: { name: string; args: unknown }) => {
    const identity = ctx.auth.getUserIdentity();
    let acting: Actor | undefined;
    const out = run(
      ctx,
      mutations,
      name,
      args,
      (store) => (acting = actorOf(identity, store, ctx.now)),
      instanceLimits,
    );
    // As over HTTP (ember/devices.ts): registered or unchanged, the time and the socket's session are recorded.
    if (name === "device.register" && acting && (out.ok || out.error.code === "conflict")) {
      const sid = identity?.claims?.sid;
      touchDevice(
        ctx,
        acting,
        Reflect.get(Object(args), "id"),
        typeof sid === "string" ? sid : undefined,
      );
    }
    return out;
  },
});

/**
 * `device.touch` as `actor`, after their `device.register` (over HTTP or a socket) went through or changed nothing:
 * the time and `sessionId`, the session it was registered with, as `WorkspaceDO.touchDevice` records them. False when
 * it was refused (logged).
 */
export function touchDevice(
  ctx: MutationCtx,
  actor: Actor,
  id: unknown,
  sessionId: string | undefined,
  store?: EmberStore<BrigadeTables>,
): boolean {
  if (typeof id !== "string") return true;
  const out = run(
    ctx,
    serverMutations,
    "device.touch",
    { id, ...(sessionId !== undefined ? { sessionId } : {}) },
    () => actor,
    instanceLimits,
    store,
  );
  if (!out.ok) {
    console.error(
      JSON.stringify({ message: "refreshing a registered device failed", code: out.error.code }),
    );
  }
  return out.ok;
}

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
    // The API's own code built this actor; a role it got wrong is a bug, refused rather than run.
    if (!isRole(input.actor.role)) {
      const message = `Not a Brigade role: ${input.actor.role}`;
      return { ok: false, error: { code: "forbidden", message } } satisfies MutateResult;
    }
    const actor = input.actor as Actor;
    return run(
      ctx as MutationCtx,
      serverMutations,
      input.name,
      input.args,
      () => actor,
      input.limits ?? instanceLimits,
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
