// Exports (RFC 0013 "Exports"): owners and admins take an incident, or the incidents declared in a date range, out
// of Brigade as one JSON file. The shard builds the file from its own rows (`buildExport`); the API Worker writes it
// to R2 and records it here (`export.record`, server-only), so the dashboard lists recent exports and every export is
// an event (RFC 0005).

import { POSTMORTEM_SECTIONS } from "./postmortems.ts";
import { defineMutation, fail, ok, type DomainEvent, type MutationStore } from "./mutation.ts";
import { defineQuery, prefixRange } from "./query.ts";
import type { ExportRow, ExportScope, IncidentRow } from "./tables.ts";
import { isDueDate } from "./followups.ts";
import { v, type Validator } from "./validate.ts";

/** How long an export can be downloaded; the bucket's lifecycle rule deletes it after that too. */
export const EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** The most incidents one export holds: a range with more is refused (`limit_reached`), to be split. */
export const MAX_EXPORT_INCIDENTS = 500;
/** The longest date range, in days, both ends included. */
export const MAX_EXPORT_RANGE_DAYS = 366;
/** Exports the shard lists; older ones are dropped from the list (the files expire on their own). */
export const MAX_LISTED_EXPORTS = 20;
/** The file's `format` and `version`: bumped when its shape changes in a way readers must know. */
export const EXPORT_FORMAT = "brigade.export";
export const EXPORT_VERSION = 1;

const DAY_MS = 24 * 60 * 60 * 1000;
const dayStart = (date: string) => Date.parse(`${date}T00:00:00Z`);

export type WorkspaceExported = DomainEvent<
  "workspace.exported",
  { id: string; scope: ExportScope; incidents: number; bytes: number; expiresAt: number }
>;

const date: Validator<string> = (input, path = "") =>
  isDueDate(input)
    ? { ok: true, value: input }
    : { ok: false, issues: [{ path, message: "Expected a date as YYYY-MM-DD" }] };

/** What to export: one incident, or every incident declared from `from` to `to` (UTC days, both included). */
export const exportScope: Validator<ExportScope> = (input, path = "") => {
  if (
    typeof input === "object" &&
    input !== null &&
    (input as { kind?: unknown }).kind === "incident"
  ) {
    const parsed = v.object({ kind: v.picklist(["incident"] as const), incidentId: v.id("inc") })(
      input,
      path,
    );
    return parsed;
  }
  const parsed = v.object({ kind: v.picklist(["range"] as const), from: date, to: date })(
    input,
    path,
  );
  if (!parsed.ok) return parsed;
  const { from, to } = parsed.value;
  const days = (dayStart(to) - dayStart(from)) / DAY_MS + 1;
  if (days < 1 || days > MAX_EXPORT_RANGE_DAYS) {
    return {
      ok: false,
      issues: [{ path, message: `Expected a range of 1 to ${MAX_EXPORT_RANGE_DAYS} days` }],
    };
  }
  return parsed;
};

/** The incidents a scope covers, oldest first; `undefined` for an incident that does not exist. */
export function exportIncidents(
  store: MutationStore,
  scope: ExportScope,
): IncidentRow[] | undefined {
  if (scope.kind === "incident") {
    const row = store.get("incidents", scope.incidentId);
    return row ? [row] : undefined;
  }
  const from = dayStart(scope.from);
  const to = dayStart(scope.to) + DAY_MS;
  return store
    .scan("incidents")
    .filter((row) => row.declaredAt >= from && row.declaredAt < to)
    .sort((a, b) => a.declaredAt - b.declaredAt || (a.id < b.id ? -1 : 1));
}

/**
 * The export file for `scope` as of `now`, or why not. Every incident with its timeline, the written updates (the
 * timeline's `update` entries, also in the timeline), what the status page published, its follow-ups and its
 * postmortem; and the members' names, so the ids in it read. Never an address, a device or a token: those tables are
 * not read.
 */
