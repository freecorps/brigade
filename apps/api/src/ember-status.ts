// `PUT /workspaces/:id/status-page`'s call into a workspace's shard (RFC 0012, RFC 0016 "Parity"), sent to the engine
// D1's `workspace_engine` names: `WorkspaceDO.configureStatusPage`, or on Ember the same steps as
// `StatusPublisher.configure`, with D1's slug claim and release here in the Worker (a mutation cannot reach D1) around
// `status:current` and `status:configure` (ember/status.ts). The route read D1 already, so the engine is read fresh.

import { allows, statusPageArgs, type Actor } from "@freecorps/brigade-schema";
import { workspaceEngine } from "./ember.ts";
import { emberMutation } from "./ember-workspace.ts";
import { claimSlug, releaseSlug, type StatusConfigureResult } from "./status-page.ts";
import type { SubscriberChange } from "../ember/status.ts";
import { within } from "./deadline.ts";
import type { BrigadeEvent } from "./outbox.ts";
import type { StatusDomainView } from "./status-domain.ts";
import type { StatusEmailPlan, StatusEmailReport } from "./status-mail.ts";
import type { TokenRefused } from "./workspace.ts";

type StatusEnv = Pick<Env, "DB" | "WORKSPACE"> & { SHARD?: Env["SHARD"] };

export type ConfigureStatusPage = (
  workspaceId: string,
  actor: Actor,
  args: unknown,
) => Promise<StatusConfigureResult | { ok: false; code: "not_a_member" } | TokenRefused>;

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

/** `workspaceId`'s `configureStatusPage`, on `WorkspaceDO` or on Ember as D1 says. */
export async function workspaceConfigureStatusPage(
  env: StatusEnv,
  workspaceId: string,
): Promise<ConfigureStatusPage> {
  if (env.SHARD && (await workspaceEngine(env.DB, workspaceId)) === "ember") {
    return emberConfigureStatusPage({ ...env, SHARD: env.SHARD });
  }
  const stub = env.WORKSPACE.getByName(workspaceId);
  return async (...args) => stub.configureStatusPage(...args);
}

/**
 * `StatusPublisher.configure` on a workspace's Ember shard: the shard's checks and the page as it is, the slug claimed
 * in D1 when the page goes public under one it does not hold, `statusPage.configure` on the shard, and a slug that was
 * free and that the shard then refused released again.
 */
export function emberConfigureStatusPage(
  env: StatusEnv & { SHARD: Env["SHARD"] },
): ConfigureStatusPage {
  return async (workspaceId, actor, raw) => {
    const parsed = statusPageArgs(raw);
    const held = await emberMutation<
      | { ok: false; code: "not_found" | "unauthenticated" | "not_a_member" }
      | {
          ok: true;
          acting: Actor;
          page: { slug: string; claimed: boolean; updatedAt: number } | null;
        }
    >(env, workspaceId, "status:current", { workspaceId, actor });
    if (!held.ok) {
      return held.code === "unauthenticated" ? { ok: false, code: "unauthenticated" } : held;
    }
    const { acting, page } = held;
    if (!allows(acting, "status:manage")) return { ok: false, code: "forbidden" };
    if (!parsed.ok) return { ok: false, code: "invalid_args" };
    const args = parsed.value;
    // Claims and retirements must stay ordered even when consecutive saves share a clock tick.
    const configuredAt = Math.max(Date.now(), (page?.updatedAt ?? 0) + 1);
    let claimed: number | null = null;
    // Only a public page claims its slug (Q23): a draft's is kept on the page alone.
    if (args.enabled && !(page?.slug === args.slug && page.claimed)) {
      try {
        const claim = await claimSlug(env.DB, workspaceId, args.slug, configuredAt);
        if (claim.taken) return { ok: false, code: "slug_taken" };
        claimed = claim.claimed;
      } catch (error) {
        log("claiming a status page slug failed", { error });
        return { ok: false, code: "unavailable" };
      }
    }
    let result: { ok: true } | { ok: false; code: string; releasable: boolean };
    try {
      result = await emberMutation(env, workspaceId, "status:configure", {
        workspaceId,
        actor: acting,
        args,
        now: configuredAt,
      });
    } catch (error) {
      // Left with this workspace, as on the DO: the next save with it succeeds.
      log("status page not applied to the shard", { error });
      return { ok: false, code: "not_applied" };
    }
    if (result.ok) return { ok: true };
    if (claimed !== null && result.releasable) {
      await releaseSlug(env.DB, workspaceId, args.slug, claimed, log);
    }
    // Nothing changed: what the caller asked for is what the page already says.
    if (result.code === "conflict") return { ok: true };
    return { ok: false, code: result.code === "forbidden" ? "forbidden" : "invalid_args" };
  };
}

