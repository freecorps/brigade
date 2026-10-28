// Opening the incident a page's notification is about, when the member taps it (Android, RFC 0006): the native
// module hands over the incident and workspace it decrypted; the app switches to that workspace if another is open,
// then opens the incident. Pure, so it is tested in Node; src/hooks/use-page-taps.ts wires it.

export type OpenedPage = { incident: string; workspace: string };

const INCIDENT = /^inc_[0-9A-Za-z]{1,64}$/;
const WORKSPACE = /^[0-9A-Za-z_-]{1,128}$/;

/** A tapped page from native code, checked; null for anything else (a page sealed by an instance from before ids). */
export function openedPage(value: unknown): OpenedPage | null {
  if (typeof value !== "object" || value === null) return null;
  const incident: unknown = Reflect.get(value, "incident");
  const workspace: unknown = Reflect.get(value, "workspace");
  if (typeof incident !== "string" || !INCIDENT.test(incident)) return null;
  if (typeof workspace !== "string" || !WORKSPACE.test(workspace)) return null;
  return { incident, workspace };
}

/**
 * What to do with a tapped page now: `open` it in the workspace that is open, `switch` to its workspace first (the
 * app opens that one from scratch, so the page waits), or `wait` for a signed-in member.
 */
export function tapStep(
  page: OpenedPage,
  active: string | undefined,
  switching: boolean,
): "open" | "switch" | "wait" {
  if (active === undefined) return "wait";
  if (active === page.workspace) return "open";
  return switching ? "wait" : "switch";
}

/** The route that finds an incident by id and shows it by number (src/app/incidents/by-id/[id].tsx). */
export function incidentByIdRoute(incident: string): string {
  return `/incidents/by-id/${encodeURIComponent(incident)}`;
}
