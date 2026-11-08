// The public status page on a workspace's Ember shard (RFC 0012, RFC 0016 "Parity"): `WorkspaceDO.configureStatusPage`
// and the alarm's snapshot push and maintenance windows. The page's settings run on the shard as on the DO; D1's slug
// claim and release run in the Worker (src/ember-status.ts), around `current` and `configure`. The snapshot push is
// the `status` tick (ember/ticks.ts), an action since it writes KV and D1: `plan` builds what is due with the DO's
// `StatusPublisher` (`planPush`), the action does it, and `record` writes what it did (`recordPush`) and arms the next
// one. Every mutation that puts the snapshot out of date arms it (`run()`'s `markStatus`), as the DO's alarm.
// Maintenance windows that start or end are moved on by the `maintenance` tick (`maintenance.advance`).

import {
  internalActionGeneric,
  internalMutationGeneric,
  makeFunctionReference,
  v,
  type MutationCtx,
} from "@freecorps/ember-server";
import {
  ACCOUNT_ACTOR,
  nextMaintenanceAt,
  statusFollowKey,
  STATUS_DOMAIN_ID,
  STATUS_PAGE_ID,
  type Actor,
  type StatusDomainRow,
} from "@freecorps/brigade-schema";
import { saasConfig, type SaasConfig, type SaasEnv } from "../src/status-domain-cf.ts";
import {
  DOMAIN_RECHECK_MIN_MS,
  DomainChecker,
  probeDomain,
  type DomainProbe,
} from "../src/status-domain-check.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import type { StatusDomainView } from "../src/status-domain.ts";
import { StatusMailer, type StatusEmailPlan, type StatusEmailReport } from "../src/status-mail.ts";
import { DeadlineError, within } from "../src/deadline.ts";
import { StatusPublisher, type StatusPushDone, type StatusPushPlan } from "../src/status-page.ts";
import { emberWorkspace, type EmberShard } from "./shard-facade.ts";
import { holdTicks, tickAt } from "./ticks.ts";

const PLAN = makeFunctionReference<"mutation">("status:plan");
const RECORD = makeFunctionReference<"mutation">("status:record");

/** How long one KV or D1 call of a push may take before the push is given up on (and its page marked to go again). */
export const STATUS_CALL_MS = 30 * 1000;

const log = (message: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ message, ...fields }));

/**
 * A `StatusPublisher` over this mutation's shard facade. `kv`: whether the Worker has the snapshots' namespace (the
 * action says; a mutation that only arms the tick assumes it does). It never waits on KV or D1 itself.
 */
function publisherOf(ctx: MutationCtx, shard: EmberShard, kv = true): StatusPublisher {
  const { storage } = emberWorkspace(ctx);
  return new StatusPublisher({
    shard: shard as never,
    sql: storage.sql,
    kv: kv ? ({} as KVNamespace) : undefined,
    db: undefined as never,
    randomBytes: (n) => {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = Math.floor(ctx.random() * 256);
      return bytes;
    },
    log,
    committed: () => {},
    wake: (at) => tickAt(ctx, at, "status"),
  });
}

type Refused = { ok: false; code: "not_found" | "unauthenticated" | "not_a_member" };

/**
 * The DO's checks before a page change, and what D1's claim needs: the shard holds the workspace, backs the API token
 * (`acting`, its role possibly lowered), the member is not removed within the tombstone; then the page as it is.
 */
export const current = internalMutationGeneric({
  args: { workspaceId: v.string(), actor: v.any() },
  handler: (
    ctx,
    input: { workspaceId: string; actor: Actor },
  ):
    | Refused
    | {
        ok: true;
        acting: Actor;
        page: { slug: string; claimed: boolean; updatedAt: number } | null;
      } => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== input.workspaceId) return { ok: false, code: "not_found" };
    const acting = shard.tokenActor(input.actor, c.now);
    if (!acting) return { ok: false, code: "unauthenticated" };
    if (shard.gone(acting.by ?? acting.id, c.now)) return { ok: false, code: "not_a_member" };
    const page = shard.store.get("status_page", STATUS_PAGE_ID);
    return {
      ok: true,
      acting,
      page: page
        ? { slug: page.slug, claimed: page.claimed !== false, updatedAt: page.updatedAt }
        : null,
    };
  },
});

