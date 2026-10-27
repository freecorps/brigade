// Drafting a postmortem with Workers AI (RFC 0013 "Drafting with AI"). `POST
// /workspaces/:id/incidents/:incidentId/postmortem/draft` has the shard mark a draft as pending (the server-only
// `postmortem.requestDraft`, rate-limited per workspace) and hand back what the model may read; the Worker answers
// 202 at once and asks the model in `waitUntil`, then writes the result through `postmortem.writeDraft` (or
// `postmortem.failDraft`) as `sys_ai`. Never on a paging path: no Queue, no alarm, no shard waits on the model.
//
// What the model reads: the incident's title, severity, status, type, services and custom fields, the timeline's
// human-readable changes and written updates, and the follow-ups, with members by name (members see those names on
// the incident page). Never an email address, a device, a push token or a delivery: those tables are not read, and
// timeline entries about pages and emails are left out.

import {
  formatIncidentNumber,
  isId,
  POSTMORTEM_SECTION_MAX,
  POSTMORTEM_SECTIONS,
  prefixRange,
  roleDefinition,
  STATUS_LOCALES,
  type MutationStore,
  type PostmortemDraftFailure,
  type PostmortemSections,
  type StatusLocale,
  type TimelineRow,
} from "@freecorps/brigade-schema";
import { unauthenticated } from "./api-tokens.ts";
import type { Auth } from "./auth.ts";
import { DRAFT_STATUS } from "./http.ts";
import { checkMember, json, readJson } from "./member-route.ts";

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

/** One timeline entry in plain English for the model; null for entries about pages, devices or emails. */
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
    case "acknowledged":
      return "acknowledged the page";
    case "role_assigned": {
      // A workspace's own role, or a renamed built-in, by the name it had then.
      const role = entry.roleName ?? entry.role;
      return entry.to === null
        ? `removed ${name(entry.from)} as ${role}`
        : `made ${name(entry.to)} ${role}`;
    }
    case "update":
      return `posted an update: ${clipText(entry.body, UPDATE_CHARS)}`;
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

const LANGUAGE: Record<StatusLocale, string> = { en: "English", "pt-BR": "Brazilian Portuguese" };

/** The model's messages: what to write, and the incident as JSON. */
export function draftMessages(source: DraftSource): { role: "system" | "user"; content: string }[] {
  return [
    {
      role: "system",
      content: [
        "You write the first draft of a blameless incident postmortem for an engineering team.",
        `Write in ${LANGUAGE[source.locale]}. Use only facts in the incident data; when something is unknown, say`,
        "it needs to be filled in rather than inventing it. Blame no person. Plain text only: no Markdown headings;",
        'short paragraphs, and "- " lists where they help. Times in UTC.',
        "Answer with a JSON object with exactly these string keys:",
        "summary (what happened, in 2-4 sentences), impact (who and what was affected, for how long),",
        "timeline (the key moments, one per line, oldest first), rootCause (the likely cause, as far as the data",
        "shows), wentWell, wentPoorly, followUps (the follow-ups listed, and any the data suggests).",
        `Keep every value under ${POSTMORTEM_SECTION_MAX - 200} characters.`,
      ].join(" "),
    },
    { role: "user", content: JSON.stringify(source) },
  ];
}

// Controls (but newlines and tabs), format characters (bidi included), private use, unassigned and line/paragraph
// separators: never kept. Emoji joined with ZWJ fall apart into their parts, which still read.
const HIDDEN =
  /(?![\n\t])[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Variation_Selector}\p{Default_Ignorable_Code_Point}]/gu;

