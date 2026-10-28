// Escalation policies (RFC 0003 "Escalation policies"): ordered levels, each paging schedules (whoever is on call
// when it fires) or members, with a timeout before the next level, repeated when nobody acknowledges. The default
// policy is what pages use (RFC 0006 "Who is paged"), unless the monitor that opened the incident names its own;
// how a run walks a policy is in escalation.ts.

import { dropPolicyFromCatalog } from "./catalog.ts";
import { idTime } from "./id.ts";
import { ID_CLOCK_SKEW_MS } from "./incidents.ts";
import { dropPolicyFromMonitors } from "./monitors.ts";
import { dropPolicyFromRoutes, incidentRoute } from "./alert-sources.ts";
import { SEVERITIES, type Severity } from "./lifecycle.ts";
import {
  defineMutation,
  fail,
  ok,
  type DomainEvent,
  type MutationContext,
  type MutationResult,
  type MutationStore,
} from "./mutation.ts";
import { defineQuery } from "./query.ts";
import type { EscalationLevel, EscalationPolicyRow, EscalationTarget } from "./tables.ts";
import { v, type Issue } from "./validate.ts";

export const ESCALATION_TARGET_KINDS = ["schedule", "member"] as const;
export type EscalationTargetKind = (typeof ESCALATION_TARGET_KINDS)[number];

export const POLICY_NAME_MAX = 80;
export const MAX_POLICIES_PER_WORKSPACE = 50;
export const MAX_POLICY_LEVELS = 10;
export const MAX_LEVEL_TARGETS = 10;
/** A level's timeout, in minutes: from one minute to a day. */
export const MIN_LEVEL_TIMEOUT = 1;
export const MAX_LEVEL_TIMEOUT = 1440;
/** How many more times the levels run when nobody acknowledges. */
export const MAX_POLICY_REPEAT = 9;

type PolicySummary = {
  id: string;
  name: string;
  levels: number;
  repeat: number;
  isDefault: boolean;
  /** From which severity it escalates; null: every severity. */
  minSeverity: Severity | null;
};
export type EscalationPolicyCreated = DomainEvent<"escalation_policy.created", PolicySummary>;
/**
 * `default_changed`: another policy became the default and took the flag from this one. `member_removed` and
 * `schedule_deleted`: a target went away and was taken out of every level (`userId` or `scheduleId`).
 */
export type EscalationPolicyUpdated = DomainEvent<
  "escalation_policy.updated",
  PolicySummary & {
    reason: "edited" | "default_changed" | "member_removed" | "schedule_deleted";
    userId: string | null;
    scheduleId: string | null;
  }
>;
export type EscalationPolicyDeleted = DomainEvent<
  "escalation_policy.deleted",
  { id: string; wasDefault: boolean }
>;

const summary = (row: EscalationPolicyRow): PolicySummary => ({
  id: row.id,
  name: row.name,
  levels: row.levels.length,
  repeat: row.repeat,
  isDefault: row.isDefault,
  minSeverity: row.minSeverity ?? null,
});

/**
 * Whether a run of `policy` for an incident at `severity` escalates (RFC 0006 "Who is paged"): at or above the policy's
 * `minSeverity`, or always when it has none. Below it the run pages its first level that reaches someone, once.
 */
export function escalatesAt(
  policy: Pick<EscalationPolicyRow, "minSeverity">,
  severity: Severity,
): boolean {
  const min = policy.minSeverity;
  return min == null || SEVERITIES.indexOf(severity) <= SEVERITIES.indexOf(min);
}

const updated = (
  row: EscalationPolicyRow,
  reason: EscalationPolicyUpdated["data"]["reason"],
  ref: { userId?: string; scheduleId?: string } = {},
): EscalationPolicyUpdated => ({
  type: "escalation_policy.updated",
  subject: row.id,
  data: {
    ...summary(row),
    reason,
    userId: ref.userId ?? null,
    scheduleId: ref.scheduleId ?? null,
  },
});

/** The workspace's default policy, if it has one: what every page uses (RFC 0006 "Who is paged"). */
export function defaultPolicy(store: MutationStore): EscalationPolicyRow | undefined {
  return store.scan("escalation_policies").find((row) => row.isDefault);
}