/**
 * `statusPage.configure` as `actor`, at `now` or later (after the page's last save, so claims and retirements stay
 * ordered), as `StatusPublisher.configure` runs it once D1's claim is done. `releasable`: whether a slug just claimed
 * may go back to D1 when it was refused (the page does not use it, nor still retires it).
 */
export const configure = internalMutationGeneric({
  args: { workspaceId: v.string(), actor: v.any(), args: v.any(), now: v.number() },
  handler: (
    ctx,
    input: { workspaceId: string; actor: Actor; args: { slug: string }; now: number },
  ): { ok: true } | { ok: false; code: string; releasable: boolean } => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== input.workspaceId) {
      return { ok: false, code: "not_found", releasable: true };
    }
    const now = Math.max(
      c.now,
      input.now,
      (shard.store.get("status_page", STATUS_PAGE_ID)?.updatedAt ?? 0) + 1,
    );
    const { result } = shard.mutate({
      clientId: "api",
      mutationId: `status:${now}:${Math.floor(c.random() * 2 ** 32)}`,
      actor: input.actor,
      name: "statusPage.configure",
      args: input.args,
      now,
      internal: true,
    });
    if (result.ok) return { ok: true };
    return {
      ok: false,
      code: result.error.code,
      releasable: publisherOf(c, shard).releasable(input.args.slug),
    };
  },
});

/** What the push is to do now (`StatusPublisher.planPush`), or null, with the next push armed for when it is due. */
export const plan = internalMutationGeneric({
  args: { kv: v.boolean() },
  handler: (
    ctx,
    input: { kv: boolean },
  ): { workspaceId: string; plan: StatusPushPlan; now: number } | null => {
    const c = ctx as MutationCtx;
    holdTicks(c);
    const { shard } = emberWorkspace(c);
    const workspaceId = shard.workspace();
    if (workspaceId === undefined) return null;
    c.sql.exec("delete from ember_ticks where key = 'status'");
    const publisher = publisherOf(c, shard, input.kv);
    const due = publisher.planPush(workspaceId, c.now);
    if (due === null) {
      const at = publisher.nextAt(c.now);
      if (at !== null) tickAt(c, at, "status");
    }
    // A fallback while a push is under way: an action that dies before `record` never ends the chain (its page stays
    // dirty, so the fallback's plan pushes it again).
    else tickAt(c, c.now + STATUS_CALL_MS * 4, "status");
    shard.check();
    return due === null ? null : { workspaceId, plan: due, now: c.now };
  },
});

/**
 * What the push did (`StatusPublisher.recordPush`; `late`: a call outlasted `STATUS_CALL_MS` and may land after a
 * newer push, so the page goes again), then the next push armed.
 */
export const record = internalMutationGeneric({
  args: { kv: v.boolean(), plan: v.any(), done: v.any(), now: v.number(), late: v.boolean() },
  handler: (
    ctx,
    input: { kv: boolean; plan: StatusPushPlan; done: StatusPushDone; now: number; late: boolean },
  ): null => {
    const c = ctx as MutationCtx;
    holdTicks(c);
    const { shard } = emberWorkspace(c);
    if (shard.workspace() === undefined) return null;
    const publisher = publisherOf(c, shard, input.kv);
    publisher.recordPush(input.plan, input.done, input.now);
    if (input.late) publisher.markRepush(c.now);
    const at = publisher.nextAt(c.now);
    if (at !== null) tickAt(c, at, "status");
    shard.check();
    return null;
  },
});

type PushEnv = { STATUS?: KVNamespace; DB: D1Database };
type ActionCtx = { env: PushEnv; runMutation(ref: unknown, args: unknown): Promise<unknown> };

/**
 * The snapshot push (the DO's `StatusPublisher.publish`): the page's snapshot put (or deleted) in KV, each retired
 * slug's snapshot deleted, and the slugs past their grace released in D1, in order, stopping at the first failure,
 * then recorded. A call that outlasts `STATUS_CALL_MS` counts as failed, and the page is pushed again after it.
 */
