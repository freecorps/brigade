import { m } from "@freecorps/brigade-i18n";
import { checkPassword } from "@freecorps/brigade-i18n/auth";
import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AuthPage } from "@/components/auth-page";
import { usePreferences } from "@/components/preferences";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { authClient } from "@/lib/auth";
import { usePageTitle } from "@/lib/page-title";
import { resetPassword, resetTokenFromHash } from "@/lib/password-reset";

/**
 * Where the password reset email's link lands: `#token=…`, in the fragment, which the browser never sends to a server
 * or in a `Referer`. The token is taken out of the address bar as soon as it is read, so it stays in neither the
 * history nor a copied link; the page keeps it until the new password is saved. Saving ends every session of the
 * account and confirms its address (RFC 0002 "Auth").
 */
export const Route = createFileRoute("/reset-password")({ component: ResetPassword });

const text = (part: string) => m.reset_page({ part, email: "" });

type State = "form" | "done" | "invalid";

function ResetPassword() {
  usePreferences();
  usePageTitle(text("reset_page_title"));
  const hash = useLocation({ select: (location) => location.hash });
  const navigate = useNavigate();
  const session = authClient.useSession();
  // Read once: the address bar loses it right after.
  const [token] = useState(() => resetTokenFromHash(hash));
  const [state, setState] = useState<State>(token ? "form" : "invalid");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (hash) void navigate({ to: "/reset-password", hash: "", replace: true });
  }, [navigate, hash]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !token) return;
    const found = checkPassword(password);
    setError(found);
    setFailure(null);
    if (found) return input.current?.focus();
    setBusy(true);
    const outcome = await resetPassword(token, password);
    setBusy(false);
    if (outcome === "done") {
      setState("done");
      // Every session ended, this browser's too: the header stops showing one.
      void session.refetch();
    } else if (outcome === "invalid") setState("invalid");
    else if (outcome === "too_short") setError(m.auth_error_password_short());
    else if (outcome === "too_long") setError(m.auth_error_password_long());
    else if (outcome === "rate_limited") setFailure(m.auth_error_rate_limited());
    // Not "try again": the link may be used up, and the password saved.
    else if (outcome === "uncertain") setFailure(text("uncertain"));
    else setFailure(m.auth_error_network());
  };

  if (state === "done") {
    return (
      <AuthPage title={text("done_title")} description={text("done_body")} focusTitle>
        <Link to="/sign-in" className={buttonVariants({ className: "self-start" })}>
          {text("sign_in")}
        </Link>
      </AuthPage>
    );
  }
  if (state === "invalid") {
    return (
      <AuthPage
        title={text("invalid_title")}
        description={text("invalid_body")}
        focusTitle={token !== undefined}
        footer={
          <Link
            to="/sign-in"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {text("back")}
          </Link>
        }
      >
        <Link to="/forgot-password" className={buttonVariants({ className: "self-start" })}>
          {text("request_new")}
        </Link>
      </AuthPage>
    );
  }
  return (
    <AuthPage title={text("reset_title")} description={text("reset_description")}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-busy={busy}>
        <Field
          ref={input}
          label={text("new_password_label")}
          hint={m.auth_password_hint()}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setError(undefined);
            setFailure(null);
          }}
          error={error}
        />
        {failure ? <FormError>{failure}</FormError> : null}
        <Button type="submit" disabled={busy} focusableWhenDisabled className="mt-2 w-full">
          {busy ? (
            <>
              <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
              {text("saving")}
            </>
          ) : (
            text("save")
          )}
        </Button>
      </form>
    </AuthPage>
  );
}
