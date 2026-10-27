import { m } from "@freecorps/brigade-i18n";
import { isRole, type Role } from "@freecorps/brigade-schema";
import { SyncProvider } from "@freecorps/brigade-sync/react";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { AuthPage } from "@/components/auth-page";
import { usePreferences } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { authClient, checkWorkspaceName, createWorkspace, openWorkspace } from "@/lib/auth";
import { usePageTitle } from "@/lib/page-title";
import { setSyncActor } from "@/lib/sync";
import { syncClient } from "@/sync-client";

/**
 * What the dashboard needs before it renders: a session (else the sign-in page), an active workspace (else the
 * create-workspace form) and the user's role in it. Then it opens the workspace's shard as that member.
 */
export function RequireWorkspace({ children }: { children: ReactNode }) {
  const session = authClient.useSession();
  if (session.isPending) return <Loading />;
  if (session.error) return <Unavailable retry={() => void session.refetch()} />;
  if (!session.data) return <Navigate to="/sign-in" replace />;
  if (!session.data.session.activeOrganizationId) return <CreateWorkspace />;
  return <ActiveWorkspace userId={session.data.user.id}>{children}</ActiveWorkspace>;
}

/** The signed-in member's workspace, user id and role, for what the dashboard shows or hides (RFC 0003). */
export type Member = { workspaceId: string; userId: string; role: Role };

const MemberContext = createContext<Member | null>(null);

/** The signed-in member when below `RequireWorkspace`, or null (a card rendered on its own, as in its tests). */
export function useOptionalMember(): Member | null {
  return useContext(MemberContext);
}

/** The member `RequireWorkspace` signed in; only below it. */
export function useMember(): Member {
  const member = useContext(MemberContext);
  if (!member) throw new Error("useMember needs <RequireWorkspace> above it");
  return member;
}

/** Mounted only with a session and an active workspace, so its queries never run signed out. */
function ActiveWorkspace({ userId, children }: { userId: string; children: ReactNode }) {
  const workspace = authClient.useActiveOrganization();
  const member = authClient.useActiveMember();
  // Just after a switch, the member read may still be the old workspace's: its role is not this one's.
  if (
    !workspace.data ||
    !member.data ||
    (member.data.organizationId !== undefined && member.data.organizationId !== workspace.data.id)
  ) {
    if (workspace.error || member.error) {
      return (
        <Unavailable
          retry={() => {
            void workspace.refetch();
            void member.refetch();
          }}
        />
      );
    }
    return <Loading />;
  }

  // Brigade gives every member one of its roles; anything else reads nothing, like the shard would answer.
  const role = isRole(member.data.role) ? member.data.role : "viewer";
  setSyncActor({ kind: "user", id: userId, role });
  return (
    <SyncProvider client={syncClient} shard={workspace.data.id}>
      {/* Keyed: a switch starts every card over, so no state of one workspace shows in another. */}
      <MemberProvider
        key={workspace.data.id}
        workspaceId={workspace.data.id}
        userId={userId}
        role={role}
      >
        {children}
      </MemberProvider>
    </SyncProvider>
  );
}

export function MemberProvider({
  workspaceId,
  userId,
  role,
  children,
}: Member & { children: ReactNode }) {
  const value = useMemo(() => ({ workspaceId, userId, role }), [workspaceId, userId, role]);
  return <MemberContext.Provider value={value}>{children}</MemberContext.Provider>;
}

export function Loading() {
  usePageTitle(m.page_title_loading());
  return (
    <div
      role="status"
      className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-10 text-sm text-muted-foreground sm:px-6"
    >
      <LoaderCircleIcon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
      {m.session_loading()}
    </div>
  );
}

function Unavailable({ retry }: { retry: () => void }) {
  usePageTitle(m.page_title_loading());
  return (
    <div className="mx-auto flex max-w-sm flex-col items-start gap-4 px-4 py-10">
      <FormError>{m.auth_error_network()}</FormError>
      <Button variant="outline" onClick={retry}>
        <RefreshCwIcon aria-hidden />
        {m.stack_check_again()}
      </Button>
    </div>
  );
}

/**
 * Signed in without a workspace (sign-up's last step failed, or the user left their last one), or, with `another`,
 * New workspace from the header's switcher (`/workspaces/new`), which can go back.
 */
export function CreateWorkspace({ another = false }: { another?: boolean }) {
  // Read so a language switch rewords the form (RequireWorkspace's route does not read it).
  usePreferences();
  usePageTitle(m.page_title_create_workspace());
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    const checked = checkWorkspaceName(name);
    if (!checked.ok) {
      setError(checked.error);
      input.current?.focus();
      return;
    }
    setBusy(true);
    const created = await createWorkspace(checked.name);
    if (!created.ok) {
      setFailure(
        created.status === 0
          ? m.auth_error_network()
          : created.error === "workspace_limit"
            ? m.workspace_error_limit()
            : m.auth_error_generic(),
      );
      setBusy(false);
      return;
    }
    await openWorkspace(created.workspace.id);
    if (another) await navigate({ to: "/" });
  };

  return (
    <AuthPage
      title={another ? m.account_flow({ part: "new_title", name: "" }) : m.workspace_create_title()}
      description={
        another
          ? m.account_flow({ part: "new_description", name: "" })
          : m.workspace_create_description()
      }
      footer={
        another ? (
          <Link to="/" className="font-medium text-primary underline-offset-4 hover:underline">
            {m.account_flow({ part: "cancel", name: "" })}
          </Link>
        ) : undefined
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-busy={busy}>
        <Field
          ref={input}
          label={m.workspace_name_label()}
          hint={error ? undefined : m.workspace_name_hint()}
          autoComplete="organization"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
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
              {m.workspace_creating()}
            </>
          ) : (
            m.workspace_create_submit()
          )}
        </Button>
      </form>
    </AuthPage>
  );
}
