import { m } from "@freecorps/brigade-i18n";
import { createFileRoute, Link } from "@tanstack/react-router";
import { LoaderCircleIcon, RotateCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthPage } from "@/components/auth-page";
import { usePreferences } from "@/components/preferences";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { authClient } from "@/lib/auth";
import { isInvitationId, verifyEmail, type VerifyOutcome } from "@/lib/invitations";
import { usePageTitle } from "@/lib/page-title";

/**
 * Where the verification email's link lands: `?token=…` (Better Auth's signed token) and, when the user was
 * answering an invitation, `?next=/invitations/inv_…` to go back to it. Nothing else is followed.
 */
export const Route = createFileRoute("/verify-email")({
  component: VerifyEmail,
  validateSearch: (search: Record<string, unknown>): { token?: string; next?: string } => ({
    ...(typeof search.token === "string" && search.token.length <= 4096
      ? { token: search.token }
      : {}),
    ...(typeof search.next === "string" &&
    search.next.startsWith("/invitations/") &&
    isInvitationId(search.next.slice("/invitations/".length))
      ? { next: search.next }
      : {}),
  }),
});

const text = (part: string) => m.verify_page({ part });

function VerifyEmail() {
  usePreferences();
  usePageTitle(text("page_title"));
  const { token, next } = Route.useSearch();
  const session = authClient.useSession();
  const [outcome, setOutcome] = useState<VerifyOutcome | "checking">(
    token ? "checking" : "invalid",
  );
  const started = useRef(false);

  const run = useCallback(async () => {
    if (!token) return;
    setOutcome("checking");
    const result = await verifyEmail(token);
    setOutcome(result);
    // The session caches `emailVerified`: read it again so the dashboard stops asking.
    if (result === "verified") void session.refetch();
  }, [token, session]);

  useEffect(() => {
    // Once per page, even when React runs effects twice in development.
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  if (outcome === "checking") {
    return (
      <AuthPage title={text("page_title")}>
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircleIcon
            aria-hidden
            className="size-4 animate-spin motion-reduce:animate-none"
          />
          {text("checking")}
        </p>
      </AuthPage>
    );
  }
  const invitation = next?.slice("/invitations/".length);
  const continueTo = invitation ? (
    <Link
      to="/invitations/$id"
      params={{ id: invitation }}
      className={buttonVariants({ className: "self-start" })}
    >
      {text("continue")}
    </Link>
  ) : (
    <Link to="/" className={buttonVariants({ className: "self-start" })}>
      {text("continue")}
    </Link>
  );
  if (outcome === "verified") {
    return (
      <AuthPage title={text("done_title")} description={text("done_body")}>
        {continueTo}
      </AuthPage>
    );
  }
  if (outcome === "network") {
    return (
      <AuthPage title={text("page_title")}>
        <FormError>{text("failed_body")}</FormError>
        <Button variant="outline" onClick={() => void run()} className="self-start">
          <RotateCwIcon aria-hidden />
          {text("retry")}
        </Button>
      </AuthPage>
    );
  }
  // Expired or broken: a new link comes from the dashboard's notice (signed in) or after signing in.
  return (
    <AuthPage
      title={text(outcome === "expired" ? "expired_title" : "invalid_title")}
      description={text(outcome === "expired" ? "expired_body" : "invalid_body")}
    >
      {session.data ? (
        continueTo
      ) : (
        <Link to="/sign-in" className={buttonVariants({ className: "self-start" })}>
          {m.accept_page({ part: "sign_in", workspace: "", inviter: "", role: "", email: "" })}
        </Link>
      )}
    </AuthPage>
  );
}
