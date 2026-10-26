import { formatRelativeTime, m } from "@freecorps/brigade-i18n";
import { inviteRoles, type Role } from "@freecorps/brigade-schema";
import { MailIcon, RotateCwIcon, SendIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { usePreferences } from "@/components/preferences";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { checkEmail } from "@freecorps/brigade-i18n/auth";
import {
  inviteMember,
  listInvitations,
  resendInvitation,
  revokeInvitation,
  type InvitationError,
  type PendingInvitation,
} from "@/lib/invitations";

/** The calls the panel makes; its tests pass their own. */
export type InvitationsApi = {
  list: (workspaceId: string) => ReturnType<typeof listInvitations>;
  invite: (workspaceId: string, email: string, role: Role) => ReturnType<typeof inviteMember>;
  resend: (workspaceId: string, id: string) => ReturnType<typeof resendInvitation>;
  revoke: (workspaceId: string, id: string) => ReturnType<typeof revokeInvitation>;
};

const defaultApi: InvitationsApi = {
  list: (workspaceId) => listInvitations(workspaceId),
  invite: (workspaceId, email, role) => inviteMember(workspaceId, email, role),
  resend: (workspaceId, id) => resendInvitation(workspaceId, id),
  revoke: (workspaceId, id) => revokeInvitation(workspaceId, id),
};

export function invitationErrorText(error: InvitationError, email = ""): string {
  return m.invite_error({ reason: error === "not_a_member" ? "forbidden" : error, email });
}

// 16px and 44px tall on phones, like the members' role picker.
const SELECT =
  "h-11 w-full rounded-md border border-input bg-card px-2 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring sm:w-40 sm:text-sm";

/**
 * The Members card's invitations, for owners and admins (RFC 0003 "Invitations"): the Invite form (an email and a
 * role the inviter may give) and the pending invitations with Resend and Revoke. Every change goes through the API,
 * which writes D1, then the workspace's events, and sends the email.
 */
export function InvitationsPanel({
  workspaceId,
  role,
  verified,
  open,
  setOpen,
  api = defaultApi,
}: {
  workspaceId: string;
  role: Role;
  /** Whether the signed-in member's own address is verified: inviting needs it. */
  verified: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  api?: InvitationsApi;
}) {
  const { locale } = usePreferences();
  const roles = inviteRoles({ role });
  const [pending, setPending] = useState<PendingInvitation[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [email, setEmail] = useState("");
  const [invitedRole, setInvitedRole] = useState<Role>(
    roles.includes("responder") ? "responder" : (roles[0] ?? "viewer"),
  );
  const [emailError, setEmailError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowFailure, setRowFailure] = useState<{ id: string; message: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const roleId = useId();
  const titleId = useId();

  const load = useCallback(async () => {
    const result = await api.list(workspaceId);
    if (result.ok) {
      setPending(result.value);
      setLoadFailed(false);
    } else setLoadFailed(true);
  }, [api, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (open) emailRef.current?.focus();
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setFailure(null);
    setNotice(null);
    const invalid = checkEmail(email);
    if (invalid) {
      setEmailError(invalid);
      emailRef.current?.focus();
      return;
    }
    const address = email.trim();
    setBusy("form");
    const result = await api.invite(workspaceId, address, invitedRole);
    setBusy(null);
    if (!result.ok && result.error !== "not_applied") {
      if (result.error === "invalid_email") {
        setEmailError(invitationErrorText("invalid_email"));
        emailRef.current?.focus();
      } else setFailure(invitationErrorText(result.error, address));
      return;
    }
    setNotice(
      result.ok
        ? m.invite_part({ part: "sent", email: address, date: "", name: "" })
        : invitationErrorText("not_applied"),
    );
    setEmail("");
    setOpen(false);
    await load();
  };

  const act = async (invitation: PendingInvitation, kind: "resend" | "revoke") => {
    if (busy) return;
    setBusy(invitation.id);
    setRowFailure(null);
    setConfirming(null);
    setNotice(null);
    const result =
      kind === "resend"
        ? await api.resend(workspaceId, invitation.id)
        : await api.revoke(workspaceId, invitation.id);
    setBusy(null);
    if (!result.ok && result.error !== "not_applied") {
      setRowFailure({
        id: invitation.id,
        message: invitationErrorText(result.error, invitation.email),
      });
      if (result.error === "not_found") await load();
      return;
    }
    setNotice(
      m.invite_part({
        part: kind === "resend" ? "resent" : "revoked",
        email: invitation.email,
        date: "",
        name: "",
      }),
    );
    await load();
  };

  const now = Date.now();
  return (
    <div className="flex flex-col gap-4">
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {notice}
        </p>
      ) : null}
      {open ? (
        <form
          onSubmit={submit}
          noValidate
          aria-labelledby={titleId}
          aria-busy={busy === "form"}
          className="flex flex-col gap-3 rounded-md bg-muted p-4"
        >
          <h3 id={titleId} className="font-medium">
            {m.invite_part({ part: "title", email: "", date: "", name: "" })}
          </h3>
          {verified ? null : (
            <p className="text-sm text-muted-foreground">
              {m.invite_part({ part: "unverified", email: "", date: "", name: "" })}
            </p>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <Field
              ref={emailRef}
              className="flex-1"
              label={m.invite_part({ part: "email_label", email: "", date: "", name: "" })}
              type="email"
              autoComplete="off"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              hint={
                emailError
                  ? undefined
                  : m.invite_part({ part: "hint", email: "", date: "", name: "" })
              }
              error={emailError}
              onChange={(event) => {
                setEmail(event.target.value);
                setEmailError(undefined);
                setFailure(null);
              }}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor={roleId} className="text-sm font-medium">
                {m.invite_part({ part: "role_label", email: "", date: "", name: "" })}
              </label>
              <select
                id={roleId}
                value={invitedRole}
                onChange={(event) => setInvitedRole(event.target.value as Role)}
                className={SELECT}
              >
                {roles.map((option) => (
                  <option key={option} value={option}>
                    {m.member_role({ role: option })}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {failure ? <FormError>{failure}</FormError> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy === "form" || !verified} focusableWhenDisabled>
              <SendIcon aria-hidden />
              {busy === "form"
                ? m.invite_part({ part: "sending", email: "", date: "", name: "" })
                : m.invite_part({ part: "submit", email: "", date: "", name: "" })}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setFailure(null);
                setEmailError(undefined);
              }}
            >
              {m.invite_part({ part: "cancel", email: "", date: "", name: "" })}
            </Button>
          </div>
        </form>
      ) : null}
      {loadFailed && pending === null ? (
        <div className="flex flex-col items-start gap-2">
          <FormError>
            {m.invite_part({ part: "load_failed", email: "", date: "", name: "" })}
          </FormError>
          <Button variant="outline" onClick={() => void load()}>
            <RotateCwIcon aria-hidden />
            {m.members_part({ part: "retry", name: "" })}
          </Button>
        </div>
      ) : pending && pending.length > 0 ? (
        <section aria-labelledby={`${titleId}-pending`} className="flex flex-col gap-2">
          <h3 id={`${titleId}-pending`} className="text-sm font-medium text-muted-foreground">
            {m.invite_part({ part: "pending_title", email: "", date: "", name: "" })}
          </h3>
          <ul className="-mx-4 divide-y border-t sm:-mx-6">
            {pending.map((invitation) => {
              const expired = invitation.expiresAt <= now;
              const manageable = roles.includes(invitation.role);
              const ask = confirming === invitation.id;
              return (
                <li key={invitation.id} className="flex flex-col gap-2 px-4 py-3 sm:px-6">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <MailIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
                      <p className="font-medium [overflow-wrap:anywhere]">{invitation.email}</p>
                      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                        {expired
                          ? m.invite_part({ part: "expired", email: "", date: "", name: "" })
                          : m.invite_part({
                              part: "expires",
                              email: "",
                              date: formatRelativeTime(invitation.expiresAt, locale, now),
                              name: "",
                            })}
                        {invitation.invitedBy.name
                          ? `. ${m.invite_part({ part: "invited_by", email: "", date: "", name: invitation.invitedBy.name })}`
                          : null}
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0">
                      {m.member_role({ role: invitation.role })}
                    </Badge>
                    {manageable ? (
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          disabled={busy !== null || !verified}
                          focusableWhenDisabled
                          onClick={() => void act(invitation, "resend")}
                        >
                          <RotateCwIcon aria-hidden />
                          {m.invite_part({ part: "resend", email: "", date: "", name: "" })}
                        </Button>
                        <Button
                          variant="ghost"
                          aria-expanded={ask}
                          disabled={busy !== null}
                          focusableWhenDisabled
                          onClick={() => setConfirming(ask ? null : invitation.id)}
                          className="text-destructive hover:text-destructive"
                        >
                          <XIcon aria-hidden />
                          {m.invite_part({ part: "revoke", email: "", date: "", name: "" })}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {busy === invitation.id ? (
                    <p role="status" className="text-sm text-muted-foreground">
                      {m.members_part({ part: "saving", name: "" })}
                    </p>
                  ) : null}
                  {rowFailure?.id === invitation.id ? (
                    <FormError>{rowFailure.message}</FormError>
                  ) : null}
                  {ask ? (
                    <div
                      role="group"
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-muted px-3 py-2 text-sm"
                    >
                      <p className="min-w-0 flex-1 basis-48 [overflow-wrap:anywhere]">
                        {m.invite_part({
                          part: "revoke_prompt",
                          email: invitation.email,
                          date: "",
                          name: "",
                        })}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="destructive"
                          onClick={() => void act(invitation, "revoke")}
                        >
                          {m.invite_part({ part: "revoke", email: "", date: "", name: "" })}
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirming(null)}>
                          {m.invite_part({ part: "cancel", email: "", date: "", name: "" })}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
