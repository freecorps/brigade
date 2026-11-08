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

/** How long a token request (and its body) may take before it fails and Ember's client tries again. */
export const TOKEN_TIMEOUT_MS = 15_000;

/** `work` with an abort signal, rejected once `ms` passed. */
async function deadline<T>(work: (signal?: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const abort = typeof AbortController === "function" ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort?.abort();
      reject(new Error("Ember token: no answer in time"));
    }, ms);
  });
  try {
    const running = work(abort?.signal);
    // Lost to the deadline, its rejection (the abort) is nobody's: not left unhandled.
    running.catch(() => {});
    return await Promise.race([running, late]);
  } finally {
    clearTimeout(timer);
  }
}

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

/** The engines remembered for a member (secure storage): one per workspace. */
function engines(raw: string | null, userId: string): Record<string, WorkspaceEngine> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (value?.userId !== userId || typeof value.engines !== "object" || value.engines === null) {
      return {};
    }
    const out: Record<string, WorkspaceEngine> = {};
    for (const [workspaceId, engine] of Object.entries(value.engines)) {
      if (engine === "ember" || engine === "brigade") out[workspaceId] = engine;
    }
    return out;
  } catch {
    return {};
  }
}

/** The engine remembered for this member's workspace, or null. */
export function rememberedEngine(
  raw: string | null,
  userId: string,
  workspaceId: string,
): WorkspaceEngine | null {
  return engines(raw, userId)[workspaceId] ?? null;
}

/** The record `raw` with `workspaceId`'s engine set: every other workspace of the member keeps its own. */
export function engineRecord(
  raw: string | null,
  userId: string,
  workspaceId: string,
  engine: WorkspaceEngine,
): string {
  return JSON.stringify({ userId, engines: { ...engines(raw, userId), [workspaceId]: engine } });
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
  timeoutMs = TOKEN_TIMEOUT_MS,
}: {
  url: string;
  cookie: () => string;
  fetch: EngineFetch;
  primed?: Minted;
  onTurnedBack: () => void;
  now?: () => number;
  timeoutMs?: number;
}): () => Promise<string | null> {
  let first = primed;
  return async () => {
    const ready = first;
    first = undefined;
    if (ready && ready.expiresAt - now() > 60_000) return ready.token;
    // A request that hangs fails, so Ember's client asks again on its next connect instead of waiting on it.
    const response = await deadline(
      (signal) =>
        post(fetchImpl, url, cookie(), signal).then(async (answer) => ({
          status: answer.status,
          ok: answer.ok,
          body: answer.ok ? await answer.json().catch(() => null) : null,
        })),
      timeoutMs,
    );
    if (response.status === 401 || response.status === 403) return null;
    if (response.status === 409) {
      onTurnedBack();
      return null;
    }
    if (!response.ok) throw new Error(`Ember token: ${response.status}`);
    const token = minted(response.body);
    if (!token) throw new Error("Ember token: no token in the answer");
    return token.token;
  };
}