/** A section as the model wrote it, made fit to save: no hidden characters, at most `POSTMORTEM_SECTION_MAX`. */
export function cleanSection(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(HIDDEN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length <= POSTMORTEM_SECTION_MAX
    ? text
    : Array.from(text.slice(0, POSTMORTEM_SECTION_MAX)).slice(0, -1).join("").trim();
}

/** The sections out of the model's answer, or undefined when it holds none. */
export function parseDraft(output: unknown): PostmortemSections | undefined {
  let value: unknown = output;
  if (typeof value === "object" && value !== null && "response" in value) {
    value = (value as { response: unknown }).response;
  }
  if (typeof value === "string") {
    // The JSON object, even with words or a code fence around it.
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start < 0 || end <= start) return undefined;
    try {
      value = JSON.parse(value.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const sections = Object.fromEntries(
    POSTMORTEM_SECTIONS.map((key) => [key, cleanSection(record[key])]),
  ) as PostmortemSections;
  return POSTMORTEM_SECTIONS.some((key) => sections[key] !== "") ? sections : undefined;
}

const SCHEMA = {
  type: "object",
  properties: Object.fromEntries(POSTMORTEM_SECTIONS.map((key) => [key, { type: "string" }])),
  required: [...POSTMORTEM_SECTIONS],
};

/** Asks the model for a draft of `source`; never throws. */
export async function generateDraft(
  ai: AiBinding,
  source: DraftSource,
  timeoutMs = AI_TIMEOUT_MS,
): Promise<
  { ok: true; sections: PostmortemSections } | { ok: false; reason: PostmortemDraftFailure }
> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), timeoutMs);
  });
  try {
    const output = await Promise.race([
      ai.run(AI_MODEL, {
        messages: draftMessages(source),
        max_tokens: AI_MAX_TOKENS,
        temperature: 0.2,
        response_format: { type: "json_schema", json_schema: SCHEMA },
      }),
      late,
    ]);
    if (output === "late") return { ok: false, reason: "timeout" };
    const sections = parseDraft(output);
    return sections ? { ok: true, sections } : { ok: false, reason: "failed" };
  } catch (error) {
    console.error(JSON.stringify({ message: "Workers AI draft failed", error: String(error) }));
    return { ok: false, reason: "failed" };
  } finally {
    clearTimeout(timer);
  }
}

/** What `WorkspaceDO.requestPostmortemDraft` answers. */
export type DraftRequestResult =
  | { ok: true; requestId: string; source: DraftSource }
  | { ok: false; code: string };

/**
 * `POST /workspaces/:id/incidents/:incidentId/postmortem/draft` (body `{ locale }`, the asker's language, used when
 * the workspace has no status page language): responders and up, or an API token with `incident:update`. 503 `ai_unavailable` without the `AI` binding; 202
 * `{ requestId }` once the draft is pending, the draft itself arriving through sync.
 */
export async function requestDraftRoute(
  request: Request,
  env: Omit<Env, "AI"> & AiEnv,
  ctx: Pick<ExecutionContext, "waitUntil">,
  lazyAuth: () => Auth,
  workspaceId: string,
  incidentId: string,
): Promise<Response> {
  const member = await checkMember(
    request,
    env,
    lazyAuth,
    workspaceId,
    ["POST"],
    "incident:update",
    ctx.waitUntil.bind(ctx),
  );
  if (!member.ok) return member.response;
  if (!isId("inc", incidentId)) return json({ error: "not_found" }, 404);
  const ai = env.AI;
  if (!ai) return json({ error: "ai_unavailable" }, 503);
  const body = await readJson(request);
  const asked = (body as { locale?: unknown } | undefined)?.locale;
  const locale: StatusLocale = STATUS_LOCALES.find((one) => one === asked) ?? "en";
  const shard = env.WORKSPACE.getByName(workspaceId);
  let result: DraftRequestResult;
  try {
    result = await shard.requestPostmortemDraft(workspaceId, member.actor, incidentId, locale);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "WorkspaceDO.requestPostmortemDraft failed",
        workspaceId,
        error: String(error),
      }),
    );
    return json({ error: "unavailable" }, 503);
  }
  if (!result.ok) {
    if (result.code === "unauthenticated") return unauthenticated();
    return json({ error: result.code }, DRAFT_STATUS[result.code] ?? 500);
  }
  const { requestId, source } = result;
  ctx.waitUntil(
    (async () => {
      const outcome = await generateDraft(ai, source);
      try {
        await shard.finishPostmortemDraft(workspaceId, incidentId, requestId, outcome);
      } catch (error) {
        // The draft stays pending until it goes stale (`AI_DRAFT_STALE_MS`), then reads as failed.
        console.error(
          JSON.stringify({
            message: "writing a postmortem draft failed",
            workspaceId,
            error: String(error),
          }),
        );
      }
    })(),
  );
  return json({ requestId }, 202);
}
