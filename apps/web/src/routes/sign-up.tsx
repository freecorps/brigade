import { m } from "@freecorps/brigade-i18n";
import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { AuthPage } from "@/components/auth-page";
import { usePreferences } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import {
  authClient,
  authErrorMessage,
  checkSignUp,
  checkWorkspaceName,
  createWorkspace,
  openWorkspace,
  type FieldErrors,
  type SignUpField,
} from "@/lib/auth";
import { isInvitationId } from "@/lib/invitations";
import { usePageTitle } from "@/lib/page-title";

/**
 * `?invitation=inv_…`: signing up to answer that invitation. No workspace is created then (they join the one they
 * were invited to), and the page goes back to the invitation.
 */
export const Route = createFileRoute("/sign-up")({
  component: SignUp,
  validateSearch: (search: Record<string, unknown>): { invitation?: string } =>
    isInvitationId(search.invitation) ? { invitation: search.invitation } : {},
});

const FIELDS = ["name", "email", "password", "workspace"] as const;

/**
 * Creates the account, signs in, then creates the user's first workspace. If the last step fails the account still exists and is
 * signed in, so the dashboard's gate asks for the workspace again instead of this form (whose email would now be
 * taken).
 */
function SignUp() {
  const { locale } = usePreferences();
  usePageTitle(m.page_title_sign_up());
  const navigate = useNavigate();
  const { invitation } = Route.useSearch();
  const session = authClient.useSession();
  const [values, setValues] = useState<Record<SignUpField, string>>({
    name: "",
    email: "",
    password: "",
    workspace: "",
  });
  const [errors, setErrors] = useState<FieldErrors<SignUpField>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = {
    name: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    workspace: useRef<HTMLInputElement>(null),
  };

  if (session.data && !busy) {
    return invitation ? (
      <Navigate to="/invitations/$id" params={{ id: invitation }} replace />
    ) : (
      <Navigate to="/" replace />
    );
  }

  const set = (field: SignUpField) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
    setFailure(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found: FieldErrors<SignUpField> = checkSignUp(values);
    // Invited: no workspace of their own to name.
    if (invitation) delete found.workspace;
    setErrors(found);
    setFailure(null);
    const first = FIELDS.find((field) => found[field]);
    if (first) return refs[first].current?.focus();
    setBusy(true);
    try {
      const { error } = await authClient.signUp.email({
        name: values.name.trim(),
        email: values.email.trim(),
        password: values.password,
        // The language the dashboard is in: emails to them are written in it.
        locale,
        // Invited: the verification link brings them back to the invitation (the API keeps only that path).
        ...(invitation ? { callbackURL: `/invitations/${invitation}` } : {}),
      });
      if (error) {
        setFailure(authErrorMessage(error, "sign-up"));
        setBusy(false);
        return;
      }
    } catch {
      setFailure(authErrorMessage(null, "sign-up"));
      setBusy(false);
      return;
    }
    // A sign-up answers the same for a taken address and hands out no session (RFC 0002 "Auth"): sign in with what
    // was typed. Refused here means the address already had an account, whose owner was just emailed.
    try {
      const { error } = await authClient.signIn.email({
        email: values.email.trim(),
        password: values.password,
      });
      if (error) {
        setFailure(authErrorMessage(error, "after-sign-up"));
        setBusy(false);
        return;
      }
    } catch {
      setFailure(authErrorMessage(null, "after-sign-up"));
      setBusy(false);
      return;
    }
    if (invitation) {
      await session.refetch();
      await navigate({ to: "/invitations/$id", params: { id: invitation }, replace: true });
      return;
    }
    const name = checkWorkspaceName(values.workspace);
    const created = name.ok ? await createWorkspace(name.name) : undefined;
    // Opens on the workspace, or (if creating it failed) reloads the session so the dashboard asks for one again.
    if (created?.ok) await openWorkspace(created.workspace.id);
    else await session.refetch();
    await navigate({ to: "/", replace: true });
  };

  return (
    <AuthPage
      title={m.auth_sign_up_title()}
      description={invitation ? m.auth_sign_up_invited_description() : m.auth_sign_up_description()}
      footer={
        <>
          {m.auth_have_account()}{" "}
          <Link
            to="/sign-in"
            search={invitation ? { invitation } : {}}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {m.auth_to_sign_in()}
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-busy={busy}>
        <Field
          ref={refs.name}
          label={m.auth_name_label()}
          autoComplete="name"
          value={values.name}
          onChange={(event) => set("name")(event.target.value)}
          error={errors.name}
        />
        <Field
          ref={refs.email}
          label={m.auth_email_label()}
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={values.email}
          onChange={(event) => set("email")(event.target.value)}
          error={errors.email}
        />
        <Field
          ref={refs.password}
          label={m.auth_password_label()}
          type="password"
          autoComplete="new-password"
          hint={errors.password ? undefined : m.auth_password_hint()}
          value={values.password}
          onChange={(event) => set("password")(event.target.value)}
          error={errors.password}
        />
        {invitation ? null : (
          <Field
            ref={refs.workspace}
            label={m.workspace_name_label()}
            hint={errors.workspace ? undefined : m.workspace_name_hint()}
            autoComplete="organization"
            value={values.workspace}
            onChange={(event) => set("workspace")(event.target.value)}
            error={errors.workspace}
          />
        )}
        {failure ? <FormError>{failure}</FormError> : null}
        <Button type="submit" disabled={busy} focusableWhenDisabled className="mt-2 w-full">
          {busy ? (
            <>
              <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
              {m.auth_signing_up()}
            </>
          ) : (
            m.auth_sign_up_submit()
          )}
        </Button>
      </form>
    </AuthPage>
  );
}
