import { m } from "@freecorps/brigade-i18n";
import type { MemberChange, Role } from "@freecorps/brigade-schema";
import { cn } from "cn";
import { LogOutIcon, RotateCwIcon, UserMinusIcon, UserPlusIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { InvitationsPanel } from "@/components/invitations-panel";
import { usePreferences } from "@/components/preferences";
import { useMember } from "@/components/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/ui/field";
import { authClient } from "@/lib/auth";
import {
  changeMember,
  listedMembers,
  memberChangeReason,
  memberChoices,
  selfDemotion,
  sortMembers,
  visibleMembers,
  type ListedMember,
  type MemberChangeError,
} from "@/lib/members";

/**
 * The workspace's members from D1 (Better Auth's full organization: names, emails, roles), for every role
 * (RFC 0003: `workspace:read`). Owners and admins change roles and remove members; anyone can leave. Every change
 * goes through the API (`/workspaces/:id/members/:userId`), which updates D1, the shard and paging together.
 */
export function MembersCard() {
  const { workspaceId, role } = useMember();
  const organization = authClient.useActiveOrganization();
  const session = authClient.useSession();
  const [inviting, setInviting] = useState(false);
  const members = listedMembers(organization.data?.members);
  const manage = role === "owner" || role === "admin";
  return (
    <MembersList
      invite={
        manage
          ? {
              open: () => setInviting(true),
              opened: inviting,
              panel: (
                <InvitationsPanel
                  workspaceId={workspaceId}
                  role={role}
                  verified={session.data?.user.emailVerified === true}
                  open={inviting}
                  setOpen={setInviting}
                />
              ),
            }
          : undefined
      }
      members={members}
      loading={organization.isPending && !organization.data}
      reload={organization.error && !organization.data ? () => organization.refetch() : undefined}
      change={(userId, change) => changeMember(workspaceId, userId, change)}
      refresh={async () => {
        // `set-active` (not a refetch of one hook) refreshes the session, the workspace and the signed-in
        // member's own role together, as `openWorkspace` relies on. It refuses (403) someone D1 no longer has
        // in the workspace. The removal itself already moved their sessions off it (`deleteMembership` in
        // apps/api), and Better Auth's 403 also sets this session's active workspace to none.
        const { error } = await authClient.organization.setActive({ organizationId: workspaceId });
        return error?.status !== 403;
      }}
      left={() => window.location.assign("/")}
    />
  );
}

/**
 * Answers worth sending again as they were: the change may not have landed. Not `not_applied`: D1 has the change
 * and the shard's repair alarm catches paging up on its own, so it is a note, not an error.
 */
const RETRYABLE: readonly MemberChangeError[] = ["unavailable", "network", "internal"];

/** A change waiting for its confirm: removing or leaving, or stepping one's own role down. */
type Pending = { userId: string; change: MemberChange };
/**
 * A change that did not fully go through, shown in its member's row: an error (`retry` sends the same request
 * again), or a `note` when it is saved and only paging is still catching up.
 */
type Failure = { userId: string; message: string; retry: MemberChange | null; note: boolean };
/**
 * Where focus goes once a change settles: a member's control (found by `data-member`), the row itself when it has
 * none (a viewer's list), or the card's title.
 */
type FocusTarget = { userId: string; control: "role" | "remove" | "retry" | "first" } | "title";

/** The card itself, with its data and actions passed in (its tests render it without Better Auth). */
export function MembersList({
  members,
  loading,
  reload,
  change,
  refresh,
  left,
  invite,
}: {
  /**
   * Owners and admins: the Invite button (`open`, hidden while `opened`) and the invitations panel (the form and the
   * pending invitations), shown under the card's heading.
   */
  invite?: { open: () => void; opened: boolean; panel: ReactNode };
  members: ListedMember[];
  loading: boolean;
  /** Set when the list failed to load (nothing to show): says so, with Try again, instead of an empty workspace. */
  reload?: () => void;
  change: (
    userId: string,
    change: MemberChange,
  ) => Promise<{ ok: true } | { ok: false; error: MemberChangeError }>;
  /** Reloads the list; resolves false when the signed-in user is no longer a member of the workspace. */
  refresh: () => Promise<boolean>;
  /** After the signed-in member left: the workspace is gone from their session. */
  left: () => void;
}) {
  // Read so a language switch rewords the card in place.
  usePreferences();
  const { userId, role } = useMember();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<Failure | null>(null);
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [expanded, setExpanded] = useState(false);
  // The last member acted on stays listed while collapsed, even when a new role sorts them further down.
  const [touched, setTouched] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const owners = members.filter((member) => member.role === "owner").length;
  const manage = role === "owner" || role === "admin";
  const sorted = sortMembers(members);
  // The signed-in member's own row (and its Leave) is always listed, wherever their role sorts them.
  const visible = visibleMembers(sorted, expanded, touched ? [userId, touched] : [userId]);

  // Runs after the list re-renders (a removed row gone, a changed row re-sorted), so focus lands on what is there.
  useEffect(() => {
    if (focusTarget === null) return;
    setFocusTarget(null);
    if (focusTarget === "title") {
      titleRef.current?.focus();
      return;
    }
    const row = cardRef.current?.querySelector<HTMLElement>(
      `[data-member="${focusTarget.userId}"]`,
    );
    const control =
      row?.querySelector<HTMLElement>(`[data-control="${focusTarget.control}"]`) ??
      row?.querySelector<HTMLElement>("select, button");
    (control ?? row ?? titleRef.current)?.focus();
  }, [focusTarget, members]);

  /** `fromRetry`: sent again from the row's Try again, which keeps focus while it still shows. */
  const run = async (target: ListedMember, request: MemberChange, fromRetry = false) => {
    // The control that started a change stays focusable (`aria-disabled`), so every handler goes through here.
    if (busy !== null) return;
    setFailed(null);
    setConfirming(null);
    setBusy(target.userId);
    setTouched(target.userId);
    const result = await change(target.userId, request);
    const self = target.userId === userId;
    if (request.kind === "remove" && self) {
      // Gone from D1 already: done (`not_applied`: the shard catches up on its own), or `not_found`, an earlier
      // attempt went through. A leave is otherwise refused only for the last owner (`last_owner`).
      if (result.ok || result.error === "not_applied" || result.error === "not_found") {
        left();
        return;
      }
      // An earlier attempt went through, or D1 has them with a role Brigade does not know: still a member, whom
      // the start page would open this workspace for again. D1 tells which.
      if (result.error === "not_a_member" && !(await refresh().catch(() => true))) {
        left();
        return;
      }
    }
    const retry = !result.ok && RETRYABLE.includes(result.error) ? request : null;
    if (!result.ok) {
      setFailed({
        userId: target.userId,
        message: memberChangeReason(result.error),
        retry,
        note: result.error === "not_applied",
      });
    }
    try {
      await refresh();
    } catch {
      // The list catches up on the next load; the outcome above is what the member needs to see.
    }
    setBusy(null);
    if (result.ok && request.kind === "remove") {
      // The row is gone: the next one (or the one before, at the end) takes focus, else the title.
      const index = visible.findIndex((member) => member.userId === target.userId);
      const next = visible[index + 1] ?? visible[index - 1];
      setFocusTarget(next ? { userId: next.userId, control: "first" } : "title");
    } else {
      setFocusTarget({
        userId: target.userId,
        control: fromRetry && retry ? "retry" : request.kind === "role" ? "role" : "remove",
      });
    }
  };

  return (
    <Card
      ref={cardRef}
      aria-labelledby="members-title"
      className={cn(sorted.length > 0 && "overflow-hidden pb-0 sm:pb-0")}
    >
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <CardTitle id="members-title" ref={titleRef} tabIndex={-1} className="outline-none">
            {m.members_part({ part: "title", name: "" })}
          </CardTitle>
          {invite && !invite.opened ? (
            <Button variant="outline" onClick={invite.open} className="-my-1.5 shrink-0">
              <UserPlusIcon aria-hidden />
              {m.invite_part({ part: "open", email: "", date: "", name: "" })}
            </Button>
          ) : null}
        </div>
        <CardDescription className="flex flex-wrap gap-x-2">
          {reload && members.length === 0 ? null : loading ? (
            <span aria-hidden className="my-0.5 block h-4 w-24 rounded-sm bg-muted" />
          ) : (
            <span className="tabular-nums">{m.members_count({ count: members.length })}</span>
          )}
        </CardDescription>
        <p className="max-w-prose text-sm text-muted-foreground">
          {m.members_part({ part: manage ? "description" : "read_only", name: "" })}
        </p>
      </div>
      <CardContent className="flex flex-col gap-4">
        {invite?.panel}
        {sorted.length > 0 ? (
          <div className="-mx-4 border-t sm:-mx-6">
            <ul aria-labelledby="members-title" className="divide-y">
              {visible.map((member) => (
                <MemberItem
                  key={member.userId}
                  member={member}
                  self={member.userId === userId}
                  onlyOwner={member.userId === userId && member.role === "owner" && owners <= 1}
                  choices={memberChoices(
                    { id: userId, role },
                    { id: member.userId, role: member.role },
                    owners,
                  )}
                  busy={busy === member.userId}
                  locked={busy !== null}
                  failure={failed?.userId === member.userId ? failed : null}
                  confirming={confirming?.userId === member.userId ? confirming.change : null}
                  onConfirm={(pending) => {
                    // A row shows either an outcome or a question, never both.
                    if (pending) setFailed(null);
                    setConfirming(pending ? { userId: member.userId, change: pending } : null);
                  }}
                  onChange={(request, fromRetry) => void run(member, request, fromRetry)}
                />
              ))}
            </ul>
            {visible.length < sorted.length ? (
              <div className="border-t">
                <Button
                  variant="ghost"
                  onClick={() => {
                    const first = sorted.find((member) => !visible.includes(member));
                    setExpanded(true);
                    if (first) setFocusTarget({ userId: first.userId, control: "first" });
                  }}
                  className="w-full justify-start rounded-none px-4 tabular-nums sm:px-6"
                >
                  {m.members_show_all({ count: sorted.length })}
                </Button>
              </div>
            ) : null}
          </div>
        ) : loading ? (
          <ul aria-hidden className="-mx-4 divide-y border-t sm:-mx-6">
            {[0, 1, 2].map((index) => (
              <li key={index} className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
                <div className="flex flex-col gap-1.5">
                  <span className="my-0.5 block h-4 w-36 rounded-sm bg-muted" />
                  <span className="my-0.5 block h-3 w-52 max-w-full rounded-sm bg-muted" />
                </div>
                <span className="block h-9 w-28 rounded-md bg-muted" />
              </li>
            ))}
          </ul>
        ) : null}
        {reload && members.length === 0 ? (
          <div className="flex flex-col items-start gap-2">
            <FormError>{m.members_part({ part: "load_failed", name: "" })}</FormError>
            <Button variant="outline" onClick={reload}>
              {m.members_part({ part: "retry", name: "" })}
            </Button>
          </div>
        ) : !loading && members.length <= 1 ? (
          <div className="flex flex-col items-start gap-3 rounded-md bg-muted p-4">
            <p className="text-sm text-muted-foreground">
              {m.members_part({ part: invite ? "empty_invite" : "empty", name: "" })}
            </p>
            {invite && !invite.opened ? (
              <Button variant="outline" onClick={invite.open}>
                <UserPlusIcon aria-hidden />
                {m.invite_part({ part: "open", email: "", date: "", name: "" })}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// 16px and 44px tall on phones (no zoom on focus, a full touch target); the desktop density from `sm` up.
const SELECT =
  "h-11 min-w-32 flex-1 rounded-md border border-input bg-card px-2 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring aria-disabled:opacity-60 sm:h-9 sm:w-40 sm:flex-none sm:text-sm";

/**
 * One member: name (with "You" on one's own row) and email, then their role (a picker when it can change) and
 * Remove, or Leave on one's own row. Removing, leaving and stepping one's own role down ask first, inline under
 * the row; a failed change is shown there too.
 */
function MemberItem({
  member,
  self,
  onlyOwner,
  choices,
  busy,
  locked,
  failure,
  confirming,
  onConfirm,
  onChange,
}: {
  member: ListedMember;
  self: boolean;
  /** The signed-in member is the workspace's only owner: say why they cannot leave or step down. */
  onlyOwner: boolean;
  choices: { roles: Role[]; remove: boolean; leave: boolean };
  busy: boolean;
  /** A change is running somewhere in the list: controls stay focusable but do nothing. */
  locked: boolean;
  failure: Failure | null;
  confirming: MemberChange | null;
  onConfirm: (pending: MemberChange | null) => void;
  onChange: (change: MemberChange, fromRetry?: boolean) => void;
}) {
  const nameId = useId();
  const roleId = useId();
  const promptId = useId();
  const askRef = useRef<HTMLButtonElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const open = confirming !== null;
  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);
  const cancel = () => {
    const from = confirming?.kind === "role" ? selectRef.current : askRef.current;
    onConfirm(null);
    from?.focus();
  };
  const confirm = (change: MemberChange) => {
    // The prompt goes away with its button: focus moves to the control that asked, before the change runs.
    (change.kind === "role" ? selectRef.current : askRef.current)?.focus();
    onChange(change);
  };
  const name = member.name || m.members_part({ part: "unnamed", name: "" });
  const removable = choices.remove || choices.leave;
  const pickRole = (next: Role) => {
    if (locked || !member.role || next === member.role) return;
    if (self && selfDemotion(member.role, next)) onConfirm({ kind: "role", role: next });
    else onChange({ kind: "role", role: next });
  };
  return (
    // Focusable from script only: where focus lands on a row without controls (a viewer's list after Show all).
    <li
      data-member={member.userId}
      tabIndex={-1}
      className="flex flex-col gap-2 px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset sm:px-6"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
          <p className="flex min-w-0 items-baseline gap-2">
            <span
              id={nameId}
              className={cn(
                "min-w-0 font-medium [overflow-wrap:anywhere]",
                !member.name && "text-muted-foreground italic",
              )}
            >
              {name}
            </span>
            {self ? (
              <span className="shrink-0 text-sm text-muted-foreground">
                {m.members_part({ part: "you", name: "" })}
              </span>
            ) : null}
          </p>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{member.email}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
          {choices.roles.length > 0 && member.role ? (
            <>
              <label htmlFor={roleId} className="sr-only">
                {m.members_part({ part: "role_label", name: "" })}
              </label>
              <select
                ref={selectRef}
                id={roleId}
                data-control="role"
                value={member.role}
                aria-disabled={locked || undefined}
                title={locked ? m.members_part({ part: "saving", name: "" }) : undefined}
                aria-describedby={nameId}
                onChange={(event) => pickRole(event.target.value as Role)}
                className={SELECT}
              >
                {choices.roles.map((option) => (
                  <option key={option} value={option}>
                    {m.member_role({ role: option })}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <div className="flex sm:w-40">
              <Badge variant="outline" className="shrink-0">
                {m.member_role({ role: member.role ?? "*" })}
              </Badge>
            </div>
          )}
          {/* A fixed slot from `sm` up, so every row's role lines up whichever button (or none) follows; on
              phones Leave takes its own line, Remove sits beside the role. */}
          <div
            className={cn(
              "sm:flex sm:min-w-44 sm:basis-auto sm:justify-end",
              !removable ? "hidden" : choices.leave ? "flex basis-full" : "ml-auto flex sm:ml-0",
            )}
          >
            {removable ? (
              <Button
                ref={askRef}
                data-control="remove"
                variant="ghost"
                disabled={locked}
                focusableWhenDisabled
                aria-describedby={nameId}
                aria-expanded={confirming?.kind === "remove"}
                onClick={() => {
                  if (!locked) onConfirm({ kind: "remove" });
                }}
                className="shrink-0 text-destructive hover:text-destructive"
              >
                {choices.leave ? <LogOutIcon aria-hidden /> : <UserMinusIcon aria-hidden />}
                {m.members_part({ part: choices.leave ? "leave" : "remove", name: "" })}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      {onlyOwner ? (
        <p className="max-w-prose text-sm text-muted-foreground">
          {m.members_part({ part: "only_owner", name: "" })}
        </p>
      ) : null}
      {busy ? (
        <p role="status" className="text-sm text-muted-foreground">
          {m.members_part({ part: "saving", name: "" })}
        </p>
      ) : null}
      {failure?.note ? (
        <p role="status" className="max-w-prose text-sm text-muted-foreground">
          {failure.message}
        </p>
      ) : failure ? (
        <div className="flex flex-col gap-2">
          <FormError>{failure.message}</FormError>
          {failure.retry ? (
            <Button
              data-control="retry"
              variant="outline"
              disabled={locked}
              focusableWhenDisabled
              aria-describedby={nameId}
              onClick={() => {
                if (!locked && failure.retry) onChange(failure.retry, true);
              }}
              className="self-start"
            >
              <RotateCwIcon aria-hidden />
              {m.members_part({ part: "retry", name: "" })}
            </Button>
          ) : null}
        </div>
      ) : null}
      {confirming ? (
        <div
          role="group"
          aria-labelledby={promptId}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-muted px-3 py-2 text-sm"
        >
          <p id={promptId} className="min-w-0 flex-1 basis-48 [overflow-wrap:anywhere]">
            {confirming.kind === "role"
              ? m.member_demote_prompt({
                  kind: selfDemotion(member.role ?? "viewer", confirming.role) ?? "manage",
                  role: m.member_role({ role: confirming.role }),
                })
              : m.members_part({ part: self ? "leave_prompt" : "remove_prompt", name })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              ref={confirmRef}
              variant="destructive"
              aria-describedby={nameId}
              onClick={() => confirm(confirming)}
            >
              {confirming.kind === "role" ? null : self ? (
                <LogOutIcon aria-hidden />
              ) : (
                <UserMinusIcon aria-hidden />
              )}
              {m.members_part({
                part: confirming.kind === "role" ? "demote" : self ? "leave" : "remove",
                name: "",
              })}
            </Button>
            <Button variant="ghost" onClick={cancel}>
              {m.members_part({ part: "cancel", name: "" })}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
