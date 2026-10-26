// The notice the owner of an address gets once after taking back an account someone else signed up with (RFC 0002
// "Auth"): which workspaces they inherited and what Brigade paused there. Read from and dismissed at the API's
// `/account/takeover` (apps/api `takeoverNotice`). Pure, so test/takeover-notice.test.tsx checks every answer.

export const TAKEOVER_PATH = "/api/account/takeover";

/** One inherited workspace: the monitors paused (their names), heartbeat URLs turned off, or that nothing could be. */
export type InheritedWorkspace = {
  id: string;
  name: string;
  paused: string[];
  revoked: number;
  failed: boolean;
};

/** The workspaces in the API's answer, or undefined for no notice or a body that is not the shape. */
export function parseTakeover(body: unknown): InheritedWorkspace[] | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const notice: unknown = Reflect.get(body, "notice");
  if (typeof notice !== "object" || notice === null) return undefined;
  const workspaces: unknown = Reflect.get(notice, "workspaces");
  if (!Array.isArray(workspaces)) return undefined;
  const parsed = workspaces.flatMap((one: unknown): InheritedWorkspace[] => {
    if (typeof one !== "object" || one === null) return [];
    const { id, name, paused, revoked, failed } = one as Record<string, unknown>;
    if (typeof id !== "string" || typeof name !== "string") return [];
    if (!Array.isArray(paused) || !paused.every((item) => typeof item === "string")) return [];
    if (typeof revoked !== "number" || typeof failed !== "boolean") return [];
    return [{ id, name, paused, revoked, failed }];
  });
  return parsed.length > 0 ? parsed : undefined;
}

/** The signed-in user's notice; undefined without one, or when it cannot be read (it is shown again next time). */
export async function fetchTakeover(
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<InheritedWorkspace[] | undefined> {
  try {
    const response = await fetcher(TAKEOVER_PATH, {
      signal,
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return undefined;
    return parseTakeover(await response.json());
  } catch {
    return undefined;
  }
}

/** Dismisses the notice for good; false when that failed. */
export async function dismissTakeover(fetcher: typeof fetch): Promise<boolean> {
  try {
    const response = await fetcher(TAKEOVER_PATH, {
      method: "DELETE",
      credentials: "same-origin",
    });
    return response.ok;
  } catch {
    return false;
  }
}