export const push = internalActionGeneric({
  args: {},
  handler: async (ctx): Promise<{ pushed: boolean }> => {
    const c = ctx as unknown as ActionCtx;
    const kv = c.env.STATUS;
    const due = (await c.runMutation(PLAN, { kv: kv !== undefined })) as {
      workspaceId: string;
      plan: StatusPushPlan;
      now: number;
    } | null;
    if (!due) return { pushed: false };
    const done: StatusPushDone = { page: false, cleared: [], released: [] };
    let late = false;
    const call = async <T>(p: Promise<T>, what: string): Promise<T> => {
      try {
        return await within(p, STATUS_CALL_MS, what);
      } catch (error) {
        if (error instanceof DeadlineError) late = true;
        throw error;
      }
    };
    try {
      const { page, retired } = due.plan;
      if (page && kv) {
        await (page.put !== undefined
          ? call(kv.put(page.key, page.put), "status snapshot put")
          : call(kv.delete(page.key), "status snapshot delete"));
        done.page = true;
      }
      for (const one of retired) {
        if (one.op === "kv_delete") {
          if (!kv) continue;
          await call(kv.delete(`status:${one.id}`), "retired status snapshot delete");
          done.cleared.push(one.id);
        } else {
          // Only a row stamped before it was given up: one stamped later is a claim made since.
          await call(
            c.env.DB.prepare(
              "delete from status_slug where slug = ? and workspace_id = ? and created_at < ?",
            )
              .bind(one.id, due.workspaceId, one.at)
              .run(),
            "status slug release",
          );
          done.released.push(one.id);
        }
      }
    } catch (error) {
      done.error = String(error);
    }
    await c.runMutation(RECORD, { kv: kv !== undefined, plan: due.plan, done, now: due.now, late });
    return { pushed: done.page };
  },
});

/** Moves on every maintenance window whose start or end passed (`maintenance.advance`), then arms the next one. */
export const maintenance = internalMutationGeneric({
  args: {},
  handler: (ctx): { advanced: number } => {
    const c = ctx as MutationCtx;
    holdTicks(c);
    const { shard } = emberWorkspace(c);
    if (shard.workspace() === undefined) return { advanced: 0 };
    c.sql.exec("delete from ember_ticks where key = 'maintenance'");
    let advanced = 0;
    for (const row of shard.store.scan("status_maintenance")) {
      const at =
        row.phase === "scheduled" ? row.startsAt : row.phase === "in_progress" ? row.endsAt : null;
      if (at === null || at > c.now) continue;
      const { result } = shard.mutate({
        clientId: "api",
        mutationId: `maintenance:${row.id}:${row.phase}`,
        actor: ACCOUNT_ACTOR,
        name: "maintenance.advance",
        args: { id: row.id },
        now: c.now,
        internal: true,
      });
      if (result.ok) advanced++;
      else if (result.error.code !== "conflict") {
        log("moving a maintenance window on failed", { id: row.id, code: result.error.code });
      }
    }
    const next = nextMaintenanceAt(shard.store.scan("status_maintenance"));
    // One that could not move on is tried again a minute later, not in a loop (the DO's alarm tick).
    if (next !== null) tickAt(c, next <= c.now ? c.now + 60 * 1000 : next, "maintenance");
    shard.check();
    return { advanced };
  },
});

/** A `StatusMailer` over this mutation's shard facade (`statusEmail.continue` run as the account, as on the DO). */
function mailerOf(ctx: MutationCtx, shard: EmberShard): StatusMailer {
  const { storage } = emberWorkspace(ctx);
  return new StatusMailer({
    shard: shard as never,
    sql: storage.sql,
    log,
    carryOn: (eventId) => {
      const { result } = shard.mutate({
        clientId: "api",
        mutationId: `continue:${eventId}:${ctx.now}`,
        actor: ACCOUNT_ACTOR,
        name: "statusEmail.continue",
        args: { eventId },
        now: ctx.now,
        internal: true,
      });
      if (!result.ok && result.error.code !== "conflict") {
        throw new Error(`statusEmail.continue refused: ${result.error.code}`);
      }
    },
  });
}

