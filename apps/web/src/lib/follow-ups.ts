// Follow-ups, the postmortem and exports on the dashboard (RFC 0013): their wording, the reader's calendar for due
// dates, and the API calls that are not socket mutations (an AI draft, an export, what this server can do). Pure apart
// from `fetch`; tested in test/follow-ups.test.tsx.
import { m } from "@freecorps/brigade-i18n";
import { formatDateTime, type Locale } from "@freecorps/brigade-i18n";
import {
  isFieldLink,
  newId,
  type ExportScope,
  type PostmortemSections,
  type StatusLocale,
} from "@freecorps/brigade-schema";
import { useEffect, useState } from "react";

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
export const newFollowUpId = (now: number) => newId("fup", now, random);

type Inputs = {
  name?: string;
  date?: string;
  count?: string | number;
  reason?: string;
  time?: string;
};

/** `followup_text` without the inputs a part does not use. */
export function followUpText(text: string, inputs: Inputs = {}): string {
  return m.followup_text({
    text,
    name: inputs.name ?? "",
    date: inputs.date ?? "",
    count: String(inputs.count ?? ""),
    reason: inputs.reason ?? "",
  });
}

/** `postmortem_text` without the inputs a part does not use. */
export function postmortemText(part: string, inputs: Inputs = {}): string {
  return m.postmortem_text({
    part,
    name: inputs.name ?? "",
    time: inputs.time ?? "",
    count: String(inputs.count ?? ""),
    reason: inputs.reason ?? "",
  });
}

/** `export_text` without the inputs a part does not use. */
export function exportText(part: string, inputs: Inputs = {}): string {
  return m.export_text({
    part,
    name: inputs.name ?? "",
    time: inputs.time ?? "",
    count: String(inputs.count ?? ""),
    reason: inputs.reason ?? "",
  });
}

/** `YYYY-MM-DD` of `now` on the reader's own calendar: a follow-up is overdue from the day after its due date. */
export function localDate(now: number, timeZone?: string): string {
  // `en-CA` writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeZone && { timeZone }),
  }).format(now);
}

/** A due date (`YYYY-MM-DD`) in the reader's words: "Nov 2, 2026". Read as a calendar day, never shifted by a zone. */
export function formatDueDate(date: string, locale: Locale): string {
  return formatDateTime(Date.parse(`${date}T12:00:00Z`), locale, "UTC", { dateStyle: "medium" });
}

/** A link a follow-up may keep: empty (none) or an `http(s)` URL. */
export const linkProblem = (value: string) =>
  value.trim() !== "" && !isFieldLink(value.trim()) ? followUpText("link_invalid") : undefined;

/**
 * What this server can do beyond the basics (`GET /api/features`); both off until it answers. `maxMonitors`: the most
 * monitors a workspace may have on this instance (RFC 0007 "Limits"), absent until it answers.
 */
export type Features = { ai: boolean; exports: boolean; maxMonitors?: number };

let cached: Promise<Features> | undefined;

/** Fetched once per page load: bindings change only with a deploy. */
export function loadFeatures(fetcher: typeof fetch = fetch): Promise<Features> {
  cached ??= fetcher("/api/features", { headers: { Accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as Partial<Features>;
      const max = body.maxMonitors;
      return {
        ai: body.ai === true,
        exports: body.exports === true,
        ...(Number.isSafeInteger(max) && max! > 0 && { maxMonitors: max }),
      };
    })
    .catch(() => {
      // Asked again next time: a failed answer is no reason to hide them for good.
      cached = undefined;
      return { ai: false, exports: false };
    });
  return cached;
}

/** Forgets the cached answer (tests). */
export function resetFeatures() {
  cached = undefined;
}

export function useFeatures(): Features {
  const [features, setFeatures] = useState<Features>({ ai: false, exports: false });
  useEffect(() => {
    let live = true;
    void loadFeatures().then((next) => live && setFeatures(next));
    return () => {
      live = false;
    };
  }, []);
  return features;
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: unknown };
  return typeof body.error === "string" ? body.error : "internal";
}

/** `POST /api/workspaces/:id/incidents/:incidentId/postmortem/draft`: the draft then arrives through sync. */
export async function requestDraft(
  workspaceId: string,
  incidentId: string,
  locale: StatusLocale,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetcher(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/incidents/${encodeURIComponent(incidentId)}/postmortem/draft`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ locale }),
      },
    );
    return response.ok ? { ok: true } : { ok: false, error: await errorCode(response) };
  } catch {
    return { ok: false, error: "network" };
  }
}

/** One kept revision of a postmortem, as `GET …/postmortem/revisions` answers it (RFC 0013 "Revision history"). */
export type PostmortemRevision = {
  revision: number;
  sections: PostmortemSections;
  savedAt: number;
  savedBy: string;
  ai: boolean;
};

/** `GET /api/workspaces/:id/incidents/:incidentId/postmortem/revisions`: the kept revisions, newest first. */
export async function loadRevisions(
  workspaceId: string,
  incidentId: string,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; revisions: PostmortemRevision[] } | { ok: false; error: string }> {
  try {
    const response = await fetcher(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/incidents/${encodeURIComponent(incidentId)}/postmortem/revisions`,
      { headers: { Accept: "application/json" } },
    );
    if (!response.ok) return { ok: false, error: await errorCode(response) };
    const body = (await response.json()) as { revisions: PostmortemRevision[] };
    return { ok: true, revisions: body.revisions };
  } catch {
    return { ok: false, error: "network" };
  }
}

/** `POST /api/workspaces/:id/exports`: the new export's id, to download. */
export async function createExport(
  workspaceId: string,
  scope: ExportScope,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const response = await fetcher(`/api/workspaces/${encodeURIComponent(workspaceId)}/exports`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ scope }),
    });
    if (!response.ok) return { ok: false, error: await errorCode(response) };
    const body = (await response.json()) as { id: string };
    return { ok: true, id: body.id };
  } catch {
    return { ok: false, error: "network" };
  }
}

/** Where an export is downloaded: the API streams it, as the signed-in owner or admin. */
export const exportUrl = (workspaceId: string, exportId: string) =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/exports/${encodeURIComponent(exportId)}`;
