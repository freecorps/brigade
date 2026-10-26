import { m } from "@freecorps/brigade-i18n";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckIcon, LoaderCircleIcon, LogOutIcon, RotateCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AuthPage } from "@/components/auth-page";
import { invitationErrorText } from "@/components/invitations-panel";
import { usePreferences } from "@/components/preferences";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { VerifyNotice } from "@/components/verify-notice";
import { authClient, openWorkspace } from "@/lib/auth";
import {
  answerInvitation,
  isInvitationId,
  previewInvitation,
  type InvitationError,
  type InvitationPreview,
} from "@/lib/invitations";
import { usePageTitle } from "@/lib/page-title";

/** The invitee's page, where the invitation email links (RFC 0003 "Invitations"). */
export const Route = createFileRoute("/invitations/$id")({ component: InvitationRoute });

type Words = { workspace?: string; inviter?: string; role?: string; email?: string };
const text = (part: string, words: Words = {}) =>
  m.accept_page({
    part,
    workspace: words.workspace ?? "",
    inviter: words.inviter ?? "",
    role: words.role ?? "",
    email: words.email ?? "",
  });

/** The way out of a page with nothing left to do here. */
function DashboardLink() {
  return (
    <Link to="/" className={buttonVariants({ variant: "outline", className: "self-start" })}>
      {text("open")}
    </Link>
  );
}

const ACCEPT_ERRORS: readonly InvitationError[] = [
  "workspace_full",
  "workspace_limit",
  "already_member",
  "conflict",
  "unavailable",
  "network",
];

function InvitationRoute() {
  usePreferences();
  usePageTitle(text("page_title"));
  const { id } = Route.useParams();
  const session = authClient.useSession();
  if (!isInvitationId(id)) {
    return (
      <AuthPage title={text("not_found_title")} description={text("not_found_body")}>
        {session.data ? <DashboardLink /> : null}
      </AuthPage>
    );
  }
  if (session.isPending) return <Loading />;
  if (!session.data) {
    return (
      <AuthPage title={text("sign_in_title")} description={text("sign_in_body")}>
        <div className="flex flex-wrap gap-2">
          <Link to="/sign-in" search={{ invitation: id }} className={buttonVariants()}>
            {text("sign_in")}
          </Link>
          <Link
            to="/sign-up"
            search={{ invitation: id }}
            className={buttonVariants({ variant: "outline" })}
          >
            {text("sign_up")}
          </Link>
        </div>
      </AuthPage>
    );
  }
  return (
    <Invitation
      id={id}
      email={session.data.user.email}
      verified={session.data.user.emailVerified}
    />
  );
}

function Loading() {
  return (
    <AuthPage title={text("page_title")}>
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircleIcon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
        {m.session_loading()}
      </p>
    </AuthPage>
  );
}

