// Opening the incident a page's notification is about, when the member taps it (Android, RFC 0006): the native
// module hands over the incident, workspace and (version 2) instance it decrypted; the app switches to that instance
// and workspace if others are open, then opens the incident. Pure, so it is tested in Node; src/hooks/use-page-taps.ts
// wires it.
import { originOf } from "@/lib/instances";

export type OpenedPage = { incident: string; workspace: string; origin?: string };

const INCIDENT = /^inc_[0-9A-Za-z]{1,64}$/;
const WORKSPACE = /^[0-9A-Za-z_-]{1,128}$/;

/** A tapped page from native code, checked; null for anything else (a page sealed by an instance from before ids). */
export function openedPage(value: unknown): OpenedPage | null {
  if (typeof value !== "object" || value === null) return null;
  const incident: unknown = Reflect.get(value, "incident");
  const workspace: unknown = Reflect.get(value, "workspace");
  const origin: unknown = Reflect.get(value, "origin");
  if (typeof incident !== "string" || !INCIDENT.test(incident)) return null;
  if (typeof workspace !== "string" || !WORKSPACE.test(workspace)) return null;
  if (origin === undefined || origin === null) return { incident, workspace };
  // An origin that is not one is no page: it could not say which instance to open. One written otherwise (a trailing
  // slash, the default port, upper case) is the same instance.
  const normalized = typeof origin === "string" ? bareOrigin(origin) : undefined;
  if (normalized === undefined) return null;
  return { incident, workspace, origin: normalized };
}

/** `value` as `URL.origin` writes it, if it is an origin and nothing more (no path, query, fragment or user). */
function bareOrigin(value: string): string | undefined {
  const origin = originOf(value);
  if (origin === undefined) return undefined;
  const url = new URL(value);
  const bare = url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  return bare ? origin : undefined;
}

/**
 * What to do with a tapped page now: `open` it in the workspace that is open, `instance` to switch to the instance it
 * came from first, `switch` to its workspace (the app opens that one from scratch, so the page waits), `wait` for a
 * signed-in member, or `drop` it: its instance is not on this phone (removed), so nothing opens or is sent.
 * `instance`: the instance the page is for (src/lib/page-action.ts `pageInstance`), `active` the one the app shows.
 */
export function tapStep(
  page: OpenedPage,
  at: { instance: string | undefined; active: string | undefined },
  workspace: string | undefined,
  switching: boolean,
): "open" | "instance" | "switch" | "wait" | "drop" {
  if (at.instance === undefined) return page.origin === undefined ? "wait" : "drop";
  if (at.instance !== at.active) return "instance";
  if (workspace === undefined) return "wait";
  if (workspace === page.workspace) return "open";
  return switching ? "wait" : "switch";
}

/** The route that finds an incident by id and shows it by number (src/app/incidents/by-id/[id].tsx). */
export function incidentByIdRoute(incident: string): string {
  return `/incidents/by-id/${encodeURIComponent(incident)}`;
}
