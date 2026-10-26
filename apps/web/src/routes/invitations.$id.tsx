import { m } from "@freecorps/brigade-i18n";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckIcon, LoaderCircleIcon, LogOutIcon, RotateCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
    return <AuthPage title={text("not_found_title")} description={text("not_found_body")} />;
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

  const load = useCallback(async () => {
    setPreview(null);
    const result = await previewInvitation(id);
    setPreview(result.ok ? result.value : result.error);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (preview === null) return <Loading />;
  if (typeof preview === "string") {
    if (preview === "not_found") {
      return <AuthPage title={text("not_found_title")} description={text("not_found_body")} />;
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
  if (member) {
    return <AuthPage title={text("member_title", words)}>{open}</AuthPage>;
  }
  if (declined) {
    return <AuthPage title={text("declined_title")} description={text("declined_body", words)} />;
  }
  if (preview.status === "expired") {
    return <AuthPage title={text("expired_title")} description={text("expired_body")} />;
  }
  if (preview.status !== "pending") {
    return <AuthPage title={text("gone_title")} description={text("gone_body")} />;
  }
  if (!preview.forYou) {
    return (
      <AuthPage title={text("wrong_email_title")} description={text("wrong_email_body", words)}>
        <Button
          variant="outline"
          className="self-start"
          onClick={() => void authClient.signOut().then(() => window.location.reload())}
        >
          <LogOutIcon aria-hidden />
          {text("sign_out")}
        </Button>
      </AuthPage>
    );
  }
  const title = text("title", words);
  const body = text(preview.invitedBy ? "body" : "body_anonymous", words);
  if (!verified) {
    return (
      <AuthPage title={text("unverified_title")} description={body}>
        <VerifyNotice email={email} verified={false} next={`/invitations/${id}`} />
      </AuthPage>
    );
  }

  const run = async (action: "accept" | "decline") => {
    if (busy) return;
    setBusy(action);
    setFailure(null);
    const result = await answerInvitation(id, action);
    if (action === "decline") {
      setBusy(null);
      if (result.ok) setDeclined(true);
      else setFailure(invitationErrorText(result.error));
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
          variant="ghost"
          disabled={busy !== null}
          focusableWhenDisabled
          onClick={() => void run("decline")}
        >
          {busy === "decline" ? text("declining") : text("decline")}
        </Button>
      </div>
    </AuthPage>
  );
}
