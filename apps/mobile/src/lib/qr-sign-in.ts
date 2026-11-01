// Signing in with the dashboard's QR code (RFC 0015 section 6, D2), the phone's side of apps/api src/app-sign-in.ts as
// docs/api/openapi.json describes it: the phone claims the code (`POST /api/app-sign-in/claim`), shows the 2-digit
// number the member types on the dashboard, and polls its claim (`GET /api/app-sign-in/claim/:id`, with the secret
// only it got) until the member approves (a new session, stored for that instance only), denies, or time runs out.
// Pure, so it is tested in Node; src/screens/connect.tsx runs it with fetch and the instance's session storage.
import { RELAY_TIMEOUT_MS } from "@/lib/relay";

/** How often the phone asks whether the member answered. */
export const POLL_INTERVAL_MS = 2_000;
/** Past the claim's `expiresAt` by this much with no answer, the phone stops asking: the server has ended it. */
export const POLL_GRACE_MS = 5_000;
/**
 * The longest the phone asks past the claim's first `expiresAt`, whatever later one the server answers: an approval
 * gives the phone at least 30 s to pick its session up (apps/api `APP_SIGN_IN_PICKUP_MS`), and no claim is worth more.
 */
export const POLL_CAP_MS = 30_000;

const CLAIM_ID = /^asi_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const NUMBER = /^[0-9]{2}$/;

/**
 * Why a sign-in ended without a session. From the server: `denied` (Deny on the dashboard), `wrong_number` (another
 * number typed), `timeout` (2 minutes passed), `delivered` (the session went to an earlier poll), `signed_out` (the
 * dashboard session that showed the code signed out). From the phone: `invalid_code` (unknown, spent or past its
 * time, which the server does not tell apart), `rate_limited`, `unreachable` (no answer to the claim), `lost` (the
 * server no longer knows the claim), `not_stored` (the session could not be kept on the phone), `already` (by the
 * time it was approved, the phone had a session at that instance, which a QR sign-in never replaces).
 */
export type EndReason =
  | "denied"
  | "wrong_number"
  | "timeout"
  | "delivered"
  | "signed_out"
  | "invalid_code"
  | "rate_limited"
  | "unreachable"
  | "lost"
  | "not_stored"
  | "already";

const SERVER_REASONS: ReadonlySet<string> = new Set([
  "denied",
  "wrong_number",
  "timeout",
  "delivered",
  "signed_out",
]);

export type SignedInUser = { id: string; name: string; email: string };

export type ClaimState =
  | { step: "claiming" }
  /** Claimed: the phone shows `number` until the member types it on the dashboard. */
  | { step: "waiting"; number: string; expiresAt: number }
  | { step: "signed-in"; user: SignedInUser }
  | { step: "ended"; reason: EndReason };

export type Claimed = { claimId: string; secret: string; number: string; expiresAt: number };

type Fetch = (url: string, init: RequestInit) => Promise<Pick<Response, "status" | "ok" | "json">>;

/** `POST /api/app-sign-in/claim`'s answer read; anything off-contract is `unreachable`, as no answer is. */
export function readClaim(status: number, body: unknown): Claimed | { ended: EndReason } {
  if (status === 404) return { ended: "invalid_code" };
  if (status === 429) return { ended: "rate_limited" };
  if (status !== 201 || typeof body !== "object" || body === null) return { ended: "unreachable" };
  const { claimId, secret, number, expiresAt } = body as Record<string, unknown>;
  const at = typeof expiresAt === "string" ? Date.parse(expiresAt) : NaN;
  if (
    typeof claimId !== "string" ||
    !CLAIM_ID.test(claimId) ||
    typeof secret !== "string" ||
    !SECRET.test(secret) ||
    typeof number !== "string" ||
    !NUMBER.test(number) ||
    Number.isNaN(at)
  ) {
    return { ended: "unreachable" };
  }
  return { claimId, secret, number, expiresAt: at };
}

/** What one poll said: still waiting (with the claim's end, which an approval moves), signed in, ended, or no answer. */
export type Poll =
  | { kind: "pending"; expiresAt?: number }
  | { kind: "approved"; cookie: string; user: SignedInUser }
  | { kind: "ended"; reason: EndReason }
  | { kind: "retry" };

