import { m } from "@freecorps/brigade-i18n";
import type { MemberChange, Role } from "@freecorps/brigade-schema";
import { cn } from "cn";
import { LogOutIcon, UserMinusIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
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
  sortMembers,
  type ListedMember,
  type MemberChangeError,
} from "@/lib/members";

/**
 * The workspace's members from D1 (Better Auth's full organization: names, emails, roles), for every role
 * (RFC 0003: `workspace:read`). Owners and admins change roles and remove members; anyone can leave. Every change
 * goes through the API (`/workspaces/:id/members/:userId`), which updates D1, the shard and paging together.
 */
export function MembersCard() {
  const { workspaceId } = useMember();
  const organization = authClient.useActiveOrganization();
  const members = listedMembers(organization.data?.members);
  return (
    <MembersList
      members={members}
      loading={organization.isPending && !organization.data}
      change={(userId, change) => changeMember(workspaceId, userId, change)}
      refresh={async () => {
        // `set-active` (not a refetch of one hook) refreshes the session, the workspace and the signed-in
        // member's own role together, as `openWorkspace` relies on.
        await authClient.organization.setActive({ organizationId: workspaceId });
      }}
      left={() => window.location.assign("/")}
    />
  );
}

/** The card itself, with its data and actions passed in (its tests render it without Better Auth). */
export function MembersList({
  members,
  loading,
  change,
  refresh,
  left,
}: {
  members: ListedMember[];
  loading: boolean;
  change: (
    userId: string,
    change: MemberChange,
  ) => Promise<{ ok: true } | { ok: false; error: MemberChangeError }>;
  refresh: () => Promise<void>;
  /** After the signed-in member left: the workspace is gone from their session. */
  left: () => void;
}) {
  // Read so a language switch rewords the card in place.
  usePreferences();
  const { userId, role } = useMember();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const owners = members.filter((member) => member.role === "owner").length;
  const manage = role === "owner" || role === "admin";
  const sorted = sortMembers(members);

  const run = async (target: ListedMember, request: MemberChange) => {
    setFailed(null);
    setBusy(target.userId);
    const result = await change(target.userId, request);
    if (result.ok && request.kind === "remove" && target.userId === userId) {
      left();
      return;
    }
    if (!result.ok) setFailed(memberChangeReason(result.error));
    try {
      await refresh();
    } catch {
      // The list catches up on the next load; the outcome above is what the member needs to see.
    }
    setBusy(null);
  };

  return (
    <Card
      aria-labelledby="members-title"
      className={cn(sorted.length > 0 && "overflow-hidden pb-0 sm:pb-0")}
    >
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <CardTitle id="members-title">{m.members_part({ part: "title", name: "" })}</CardTitle>
        <CardDescription className="flex flex-wrap gap-x-2">
          {loading ? (
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
        {failed ? <FormError>{failed}</FormError> : null}
        {sorted.length > 0 ? (
          <ul aria-labelledby="members-title" className="-mx-4 divide-y border-t sm:-mx-6">
            {sorted.map((member) => (
              <MemberItem
                key={member.userId}
                member={member}
                self={member.userId === userId}
                choices={memberChoices(
                  { id: userId, role },
                  { id: member.userId, role: member.role },
                  owners,
                )}
                busy={busy === member.userId}
                disabled={busy !== null}
                onChange={(request) => void run(member, request)}
              />
            ))}
          </ul>
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
        {!loading && members.length <= 1 ? (
          <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
            {m.members_part({ part: "empty", name: "" })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

const SELECT =
  "h-9 w-full min-w-0 rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-60 sm:w-40";

/**
 * One member: name (with "You" on one's own row) and email, then their role (a picker when it can change) and
 * Remove, or Leave on one's own row, each asking first, inline under the row.
 */
function MemberItem({
  member,
  self,
  choices,
  busy,
  disabled,
  onChange,
}: {
  member: ListedMember;
  self: boolean;
  choices: { roles: Role[]; remove: boolean; leave: boolean };
  busy: boolean;
  disabled: boolean;
  onChange: (change: MemberChange) => void;
}) {
  const nameId = useId();
  const roleId = useId();
  const promptId = useId();
  const [confirming, setConfirming] = useState(false);
  const askRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);
  const cancel = () => {
    setConfirming(false);
    askRef.current?.focus();
  };
  const name = member.name || m.members_part({ part: "unnamed", name: "" });
  const removable = choices.remove || choices.leave;
  return (
    <li data-member={member.userId} className="flex flex-col gap-2 px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
          <p className="flex min-w-0 items-start gap-2">
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
              <Badge variant="outline" className="shrink-0">
                {m.members_part({ part: "you", name: "" })}
              </Badge>
            ) : null}
          </p>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{member.email}</p>
        </div>
        <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
          {choices.roles.length > 0 && member.role ? (
            <>
              <label htmlFor={roleId} className="sr-only">
                {m.members_part({ part: "role_label", name: "" })}
              </label>
              <select
                id={roleId}
                value={member.role}
                disabled={disabled}
                aria-describedby={nameId}
                onChange={(event) => onChange({ kind: "role", role: event.target.value as Role })}
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
            <Badge variant="outline" className="shrink-0">
              {m.member_role({ role: member.role ?? "*" })}
            </Badge>
          )}
          {removable ? (
            <Button
              ref={askRef}
              variant="ghost"
              disabled={disabled}
              aria-describedby={nameId}
              aria-expanded={confirming}
              onClick={() => setConfirming(true)}
              className="ml-auto shrink-0 text-destructive hover:text-destructive sm:ml-0"
            >
              {choices.leave ? <LogOutIcon aria-hidden /> : <UserMinusIcon aria-hidden />}
              {m.members_part({ part: choices.leave ? "leave" : "remove", name: "" })}
            </Button>
          ) : null}
        </div>
      </div>
      {busy ? (
        <p role="status" className="text-sm text-muted-foreground">
          {m.members_part({ part: "saving", name: "" })}
        </p>
      ) : null}
      {confirming && removable ? (
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
            {m.members_part({ part: self ? "leave_prompt" : "remove_prompt", name })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              ref={confirmRef}
              variant="destructive"
              aria-describedby={nameId}
              onClick={() => {
                setConfirming(false);
                onChange({ kind: "remove" });
              }}
            >
              {self ? <LogOutIcon aria-hidden /> : <UserMinusIcon aria-hidden />}
              {m.members_part({ part: self ? "leave" : "remove", name: "" })}
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
