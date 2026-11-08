// What the model may read for a postmortem draft (RFC 0013 "Drafting with AI"): the incident's source, built from the
// shard's rows. Its own module, without the routes (which load Better Auth), so the shard's side runs in an Ember
// mutation and its Node tests (ember/postmortems.ts). src/postmortem.ts re-exports it.

import {
  formatIncidentNumber,
  prefixRange,
  roleDefinition,
  type MutationStore,
  type StatusLocale,
  type TimelineRow,
} from "@freecorps/brigade-schema";

/**
 * The model that writes drafts: Meta's Llama 3.3 70B (FP8, the "fast" variant), a general instruction model that
 * writes Portuguese well, with a 24k-token context and JSON output. About $0.29 per million input tokens and $2.25
 * per million output tokens: a draft of ~6k tokens in and ~1.5k out costs about half a cent (RFC 0013).
 */
export const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
/** How long the Worker waits on the model: inside `waitUntil`'s 30 s after the response. */
export const AI_TIMEOUT_MS = 25_000;
export const AI_MAX_TOKENS = 2000;
/** The most of the incident the model reads, in characters of JSON: well inside its context with the answer. */
export const MAX_SOURCE_CHARS = 40_000;
/** An update's text as the model reads it, at most. */
const UPDATE_CHARS = 1500;
/**
 * The timeline entries `draftSource` reads at most: its first `HEAD_ENTRIES` and its last `TAIL_ENTRIES`. Far more
 * than fit in `MAX_SOURCE_CHARS`, so a long incident costs the shard the same as one that just fits.
 */
export const HEAD_ENTRIES = 50;
export const TAIL_ENTRIES = 2000;
/** The entries a long timeline always keeps from its start, and at least from its end. */
const KEEP_FIRST = 10;
const KEEP_LAST = 10;

/** The Workers AI binding, when the deployment has one (`"ai": { "binding": "AI" }`, apps/api/README.md). */
export type AiBinding = { run(model: string, inputs: unknown): Promise<unknown> };
export type AiEnv = { AI?: AiBinding };

/** What the model reads about one incident. */
export type DraftSource = {
  locale: StatusLocale;
  incident: Record<string, unknown>;
  timeline: { at: string; who: string; what: string }[];
  followUps: { title: string; owner: string | null; due: string | null; status: string }[];
  /** Entries left out from the middle of a long timeline. */
  omitted: number;
};

const SYSTEM_NAMES: Record<string, string> = {
  sys_monitors: "Brigade monitors",
  sys_escalation: "Brigade escalation",
  sys_notifier: "Brigade",
  sys_members: "Brigade",
  sys_ai: "Brigade AI",
};

