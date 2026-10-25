// Sign-up, sign-in and workspaces for the dashboard: the Better Auth client on the same origin (the web Worker
// forwards `/api/auth/*` to the API Worker), the dashboard's own `POST /api/workspaces`, and the pure checks and
// error wording the forms use (tested in test/auth.test.ts).
import { m } from "@freecorps/brigade-i18n";
import { WORKSPACE_NAME_MAX, workspaceName } from "@freecorps/brigade-schema";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Better Auth's default limits for email and password accounts. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
/** What a user may type as their name; Better Auth itself does not cap it. */
export const NAME_MAX = 80;

export const authClient = createAuthClient({
  // Relative to the page: the dashboard and its API share an origin, in dev and deployed.
  baseURL: `${typeof window === "undefined" ? "http://localhost" : window.location.origin}/api/auth`,
  plugins: [organizationClient()],
});

export type SignUpField = "name" | "email" | "password" | "workspace";
export type SignInField = "email" | "password";
export type FieldErrors<F extends string> = Partial<Record<F, string>>;

/** Loose on purpose: something@something.something. The server has the final say. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkEmail(email: string): string | undefined {
  if (email.trim() === "") return m.auth_error_required();
  return EMAIL.test(email.trim()) ? undefined : m.auth_error_email();
}

function checkPassword(password: string): string | undefined {
  if (password === "") return m.auth_error_required();
  if (password.length < PASSWORD_MIN) return m.auth_error_password_short();
  if (password.length > PASSWORD_MAX) return m.auth_error_password_long();
  return undefined;
}

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
  const email = checkEmail(values.email);
  if (email) errors.email = email;
  const password = checkPassword(values.password);
  if (password) errors.password = password;
  const workspace = checkWorkspaceName(values.workspace);
  if (!workspace.ok) errors.workspace = workspace.error;
  return errors;
}

export function checkSignIn(values: Record<SignInField, string>): FieldErrors<SignInField> {
  const errors: FieldErrors<SignInField> = {};
  const email = checkEmail(values.email);
  if (email) errors.email = email;
  if (values.password === "") errors.password = m.auth_error_required();
  return errors;
}

/** The shape Better Auth's client returns errors in (`{ status, code?, message? }`), or a thrown fetch error. */
export type AuthFailure = { status?: number; code?: string } | null | undefined;

/** What to tell the user about a failed sign-in or sign-up. */
export function authErrorMessage(error: AuthFailure, during: "sign-in" | "sign-up"): string {
  const status = error?.status ?? 0;
  if (status === 0) return m.auth_error_network();
  if (status === 429) return m.auth_error_rate_limited();
  if (during === "sign-in" && (status === 401 || error?.code === "INVALID_EMAIL_OR_PASSWORD")) {
    return m.auth_error_credentials();
  }
  if (during === "sign-up" && (status === 422 || error?.code?.startsWith("USER_ALREADY_EXISTS"))) {
    return m.auth_error_email_taken();
  }
  return m.auth_error_generic();
}

export type CreatedWorkspace = { id: string; name: string };

/** `POST /api/workspaces`: a new workspace owned by the signed-in user, made active in their session. */
export async function createWorkspace(
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; workspace: CreatedWorkspace } | { ok: false; status: number }> {
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
  if (response.status !== 201) return { ok: false, status: response.status };
  try {
    const body = (await response.json()) as Partial<CreatedWorkspace>;
    if (typeof body.id !== "string" || typeof body.name !== "string")
      return { ok: false, status: 502 };
    return { ok: true, workspace: { id: body.id, name: body.name } };
  } catch {
    return { ok: false, status: 502 };
  }
}
