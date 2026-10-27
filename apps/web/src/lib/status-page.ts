// The dashboard's side of the status page (RFC 0012): saving the page's settings through the API (the slug is
// claimed in D1, so it is not a socket mutation), its public address, and the card's wording. Pure apart from
// `fetch`; tested in test/status-page.test.tsx.
import { m } from "@freecorps/brigade-i18n";
import type { StatusLocale } from "@freecorps/brigade-schema";

/** The card's text for `part` (packages/i18n `status_card`). */
export function statusCardText(
  part: string,
  args: { url?: string; name?: string; status?: string } = {},
): string {
  return m.status_card({
    part,
    url: args.url ?? "",
    name: args.name ?? "",
    status: args.status ?? "",
  });
}

/** Shared wording of the public page (`status_text`): component and public statuses. */
export function statusText(part: string): string {
  return m.status_text({ part, time: "", list: "" });
}

export type StatusSettings = {
  slug: string;
  title: string;
  locale: StatusLocale;
  enabled: boolean;
};

export type StatusSaveError =
  | "slug_taken"
  | "invalid_args"
  | "forbidden"
  | "not_applied"
  | "unavailable"
  | "network";

/** `PUT /api/workspaces/:id/status-page`. */
export async function saveStatusPage(
  workspaceId: string,
  settings: StatusSettings,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: StatusSaveError }> {
  let response: Response;
  try {
    response = await fetcher(`/api/workspaces/${encodeURIComponent(workspaceId)}/status-page`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(settings),
    });
  } catch {
    return { ok: false, error: "network" };
  }
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => ({}))) as { error?: unknown };
  const known: StatusSaveError[] = ["slug_taken", "invalid_args", "forbidden", "not_applied"];
  const error = known.find((code) => code === body.error);
  return {
    ok: false,
    error: error ?? (body.error === "not_a_member" ? "forbidden" : "unavailable"),
  };
}

/** What the card says for a refused save. */
export function saveErrorPart(error: StatusSaveError): string {
  if (error === "slug_taken") return "slug_taken";
  // The form checks the address with the server's own pattern first, so what the server still refuses is the name
  // (characters the form lets through and the server does not, such as invisible ones).
  if (error === "invalid_args") return "title_required";
  if (error === "forbidden") return "manage_only";
  return "save_failed";
}

/** The page's public address on this origin. */
export function statusUrl(slug: string, origin: string): string {
  return `${origin}/status/${slug}`;
}

/** A typed slug: trimmed and lower-cased, as people paste it. */
export function normalizeSlug(input: string): string {
  return input.trim().toLowerCase();
}
