// The dashboard's side of signing in to the app with a QR code (RFC 0015 section 6, apps/api src/app-sign-in.ts): ask
// for a code, follow it until a phone claims it, then send the number the member types, or deny. The number the phone
// shows never reaches the dashboard: only the member's typing brings it here.

/** What the dashboard sees of its request (`GET /api/app-sign-in/:id`). */
export type SignInStatus =
  | "waiting"
  | "claimed"
  | "approved"
  | "signed_in"
  | "denied"
  | "wrong_number"
  | "expired";

export type SignInView = {
  id: string;
  status: SignInStatus;
  /** When the code (or, once claimed, the claim) runs out, in ms since the epoch. */
  expiresAt: number;
  deviceName?: string;
};

export type Created = SignInView & { url: string };

/** Ended: no poll changes it any more. */
export const ENDED: readonly SignInStatus[] = ["signed_in", "denied", "wrong_number", "expired"];

/** How often the dashboard asks where its request is. */
export const POLL_MS = 1500;

/** The address-only QR: adds this instance to the app, which signs in there another way. */
export function connectUrl(origin: string): string {
  return `brigade://connect?${new URLSearchParams({ server: origin }).toString()}`;
}

/** `1:42`, from milliseconds left (never below `0:00`). */
export function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Two digits, as the phone shows them: what the approve button waits for. */
export const NUMBER = /^[0-9]{2}$/;

/** What the member typed, as digits only (a space, a dash or full-width digits from some keyboards dropped). */
export function typedNumber(value: string): string {
  return value
    .normalize("NFKC")
    .replaceAll(/[^0-9]/g, "")
    .slice(0, 2);
}

type Failure = { ok: false; reason: "rate_limited" | "failed" | "unauthenticated" };

/** `POST /api/app-sign-in`: a new code, and the QR's `brigade://connect` URL. */
export async function createSignIn(
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; value: Created } | Failure> {
  try {
    const response = await fetcher("/api/app-sign-in", {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    if (response.status === 429) return { ok: false, reason: "rate_limited" };
    if (response.status === 401) return { ok: false, reason: "unauthenticated" };
    if (response.status !== 201) return { ok: false, reason: "failed" };
    const body = (await response.json()) as { id: string; url: string; expiresAt: string };
    return {
      ok: true,
      value: {
        id: body.id,
        url: body.url,
        status: "waiting",
        expiresAt: Date.parse(body.expiresAt),
      },
    };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** `GET /api/app-sign-in/:id`; undefined when it could not be read this time (the next poll tries again). */
export async function readSignIn(
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<SignInView | undefined> {
  try {
    const response = await fetcher(`/api/app-sign-in/${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json" },
    });
    // Gone (another session, or deleted a day after it ended): nothing more will happen to it.
    if (response.status === 404) return { id, status: "expired", expiresAt: 0 };
    if (!response.ok) return undefined;
    const body = (await response.json()) as {
      id: string;
      status: SignInStatus;
      expiresAt: string;
      deviceName?: string;
    };
    return {
      id: body.id,
      status: body.status,
      expiresAt: Date.parse(body.expiresAt),
      ...(body.deviceName === undefined ? {} : { deviceName: body.deviceName }),
    };
  } catch {
    return undefined;
  }
}

/**
 * `POST /api/app-sign-in/:id/approve { number }` or `…/deny`: the status it moved to (`approved`, `denied`,
 * `wrong_number`), the one the request already had when there was nothing to answer, or `failed`.
 */
export async function answerSignIn(
  id: string,
  answer: { approve: string } | "deny",
  fetcher: typeof fetch = fetch,
): Promise<SignInStatus | "failed"> {
  try {
    const approve = answer !== "deny";
    const response = await fetcher(
      `/api/app-sign-in/${encodeURIComponent(id)}/${approve ? "approve" : "deny"}`,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        ...(approve ? { body: JSON.stringify({ number: answer.approve }) } : {}),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      status?: SignInStatus;
      error?: string;
    };
    if (response.status === 403 && body.error === "wrong_number") return "wrong_number";
    if (response.ok && body.status) return body.status;
    if (response.status === 409 && body.status) return body.status;
    if (response.status === 404) return "expired";
    return "failed";
  } catch {
    return "failed";
  }
}
