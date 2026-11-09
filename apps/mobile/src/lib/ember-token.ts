// The Ember client's tokens for a workspace (RFC 0016 step 5): `POST /api/ember-token/:workspace` answers one for the
// session's member, as the dashboard asks (apps/web src/lib/sync.ts). The app asks once as it opens the workspace, so
// the client's first connect needs no second request (`primeToken`), then once per connect and refresh
// (`emberTokens`). Pure, so it is tested in Node.

export type Minted = { token: string; expiresAt: number };

export type TokenFetch = (
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

/** How long the app waits for the first token before it opens the workspace without one. */
export const PRIME_TIMEOUT_MS = 5000;

function minted(body: unknown): Minted | null {
  if (typeof body !== "object" || body === null) return null;
  const { token, expiresAt } = body as Record<string, unknown>;
  return typeof token === "string" && token !== "" && typeof expiresAt === "number"
    ? { token, expiresAt }
    : null;
}

/** A native fetch sends no cookies of its own: the session goes in the `Cookie` header. */
function post(fetchImpl: TokenFetch, url: string, cookie: string, signal?: AbortSignal) {
  return fetchImpl(url, {
    method: "POST",
    headers: { Cookie: cookie, accept: "application/json" },
    credentials: "omit",
    ...(signal ? { signal } : {}),
  });
}

/**
 * The client's first token, asked as the workspace opens. Nothing on any failure (offline, refused, a 5xx, no answer
 * in `timeoutMs`): the client then asks for its own on connect (`emberTokens`), which says why.
 */
export async function primeToken(
  url: string,
  cookie: string,
  fetchImpl: TokenFetch,
  timeoutMs: number = PRIME_TIMEOUT_MS,
): Promise<Minted | undefined> {
  try {
    return await deadline(async (signal) => {
      const response = await post(fetchImpl, url, cookie, signal);
      if (!response.ok) return undefined;
      return minted(await response.json().catch(() => null)) ?? undefined;
    }, timeoutMs);
  } catch {
    return undefined;
  }
}

/**
 * The Ember client's tokens for a workspace: the primed one first (while it has a minute left, as Ember's client
 * refreshes 30 s ahead), then a new one per connect and refresh. A refused session or membership is no token (the
 * client stops asking until the next connect).
 */
export function emberTokens({
  url,
  cookie,
  fetch: fetchImpl,
  primed,
  now = Date.now,
  timeoutMs = TOKEN_TIMEOUT_MS,
}: {
  url: string;
  cookie: () => string;
  fetch: TokenFetch;
  primed?: Minted;
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
    if (!response.ok) throw new Error(`Ember token: ${response.status}`);
    const token = minted(response.body);
    if (!token) throw new Error("Ember token: no token in the answer");
    return token.token;
  };
}
