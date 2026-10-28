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
  checkSignIn,
  type FieldErrors,
  type SignInField,
  useSignUpMode,
} from "@/lib/auth";
import { isInvitationId } from "@/lib/invitations";
import { usePageTitle } from "@/lib/page-title";

/** `?invitation=inv_…`: signing in to answer that invitation, which the page goes back to. */
export const Route = createFileRoute("/sign-in")({
  component: SignIn,
  validateSearch: (search: Record<string, unknown>): { invitation?: string } =>
    isInvitationId(search.invitation) ? { invitation: search.invitation } : {},
});

function SignIn() {
  usePreferences();
  usePageTitle(m.page_title_sign_in());
  const navigate = useNavigate();
  const { invitation } = Route.useSearch();
  const session = authClient.useSession();
  const signUpMode = useSignUpMode();
  const [values, setValues] = useState<Record<SignInField, string>>({ email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors<SignInField>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = { email: useRef<HTMLInputElement>(null), password: useRef<HTMLInputElement>(null) };

  // Already signed in (another tab, a back button): the dashboard.
  if (session.data && !busy) {
    return invitation ? (
      <Navigate to="/invitations/$id" params={{ id: invitation }} replace />
    ) : (
      <Navigate to="/" replace />
    );
  }

  const set = (field: SignInField) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
    // The server's answer was about what was there before; an edit is a new attempt.
    setFailure(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = checkSignIn(values);
    setErrors(found);
    setFailure(null);
    const first = (["email", "password"] as const).find((field) => found[field]);
    if (first) return refs[first].current?.focus();
    setBusy(true);
    try {
      const { error } = await authClient.signIn.email({
        email: values.email.trim(),
        password: values.password,
      });
      if (error) {
        setFailure(authErrorMessage(error, "sign-in"));
        setBusy(false);
        return;
      }
      await (invitation
        ? navigate({ to: "/invitations/$id", params: { id: invitation }, replace: true })
        : navigate({ to: "/", replace: true }));
    } catch {
      setFailure(authErrorMessage(null, "sign-in"));
      setBusy(false);
    }
  };

  return (
    <AuthPage
      title={m.auth_sign_in_title()}
      description={m.auth_sign_in_description()}
      footer={
        // A closed instance offers sign-up only from an invitation's link (RFC 0002 "Sign-up modes").
        invitation || signUpMode === "open" || signUpMode === "invite" ? (
          <>
            {m.auth_no_account()}{" "}
            <Link
              to="/sign-up"
              search={invitation ? { invitation } : {}}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {m.auth_to_sign_up()}
            </Link>
          </>
        ) : signUpMode === "closed" ? (
          m.auth_error_sign_up_closed()
        ) : undefined
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-busy={busy}>
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
          autoComplete="current-password"
          value={values.password}
          onChange={(event) => set("password")(event.target.value)}
          error={errors.password}
        />
        <Link
          to="/forgot-password"
          className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {m.reset_page({ part: "forgot_link", email: "" })}
        </Link>
        {failure ? <FormError>{failure}</FormError> : null}
        <Button type="submit" disabled={busy} focusableWhenDisabled className="mt-2 w-full">
          {busy ? (
            <>
              <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
              {m.auth_signing_in()}
            </>
          ) : (
            m.auth_sign_in_submit()
          )}
        </Button>
      </form>
    </AuthPage>
  );
}