export type SubscriberChange =
  | { action: "request"; subscriberId: string; send: number }
  | { action: "confirm"; subscriberId: string }
  | { action: "follow"; subscriberId: string; follows: number }
  | { action: "remove"; subscriberId: string; reason: "unsubscribed" | "deleted" | "expired" };

/** `WorkspaceDO.statusSubscription`, inside one mutation: a confirmation and a removal are recorded once. */
function subscriptionChange(
  c: MutationCtx,
  shard: EmberShard,
  mailer: StatusMailer,
  change: SubscriberChange,
  actor: Actor,
): { ok: true } | { ok: false; code: string } {
  const once =
    change.action === "request" || change.action === "follow"
      ? null
      : `${change.action}:${change.subscriberId}`;
  if (once !== null && mailer.seen(once)) return { ok: true };
  const { action, ...args } = change;
  const { result } = shard.mutate({
    clientId: "status-subscribers",
    mutationId: `${action}:${change.subscriberId}:${c.now}:${Math.floor(c.random() * 2 ** 32)}`,
    actor,
    name: `statusSubscriber.${action}`,
    args,
    now: c.now,
    internal: true,
  });
  if (!result.ok) return { ok: false, code: result.error.code };
  if (once !== null) mailer.remember(once, c.now);
  return { ok: true };
}

/**
 * A change to a status page subscription after the subscriber's row changed in D1 (`WorkspaceDO.statusSubscription`):
 * its event, with the subscriber's id and never the address. A visitor's change runs as `ACCOUNT_ACTOR`.
 */
export const subscription = internalMutationGeneric({
  args: { workspaceId: v.string(), change: v.any(), actor: v.optional(v.any()) },
  handler: (
    ctx,
    input: { workspaceId: string; change: SubscriberChange; actor?: Actor },
  ): { ok: true } | { ok: false; code: string } => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== input.workspaceId) return { ok: false, code: "not_found" };
    const out = subscriptionChange(
      c,
      shard,
      mailerOf(c, shard),
      input.change,
      input.actor ?? ACCOUNT_ACTOR,
    );
    shard.check();
    return out;
  },
});

/** Pending subscribers whose confirmation link expired (`WorkspaceDO.expireStatusSubscribers`): removed, `expired`. */
export const expire = internalMutationGeneric({
  args: { workspaceId: v.string(), subscriberIds: v.array(v.string()) },
  handler: (
    ctx,
    input: { workspaceId: string; subscriberIds: string[] },
  ): { ok: true } | { ok: false; code: string } => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== input.workspaceId) return { ok: false, code: "not_found" };
    const mailer = mailerOf(c, shard);
    for (const subscriberId of input.subscriberIds) {
      const out = subscriptionChange(
        c,
        shard,
        mailer,
        { action: "remove", subscriberId, reason: "expired" },
        ACCOUNT_ACTOR,
      );
      // As on the DO: the first refusal stops the sweep, and what came before it stays done.
      if (!out.ok) {
        shard.check();
        return out;
      }
    }
    shard.check();
    return { ok: true };
  },
});

/** What each follow key of the page stands for now (`WorkspaceDO.statusFollowNames`). */
export const followNames = internalMutationGeneric({
  args: { workspaceId: v.string() },
  handler: (ctx, input: { workspaceId: string }): Record<string, string> => {
    const { shard } = emberWorkspace(ctx as MutationCtx);
    if (shard.workspace() !== input.workspaceId) return {};
    const names: Record<string, string> = {};
    for (const component of shard.store.scan("status_components")) {
      names[statusFollowKey("c", component.id)] = component.name;
      if (component.group !== null) {
        names[statusFollowKey("g", component.group)] = `group: ${component.group}`;
      }
    }
    return names;
  },
});

/** What a status page email event asks for (`WorkspaceDO.planStatusEmail`). */
export const planEmail = internalMutationGeneric({
  args: { event: v.any() },
  handler: (ctx, { event }: { event: BrigadeEvent }): StatusEmailPlan => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== event.workspaceId) return { send: false, reason: "nothing" };
    const out = mailerOf(c, shard).plan(event, c.now);
    shard.check();
    return out;
  },
});

