// The public status page (RFC 0012): one page per workspace, its components, and what responders chose to publish
// about an incident. The workspace shard is the authority; the public reads a sanitized snapshot the shard pushes
// (`statusSnapshot`, apps/api src/status-page.ts), never the shard itself. Nothing internal reaches the snapshot:
// no member, no internal title, no timeline entry; only what was written for the public.

import { defineMutation, fail, ok, type DomainEvent, type MutationStore } from "./mutation.ts";
import { defineQuery } from "./query.ts";
import type { StatusComponentRow, StatusIncidentRow, StatusPageRow } from "./tables.ts";
import { appendTimeline } from "./timeline.ts";
import { UPDATE_BODY_MAX } from "./incidents.ts";
import { v, type Validator } from "./validate.ts";

/** The one row of `status_page`: a workspace has at most one page. */
export const STATUS_PAGE_ID = "status_page";

/** Languages a page can be written in (RFC 0008); chosen per page, not per visitor. */
export const STATUS_LOCALES = ["en", "pt-BR"] as const;
export type StatusLocale = (typeof STATUS_LOCALES)[number];

/** A component's status, best first. An incident's `impact` uses the same scale (`operational`: no impact). */
export const COMPONENT_STATUSES = [
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
] as const;
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];

/** Where a published incident stands, as the public reads it; separate from the incident's own status. */
export const PUBLIC_STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const;
export type PublicStatus = (typeof PUBLIC_STATUSES)[number];

export const STATUS_PAGE_TITLE_MAX = 80;
export const COMPONENT_NAME_MAX = 80;
export const COMPONENT_GROUP_MAX = 80;
export const PUBLIC_TITLE_MAX = 200;
export const MAX_COMPONENTS = 50;
/** Published updates kept per incident; a 51st is `limit_reached`. */
export const MAX_PUBLIC_UPDATES = 50;
/** How far back the page lists resolved incidents. */
export const STATUS_HISTORY_DAYS = 90;
/** At most this many resolved incidents in the snapshot, newest first, however many the 90 days hold. */
export const STATUS_HISTORY_MAX = 50;
/** The snapshot's shape; bumped when a reader would misread a newer one. */
export const STATUS_SNAPSHOT_VERSION = 1;

/**
 * A page's address under `/status/`: 3 to 40 lowercase letters, digits and single hyphens, starting and ending
 * with a letter or digit. Unique across the instance (D1's `status_slug`, apps/api migrations/0008).
 */
export const STATUS_SLUG = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,39}$/;

export const statusSlug: Validator<string> = (input, path = "") =>
  typeof input === "string" && STATUS_SLUG.test(input)
    ? { ok: true, value: input }
    : {
        ok: false,
        issues: [{ path, message: "Expected 3 to 40 lowercase letters, digits and hyphens" }],
      };

/** Whether `value` is a slug the page accepts, for the form's own check. */
export function isStatusSlug(value: string): boolean {
  return STATUS_SLUG.test(value);
}

/** The worse of two statuses. */
export function worseStatus(a: ComponentStatus, b: ComponentStatus): ComponentStatus {
  return COMPONENT_STATUSES.indexOf(a) >= COMPONENT_STATUSES.indexOf(b) ? a : b;
}

/**
 * What the public sees for a component: the worse of its own status (set by hand) and the impact of every
 * published incident on it that is not resolved.
 */
export function componentStatus(
  component: Pick<StatusComponentRow, "id" | "status">,
  incidents: readonly Pick<StatusIncidentRow, "status" | "impact" | "componentIds">[],
): ComponentStatus {
  let status = component.status;
  for (const incident of incidents) {
    if (incident.status !== "resolved" && incident.componentIds.includes(component.id)) {
      status = worseStatus(status, incident.impact);
    }
  }
  return status;
}

export type StatusPageConfigured = DomainEvent<
  "status_page.configured",
  Pick<StatusPageRow, "slug" | "title" | "locale" | "enabled"> & { previousSlug: string | null }
>;

const pageTitle = v.string({ min: 1, max: STATUS_PAGE_TITLE_MAX });

/** The page's settings as `PUT /workspaces/:id/status-page` takes them; the API validates with it first. */
export const statusPageArgs = v.object({
  slug: statusSlug,
  title: pageTitle,
  locale: v.picklist(STATUS_LOCALES),
  enabled: v.boolean(),
});