/** `GET /api/app-sign-in/claim/:id`'s answer read. A server error is `retry` (until the claim's time is up). */
export function readPoll(status: number, body: unknown): Poll {
  if (status === 404) return { kind: "ended", reason: "lost" };
  if (status !== 200 || typeof body !== "object" || body === null) return { kind: "retry" };
  const value = body as Record<string, unknown>;
  if (value.status === "pending") {
    const at = typeof value.expiresAt === "string" ? Date.parse(value.expiresAt) : NaN;
    return Number.isNaN(at) ? { kind: "pending" } : { kind: "pending", expiresAt: at };
  }
  if (value.status === "expired") {
    const reason = typeof value.reason === "string" ? value.reason : "";
    // A reason this app does not know yet still ends it.
    return {
      kind: "ended",
      reason: SERVER_REASONS.has(reason) ? (reason as EndReason) : "timeout",
    };
  }
  if (value.status === "approved") {
    const session = value.session as Record<string, unknown> | undefined;
    const user = value.user as Record<string, unknown> | undefined;
    const cookie = session?.cookie;
    if (
      typeof cookie === "string" &&
      cookie !== "" &&
      typeof user?.id === "string" &&
      typeof user.email === "string"
    ) {
      return {
        kind: "approved",
        cookie,
        user: {
          id: user.id,
          email: user.email,
          name: typeof user.name === "string" ? user.name : "",
        },
      };
    }
    // Approved with a session this app cannot read: the session was handed out and cannot be asked for again.
    return { kind: "ended", reason: "not_stored" };
  }
  return { kind: "retry" };
}

export type ClaimDeps = {
  fetch: Fetch;
  now: () => number;
  /** Resolves after `ms`. */
  sleep: (ms: number) => Promise<void>;
  /**
   * Keeps the session for the instance the code came from, and only it: src/lib/auth-client.ts `storeSessionCookie`
   * under that instance's storage prefix. Throws when it could not; a `SessionExists` when the phone has a session
   * there already (never replaced).
   */
  store: (cookie: string) => Promise<void>;
  onState: (state: ClaimState) => void;
  /** True once the member left the screen: nothing more is asked or stored. */
  cancelled: () => boolean;
};

/**
 * Claims `code` at the instance at `origin` as `deviceName` on `platform`, shows the number and polls until the
 * sign-in ends; returns how. The session is stored (`deps.store`) only on an approval, once, before `signed-in`.
 */
export async function runClaim(
  input: { origin: string; code: string; deviceName: string; platform: "ios" | "android" },
  deps: ClaimDeps,
): Promise<ClaimState> {
  const finish = (state: ClaimState): ClaimState => {
    if (!deps.cancelled()) deps.onState(state);
    return state;
  };
  deps.onState({ step: "claiming" });
  let claimed: Claimed;
  try {
    const response = await inTime((signal) =>
      deps.fetch(`${input.origin}/api/app-sign-in/claim`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          code: input.code,
          deviceName: input.deviceName,
          platform: input.platform,
        }),
        signal,
      }),
    );
    const read = readClaim(response.status, await response.json().catch(() => null));
    if ("ended" in read) return finish({ step: "ended", reason: read.ended });
    claimed = read;
  } catch {
    return finish({ step: "ended", reason: "unreachable" });
  }
  if (deps.cancelled()) return { step: "ended", reason: "timeout" };
  deps.onState({ step: "waiting", number: claimed.number, expiresAt: claimed.expiresAt });
  let expiresAt = claimed.expiresAt;
  const cap = claimed.expiresAt + POLL_CAP_MS;
  const url = `${input.origin}/api/app-sign-in/claim/${encodeURIComponent(claimed.claimId)}`;
  for (;;) {
    await deps.sleep(POLL_INTERVAL_MS);
    if (deps.cancelled()) return { step: "ended", reason: "timeout" };
    let poll: Poll;
    try {
      const response = await inTime((signal) =>
        deps.fetch(url, {
          headers: { authorization: `Bearer ${claimed.secret}`, accept: "application/json" },
          signal,
        }),
      );
      poll = readPoll(response.status, await response.json().catch(() => null));
    } catch {
      poll = { kind: "retry" };
    }
    if (poll.kind === "approved") {
      // Handed out once: a session that came is stored even if the member just left the screen, so it is not lost
      // on the server unseen (it is listed and revocable there either way).
      try {
        await deps.store(poll.cookie);
      } catch (error) {
        return finish({
          step: "ended",
          reason: error instanceof SessionExists ? "already" : "not_stored",
        });
      }
      return finish({ step: "signed-in", user: poll.user });
    }
    if (poll.kind === "ended") return finish({ step: "ended", reason: poll.reason });
    if (poll.kind === "pending" && poll.expiresAt !== undefined) expiresAt = poll.expiresAt;
    if (deps.now() > Math.min(expiresAt + POLL_GRACE_MS, cap))
      return finish({ step: "ended", reason: "timeout" });
  }
}

/** Thrown by a `store` that found a session at the instance already: a QR sign-in never replaces one. */
export class SessionExists extends Error {
  constructor() {
    super("A session is kept for this instance already");
    this.name = "SessionExists";
  }
}

async function inTime<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  // Not `AbortSignal.timeout`, which Hermes may lack.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), RELAY_TIMEOUT_MS);
  try {
    return await run(abort.signal);
  } finally {
    clearTimeout(timer);
  }
}