function Invitation({ id, email, verified }: { id: string; email: string; verified: boolean }) {
  const navigate = useNavigate();
  const [preview, setPreview] = useState<InvitationPreview | InvitationError | null>(null);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const [member, setMember] = useState(false);
  const [askingDecline, setAskingDecline] = useState(false);
  const declineRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setPreview(null);
    const result = await previewInvitation(id);
    setPreview(result.ok ? result.value : result.error);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (askingDecline) confirmRef.current?.focus();
  }, [askingDecline]);

  if (preview === null) return <Loading />;
  if (typeof preview === "string") {
    if (preview === "not_found") {
      return (
        <AuthPage title={text("not_found_title")} description={text("not_found_body")}>
          <DashboardLink />
        </AuthPage>
      );
    }
    return (
      <AuthPage title={text("page_title")}>
        <FormError>{invitationErrorText(preview)}</FormError>
        <Button variant="outline" onClick={() => void load()} className="self-start">
          <RotateCwIcon aria-hidden />
          {m.members_part({ part: "retry", name: "" })}
        </Button>
      </AuthPage>
    );
  }

  const words: Words = {
    workspace: preview.workspace.name,
    inviter: preview.invitedBy ?? "",
    role: preview.role ? m.member_role({ role: preview.role }) : "",
    email,
  };
  const open = (
    <Button
      className="self-start"
      onClick={() =>
        void openWorkspace(preview.workspace.id).then(() => navigate({ to: "/", replace: true }))
      }
    >
      {text("open")}
    </Button>
  );
  // After Accept or Decline the page is replaced: focus goes to the new heading, not to the page.
  if (member) {
    return (
      <AuthPage title={text("member_title", words)} focusTitle>
        {open}
      </AuthPage>
    );
  }
  if (declined) {
    return (
      <AuthPage
        title={text("declined_title")}
        description={text("declined_body", words)}
        focusTitle
      >
        <DashboardLink />
      </AuthPage>
    );
  }
  // Not theirs: nothing about it but that (the API sends no inviter or role either).
  if (!preview.forYou) {
    return (
      <AuthPage title={text("wrong_email_title")} description={text("wrong_email_body", words)}>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void authClient.signOut().then(() => window.location.reload())}
          >
            <LogOutIcon aria-hidden />
            {text("sign_out")}
          </Button>
          <Link to="/" className={buttonVariants({ variant: "ghost" })}>
            {text("open")}
          </Link>
        </div>
      </AuthPage>
    );
  }
  if (preview.status === "expired") {
    return (
      <AuthPage
        title={text("expired_title")}
        description={text(preview.invitedBy ? "expired_body_named" : "expired_body", words)}
      >
        <DashboardLink />
      </AuthPage>
    );
  }
  if (preview.status !== "pending") {
    return (
      <AuthPage title={text("gone_title")} description={text("gone_body")}>
        <DashboardLink />
      </AuthPage>
    );
  }
  const title = text("title", words);
  const body = text(preview.invitedBy ? "body" : "body_anonymous", words);
  if (!verified) {
    return (
      <AuthPage title={title} description={body}>
        <VerifyNotice
          email={email}
          verified={false}
          next={`/invitations/${id}`}
          title={text("unverified_notice_title")}
          body={text("unverified_body", words)}
        />
      </AuthPage>
    );
  }

  const closeDecline = () => {
    setAskingDecline(false);
    declineRef.current?.focus();
  };

  const run = async (action: "accept" | "decline") => {
    if (busy) return;
    setBusy(action);
    setFailure(null);
    setAskingDecline(false);
    const result = await answerInvitation(id, action);
    if (action === "decline") {
      setBusy(null);
      if (result.ok) setDeclined(true);
      else {
        setFailure(invitationErrorText(result.error));
        declineRef.current?.focus();
      }
      return;
    }
    // `not_applied`: D1 has the membership already, the shard catches up on its own.
    if (result.ok || result.error === "not_applied") {
      await openWorkspace(
        result.ok && result.value.workspaceId ? result.value.workspaceId : preview.workspace.id,
      );
      await navigate({ to: "/", replace: true });
      return;
    }
    setBusy(null);
    if (result.error === "already_member") {
      setMember(true);
      return;
    }
    if (result.error === "not_found" || result.error === "expired") {
      await load();
      return;
    }
    setFailure(
      ACCEPT_ERRORS.includes(result.error)
        ? m.accept_error({ reason: result.error, workspace: preview.workspace.name })
        : invitationErrorText(result.error),
    );
  };

  return (
    <AuthPage title={title} description={body}>
      {failure ? <FormError>{failure}</FormError> : null}
      <div className="flex flex-wrap gap-2" aria-busy={busy !== null}>
        <Button disabled={busy !== null} focusableWhenDisabled onClick={() => void run("accept")}>
          {busy === "accept" ? (
            <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
          ) : (
            <CheckIcon aria-hidden />
          )}
          {busy === "accept" ? text("accepting") : text("accept")}
        </Button>
        <Button
          ref={declineRef}
          variant="ghost"
          aria-expanded={askingDecline}
          disabled={busy !== null}
          focusableWhenDisabled
          onClick={() => {
            if (busy !== null) return;
            if (askingDecline) closeDecline();
            else setAskingDecline(true);
          }}
        >
          {busy === "decline" ? text("declining") : text("decline")}
        </Button>
      </div>
      {askingDecline ? (
        <div
          role="group"
          aria-labelledby="decline-prompt"
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeDecline();
            }
          }}
          className="flex flex-col gap-3 rounded-md bg-muted px-3 py-3 text-sm"
        >
          <p id="decline-prompt" className="text-pretty [overflow-wrap:anywhere]">
            {text("decline_prompt", words)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button ref={confirmRef} variant="destructive" onClick={() => void run("decline")}>
              {text("decline_confirm")}
            </Button>
            <Button variant="ghost" onClick={closeDecline}>
              {text("cancel")}
            </Button>
          </div>
        </div>
      ) : null}
    </AuthPage>
  );
}