/**
 * The policy a run on `incidentId` follows (RFC 0003 "Escalation policies", "Incident types", "Service catalog", RFC
 * 0006 "Who is paged"): the policy whoever declared it picked (`picked`), else the policy of the alert route an alert source opened the incident through when it names one
 * (`route` says which, by its name then), else the policy of the incident's type, else the policy of the first of its
 * services, in the order they were picked, that names one (`service`, by its name now), else the policy of the monitor
 * that opened the incident (`monitor`, by its name now), otherwise the default; undefined with none (the interim rule
 * pages). A picked policy, route, type, service or monitor deleted since, or a policy gone, falls through to the next.
 */
export function incidentPolicy(
  store: MutationStore,
  incidentId: string,
):
  | {
      policy: EscalationPolicyRow;
      monitor: { id: string; name: string } | null;
      route?: { id: string; name: string } | null;
      service?: { id: string; name: string } | null;
      picked?: boolean;
    }
  | undefined {
  const incident = store.get("incidents", incidentId);
  const pickedId = incident?.escalationPolicyId;
  const picked = pickedId ? store.get("escalation_policies", pickedId) : undefined;
  if (picked) return { policy: picked, monitor: null, picked: true };
  const opened = incidentRoute(store, incidentId);
  const routed = opened?.policyId ? store.get("escalation_policies", opened.policyId) : undefined;
  if (opened && routed) {
    return { policy: routed, monitor: null, route: { id: opened.routeId, name: opened.routeName } };
  }
  const typeId = incident?.typeId;
  const type = typeId ? store.get("incident_types", typeId) : undefined;
  const typed = type?.escalationPolicyId
    ? store.get("escalation_policies", type.escalationPolicyId)
    : undefined;
  if (typed) return { policy: typed, monitor: null };
  for (const serviceId of incident?.serviceIds ?? []) {
    const service = store.get("services", serviceId);
    const owned = service?.escalationPolicyId
      ? store.get("escalation_policies", service.escalationPolicyId)
      : undefined;
    if (service && owned) {
      return { policy: owned, monitor: null, service: { id: service.id, name: service.name } };
    }
  }
  const opener = openedBy(store, incidentId);
  const own = opener?.policyId ? store.get("escalation_policies", opener.policyId) : undefined;
  if (opener && own) return { policy: own, monitor: { id: opener.id, name: opener.name } };
  const policy = defaultPolicy(store);
  return policy && { policy, monitor: null };
}

/**
 * The monitor that opened `incidentId` (RFC 0006 "Who is paged", 4): the one whose alert opened it, firing or not. A
 * monitor whose alert a `group` route put onto it (RFC 0007 "Monitor alerts through the routes") did not open it, so
 * its policy never takes over the incident's pages.
 */
function openedBy(store: MutationStore, incidentId: string) {
  const alert = store
    .scan("alerts")
    .filter((one) => one.incidentId === incidentId && one.outcome !== "grouped")
    .sort((a, b) => a.firedAt - b.firedAt)[0];
  return alert ? store.get("monitors", alert.monitorId) : undefined;
}

// ---- Validation -------------------------------------------------------------------------------------------------

const policyId = v.id("esc");

const targetArgs = v.object({
  kind: v.picklist(ESCALATION_TARGET_KINDS),
  // A schedule id (`sch_<ULID>`) or a member's user id; which one exists is checked against the store.
  id: v.string({ min: 1, max: 64 }),
});

const levelArgs = v.object({
  id: v.id("lvl"),
  targets: v.array(targetArgs, { min: 1, max: MAX_LEVEL_TARGETS }),
  timeoutMinutes: v.integer({ min: MIN_LEVEL_TIMEOUT, max: MAX_LEVEL_TIMEOUT }),
});

const policyFields = {
  name: v.string({ min: 1, max: POLICY_NAME_MAX }),
  levels: v.array(levelArgs, { min: 1, max: MAX_POLICY_LEVELS }),
  repeat: v.integer({ min: 0, max: MAX_POLICY_REPEAT }),
  isDefault: v.boolean(),
  // Left out (clients from before it): every severity on create, unchanged on update.
  minSeverity: v.omittable(v.nullable(v.picklist(SEVERITIES))),
};