/** The status page's subscriber, follow and email calls, with `WorkspaceDO`'s signatures. */
export type WorkspaceStatus = {
  statusSubscription(
    workspaceId: string,
    change: SubscriberChange,
    actor?: Actor,
  ): Promise<{ ok: true } | { ok: false; code: string }>;
  expireStatusSubscribers(
    workspaceId: string,
    subscriberIds: string[],
  ): Promise<{ ok: true } | { ok: false; code: string }>;
  statusFollowNames(workspaceId: string): Promise<Record<string, string>>;
  planStatusEmail(event: BrigadeEvent): Promise<StatusEmailPlan>;
  recordStatusEmail(
    event: BrigadeEvent,
    key: string,
    report: StatusEmailReport,
  ): Promise<{ retry: boolean }>;
};

/**
 * `workspaceId`'s status page calls, on `WorkspaceDO` or on its Ember shard (ember/status.ts) as D1 says. The engine
 * lookup is bounded (`STATUS_ENGINE_BUDGET_MS`): one that stalls throws, and its caller tries again (the Queue retries
 * the message; a route answers `unavailable`).
 */
export async function workspaceStatus(
  env: Pick<Env, "WORKSPACE"> & { DB?: Env["DB"]; SHARD?: Env["SHARD"] },
  workspaceId: string,
): Promise<WorkspaceStatus> {
  const { DB, SHARD } = env;
  if (
    DB &&
    SHARD &&
    (await within(workspaceEngine(DB, workspaceId), STATUS_ENGINE_BUDGET_MS, "engine lookup")) ===
      "ember"
  ) {
    const shard = { SHARD };
    return {
      statusSubscription: (id, change, actor) =>
        emberMutation(shard, id, "status:subscription", {
          workspaceId: id,
          change,
          ...(actor ? { actor } : {}),
        }),
      expireStatusSubscribers: (id, subscriberIds) =>
        emberMutation(shard, id, "status:expire", { workspaceId: id, subscriberIds }),
      statusFollowNames: (id) =>
        emberMutation(shard, id, "status:followNames", { workspaceId: id }),
      planStatusEmail: (event) =>
        emberMutation(shard, event.workspaceId, "status:planEmail", { event }),
      recordStatusEmail: (event, key, report) =>
        emberMutation(shard, event.workspaceId, "status:recordEmail", { event, key, report }),
    };
  }
  const stub = env.WORKSPACE.getByName(workspaceId);
  return {
    statusSubscription: async (id, change, actor) => stub.statusSubscription(id, change, actor),
    expireStatusSubscribers: async (id, ids) => stub.expireStatusSubscribers(id, ids),
    statusFollowNames: async (id) => stub.statusFollowNames(id),
    planStatusEmail: async (event) => stub.planStatusEmail(event),
    recordStatusEmail: async (event, key, report) => stub.recordStatusEmail(event, key, report),
  };
}

/** How long the engine lookup of a status page call may take (see `workspaceStatus`). */
export const STATUS_ENGINE_BUDGET_MS = 5000;

/** The page's domain calls, with `WorkspaceDO`'s signatures. */
export type WorkspaceDomain = {
  changeStatusDomain(
    workspaceId: string,
    actor: Actor,
    name: "add" | "check" | "remove",
    args: Record<string, unknown>,
  ): Promise<{ ok: true } | { ok: false; code: string } | TokenRefused>;
  statusDomainState(workspaceId: string): Promise<StatusDomainView>;
  releaseStatusDomain(
    workspaceId: string,
    hostname: string,
    cloudflareId: string | null,
    before: number,
  ): Promise<{ ok: true } | { ok: false; code: string }>;
};

/** `workspaceId`'s domain calls, on `WorkspaceDO` or on its Ember shard (ember/status.ts), engine lookup bounded. */
export async function workspaceDomain(
  env: Pick<Env, "WORKSPACE"> & { DB?: Env["DB"]; SHARD?: Env["SHARD"] },
  workspaceId: string,
): Promise<WorkspaceDomain> {
  const { DB, SHARD } = env;
  if (
    DB &&
    SHARD &&
    (await within(workspaceEngine(DB, workspaceId), STATUS_ENGINE_BUDGET_MS, "engine lookup")) ===
      "ember"
  ) {
    const shard = { SHARD };
    return {
      changeStatusDomain: (id, actor, name, args) =>
        emberMutation(shard, id, "status:changeDomain", { workspaceId: id, actor, name, args }),
      statusDomainState: (id) =>
        emberMutation(shard, id, "status:domainState", { workspaceId: id }),
      releaseStatusDomain: (id, hostname, cloudflareId, before) =>
        emberMutation(shard, id, "status:releaseDomain", {
          workspaceId: id,
          hostname,
          cloudflareId,
          before,
        }),
    };
  }
  const stub = env.WORKSPACE.getByName(workspaceId);
  return {
    changeStatusDomain: async (...args) => stub.changeStatusDomain(...args),
    statusDomainState: async (id) => stub.statusDomainState(id),
    releaseStatusDomain: async (...args) => stub.releaseStatusDomain(...args),
  };
}