export function buildExport(
  store: MutationStore,
  scope: ExportScope,
  now: number,
):
  | { ok: true; file: unknown; incidents: number }
  | { ok: false; code: "not_found" | "limit_reached" } {
  const incidents = exportIncidents(store, scope);
  if (!incidents) return { ok: false, code: "not_found" };
  if (incidents.length > MAX_EXPORT_INCIDENTS) return { ok: false, code: "limit_reached" };
  const workspace = store.scan("workspace")[0];
  const followUps = store.scan("follow_ups");
  const iso = (at: number | null | undefined) =>
    typeof at === "number" ? new Date(at).toISOString() : null;
  const file = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: iso(now),
    workspace: workspace ? { id: workspace.id, name: workspace.name } : null,
    scope,
    members: store.scan("members").map((member) => ({ id: member.id, name: member.name })),
    incidents: incidents.map((incident) => {
      const { from, to } = prefixRange(`${incident.id}:`);
      const timeline = store
        .range("timeline", from, to)
        .filter((entry) => entry.incidentId === incident.id)
        .sort((a, b) => a.seq - b.seq);
      const postmortem = store.get("postmortems", incident.id);
      const published = store.get("status_incidents", incident.id);
      const { escalation: _escalation, ...row } = incident;
      return {
        incident: {
          ...row,
          declaredAt: iso(incident.declaredAt),
          updatedAt: iso(incident.updatedAt),
        },
        timeline: timeline.map((entry) => ({ ...entry, at: iso(entry.at) })),
        updates: timeline
          .filter((entry) => entry.kind === "update")
          .map((entry) => ({
            at: iso(entry.at),
            by: entry.actor,
            body: entry.kind === "update" ? entry.body : "",
          })),
        statusPage: published
          ? {
              title: published.title,
              updates: published.updates.map((update) => ({ ...update, at: iso(update.at) })),
            }
          : null,
        followUps: followUps
          .filter((one) => one.incidentId === incident.id)
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((one) => ({
            ...one,
            createdAt: iso(one.createdAt),
            updatedAt: iso(one.updatedAt),
            doneAt: iso(one.doneAt),
          })),
        postmortem:
          postmortem && postmortem.revision > 0
            ? {
                revision: postmortem.revision,
                updatedAt: iso(postmortem.updatedAt),
                updatedBy: postmortem.updatedBy,
                aiDraft: postmortem.ai != null,
                sections: Object.fromEntries(
                  POSTMORTEM_SECTIONS.map((key) => [key, postmortem.sections[key]]),
                ),
              }
            : null,
      };
    }),
  };
  return { ok: true, file, incidents: incidents.length };
}

/**
 * Server only (`WorkspaceDO.recordExport`, as the member who exported, once the file is in R2): lists the export and
 * emits `workspace.exported`. Exports past their expiry, and the oldest past `MAX_LISTED_EXPORTS`, leave the list.
 */
export const recordExport = defineMutation({
  name: "export.record",
  args: v.object({
    id: v.id("exp"),
    scope: exportScope,
    incidents: v.integer({ min: 0, max: MAX_EXPORT_INCIDENTS }),
    bytes: v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  }),
  permission: "data:export",
  apply(store, args, ctx) {
    if (store.get("exports", args.id)) return fail("conflict", "Export already recorded");
    const kept = store
      .scan("exports")
      .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
    kept.forEach((row, index) => {
      if (row.expiresAt <= ctx.now || index >= MAX_LISTED_EXPORTS - 1)
        store.delete("exports", row.id);
    });
    const row: ExportRow = {
      id: args.id,
      scope: args.scope,
      incidents: args.incidents,
      bytes: args.bytes,
      createdAt: ctx.now,
      createdBy: ctx.actor.id,
      expiresAt: ctx.now + EXPORT_TTL_MS,
    };
    store.insert("exports", row);
    const event: WorkspaceExported = {
      type: "workspace.exported",
      subject: row.id,
      data: {
        id: row.id,
        scope: row.scope,
        incidents: row.incidents,
        bytes: row.bytes,
        expiresAt: row.expiresAt,
      },
    };
    return ok(event);
  },
});

/** Recent exports, newest first, for owners and admins (readers hide the expired ones). */
export const recentExports = defineQuery({
  name: "exports.recent",
  args: v.object({}),
  permission: "data:export",
  table: "exports",
  filter: () => true,
  sort: (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1),
});