/**
 * Server only: sets up or changes the page (owners and admins, `status:manage`). Run by the shard once the API
 * Worker's route has claimed the slug in D1 (RFC 0012 "Addresses"), never from a socket, since a slug is unique
 * across workspaces and a socket's mutation cannot wait on D1. A slug given up is recorded (`status_retired`) in the
 * same transaction, so the shard deletes its snapshot and only then lets D1 release it. No change is a `conflict`.
 */
export const configureStatusPage = defineMutation({
  name: "statusPage.configure",
  args: statusPageArgs,
  permission: "status:manage",
  apply(store, args, ctx) {
    const current = store.get("status_page", STATUS_PAGE_ID);
    if (
      current &&
      current.slug === args.slug &&
      current.title === args.title &&
      current.locale === args.locale &&
      current.enabled === args.enabled
    ) {
      return fail("conflict", "Status page settings are unchanged");
    }
    const row: StatusPageRow = {
      id: STATUS_PAGE_ID,
      ...args,
      updatedAt: ctx.now,
      updatedBy: ctx.actor.id,
    };
    if (current) store.update("status_page", STATUS_PAGE_ID, row);
    else store.insert("status_page", row);
    const previousSlug = current && current.slug !== args.slug ? current.slug : null;
    if (ctx.server) {
      if (previousSlug && !store.get("status_retired", previousSlug)) {
        store.insert("status_retired", { id: previousSlug, at: ctx.now });
      }
      // Taken back before the shard got round to releasing it: still this workspace's in D1.
      if (store.get("status_retired", args.slug)) store.delete("status_retired", args.slug);
    }
    const event: StatusPageConfigured = {
      type: "status_page.configured",
      subject: STATUS_PAGE_ID,
      data: { ...args, previousSlug },
    };
    return ok(event);
  },
});

export type StatusComponentCreated = DomainEvent<
  "status_component.created",
  Pick<StatusComponentRow, "id" | "name" | "group" | "status">
>;
export type StatusComponentUpdated = DomainEvent<
  "status_component.updated",
  Pick<StatusComponentRow, "id" | "name" | "group" | "status">
>;
export type StatusComponentDeleted = DomainEvent<
  "status_component.deleted",
  { id: string; incidents: number }
>;

const componentId = v.id("cmp");
const componentName = v.string({ min: 1, max: COMPONENT_NAME_MAX });
const componentGroup = v.nullable(v.string({ min: 1, max: COMPONENT_GROUP_MAX }));

/** A part of the service the public sees (API, Website), optionally in a group; owners and admins. */
export const createStatusComponent = defineMutation({
  name: "statusComponent.create",
  args: v.object({ id: componentId, name: componentName, group: componentGroup }),
  permission: "status:manage",
  apply(store, args, ctx) {
    if (store.get("status_components", args.id)) return fail("conflict", "Component exists");
    if (store.scan("status_components").length >= MAX_COMPONENTS) {
      return fail("limit_reached", `At most ${MAX_COMPONENTS} components per status page`);
    }
    const row: StatusComponentRow = {
      ...args,
      status: "operational",
      createdAt: ctx.now,
      updatedAt: ctx.now,
    };
    store.insert("status_components", row);
    const event: StatusComponentCreated = {
      type: "status_component.created",
      subject: row.id,
      data: { id: row.id, name: row.name, group: row.group, status: row.status },
    };
    return ok(event);
  },
});

/** Renames or regroups a component, or sets its own status by hand; owners and admins. */
export const updateStatusComponent = defineMutation({
  name: "statusComponent.update",
  args: v.object({
    id: componentId,
    name: componentName,
    group: componentGroup,
    status: v.picklist(COMPONENT_STATUSES),
  }),
  permission: "status:manage",
  apply(store, args, ctx) {
    const current = store.get("status_components", args.id);
    if (!current) return fail("not_found", "Component not found");
    if (
      current.name === args.name &&
      current.group === args.group &&
      current.status === args.status
    ) {
      return fail("conflict", "Component is unchanged");
    }
    store.update("status_components", args.id, {
      name: args.name,
      group: args.group,
      status: args.status,
      updatedAt: ctx.now,
    });
    const event: StatusComponentUpdated = {
      type: "status_component.updated",
      subject: args.id,
      data: args,
    };
    return ok(event);
  },
});

/**
 * Deletes a component and takes it out of every published incident in the same transaction (`incidents`: how many
 * named it), so no incident points at a component that is gone; owners and admins.
 */
