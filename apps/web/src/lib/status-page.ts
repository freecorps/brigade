// The dashboard's side of the status page (RFC 0012): saving the page's settings through the API (the slug is
// claimed in D1, so it is not a socket mutation), its public address, and the card's wording. Pure apart from
// `fetch`; tested in test/status-page.test.tsx.
import { formatNumber, getLocale, m } from "@freecorps/brigade-i18n";
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

/** The subscribers card's text for `part` (packages/i18n `status_subscribers`). */
export function subscribersText(
  part: string,
  args: { confirmed?: number; pending?: number; email?: string; name?: string } = {},
): string {
  return m.status_subscribers({
    part,
    confirmed: formatNumber(args.confirmed ?? 0, getLocale()),
    pending: formatNumber(args.pending ?? 0, getLocale()),
    email: args.email ?? "",
    name: args.name ?? "",
  });
}

/**
 * How many subscribers there are and, of the confirmed, what they follow (RFC 0012 "Following components"):
 * `everything`, and each follow key (`statusFollowKey`) with its count. Absent from an older API.
 */
export type SubscriberCounts = {
  confirmed: number;
  pending: number;
  everything?: number;
  follows?: Record<string, number>;
};

const subscribersPath = (workspaceId: string) =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/status-page/subscribers`;

/** `GET …/status-page/subscribers`: how many confirmed and pending (owners and admins); null when it failed. */
export async function loadSubscriberCounts(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<SubscriberCounts | null> {
  try {
    const response = await fetcher(subscribersPath(workspaceId), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<SubscriberCounts>;
    if (typeof body.confirmed !== "number" || typeof body.pending !== "number") return null;
    const counts: SubscriberCounts = { confirmed: body.confirmed, pending: body.pending };
    if (typeof body.everything === "number") counts.everything = body.everything;
    if (body.follows && typeof body.follows === "object") {
      counts.follows = Object.fromEntries(
        Object.entries(body.follows).filter(([, n]) => typeof n === "number"),
      );
    }
    return counts;
  } catch {
    return null;
  }
}

/** The CSV export's address (a download, authenticated by the session cookie). */
export const subscribersExportUrl = (workspaceId: string) =>
  `${subscribersPath(workspaceId)}/export`;

/** `DELETE …/status-page/subscribers` `{ email }`. */
export async function removeSubscriber(
  workspaceId: string,
  email: string,
  fetcher: typeof fetch = fetch,
): Promise<"removed" | "not_found" | "failed"> {
  try {
    const response = await fetcher(subscribersPath(workspaceId), {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email }),
    });
    if (response.ok) return "removed";
    return response.status === 404 ? "not_found" : "failed";
  } catch {
    return "failed";
  }
}

/** Components as the public page lists them: the ungrouped ones first, then each group where its first one comes. */
export type ComponentBlock<T> = { group: string | null; components: T[] };

export function componentBlocks<T extends { group: string | null }>(
  components: readonly T[],
): ComponentBlock<T>[] {
  const blocks: ComponentBlock<T>[] = [];
  for (const component of components) {
    let block = blocks.find((candidate) => candidate.group === component.group);
    if (!block) {
      block = { group: component.group, components: [] };
      if (component.group === null) blocks.unshift(block);
      else blocks.push(block);
    }
    block.components.push(component);
  }
  return blocks;
}

const flatten = <T extends { id: string }>(blocks: readonly ComponentBlock<T>[]) =>
  blocks.flatMap((block) => block.components.map((component) => component.id));

/**
 * Every component's id once a component moves `by` places within its group (`statusComponent.reorder` takes them
 * all); null when it cannot move that way.
 */
export function moveComponent<T extends { id: string; group: string | null }>(
  components: readonly T[],
  id: string,
  by: -1 | 1,
): string[] | null {
  const blocks = componentBlocks(components);
  for (const block of blocks) {
    const at = block.components.findIndex((component) => component.id === id);
    if (at < 0) continue;
    const to = at + by;
    if (to < 0 || to >= block.components.length) return null;
    const moved = [...block.components];
    [moved[at], moved[to]] = [moved[to]!, moved[at]!];
    block.components = moved;
    return flatten(blocks);
  }
  return null;
}

/** Every component's id once a group moves `by` places among the groups (the ungrouped ones stay first); or null. */
export function moveGroup<T extends { id: string; group: string | null }>(
  components: readonly T[],
  group: string,
  by: -1 | 1,
): string[] | null {
  const blocks = componentBlocks(components);
  const first = blocks[0]?.group === null ? 1 : 0;
  const at = blocks.findIndex((block) => block.group === group);
  const to = at + by;
  if (at < 0 || to < first || to >= blocks.length) return null;
  [blocks[at], blocks[to]] = [blocks[to]!, blocks[at]!];
  return flatten(blocks);
}

/**
 * The services to link a component to once its form is saved, or null when that changes nothing. Compared with what
 * the row stores minus the services known to be deleted, never with an empty list: before the workspace's services
 * have loaded (`known` undefined) nothing is linked or unlinked, so a rename cannot take every link off.
 */
export function servicesToLink(
  stored: readonly string[],
  known: readonly { id: string }[] | undefined,
  chosen: readonly string[],
): string[] | null {
  if (!known) return null;
  const kept = stored.filter((id) => known.some((service) => service.id === id));
  return chosen.join() === kept.join() ? null : [...chosen];
}