const toLevels = (levels: readonly EscalationLevel[]): EscalationLevel[] =>
  levels.map((level) => ({
    id: level.id,
    targets: level.targets.map((target) => ({ kind: target.kind, id: target.id })),
    timeoutMinutes: level.timeoutMinutes,
  }));

/** What `v.object` cannot say: level ids once, each target once per level, and targets that exist and can respond. */
function checkLevels(store: MutationStore, levels: readonly EscalationLevel[]): Issue[] {
  const issues: Issue[] = [];
  const ids = new Set<string>();
  levels.forEach((level, index) => {
    const at = `levels[${index}]`;
    if (ids.has(level.id)) issues.push({ path: `${at}.id`, message: "Listed twice" });
    ids.add(level.id);
    const seen = new Set<string>();
    level.targets.forEach((target, position) => {
      const path = `${at}.targets[${position}]`;
      const key = `${target.kind}:${target.id}`;
      if (seen.has(key)) issues.push({ path, message: "Listed twice" });
      seen.add(key);
      if (target.kind === "schedule") {
        if (!store.get("schedules", target.id))
          issues.push({ path, message: "Schedule not found" });
        return;
      }
      const member = store.get("members", target.id);
      // Viewers only read, so they are never paged.
      if (!member || member.role === "viewer") {
        issues.push({ path, message: member ? "Viewers cannot be paged" : "Not a member" });
      }
    });
  });
  return issues;
}

function checkNewId(id: string, ctx: MutationContext): MutationResult | undefined {
  if (ctx.server && idTime(id) - ctx.now > ID_CLOCK_SKEW_MS) {
    return fail("invalid_args", "Id time is ahead of the server clock", [
      { path: "id", message: "Id time is too far in the future" },
    ]);
  }
  return undefined;
}

/** Takes the default flag from every other policy (one default per workspace). */
function unseatDefault(store: MutationStore, keep: string, ctx: MutationContext): DomainEvent[] {
  const events: DomainEvent[] = [];
  for (const row of store.scan("escalation_policies")) {
    if (row.id === keep || !row.isDefault) continue;
    const next = store.update("escalation_policies", row.id, {
      isDefault: false,
      updatedAt: ctx.now,
    });
    events.push(updated(next, "default_changed"));
  }
  return events;
}

// ---- Mutations ----------------------------------------------------------------------------------------------------

export const createPolicy = defineMutation({
  name: "escalation.createPolicy",
  args: v.object({ id: policyId, ...policyFields }),
  permission: "escalation:manage",
  apply(store, args, ctx) {
    const clock = checkNewId(args.id, ctx);
    if (clock) return clock;
    const levels = toLevels(args.levels);
    const issues = checkLevels(store, levels);
    if (issues.length) {
      return fail("invalid_args", "Invalid arguments for escalation.createPolicy", issues);
    }
    if (store.get("escalation_policies", args.id)) return fail("conflict", "Policy already exists");
    if (store.scan("escalation_policies").length >= MAX_POLICIES_PER_WORKSPACE) {
      return fail(
        "limit_reached",
        `At most ${MAX_POLICIES_PER_WORKSPACE} escalation policies per workspace`,
      );
    }
    const row: EscalationPolicyRow = {
      id: args.id,
      name: args.name,
      levels,
      repeat: args.repeat,
      isDefault: args.isDefault,
      ...(args.minSeverity != null && { minSeverity: args.minSeverity }),
      createdAt: ctx.now,
      createdBy: ctx.actor.id,
      updatedAt: ctx.now,
    };
    store.insert("escalation_policies", row);
    const created: EscalationPolicyCreated = {
      type: "escalation_policy.created",
      subject: row.id,
      data: summary(row),
    };
    return ok(created, ...(row.isDefault ? unseatDefault(store, row.id, ctx) : []));
  },
});

/**
 * Replaces the policy's name, levels, repeat, whether it is the default and from which severity it escalates
 * (`minSeverity`, kept when left out), at once. A run under way keeps the
 * levels it started with (RFC 0003 "Escalation run"); the next run reads these.
 */
