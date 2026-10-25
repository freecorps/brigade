import { m } from "@freecorps/brigade-i18n";
import { WORKSPACE_NAME_MAX } from "@freecorps/brigade-schema";
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
  NAME_MAX,
  PASSWORD_MAX,
  type FieldErrors,
  type SignUpField,
} from "@/lib/auth";

export const Route = createFileRoute("/sign-up")({ component: SignUp });

const FIELDS = ["name", "email", "password", "workspace"] as const;

/**
 * Creates the account, then the user's first workspace. If the second step fails the account still exists and is
 * signed in, so the dashboard's gate asks for the workspace again instead of this form (whose email would now be
 * taken).
 */
function SignUp() {
  usePreferences();
  const navigate = useNavigate();
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

  if (session.data && !busy) return <Navigate to="/" replace />;

  const set = (field: SignUpField) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = checkSignUp(values);
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
    const name = checkWorkspaceName(values.workspace);
    const created = name.ok ? await createWorkspace(name.name) : undefined;
    // Refresh the session (now with its active workspace) before the dashboard reads it.
    if (created?.ok)
      await authClient.organization.setActive({ organizationId: created.workspace.id });
    else await authClient.getSession();
    await navigate({ to: "/", replace: true });
  };

  return (
    <AuthPage
      title={m.auth_sign_up_title()}
      description={m.auth_sign_up_description()}
      footer={
        <>
          {m.auth_have_account()}{" "}
          <Link
            to="/sign-in"
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
          maxLength={NAME_MAX}
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
          maxLength={PASSWORD_MAX}
          hint={errors.password ? undefined : m.auth_password_hint()}
          value={values.password}
          onChange={(event) => set("password")(event.target.value)}
          error={errors.password}
        />
        <Field
          ref={refs.workspace}
          label={m.workspace_name_label()}
          placeholder={m.workspace_name_placeholder()}
          autoComplete="organization"
          maxLength={WORKSPACE_NAME_MAX}
          value={values.workspace}
          onChange={(event) => set("workspace")(event.target.value)}
          error={errors.workspace}
        />
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