export const deleteStatusComponent = defineMutation({
  name: "statusComponent.delete",
  args: v.object({ id: componentId }),
  permission: "status:manage",
  apply(store, args, ctx) {
    if (!store.get("status_components", args.id)) return fail("not_found", "Component not found");
    store.delete("status_components", args.id);
    let incidents = 0;
    for (const incident of store.scan("status_incidents")) {
      if (!incident.componentIds.includes(args.id)) continue;
      incidents++;
      store.update("status_incidents", incident.id, {
        componentIds: incident.componentIds.filter((id) => id !== args.id),
        updatedAt: ctx.now,
      });
    }
    const event: StatusComponentDeleted = {
      type: "status_component.deleted",
      subject: args.id,
      data: { id: args.id, incidents },
    };
    return ok(event);
  },
});

export type IncidentUpdatePublished = DomainEvent<
  "incident.update_published",
  Pick<StatusIncidentRow, "title" | "status" | "impact" | "componentIds"> & {
    entryId: string;
    body: string;
  }
>;

/**
 * Publishes an update about an incident to the status page (RFC 0012 "Publishing"): its own action, never a copy
 * of the internal timeline. The responder writes the public title, where it stands (`status`), its impact, the
 * components it touches and the text; each publish may change all of them, and `resolved` ends it on the page. The
 * timeline gets a `status_published` entry in the same transaction, so the team sees what the public was told.
 * Owners, admins and responders (`status:publish`): whoever runs the incident tells the public. The page must be set
 * up (enabled or not: a draft page can be filled before it goes live).
 */
export const publishIncidentUpdate = defineMutation({
  name: "incident.publishUpdate",
  args: v.object({
    id: v.id("inc"),
    title: v.string({ min: 1, max: PUBLIC_TITLE_MAX }),
    status: v.picklist(PUBLIC_STATUSES),
    impact: v.picklist(COMPONENT_STATUSES),
    componentIds: v.array(componentId, { max: MAX_COMPONENTS, unique: true }),
    body: v.string({ min: 1, max: UPDATE_BODY_MAX, multiline: true, joiners: true }),
  }),
  permission: "status:publish",
  apply(store, args, ctx) {
    if (!store.get("status_page", STATUS_PAGE_ID)) {
      return fail("not_found", "The status page is not set up");
    }
    const incident = store.get("incidents", args.id);
    if (!incident) return fail("not_found", "Incident not found");
    const missing = args.componentIds.findIndex(
      (id: string) => !store.get("status_components", id),
    );
    if (missing >= 0) {
      const message = "No such component";
      return fail("invalid_args", message, [{ path: `componentIds[${missing}]`, message }]);
    }
    const current = store.get("status_incidents", args.id);
    if (current && current.updates.length >= MAX_PUBLIC_UPDATES) {
      return fail("limit_reached", `At most ${MAX_PUBLIC_UPDATES} published updates per incident`);
    }
    store.update("incidents", args.id, { updatedAt: ctx.now });
    const entry = appendTimeline(
      store,
      incident,
      { kind: "status_published", status: args.status, body: args.body },
      ctx,
    );
    const update = { id: entry.id, at: ctx.now, status: args.status, body: args.body };
    const resolvedAt = args.status === "resolved" ? (current?.resolvedAt ?? ctx.now) : null;
    const fields = {
      title: args.title,
      status: args.status,
      impact: args.impact,
      componentIds: args.componentIds,
      resolvedAt,
      updatedAt: ctx.now,
    };
    if (current) {
      store.update("status_incidents", args.id, {
        ...fields,
        updates: [...current.updates, update],
      });
    } else {
      store.insert("status_incidents", {
        id: args.id,
        ...fields,
        updates: [update],
        publishedAt: ctx.now,
      });
    }
    const event: IncidentUpdatePublished = {
      type: "incident.update_published",
      subject: args.id,
      data: {
        entryId: entry.id,
        title: args.title,
        status: args.status,
        impact: args.impact,
        componentIds: args.componentIds,
        body: args.body,
      },
    };
    return ok(event);
  },
});

/** The page's settings: none (not set up), or one row. */
export const statusPageConfig = defineQuery({
  name: "statusPage.config",
  args: v.object({}),
  permission: "status:read",
  table: "status_page",
  filter: () => true,
  sort: () => 0,
});