export const updatePolicy = defineMutation({
  name: "escalation.updatePolicy",
  args: v.object({ id: policyId, ...policyFields }),
  permission: "escalation:manage",
  apply(store, args, ctx) {
    const policy = store.get("escalation_policies", args.id);
    if (!policy) return fail("not_found", "Policy not found");
    const levels = toLevels(args.levels);
    const issues = checkLevels(store, levels);
    if (issues.length) {
      return fail("invalid_args", "Invalid arguments for escalation.updatePolicy", issues);
    }
    const minSeverity =
      args.minSeverity === undefined ? (policy.minSeverity ?? null) : args.minSeverity;
    if (
      policy.name === args.name &&
      policy.repeat === args.repeat &&
      (policy.minSeverity ?? null) === minSeverity &&
      policy.isDefault === args.isDefault &&
      JSON.stringify(policy.levels) === JSON.stringify(levels)
    ) {
      return fail("conflict", "Policy is unchanged");
    }
    const row = store.update("escalation_policies", args.id, {
      name: args.name,
      levels,
      repeat: args.repeat,
      isDefault: args.isDefault,
      minSeverity,
      updatedAt: ctx.now,
    });
    return ok(updated(row, "edited"), ...(row.isDefault ? unseatDefault(store, row.id, ctx) : []));
  },
});

/**
 * Deletes the policy. Deleting the default leaves none, so pages go back to the interim rule (RFC 0006). Monitors,
 * services and incident types that named it go back to the default in the same transaction (`monitor.updated`,
 * `service.updated`, `incident_type.updated`, `reason: policy_deleted`), so nothing names a policy that is gone.
 */
export const deletePolicy = defineMutation({
  name: "escalation.deletePolicy",
  args: v.object({ id: policyId }),
  permission: "escalation:manage",
  apply(store, args, ctx) {
    const policy = store.get("escalation_policies", args.id);
    if (!policy) return fail("not_found", "Policy not found");
    store.delete("escalation_policies", args.id);
    const event: EscalationPolicyDeleted = {
      type: "escalation_policy.deleted",
      subject: args.id,
      data: { id: args.id, wasDefault: policy.isDefault },
    };
    return ok(
      event,
      ...dropPolicyFromMonitors(store, args.id, ctx),
      ...dropPolicyFromCatalog(store, args.id, ctx),
      ...dropPolicyFromRoutes(store, args.id, ctx),
    );
  },
});

/**
 * Takes `target` out of every level, in the transaction that made it go away: a schedule deleted, or a member
 * removed or made a viewer (`dropFromSchedules`). A level left with no targets stays, a visible gap until someone
 * edits it; when it fires it is skipped like an unreachable level (RFC 0006 "Who is paged").
 */
export function dropFromPolicies(
  store: MutationStore,
  target: EscalationTarget,
  ctx: MutationContext,
): DomainEvent[] {
  const events: DomainEvent[] = [];
  const same = (one: EscalationTarget) => one.kind === target.kind && one.id === target.id;
  for (const policy of store.scan("escalation_policies")) {
    if (!policy.levels.some((level) => level.targets.some(same))) continue;
    const levels = policy.levels.map((level) => ({
      ...level,
      targets: level.targets.filter((one) => !same(one)),
    }));
    const row = store.update("escalation_policies", policy.id, { levels, updatedAt: ctx.now });
    events.push(
      target.kind === "member"
        ? updated(row, "member_removed", { userId: target.id })
        : updated(row, "schedule_deleted", { scheduleId: target.id }),
    );
  }
  return events;
}

// ---- Queries ------------------------------------------------------------------------------------------------------

/** The default first, then by name, then id (code point order, the same on every replica). */
const defaultThenName = (a: EscalationPolicyRow, b: EscalationPolicyRow) =>
  Number(b.isDefault) - Number(a.isDefault) ||
  (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const allPolicies = defineQuery({
  name: "escalationPolicies.all",
  args: v.object({}),
  permission: "escalation:read",
  table: "escalation_policies",
  filter: () => true,
  sort: defaultThenName,
});

/** What members may send. */
export const policyMutations = [createPolicy, updatePolicy, deletePolicy] as const;
