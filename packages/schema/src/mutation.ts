// Named mutations (RFC 0004 "Shared core"): the same `apply` runs optimistically on clients and
// authoritatively, with RBAC, in the server's Durable Object.

import { can, isRole, type Permission, type Role } from "./access.ts";
import type { Store } from "./store.ts";
import type { BrigadeTables } from "./tables.ts";
import type { Infer, Issue, Validator } from "./validate.ts";

export type Actor = { kind: "user" | "system" | "integration"; id: string; role: Role };

export type MutationContext = {
  actor: Actor;
  /** The clock, injected: epoch milliseconds. On the server it is the time the shard ran the mutation. */
  now: number;
  /**
   * True only in the authoritative run. Server-only work (allocating `INC-n`) happens only then; clients leave
   * those fields empty until the server's patch arrives.
   */
  server: boolean;
};

/** A domain event without its envelope; the server wraps it as a `BrigadeEvent` (RFC 0005). */
export type DomainEvent<Type extends string = string, Data = unknown> = {
  type: Type;
  subject?: string;
  data: Data;
};

export type MutationErrorCode =
  | "unknown_mutation"
  | "invalid_args"
  | "forbidden"
  | "not_found"
  | "invalid_transition"
  | "conflict"
  | "internal";

export type MutationError = { code: MutationErrorCode; message: string; issues?: Issue[] };

export type MutationResult =
  | { ok: true; events: DomainEvent[] }
  | { ok: false; error: MutationError };

export type MutationStore = Store<BrigadeTables>;

export type MutationDef<Name extends string = string, Args = unknown> = {
  name: Name;
  args: Validator<Args>;
  permission: Permission;
  /** Deterministic and side-effect free: reads and writes only `store`, time only from `ctx.now`. */
  apply(store: MutationStore, args: Args, ctx: MutationContext): MutationResult;
};

// `any` keeps every concrete mutation assignable to a registry entry (args are checked by its validator).
export type AnyMutation = MutationDef<string, any>;
export type ArgsOf<M> = M extends MutationDef<string, infer A> ? A : never;

// Generic over the validator (not its output) so `apply`'s `args` is inferred from `args`.
export function defineMutation<const Name extends string, V extends Validator<any>>(def: {
  name: Name;
  args: V;
  permission: Permission;
  apply(store: MutationStore, args: Infer<V>, ctx: MutationContext): MutationResult;
}): MutationDef<Name, Infer<V>> {
  return def;
}

export const ok = (...events: DomainEvent[]): MutationResult => ({ ok: true, events });
export const fail = (
  code: MutationErrorCode,
  message: string,
  issues?: Issue[],
): MutationResult => ({
  ok: false,
  error: issues ? { code, message, issues } : { code, message },
});

export type Registry<D extends { name: string }> = { readonly [M in D as M["name"]]: M };

/** Indexes definitions by name; a duplicate name is a programming error. */
export function defineRegistry<const D extends readonly { name: string }[]>(
  defs: D,
): Registry<D[number]> {
  const registry: Record<string, D[number]> = {};
  for (const def of defs) {
    if (Object.prototype.hasOwnProperty.call(registry, def.name)) {
      throw new Error(`Duplicate definition ${def.name}`);
    }
    registry[def.name] = def;
  }
  return registry as Registry<D[number]>;
}

class Rollback extends Error {
  constructor(readonly result: MutationResult) {
    super("rollback");
  }
}

/**
 * Checks the actor's permission, validates `rawArgs` and runs the mutation inside `store.transaction`.
 * Nothing is written unless it succeeds. Never throws: unexpected exceptions become an `internal` error whose
 * message reveals nothing about them.
 */
export function runMutation(
  registry: { readonly [name: string]: AnyMutation },
  name: string,
  rawArgs: unknown,
  store: MutationStore,
  ctx: MutationContext,
): MutationResult {
  const def = Object.prototype.hasOwnProperty.call(registry, name) ? registry[name] : undefined;
  if (!def) return fail("unknown_mutation", `Unknown mutation ${name}`);
  if (!isRole(ctx.actor.role) || !can(ctx.actor.role, def.permission)) {
    return fail("forbidden", `Not allowed to run ${name}`);
  }
  const args = def.args(rawArgs);
  if (!args.ok) return fail("invalid_args", `Invalid arguments for ${name}`, args.issues);
  try {
    return store.transaction(() => {
      const result = def.apply(store, args.value, ctx);
      if (!result.ok) throw new Rollback(result);
      return result;
    });
  } catch (error) {
    if (error instanceof Rollback) return error.result;
    return fail("internal", `${name} failed`);
  }
}