/** What a batch of status page emails did (`WorkspaceDO.recordStatusEmail`). */
export const recordEmail = internalMutationGeneric({
  args: { event: v.any(), key: v.string(), report: v.any() },
  handler: (
    ctx,
    input: { event: BrigadeEvent; key: string; report: StatusEmailReport },
  ): { retry: boolean } => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== input.event.workspaceId) return { retry: false };
    const out = mailerOf(c, shard).record(input.key, input.report, c.now);
    shard.check();
    return out;
  },
});

/** A `DomainChecker` over this mutation's shard facade; `config` says whether the Worker has Cloudflare for SaaS. */
function checkerOf(ctx: MutationCtx, shard: EmberShard, config: boolean): DomainChecker {
  const { storage } = emberWorkspace(ctx);
  return new DomainChecker({
    shard: shard as never,
    sql: storage.sql,
    config: () => (config ? ({} as SaasConfig) : undefined),
    limiter: () => undefined,
    check: (args) => {
      const { result } = shard.mutate({
        clientId: "status-domain",
        mutationId: `check:${ctx.now}:${Math.floor(ctx.random() * 2 ** 32)}`,
        actor: ACCOUNT_ACTOR,
        name: "statusDomain.check",
        args,
        now: ctx.now,
        internal: true,
      });
      if (!result.ok) throw new Error(`statusDomain.check refused: ${result.error.code}`);
    },
    log,
  });
}

/** The page's domain and where it sends visitors (`WorkspaceDO.statusDomainState`). */
export const domainState = internalMutationGeneric({
  args: { workspaceId: v.string() },
  handler: (ctx, input: { workspaceId: string }): StatusDomainView => {
    const { shard } = emberWorkspace(ctx as MutationCtx);
    if (shard.workspace() !== input.workspaceId) return { domain: null, page: null };
    const page = shard.store.get("status_page", STATUS_PAGE_ID);
    return {
      domain: shard.store.get("status_domain", STATUS_DOMAIN_ID) ?? null,
      page: page ? { slug: page.slug, public: page.enabled && page.claimed !== false } : null,
    };
  },
});

/**
 * A change to the page's own domain as the member (`WorkspaceDO.changeStatusDomain`), once the route checked the role
 * in D1 and Cloudflare (or the edge) answered. It starts the domain's checks afresh.
 */
export const changeDomain = internalMutationGeneric({
  args: { workspaceId: v.string(), actor: v.any(), name: v.string(), args: v.any() },
  handler: (
    ctx,
    input: { workspaceId: string; actor: Actor; name: string; args: Record<string, unknown> },
  ): { ok: true } | { ok: false; code: string } => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== input.workspaceId) return { ok: false, code: "not_found" };
    if (!["add", "check", "remove"].includes(input.name))
      return { ok: false, code: "invalid_args" };
    const acting = shard.tokenActor(input.actor, c.now);
    if (!acting) return { ok: false, code: "unauthenticated" };
    if (shard.gone(acting.by ?? acting.id, c.now)) return { ok: false, code: "not_a_member" };
    const { result } = shard.mutate({
      clientId: "status-domain",
      mutationId: `${input.name}:${c.now}:${Math.floor(c.random() * 2 ** 32)}`,
      actor: acting,
      name: `statusDomain.${input.name}`,
      args: input.args,
      now: c.now,
      internal: true,
    });
    if (!result.ok) return { ok: false, code: result.error.code };
    checkerOf(c, shard, true).reset();
    shard.check();
    return { ok: true };
  },
});

/** Gives up the page's domain to another workspace's takeover (`WorkspaceDO.releaseStatusDomain`). */
export const releaseDomain = internalMutationGeneric({
  args: {
    workspaceId: v.string(),
    hostname: v.string(),
    cloudflareId: v.union(v.string(), v.null()),
    before: v.number(),
  },
  handler: (
    ctx,
    input: { workspaceId: string; hostname: string; cloudflareId: string | null; before: number },
  ): { ok: true } | { ok: false; code: string } => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== input.workspaceId) return { ok: false, code: "not_found" };
    const { result } = shard.mutate({
      clientId: "status-domain",
      mutationId: `release:${c.now}:${Math.floor(c.random() * 2 ** 32)}`,
      actor: ACCOUNT_ACTOR,
      name: "statusDomain.release",
      args: { hostname: input.hostname, cloudflareId: input.cloudflareId, before: input.before },
      now: c.now,
      internal: true,
    });
    if (!result.ok) return { ok: false, code: result.error.code };
    checkerOf(c, shard, true).reset();
    shard.check();
    return { ok: true };
  },
});

