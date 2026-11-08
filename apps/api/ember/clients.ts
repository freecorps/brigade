// A client admitted to a workspace's Ember shard (RFC 0004 "Socket topology", RFC 0016 "Clients"): what
// `WorkspaceDO.fetch` does on a sync upgrade, for a client the Worker issues an Ember token to
// (`POST /ember-token/:workspace`, src/ember.ts) and, through it, for the Brigade Sync adapter's sockets. The Worker
// resolved the caller in D1 already; here, in one transaction: an API token the shard no longer backs is refused, a
// member removed within the tombstone is `gone` (the Worker checks D1 and comes back with the member fence, as for a
// phone's registration, ember/devices.ts), their phones from before a password reset come off, and their copy in
// the member list is brought up to date (`member.sync`). A member list that has not agreed with D1 for a while is
// reconciled (`members:repair`), as the DO reconciles on every upgrade, at most once per `MEMBER_STALE_MS`.

import { internalMutationGeneric, v, type MutationCtx } from "@freecorps/ember-server";
import {
  ACCOUNT_ACTOR,
  fitMemberName,
  serverMutations,
  type Actor,
} from "@freecorps/brigade-schema";
import { MEMBER_STALE_MS } from "../src/members.ts";
import { EMBER_MEMBER_REPAIR_DELAY_MS, fenceGen, reconciledDoc } from "./members.ts";
import { emberWorkspace } from "./shard-facade.ts";
import { run, workspaceLimits } from "./workspace.ts";

/** What `admit` answers. */
export type AdmitResult =
  | { ok: true; actor: Actor; tokenExpiresAt: number | null }
  | { ok: false; code: "not_found" | "unauthenticated" | "unavailable" }
  | { ok: false; code: "gone"; gen: number };

/** When an admission last asked for the member repair (`shard_meta`). */
const ADMIT_REPAIR = "admit_repair_at";

const log = (message: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ message, ...fields }));

/**
 * Admits `actor` (as the Worker resolved it) to this shard. `name`: a member's name as D1 holds it (none for an API
 * token); `resetAt`: when their password was last reset; `memberGen`: the member fence `gone` answered, once the
 * Worker found them in D1 after it (their tombstone goes, unless a member change came in since).
 */
export const admit = internalMutationGeneric({
  args: {
    workspaceId: v.string(),
    actor: v.any(),
    name: v.optional(v.string()),
    resetAt: v.optional(v.number()),
    memberGen: v.optional(v.number()),
  },
  handler: (
    ctx,
    input: {
      workspaceId: string;
      actor: Actor;
      name?: string;
      resetAt?: number;
      memberGen?: number;
    },
  ): AdmitResult => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== input.workspaceId) return { ok: false, code: "not_found" };
    const acting = shard.tokenActor(input.actor, c.now);
    if (!acting) return { ok: false, code: "unauthenticated" };
    const memberId = acting.by ?? acting.id;
    if (shard.gone(memberId, c.now)) {
      const gen = fenceGen(c.db);
      if (input.memberGen !== gen) return { ok: false, code: "gone", gen };
      c.sql.exec("delete from member_gone where user_id = ?", memberId);
    }
    const store = shard.store;
    const exec = (name: string, args: unknown, as: Actor) =>
      run(c, serverMutations, name, args, () => as, workspaceLimits(), store);
    // Their phones from before a password reset, left behind when the reset's own sign-out failed here.
    if (
      input.name !== undefined &&
      input.resetAt !== undefined &&
      store
        .scan("devices")
        .some((device) => device.userId === acting.id && device.updatedAt < input.resetAt!)
    ) {
      const out = exec(
        "device.signOut",
        { userId: acting.id, before: input.resetAt },
        ACCOUNT_ACTOR,
      );
      shard.check();
      if (!out.ok && out.error.code !== "conflict") {
        // As a phone's registration does (ember/devices.ts): the reconcile signs them out later.
        c.scheduler.runAfter(EMBER_MEMBER_REPAIR_DELAY_MS, "members:repair", {
          workspaceId: input.workspaceId,
        });
        return { ok: false, code: "unavailable" };
      }
    }
    // Their copy in the member list, so roles can point at them and the dashboard can show their name.
    if (input.name !== undefined) {
      const name = fitMemberName(input.name);
      const current = store.get("members", acting.id);
      if (!current || current.name !== name || current.role !== acting.role) {
        const out = exec("member.sync", { id: acting.id, name, role: acting.role }, acting);
        shard.check();
        // A cache of D1: logged, and the client is admitted all the same (its next admission tries again).
        if (!out.ok) log("copying a member to the shard failed", { code: out.error.code });
      }
    }
    // The DO reconciles the member list with D1 on every upgrade; here at most once per `MEMBER_STALE_MS`.
    const reconciled = reconciledDoc(c.db)?.n ?? null;
    if (reconciled === null || c.now - reconciled > MEMBER_STALE_MS) {
      // One repair for a burst of admissions, not one each.
      const [asked] = c.sql.exec("select value from shard_meta where key = ?", ADMIT_REPAIR) as {
        value: number;
      }[];
      if (!asked || c.now - asked.value > MEMBER_STALE_MS) {
        c.sql.exec(
          "insert into shard_meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value",
          ADMIT_REPAIR,
          c.now,
        );
        c.scheduler.runAfter(0, "members:repair", { workspaceId: input.workspaceId });
      }
    }
    const tokenExpiresAt =
      acting.kind === "token" ? (store.get("api_tokens", acting.id)?.expiresAt ?? null) : null;
    return { ok: true, actor: acting, tokenExpiresAt };
  },
});
