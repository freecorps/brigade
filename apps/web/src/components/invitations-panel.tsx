import { formatDateTime, m } from "@freecorps/brigade-i18n";
import { inviteRoles, type Role } from "@freecorps/brigade-schema";
import { MailIcon, RotateCwIcon, SendIcon, XIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { usePreferences } from "@/components/preferences";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { useResendVerification } from "@/components/verify-notice";
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

const part = (name: string, words: { email?: string; date?: string; name?: string } = {}) =>
  m.invite_part({
    part: name,
    email: words.email ?? "",
    date: words.date ?? "",
    name: words.name ?? "",
  });

// 16px and 44px tall on phones, like the members' role picker.
const SELECT = "field w-full px-2 focus-visible:ring-3 focus-visible:ring-ring sm:w-40 sm:text-sm";

/** Pending invitations listed before "Show all": enough to see what is out, few enough not to bury the members. */
export const PENDING_SHOWN = 5;

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The panel's two pieces, for a parent that places them apart (the Members card: the form up top, the list last). */
export type InvitationParts = {
  /** The Invite form while open, and what the last send said. */
  form: ReactNode;
  /** The pending invitations, or nothing when there are none. */
  pending: ReactNode;
  /** How many invitations are pending (0 until loaded). */
  count: number;
};

/** Where focus goes once a revoke settles: a row's control, or the outcome when no row is left to hold it. */
type FocusTarget = { id: string; control: "revoke" | "first" } | "notice";

/**
 * The Members card's invitations, for owners and admins (RFC 0003 "Invitations"): the Invite form (an email and a
 * role the inviter may give) and the pending invitations with Resend and Revoke. Every change goes through the API,
 * which writes D1, then the workspace's events, and sends the email. An inviter whose own address is unverified gets
 * the way to verify it in place of the form. `children` places the form and the list; without it they stack.
 */
export function InvitationsPanel({
  workspaceId,
  role,
  verified,
  ownEmail,
  open,
  setOpen,
  api = defaultApi,
  children,
}: {
  workspaceId: string;
  role: Role;
  /** Whether the signed-in member's own address is verified: inviting needs it. */
  verified: boolean;
  /** The signed-in member's own address, where a new verification link goes. */
  ownEmail: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  api?: InvitationsApi;
  children?: (parts: InvitationParts) => ReactNode;
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
  // Said next to what it is about: a send by the form, a resend or revoke by the list.
  const [notice, setNotice] = useState<{ text: string; at: "form" | "list" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // What `busy` guards, read by the handlers: two clicks before the re-render both see the old `busy`.
  const busyRef = useRef(false);
  const [rowFailure, setRowFailure] = useState<{ id: string; message: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const verifyRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const roleId = useId();
  const titleId = useId();
  const verification = useResendVerification(ownEmail);

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
    if (open) (verified ? emailRef.current : verifyRef.current)?.focus();
  }, [open, verified]);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  /** A row's control, by the invitation's id: `first` is its first button. */
  const control = (id: string, which: "revoke" | "first") => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-invitation="${id}"]`);
    return which === "revoke"
      ? row?.querySelector<HTMLElement>('[data-control="revoke"]')
      : row?.querySelector<HTMLElement>("button");
  };

  // Runs after the list re-renders (a revoked row gone), so focus lands on what is there.
  useEffect(() => {
    if (focusTarget === null) return;
    setFocusTarget(null);
    if (focusTarget === "notice") noticeRef.current?.focus();
    else (control(focusTarget.id, focusTarget.control) ?? noticeRef.current)?.focus();
  }, [focusTarget, pending]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current || !verified) return;
    setFailure(null);
    setNotice(null);
    const invalid = checkEmail(email);
    if (invalid) {
      setEmailError(invalid);
      emailRef.current?.focus();
      return;
    }
    const address = email.trim();
    busyRef.current = true;
    setBusy("form");
    const result = await api.invite(workspaceId, address, invitedRole);
    busyRef.current = false;
    setBusy(null);
    if (!result.ok && result.error !== "not_applied") {
      if (result.error === "invalid_email") {
        setEmailError(invitationErrorText("invalid_email"));
        emailRef.current?.focus();
      } else setFailure(invitationErrorText(result.error, address));
      return;
    }
    setNotice({
      text: result.ok ? part("sent", { email: address }) : invitationErrorText("not_applied"),
      at: "form",
    });
    setEmail("");
    // The parent takes focus back to its Invite button.
    setOpen(false);
    await load();
  };

  const cancel = () => {
    setOpen(false);
    setFailure(null);
    setEmailError(undefined);
  };

  const closePrompt = (id: string) => {
    setConfirming(null);
    control(id, "revoke")?.focus();
  };

  const act = async (invitation: PendingInvitation, kind: "resend" | "revoke") => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(invitation.id);
    setRowFailure(null);
    setConfirming(null);
    setNotice(null);
    // Its prompt goes with the button that confirmed: hold focus on the row while it runs.
    if (kind === "revoke") control(invitation.id, "revoke")?.focus();
    const shown = visibleOf(pending ?? []);
    const index = shown.findIndex((one) => one.id === invitation.id);
    const neighbour = shown[index + 1] ?? shown[index - 1];
    const result =
      kind === "resend"
        ? await api.resend(workspaceId, invitation.id)
        : await api.revoke(workspaceId, invitation.id);
    busyRef.current = false;
    setBusy(null);
    if (!result.ok && result.error !== "not_applied") {
      setRowFailure({
        id: invitation.id,
        message: invitationErrorText(result.error, invitation.email),
      });
      if (result.error === "not_found") await load();
      if (kind === "revoke") setFocusTarget({ id: invitation.id, control: "revoke" });
      return;
    }
    setNotice({
      text: part(kind === "resend" ? "resent" : "revoked", { email: invitation.email }),
      at: "list",
    });
    await load();
    if (kind === "revoke") {
      setFocusTarget(neighbour ? { id: neighbour.id, control: "first" } : "notice");
    }
  };

  const visibleOf = (list: PendingInvitation[]) => (expanded ? list : list.slice(0, PENDING_SHOWN));

  const formNotice =
    notice?.at === "form" ? (
      <p role="status" className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
        {notice.text}
      </p>
    ) : null;

  const form = open ? (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby={titleId}
      aria-busy={busy === "form"}
      className="flex flex-col gap-3 rounded-md bg-muted p-4"
    >
      <h3 id={titleId} className="font-medium">
        {part("title")}
      </h3>
      {verified ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <Field
              ref={emailRef}
              className="flex-1"
              label={part("email_label")}
              type="email"
              autoComplete="off"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="send"
              value={email}
              hint={emailError ? undefined : part("hint")}
              error={emailError}
              onChange={(event) => {
                setEmail(event.target.value);
                setEmailError(undefined);
                setFailure(null);
              }}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor={roleId} className="text-sm font-medium">
                {part("role_label")}
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
        </>
      ) : (
        // Nothing to fill in yet: what they can do now is confirm their own address.
        <div className="flex flex-col gap-2">
          <p className="max-w-prose text-sm text-pretty text-muted-foreground [overflow-wrap:anywhere]">
            {/* The address comes with the session: until it does, nothing to point at yet. */}
            {ownEmail ? part("unverified", { email: ownEmail }) : invitationErrorText("unverified")}
          </p>
          {verification.outcome ? (
            <p role="status" className="text-sm">
              {verification.outcome}
            </p>
          ) : null}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {verified ? (
          <Button type="submit" disabled={busy === "form"} focusableWhenDisabled>
            <SendIcon aria-hidden />
            {busy === "form" ? part("sending") : part("submit")}
          </Button>
        ) : (
          <Button
            ref={verifyRef}
            type="button"
            disabled={verification.sending || !ownEmail}
            focusableWhenDisabled
            onClick={() => void verification.send()}
          >
            <SendIcon aria-hidden />
            {verification.sending
              ? m.verify_notice({ part: "sending", email: "" })
              : m.verify_notice({ part: "resend", email: "" })}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={cancel}>
          {part("cancel")}
        </Button>
      </div>
    </form>
  ) : null;

  const listNotice = (
    <p
      ref={noticeRef}
      role="status"
      tabIndex={-1}
      className="text-sm text-muted-foreground outline-none [overflow-wrap:anywhere] empty:hidden"
    >
      {notice?.at === "list" ? notice.text : null}
    </p>
  );

  const now = Date.now();
  const visible = visibleOf(pending ?? []);
  const list =
    loadFailed && pending === null ? (
      <div className="flex flex-col items-start gap-2">
        <FormError>{part("load_failed")}</FormError>
        <Button variant="outline" onClick={() => void load()}>
          <RotateCwIcon aria-hidden />
          {m.members_part({ part: "retry", name: "" })}
        </Button>
      </div>
    ) : pending && pending.length > 0 ? (
      <section ref={listRef} aria-labelledby={`${titleId}-pending`} className="flex flex-col gap-2">
        <h3 id={`${titleId}-pending`} className="text-sm font-medium text-muted-foreground">
          {part("pending_title")}
        </h3>
        {listNotice}
        <ul className="-mx-4 divide-y border-t sm:-mx-6">
          {visible.map((invitation) => {
            const expired = invitation.expiresAt <= now;
            const manageable = roles.includes(invitation.role);
            const ask = confirming === invitation.id;
            return (
              <li
                key={invitation.id}
                data-invitation={invitation.id}
                // Icon, address and role on top; on phones the actions take a line of their own under the address.
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:items-center sm:gap-x-4 sm:px-6"
              >
                <MailIcon
                  aria-hidden
                  className="mt-1 size-4 shrink-0 text-muted-foreground sm:mt-0"
                />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="font-medium [overflow-wrap:anywhere]">{invitation.email}</p>
                  <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                    {expired ? (
                      part("expired")
                    ) : (
                      <span title={formatDateTime(invitation.expiresAt, locale, TIME_ZONE)}>
                        {part("expires", {
                          date: formatDateTime(invitation.expiresAt, locale, TIME_ZONE, {
                            month: "short",
                            day: "numeric",
                          }),
                        })}
                      </span>
                    )}
                    {invitation.invitedBy.name
                      ? `. ${part("invited_by", { name: invitation.invitedBy.name })}`
                      : null}
                  </p>
                </div>
                <Badge variant="outline" className="mt-0.5 shrink-0 sm:mt-0">
                  {m.member_role({ role: invitation.role })}
                </Badge>
                {manageable ? (
                  <div className="col-span-2 col-start-2 -ml-3 flex flex-wrap gap-1 sm:col-span-1 sm:col-start-auto sm:ml-0">
                    <Button
                      variant="ghost"
                      disabled={busy !== null || !verified}
                      focusableWhenDisabled
                      onClick={() => void act(invitation, "resend")}
                    >
                      <RotateCwIcon aria-hidden />
                      {part("resend")}
                    </Button>
                    <Button
                      data-control="revoke"
                      variant="ghost"
                      aria-expanded={ask}
                      disabled={busy !== null}
                      focusableWhenDisabled
                      onClick={() => {
                        if (busy !== null) return;
                        if (ask) closePrompt(invitation.id);
                        else {
                          setRowFailure(null);
                          setConfirming(invitation.id);
                        }
                      }}
                      className="text-destructive hover:text-destructive"
                    >
                      <XIcon aria-hidden />
                      {part("revoke")}
                    </Button>
                  </div>
                ) : null}
                {busy === invitation.id ? (
                  <p
                    role="status"
                    className="col-span-2 col-start-2 text-sm text-muted-foreground sm:col-span-3"
                  >
                    {m.members_part({ part: "saving", name: "" })}
                  </p>
                ) : null}
                {rowFailure?.id === invitation.id ? (
                  <div className="col-span-2 col-start-2 sm:col-span-3">
                    <FormError>{rowFailure.message}</FormError>
                  </div>
                ) : null}
                {ask ? (
                  <div
                    role="group"
                    aria-labelledby={`${titleId}-${invitation.id}`}
                    onKeyDown={(event: KeyboardEvent) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        closePrompt(invitation.id);
                      }
                    }}
                    className="col-span-2 col-start-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-muted px-3 py-2 text-sm sm:col-span-3"
                  >
                    <p
                      id={`${titleId}-${invitation.id}`}
                      className="min-w-0 flex-1 basis-48 [overflow-wrap:anywhere]"
                    >
                      {part("revoke_prompt", { email: invitation.email })}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        ref={confirmRef}
                        variant="destructive"
                        onClick={() => void act(invitation, "revoke")}
                      >
                        {part("revoke_confirm")}
                      </Button>
                      <Button variant="ghost" onClick={() => closePrompt(invitation.id)}>
                        {part("cancel")}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {visible.length < pending.length ? (
          <div className="-mx-4 -mt-2 border-t sm:-mx-6">
            <Button
              variant="ghost"
              onClick={() => {
                const first = pending[visible.length];
                setExpanded(true);
                if (first) setFocusTarget({ id: first.id, control: "first" });
              }}
              className="w-full justify-start rounded-none px-4 tabular-nums sm:px-6"
            >
              {m.invite_show_all({ count: pending.length })}
            </Button>
          </div>
        ) : null}
      </section>
    ) : notice?.at === "list" ? (
      // The last one revoked: the outcome stays, and holds focus.
      listNotice
    ) : null;

  const parts: InvitationParts = {
    form:
      formNotice || form ? (
        <>
          {formNotice}
          {form}
        </>
      ) : null,
    pending: list,
    count: pending?.length ?? 0,
  };
  return children ? (
    children(parts)
  ) : (
    <div className="flex flex-col gap-4">
      {parts.form}
      {parts.pending}
    </div>
  );
}
