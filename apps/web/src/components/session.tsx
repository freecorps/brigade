import { m } from "@freecorps/brigade-i18n";
import { isRole } from "@freecorps/brigade-schema";
import { SyncProvider } from "@freecorps/brigade-sync/react";
import { Navigate } from "@tanstack/react-router";
import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { AuthPage } from "@/components/auth-page";
import { usePreferences } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { authClient, checkWorkspaceName, createWorkspace } from "@/lib/auth";
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

/** Mounted only with a session and an active workspace, so its queries never run signed out. */
function ActiveWorkspace({ userId, children }: { userId: string; children: ReactNode }) {
  const workspace = authClient.useActiveOrganization();
  const member = authClient.useActiveMember();
  if (!workspace.data || !member.data) {
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

  const role = member.data.role;
  // Brigade gives every member one of its roles; anything else reads nothing, like the shard would answer.
  setSyncActor({ kind: "user", id: userId, role: isRole(role) ? role : "viewer" });
  return (
    <SyncProvider client={syncClient} shard={workspace.data.id}>
      {children}
    </SyncProvider>
  );
}

function Loading() {
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

/** Signed in without a workspace: sign-up's second step failed, or the user left their last one. */
function CreateWorkspace() {
  // Read so a language switch rewords the form (RequireWorkspace's route does not read it).
  usePreferences();
  usePageTitle(m.page_title_create_workspace());
  const session = authClient.useSession();
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
      setFailure(created.status === 0 ? m.auth_error_network() : m.auth_error_generic());
      setBusy(false);
      return;
    }
    // `POST /workspaces` made it active; reloading the session re-renders the gate into the dashboard.
    await session.refetch();
  };

  return (
    <AuthPage title={m.workspace_create_title()} description={m.workspace_create_description()}>
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
