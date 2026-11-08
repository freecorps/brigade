// Which client the app opens a workspace with (RFC 0016 step 5): Ember's for a workspace on Ember, Brigade Sync's
// otherwise. Asked as the dashboard asks (apps/web src/lib/sync.ts): `POST /api/ember-token/:workspace` answers a
// token for a workspace on Ember (the client's first one), 409 for one on `WorkspaceDO`, 404 on an instance from
// before Ember (a self-hosted one not migrated, RFC 0015). It is asked per workspace, not per instance, because an
// instance holds workspaces on both engines while it migrates. When nothing answers (offline, a 5xx), the engine last
// known for the workspace is used, and Brigade Sync without one: the Brigade Sync adapter serves a workspace on Ember
// too, so a wrong guess still works. Pure, so it is tested in Node.

export type WorkspaceEngine = "ember" | "brigade";

export type Minted = { token: string; expiresAt: number };

export type Probe =
  /** On Ember, with a token for the client's first connect. */
  | { engine: "ember"; minted: Minted }
  /** On `WorkspaceDO` (409) or an instance without Ember (404): remembered. */
  | { engine: "brigade"; remember: true }
  /**
   * Not answered as either: the session or membership was refused (401, 403), which Brigade Sync's socket reports as
   * before, so `brigade`; nothing remembered.
   */
  | { engine: "brigade"; remember: false }
  /** Not reached, or the server could not say: the engine last known. */
  | { engine: undefined };

export type EngineFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    credentials: "omit";
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** How long the app waits for the answer before it opens the workspace with the engine last known. */
export const PROBE_TIMEOUT_MS = 5000;

function minted(body: unknown): Minted | null {
  if (typeof body !== "object" || body === null) return null;
  const { token, expiresAt } = body as Record<string, unknown>;
  return typeof token === "string" && token !== "" && typeof expiresAt === "number"
    ? { token, expiresAt }
    : null;
}

/** A native fetch sends no cookies of its own: the session goes in the `Cookie` header, as on the sync upgrade. */
function post(fetchImpl: EngineFetch, url: string, cookie: string, signal?: AbortSignal) {
  return fetchImpl(url, {
    method: "POST",
    headers: { Cookie: cookie, accept: "application/json" },
    credentials: "omit",
    ...(signal ? { signal } : {}),
  });
}

export async function probeEngine(
  url: string,
  cookie: string,
  fetchImpl: EngineFetch,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<Probe> {
  const abort = typeof AbortController === "function" ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Probe>((resolve) => {
    timer = setTimeout(() => {
      abort?.abort();
      resolve({ engine: undefined });
    }, timeoutMs);
  });
  const asked = (async (): Promise<Probe> => {
    try {
      const response = await post(fetchImpl, url, cookie, abort?.signal);
      if (response.status === 409 || response.status === 404) {
        return { engine: "brigade", remember: true };
      }
      if (response.status === 401 || response.status === 403) {
        return { engine: "brigade", remember: false };
      }
      if (!response.ok) return { engine: undefined };
      const token = minted(await response.json().catch(() => null));
      return token ? { engine: "ember", minted: token } : { engine: undefined };
    } catch {
      return { engine: undefined };
    }
  })();
  try {
    return await Promise.race([asked, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The engine to open with: the probe's, else the one remembered, else Brigade Sync. */
export function chosenEngine(probe: Probe, remembered: WorkspaceEngine | null): WorkspaceEngine {
  return probe.engine ?? remembered ?? "brigade";
}

/** The engine remembered for this member's workspace (secure storage), or null. */
export function rememberedEngine(
  raw: string | null,
  userId: string,
  workspaceId: string,
): WorkspaceEngine | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (value?.userId !== userId || value.workspaceId !== workspaceId) return null;
    return value.engine === "ember" || value.engine === "brigade" ? value.engine : null;
  } catch {
    return null;
  }
}

export function engineRecord(userId: string, workspaceId: string, engine: WorkspaceEngine): string {
  return JSON.stringify({ userId, workspaceId, engine });
}

/**
 * The Ember client's tokens for a workspace: the probe's first (while it has a minute left, as Ember's client
 * refreshes 30 s ahead), then a new one per connect and refresh. A refused session or membership is no token (the
 * client stops asking until the next connect). 409: the workspace was turned back to `WorkspaceDO` (RFC 0016 `back`),
 * so `onTurnedBack` opens it again on Brigade Sync.
 */
export function emberTokens({
  url,
  cookie,
  fetch: fetchImpl,
  primed,
  onTurnedBack,
  now = Date.now,
}: {
  url: string;
  cookie: () => string;
  fetch: EngineFetch;
  primed?: Minted;
  onTurnedBack: () => void;
  now?: () => number;
}): () => Promise<string | null> {
  let first = primed;
  return async () => {
    const ready = first;
    first = undefined;
    if (ready && ready.expiresAt - now() > 60_000) return ready.token;
    const response = await post(fetchImpl, url, cookie());
    if (response.status === 401 || response.status === 403) return null;
    if (response.status === 409) {
      onTurnedBack();
      return null;
    }
    if (!response.ok) throw new Error(`Ember token: ${response.status}`);
    const token = minted(await response.json().catch(() => null));
    if (!token) throw new Error("Ember token: no token in the answer");
    return token.token;
  };
}
