// Sign-up, sign-in and workspaces for the dashboard: the Better Auth client on the same origin (the web Worker
// forwards `/api/auth/*` to the API Worker), the dashboard's own `POST /api/workspaces`, and the pure checks and
// error wording the forms use (tested in test/auth.test.ts).
import { m, type Locale } from "@freecorps/brigade-i18n";
import {
  authErrorMessage,
  checkEmail,
  checkPassword,
  readSignUpMode,
  type AuthFailure,
  type FieldErrors,
  type SignUpMode,
} from "@freecorps/brigade-i18n/auth";
import { memberName, WORKSPACE_NAME_MAX, workspaceName } from "@freecorps/brigade-schema";
import { inferAdditionalFields, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { useEffect, useState } from "react";

// The sign-in checks and error wording are shared with the mobile app (packages/i18n).
export {
  authErrorMessage,
  checkSignIn,
  PASSWORD_MAX,
  PASSWORD_MIN,
  type AuthFailure,
  type FieldErrors,
  type SignInField,
  type SignUpMode,
} from "@freecorps/brigade-i18n/auth";

/**
 * What to tell the user about a failed sign-up. Answering an invitation (`invited`), a refused address can only be
 * one with no invitation, most likely not the one it was sent to: that is what they need to hear, not "ask an owner
 * for an invitation" (RFC 0002 "Sign-up modes").
 */
export function signUpErrorMessage(error: AuthFailure, invited: boolean): string {
  if (invited && error?.code === "SIGN_UP_CLOSED") return m.auth_error_not_invited();
  return authErrorMessage(error, "sign-up");
}

/** What a user may type as their name; Better Auth itself does not cap it. */
export const NAME_MAX = 80;

/** The client, with a stand-in `fetch` for tests. */
export function makeAuthClient(customFetchImpl?: typeof fetch) {
  return createAuthClient({
    // Relative to the page: the dashboard and its API share an origin, in dev and deployed.
    baseURL: `${typeof window === "undefined" ? "http://localhost" : window.location.origin}/api/auth`,
    // `locale`: the language Brigade writes to the user in, emails included (apps/api src/auth.ts).
    plugins: [
      organizationClient(),
      inferAdditionalFields({ user: { locale: { type: "string", required: false } } }),
    ],
    ...(customFetchImpl ? { fetchOptions: { customFetchImpl } } : {}),
  });
}

export const authClient = makeAuthClient();

let signUpMode: Promise<SignUpMode> | undefined;

/**
 * Who may sign up on this instance (`GET /api/config`, RFC 0002 "Sign-up modes"), once per page load: it changes only
 * with a deploy. A failed answer reads as `closed` and is asked again next time.
 */
export function loadSignUpMode(fetcher: typeof fetch = fetch): Promise<SignUpMode> {
  signUpMode ??= fetcher("/api/config", { headers: { Accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) throw new Error(String(response.status));
      return readSignUpMode(await response.json());
    })
    .catch(() => {
      signUpMode = undefined;
      return "closed" as const;
    });
  return signUpMode;
}

/** Forgets the cached mode (tests). */
export function resetSignUpMode() {
  signUpMode = undefined;
}

/** The instance's sign-up mode; undefined until it answers, so no sign-up link shows and then goes. */
export function useSignUpMode(): SignUpMode | undefined {
  const [mode, setMode] = useState<SignUpMode>();
  useEffect(() => {
    let live = true;
    void loadSignUpMode().then((next) => live && setMode(next));
    return () => {
      live = false;
    };
  }, []);
  return mode;
}

/**
 * Stores the language picked in the dashboard on the signed-in user, so emails come in it too (RFC 0008). Best
 * effort: the switch itself never waits on it, and a failure leaves the one stored before. Saves run one at a time,
 * and one overtaken by a newer pick before its turn is skipped, so the last language picked is the one stored.
 */
export function saveLocale(
  locale: Locale,
  client: Pick<typeof authClient, "updateUser"> = authClient,
): Promise<boolean> {
  wantedLocale = locale;
  const save = savingLocale.then(async () => {
    if (wantedLocale !== locale) return true;
    try {
      const { error } = await client.updateUser({ locale });
      return !error;
    } catch {
      return false;
    }
  });
  savingLocale = save;
  return save;
}

let savingLocale: Promise<unknown> = Promise.resolve();
let wantedLocale: Locale | null = null;

/**
 * Opens a workspace `POST /workspaces` just created. `set-active` (not a plain session refetch) is what tells the
 * session, active-organization and active-member hooks to fetch again; without it a hook already mounted (the
 * header's) keeps the `null` it read before the workspace existed and the dashboard waits forever.
 */
export async function openWorkspace(
  id: string,
  client: Pick<typeof authClient, "organization"> = authClient,
  reload: () => void = () => window.location.assign("/"),
): Promise<void> {
  try {
    const { error } = await client.organization.setActive({ organizationId: id });
    if (!error) return;
  } catch {
    // A network failure: fall through.
  }
  // The server already made the workspace active (`POST /workspaces` does), so a fresh page load opens it.
  reload();
}

/**
 * Signs the dashboard out (`/sign-out`). True when the session is gone: signed out, or already gone (401). False when
 * the API could not end it (503 `SIGN_OUT_FAILED`: its end could not be recorded, RFC 0004 "Session revocation") or
 * gave no answer: the session and its cookie are kept, and the member signs out again.
 */
export async function signOutDashboard(
  client: Pick<typeof authClient, "signOut"> = authClient,
): Promise<boolean> {
  try {
    const { error } = await client.signOut();
    return !error || error.status === 401;
  } catch {
    return false;
  }
}

/**
 * Makes another of the member's workspaces active in the session (`set-active`, which also tells the session,
 * active-organization and active-member hooks to fetch again): the dashboard then opens that workspace's shard. True
 * once the server answered.
 */
export async function switchWorkspace(
  id: string,
  client: Pick<typeof authClient, "organization"> = authClient,
): Promise<boolean> {
  try {
    const { error } = await client.organization.setActive({ organizationId: id });
    return !error;
  } catch {
    return false;
  }
}

export type SignUpField = "name" | "email" | "password" | "workspace";

/** The workspace name as the API will store it, or why it would refuse it. */
export function checkWorkspaceName(
  name: string,
): { ok: true; name: string } | { ok: false; error: string } {
  if (name.trim() === "") return { ok: false, error: m.auth_error_required() };
  const result = workspaceName(name);
  if (result.ok) return { ok: true, name: result.value };
  // The inputs have no `maxLength`, which would cut a pasted name short without a word; this says it instead.
  if (name.trim().length > WORKSPACE_NAME_MAX) {
    return { ok: false, error: m.auth_error_too_long({ max: WORKSPACE_NAME_MAX }) };
  }
  return { ok: false, error: m.workspace_name_invalid() };
}

export function checkSignUp(values: Record<SignUpField, string>): FieldErrors<SignUpField> {
  const errors: FieldErrors<SignUpField> = {};
  if (values.name.trim() === "") errors.name = m.auth_error_required();
  else if (values.name.trim().length > NAME_MAX)
    errors.name = m.auth_error_too_long({ max: NAME_MAX });
  // The API's rule for names (`memberName`): it would refuse the sign-up with `INVALID_NAME`.
  else if (!memberName(values.name).ok) errors.name = m.auth_name_invalid();
  const email = checkEmail(values.email);
  if (email) errors.email = email;
  const password = checkPassword(values.password);
  if (password) errors.password = password;
  const workspace = checkWorkspaceName(values.workspace);
  if (!workspace.ok) errors.workspace = workspace.error;
  return errors;
}

export type CreatedWorkspace = { id: string; name: string };

/** `POST /api/workspaces`: a new workspace owned by the signed-in user, made active in their session. */
export async function createWorkspace(
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<
  { ok: true; workspace: CreatedWorkspace } | { ok: false; status: number; error?: string }
> {
  let response: Response;
  try {
    response = await fetcher("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ name }),
    });
  } catch {
    return { ok: false, status: 0 };
  }
  if (response.status !== 201) {
    // The API's `{ error }` code, so the form can tell the workspace limit from other refusals.
    const body: unknown = await response.json().catch(() => null);
    const error =
      typeof body === "object" && body !== null ? Reflect.get(body, "error") : undefined;
    return {
      ok: false,
      status: response.status,
      ...(typeof error === "string" ? { error } : {}),
    };
  }
  try {
    const body = (await response.json()) as Partial<CreatedWorkspace>;
    if (typeof body.id !== "string" || typeof body.name !== "string")
      return { ok: false, status: 502 };
    return { ok: true, workspace: { id: body.id, name: body.name } };
  } catch {
    return { ok: false, status: 502 };
  }
}