/** Groups in the order they first appear, ungrouped first; then oldest first, ids breaking ties. */
const byCreation = (a: StatusComponentRow, b: StatusComponentRow) =>
  a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const statusComponents = defineQuery({
  name: "statusComponents.all",
  args: v.object({}),
  permission: "status:read",
  table: "status_components",
  filter: () => true,
  sort: byCreation,
});

/** What the status page says about one incident, if anything was published. */
export const statusIncidentById = defineQuery({
  name: "statusIncident.byId",
  args: v.object({ id: v.id("inc") }),
  permission: "status:read",
  table: "status_incidents",
  key: (args) => args.id,
  filter: (row, args) => row.id === args.id,
});

/** The public's copy of a component: its name and what it shows. */
export type SnapshotComponent = { name: string; status: ComponentStatus };
export type SnapshotGroup = { name: string | null; components: SnapshotComponent[] };
export type SnapshotIncident = {
  title: string;
  status: PublicStatus;
  impact: ComponentStatus;
  /** The names of the components it touches, as the page lists them. */
  components: string[];
  publishedAt: number;
  resolvedAt: number | null;
  /** Newest first. */
  updates: { at: number; status: PublicStatus; body: string }[];
};

/**
 * The whole public page as JSON (RFC 0012 "The snapshot"): what the shard pushes to KV and the public route
 * renders. Everything in it was written for the public; no id, member or internal title is.
 */
export type StatusSnapshot = {
  v: typeof STATUS_SNAPSHOT_VERSION;
  title: string;
  locale: StatusLocale;
  /** When the shard built it. */
  generatedAt: number;
  /** The worst any component or open incident shows. */
  status: ComponentStatus;
  groups: SnapshotGroup[];
  /** Published incidents not yet resolved, most impact first, then newest. */
  active: SnapshotIncident[];
  /** Resolved within `STATUS_HISTORY_DAYS`, newest first, at most `STATUS_HISTORY_MAX`. */
  history: SnapshotIncident[];
};

type SnapshotStore = Pick<MutationStore, "get" | "scan">;

/** The page as the public may see it, or null when there is no page or it is not enabled. */
export function statusSnapshot(store: SnapshotStore, now: number): StatusSnapshot | null {
  const page = store.get("status_page", STATUS_PAGE_ID);
  if (!page?.enabled) return null;
  const incidents = store.scan("status_incidents");
  const components = store.scan("status_components").sort(byCreation);
  const names = new Map(components.map((component) => [component.id, component.name]));
  const groups: SnapshotGroup[] = [];
  let overall: ComponentStatus = "operational";
  for (const component of components) {
    const status = componentStatus(component, incidents);
    overall = worseStatus(overall, status);
    let group = groups.find((candidate) => candidate.name === component.group);
    if (!group) {
      group = { name: component.group, components: [] };
      if (component.group === null) groups.unshift(group);
      else groups.push(group);
    }
    group.components.push({ name: component.name, status });
  }
  const toPublic = (row: StatusIncidentRow): SnapshotIncident => ({
    title: row.title,
    status: row.status,
    impact: row.impact,
    components: row.componentIds.flatMap((id) => names.get(id) ?? []),
    publishedAt: row.publishedAt,
    resolvedAt: row.resolvedAt,
    updates: row.updates
      .map(({ at, status, body }) => ({ at, status, body }))
      .sort((a, b) => b.at - a.at),
  });
  const active = incidents
    .filter((row) => row.status !== "resolved")
    .sort(
      (a, b) =>
        COMPONENT_STATUSES.indexOf(b.impact) - COMPONENT_STATUSES.indexOf(a.impact) ||
        b.publishedAt - a.publishedAt,
    );
  for (const row of active) overall = worseStatus(overall, row.impact);
  const since = now - STATUS_HISTORY_DAYS * 24 * 60 * 60 * 1000;
  const history = incidents
    .filter((row) => row.status === "resolved" && (row.resolvedAt ?? 0) >= since)
    .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))
    .slice(0, STATUS_HISTORY_MAX);
  return {
    v: STATUS_SNAPSHOT_VERSION,
    title: page.title,
    locale: page.locale,
    generatedAt: now,
    status: overall,
    groups,
    active: active.map(toPublic),
    history: history.map(toPublic),
  };
}

/** The status page's mutations clients may send (the page's own settings go through the API, see above). */
export const statusMutations = [
  createStatusComponent,
  updateStatusComponent,
  deleteStatusComponent,
  publishIncidentUpdate,
] as const;
