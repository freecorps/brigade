import { m } from "@freecorps/brigade-i18n";
import { checkEmail } from "@freecorps/brigade-i18n/auth";
import { createFileRoute, Link } from "@tanstack/react-router";
import { LoaderCircleIcon } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { AuthPage } from "@/components/auth-page";
import { usePreferences } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { usePageTitle } from "@/lib/page-title";
import { requestPasswordReset } from "@/lib/password-reset";

/**
 * "Forgot your password?" from the sign-in page (and the mobile app, which opens it in the browser): asks for the
 * reset email. The answer is the same whether or not the address has an account (RFC 0002 "Auth").
 */
export const Route = createFileRoute("/forgot-password")({ component: ForgotPassword });

const text = (part: string, email = "") => m.reset_page({ part, email });

function ForgotPassword() {
  usePreferences();
  usePageTitle(text("forgot_page_title"));
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const found = checkEmail(email);
    setError(found);
    setFailure(null);
    if (found) return input.current?.focus();
    setBusy(true);
    const address = email.trim();
    const outcome = await requestPasswordReset(address);
    setBusy(false);
    if (outcome === "sent") setSentTo(address);
    // `rate_limited`, `not_configured`, `failed`: parts of the same message.
    else setFailure(text(outcome));
  };

  const back = (
    <Link to="/sign-in" className="font-medium text-primary underline-offset-4 hover:underline">
      {text("back")}
    </Link>
  );

  if (sentTo !== null) {
    return (
      <AuthPage
        title={text("sent_title")}
        description={text("sent_body", sentTo)}
        footer={back}
        focusTitle
      >
        <Button
          variant="outline"
          className="self-start"
          onClick={() => {
            setSentTo(null);
            setEmail("");
          }}
        >
          {text("other_address")}
        </Button>
      </AuthPage>
    );
  }

  return (
    <AuthPage title={text("forgot_title")} description={text("forgot_description")} footer={back}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-busy={busy}>
        <Field
          ref={input}
          label={m.auth_email_label()}
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
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
              {text("sending")}
            </>
          ) : (
            text("send")
          )}
        </Button>
      </form>
    </AuthPage>
  );
}