/** One timeline entry in plain English for the model; null for entries about pages, devices or emails, and removed updates. */
export function describeEntry(
  entry: TimelineRow,
  name: (id: string | null) => string,
): string | null {
  switch (entry.kind) {
    case "declared":
      return `declared the incident "${entry.title}" as ${entry.severity.toUpperCase()}`;
    case "status_changed":
      return `changed the status from ${entry.from} to ${entry.to}`;
    case "severity_changed":
      return `changed the severity from ${entry.from.toUpperCase()} to ${entry.to.toUpperCase()}`;
    case "renamed":
      return `renamed the incident from "${entry.from}" to "${entry.to}"`;
    case "acknowledged":
      return "acknowledged the page";
    case "role_assigned": {
      // A workspace's own role, or a renamed built-in, by the name it had then.
      const role = entry.roleName ?? entry.role;
      return entry.to === null
        ? `removed ${name(entry.from)} as ${role}`
        : `made ${name(entry.to)} ${role}`;
    }
    // The text as it reads now; a removed update is left out, its text gone.
    case "update":
      if (entry.removed) return null;
      return `posted an update${entry.edited ? " (edited later)" : ""}: ${clipText(entry.body, UPDATE_CHARS)}`;
    case "alert_resolved":
      return `the alert of monitor "${entry.monitor}" resolved (${entry.reason})`;
    case "alert_grouped":
      return entry.monitorId
        ? `monitor "${entry.name}" went down and was grouped onto this incident`
        : `the alert "${entry.name}" was grouped onto this incident`;
    case "escalated":
      return entry.level === null
        ? "paged everyone who can respond"
        : `paged escalation level ${entry.level}: ${entry.userIds.map(name).join(", ")}`;
    case "escalation_exhausted":
      return "nobody acknowledged after every escalation level";
    case "status_published":
      return `published to the public status page (${entry.status}): ${clipText(entry.body, UPDATE_CHARS)}`;
    case "status_corrected":
      return `corrected the public status page (${entry.change})`;
    case "type_changed":
      return `changed the incident type to ${entry.to ?? "none"}`;
    case "services_changed":
      return [
        entry.added.length ? `named the affected services ${entry.added.join(", ")}` : "",
        entry.removed.length ? `took off ${entry.removed.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; ");
    case "field_changed":
      return `set ${entry.field} to ${
        entry.labels?.length ? entry.labels.join(", ") : String(entry.value ?? "nothing")
      }`;
    case "follow_up":
      return `follow-up "${entry.title}": ${entry.change}`;
    case "postmortem":
      return null;
    // Pages, deliveries, emails and Slack: about devices and addresses, never sent.
    case "page_failed":
    case "email_failed":
    case "slack_failed":
      return null;
    default:
      return null;
  }
}

const clipText = (text: string, max: number) =>
  text.length <= max ? text : `${Array.from(text.slice(0, max)).slice(0, -1).join("")}…`;

/** What the model reads about `incidentId`, from the shard's own rows; undefined when there is no such incident. */
export function draftSource(
  store: MutationStore,
  incidentId: string,
  locale: StatusLocale,
): DraftSource | undefined {
  const incident = store.get("incidents", incidentId);
  if (!incident) return undefined;
  const members = new Map(store.scan("members").map((member) => [member.id, member.name]));
  const name = (id: string | null) =>
    id === null ? "nobody" : (SYSTEM_NAMES[id] ?? members.get(id) ?? "a teammate");
  const iso = (at: number) => new Date(at).toISOString();
  const { from, to } = prefixRange(`${incidentId}:`);
  const entries = store
    .range("timeline", from, to)
    .filter((entry) => entry.incidentId === incidentId)
    .sort((a, b) => a.seq - b.seq);
  // Only the start and the end are read: the middle of a very long timeline would be dropped below anyway.
  const skipped = Math.max(0, entries.length - HEAD_ENTRIES - TAIL_ENTRIES);
  const read =
    skipped > 0
      ? [...entries.slice(0, HEAD_ENTRIES), ...entries.slice(entries.length - TAIL_ENTRIES)]
      : entries;
  const timeline = read.flatMap((entry) => {
    const what = describeEntry(entry, name);
    return what ? [{ at: iso(entry.at), who: name(entry.actor), what }] : [];
  });
  const type = incident.typeId ? store.get("incident_types", incident.typeId) : undefined;
  const roles = store.scan("incident_roles");
  const fields: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(incident.fields ?? {})) {
    const field = store.get("custom_fields", id);
    if (!field) continue;
    fields[field.name] = Array.isArray(value)
      ? value.map((option) => field.options.find((one) => one.id === option)?.label ?? option)
      : (field.options.find((one) => one.id === value)?.label ?? value);
  }
  const source: DraftSource = {
    locale,
    incident: {
      number: formatIncidentNumber(incident.number),
      title: incident.title,
      severity: incident.severity.toUpperCase(),
      status: incident.status,
      declaredAt: iso(incident.declaredAt),
      type: type?.name ?? null,
      services: (incident.serviceIds ?? []).flatMap((id) => {
        const service = store.get("services", id);
        return service ? [service.name] : [];
      }),
      // By the workspace's name for each role (a built-in's id under its own); a deleted role is left out.
      roles: Object.fromEntries(
        Object.entries(incident.roles ?? {}).flatMap(([id, holder]) => {
          const role = roleDefinition(roles, id);
          return role ? [[role.name ?? id, name(holder ?? null)]] : [];
        }),
      ),
      fields,
    },
    timeline: [],
    followUps: store
      .scan("follow_ups")
      .filter((one) => one.incidentId === incidentId)
      .map((one) => ({
        title: one.title,
        owner: one.ownerId === null ? null : name(one.ownerId),
        due: one.dueDate,
        status: one.status,
      })),
    omitted: 0,
  };
  return fitTimeline(source, timeline, skipped);
}

/**
 * Puts `timeline` in `source`, inside `MAX_SOURCE_CHARS`: a long one keeps its first `KEEP_FIRST` entries and as much
 * of its end as fits (at least `KEEP_LAST`), dropping from the middle. Each entry is measured once, so it is linear in
 * the entries. `skipped` entries were never read; they count as omitted too.
 */
function fitTimeline(
  source: DraftSource,
  timeline: DraftSource["timeline"],
  skipped: number,
): DraftSource {
  // An entry costs its JSON and a comma; the omitted count is measured at its widest.
  const size = (entry: DraftSource["timeline"][number]) => JSON.stringify(entry).length + 1;
  const room =
    MAX_SOURCE_CHARS - JSON.stringify({ ...source, omitted: Number.MAX_SAFE_INTEGER }).length;
  const sizes = timeline.map(size);
  const total = sizes.reduce((sum, one) => sum + one, 0);
  if (total <= room || timeline.length <= KEEP_FIRST + KEEP_LAST) {
    return { ...source, timeline, omitted: skipped };
  }
  let used = sizes.slice(0, KEEP_FIRST).reduce((sum, one) => sum + one, 0);
  // `start` is the first entry of the end that is kept.
  let start = timeline.length;
  while (start > KEEP_FIRST) {
    const next = sizes[start - 1]!;
    const kept = timeline.length - start;
    if (kept >= KEEP_LAST && used + next > room) break;
    used += next;
    start -= 1;
  }
  return {
    ...source,
    timeline: [...timeline.slice(0, KEEP_FIRST), ...timeline.slice(start)],
    omitted: skipped + (start - KEEP_FIRST),
  };
}
