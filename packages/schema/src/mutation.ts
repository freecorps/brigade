// Named mutations (RFC 0004 "Shared core"): the same `apply` runs optimistically on clients and
// authoritatively, with RBAC, in the server's Durable Object.

import { can, isRole, type Permission, type Role } from "./access.ts";
import type { Store } from "./store.ts";
import type { BrigadeTables } from "./tables.ts";
import { clip } from "./text.ts";
import { MAX_ISSUES, type Infer, type Issue, type Validator } from "./validate.ts";

export type Actor = { kind: "user" | "system" | "integration"; id: string; role: Role };

export type MutationContext = {
  actor: Actor;
  /**
   * The clock, injected: epoch milliseconds, a safe non-negative integer. On the server it is the time the shard
   * ran the mutation; a client keeps the time of the first optimistic run for every re-apply.
   */
  now: number;
  /**
   * True only in the authoritative run. Server-only work (allocating `INC-n`, checking id clocks) happens only
   * then; clients leave those fields empty until the server's patch arrives.
   */
  server: boolean;
};

/** A domain event without its envelope; the server wraps it as a `BrigadeEvent` (RFC 0005). */
export type DomainEvent<Type extends string = string, Data = unknown> = {
  type: Type;
  subject?: string;
  data: Data;
};

/**
 * `conflict` means a well-formed request cannot apply to the current state: the id already exists, or the
 * target value already holds (no change — for status and severity alike). `limit_reached`: it would go over a
 * per-member or per-workspace cap (a member's devices, a workspace's monitors), so the caller can tell "nothing
 * to do" from "not done".
 */
export type MutationErrorCode =
  | "unknown_mutation"
  | "invalid_args"
  | "forbidden"
  | "not_found"
  | "invalid_transition"
  | "conflict"
  | "limit_reached"
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
  /**
   * May succeed without events. Only for a write that refreshes observed values (a monitor's latency, colo and
   * check time) and is no domain event: it is synced like any change but writes nothing to the outbox (RFC 0005).
   */
  silent?: boolean;
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
  silent?: boolean;
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
  error: issues ? { code, message, issues: issues.slice(0, MAX_ISSUES) } : { code, message },
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

/** Finds `name` among the registry's own entries (never `toString`, `__proto__`, …, nor a non-string). */
export function lookup<D>(registry: { readonly [name: string]: D }, name: unknown): D | undefined {
  if (typeof name !== "string") return undefined;
  return Object.prototype.hasOwnProperty.call(registry, name) ? registry[name] : undefined;
}

/** Calls the optional error hook; a failing hook must not turn a typed result into an exception. */
export function report(
  options: { onError?(error: unknown, name: string): void },
  error: unknown,
  name: string,
): void {
  try {
    options.onError?.(error, name);
  } catch {
    // Ignored on purpose (see above).
  }
}

export type RunMutationOptions = {
  /**
   * Runs inside the mutation's transaction after `apply` succeeds, with its events: the server writes them to
   * the outbox here (RFC 0005). If it throws, every write rolls back and the result is `internal`.
   */
  commit?(events: DomainEvent[]): void;
  /** Receives the cause of an `internal` error, for server logs; the result never carries it. */
  onError?(error: unknown, name: string): void;
};

class Rollback extends Error {
  readonly result: MutationResult;
  constructor(result: MutationResult) {
    super("rollback");
    this.result = result;
  }
}

/**
 * Checks the actor's permission, validates `rawArgs` and runs the mutation (and `options.commit`) inside
 * `store.transaction`. Nothing is written unless everything succeeds. Never throws: unexpected exceptions
 * become an `internal` error whose message reveals nothing about them.
 */
export function runMutation(
  registry: { readonly [name: string]: AnyMutation },
  name: unknown,
  rawArgs: unknown,
  store: MutationStore,
  ctx: MutationContext,
  options: RunMutationOptions = {},
): MutationResult {
  // `name` comes off the wire: a non-string is just an unknown mutation.
  const def = lookup(registry, name);
  if (!def) return fail("unknown_mutation", `Unknown mutation ${clip(name)}`);
  try {
    if (!Number.isSafeInteger(ctx.now) || ctx.now < 0) {
      throw new RangeError("ctx.now must be a safe non-negative integer");
    }
    if (!isRole(ctx.actor.role) || !can(ctx.actor.role, def.permission)) {
      return fail("forbidden", `Not allowed to run ${def.name}`);
    }
    // Validators only read `rawArgs`, but a hostile value (a proxy, a throwing getter) must not escape either.
    const args = def.args(rawArgs);
    if (!args.ok) return fail("invalid_args", `Invalid arguments for ${def.name}`, args.issues);
    return store.transaction(() => {
      const result = def.apply(store, args.value, ctx);
      if (!result.ok) throw new Rollback(result);
      // Every successful mutation emits an event (RFC 0005); a silent success is a bug in the mutation, unless it
      // is declared `silent`.
      if (!Array.isArray(result.events) || (result.events.length === 0 && !def.silent)) {
        throw new Error(`${def.name} succeeded without events`);
      }
      options.commit?.(result.events);
      return result;
    });
  } catch (error) {
    if (error instanceof Rollback) return error.result;
    report(options, error, def.name);
    return fail("internal", `${def.name} failed`);
  }
}