/** Arms the domain tick for its next check (`DomainChecker.nextAt`), if there is one. */
function armDomain(c: MutationCtx, checker: DomainChecker): void {
  const at = checker.nextAt(c.now);
  if (at !== null) tickAt(c, at, "domain");
}

/**
 * The domain, when it is due its check now (`DomainChecker.due`), with a fallback tick should the action die before
 * `domainSettle`; else null, with the tick armed for when it is due.
 */
export const domainDue = internalMutationGeneric({
  args: { config: v.boolean() },
  handler: (
    ctx,
    input: { config: boolean },
  ): { workspaceId: string; row: StatusDomainRow } | null => {
    const c = ctx as MutationCtx;
    holdTicks(c);
    const { shard } = emberWorkspace(c);
    const workspaceId = shard.workspace();
    if (workspaceId === undefined) return null;
    c.sql.exec("delete from ember_ticks where key = 'domain'");
    const checker = checkerOf(c, shard, input.config);
    const row = checker.due(c.now);
    if (row) tickAt(c, c.now + DOMAIN_RECHECK_MIN_MS, "domain");
    else armDomain(c, checker);
    return row ? { workspaceId, row } : null;
  },
});

/** What the domain's check found (`DomainChecker.settle`; a refused check backs off), then the next one armed. */
export const domainSettle = internalMutationGeneric({
  args: { config: v.boolean(), row: v.any(), probed: v.any() },
  handler: (ctx, input: { config: boolean; row: StatusDomainRow; probed: DomainProbe }): null => {
    const c = ctx as MutationCtx;
    holdTicks(c);
    const { shard } = emberWorkspace(c);
    if (shard.workspace() === undefined) return null;
    const checker = checkerOf(c, shard, input.config);
    try {
      checker.settle(input.row, input.probed, c.now);
    } catch (error) {
      // A refused check (the facade rethrows a storage failure, which fails this whole mutation instead).
      shard.check();
      checker.failedAttempt(c.now, String(error));
    }
    armDomain(c, checker);
    shard.check();
    return null;
  },
});

const DOMAIN_DUE = makeFunctionReference<"mutation">("status:domainDue");
const DOMAIN_SETTLE = makeFunctionReference<"mutation">("status:domainSettle");

type DomainEnv = SaasEnv & { STATUS_DOMAIN_LIMIT?: RateLimit };

/**
 * The domain's own check (the DO's `DomainChecker.run`): due, the workspace's `STATUS_DOMAIN_LIMIT` (failing open),
 * Cloudflare or the edge asked, then what it found recorded.
 */
export const domainCheck = internalActionGeneric({
  args: {},
  handler: async (ctx): Promise<{ checked: boolean }> => {
    const c = ctx as unknown as {
      env: DomainEnv;
      runMutation(ref: unknown, args: unknown): Promise<unknown>;
    };
    const config = saasConfig(c.env);
    const due = (await c.runMutation(DOMAIN_DUE, { config: config !== undefined })) as {
      workspaceId: string;
      row: StatusDomainRow;
    } | null;
    if (!due) return { checked: false };
    let allowed = true;
    try {
      const limiter = c.env.STATUS_DOMAIN_LIMIT;
      if (limiter) allowed = (await limiter.limit({ key: due.workspaceId })).success;
    } catch (error) {
      log("the status domain limit failed", { error: String(error) });
    }
    const probed: DomainProbe = allowed
      ? await probeDomain(due.row, config, (request) => fetch(request))
      : { kind: "failed", why: "rate limited" };
    await c.runMutation(DOMAIN_SETTLE, { config: config !== undefined, row: due.row, probed });
    return { checked: probed.kind !== "failed" };
  },
});
