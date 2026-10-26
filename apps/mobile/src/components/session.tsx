import type { Role } from "@freecorps/brigade-schema";
import { SyncProvider } from "@freecorps/brigade-sync/react";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { authClient, server } from "@/lib/auth-client";
import { registerPhone, unregisterPhone, type Paging } from "@/lib/device";
import { phoneDeps } from "@/lib/phone";
import { memberActor } from "@/lib/sync";
import { createWorkspaceSync, setCurrentSync, type WorkspaceSync } from "@/lib/sync-client";

/** The signed-in member in their active workspace: what every signed-in screen reads. */
export type Member = {
  userId: string;
  name: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  role: Role;
  /** Whether this phone gets pages (registered on sign-in). */
  paging: Paging;
  signOut: () => Promise<void>;
};

/** What the app shows before a member is ready: the sign-in screen draws all of these. */
export type SessionView =
  | { kind: "loading" }
  | { kind: "signed-out" }
  /** The build has no Brigade to talk to (a release build without EXPO_PUBLIC_BRIGADE_URL). */
  | { kind: "no-server" }
  | { kind: "unavailable"; retry: () => void }
  | { kind: "no-workspace"; signOut: () => Promise<void> }
  | { kind: "ready"; member: Member };

const SessionContext = createContext<SessionView>({ kind: "loading" });

export function useSessionView(): SessionView {
  return use(SessionContext);
}

/** The member below a ready session; only signed-in screens call it. */
export function useMember(): Member {
  const view = use(SessionContext);
  if (view.kind !== "ready") throw new Error("useMember needs a signed-in member");
  return view.member;
}

/**
 * Who is signed in, from Better Auth's session (kept in secure storage, so the app opens signed in offline). With a
 * session and an active workspace it opens the workspace's shard as the member and registers the phone for pages;
 * `children` gets whether a member is ready, for the signed-in screens' guard.
 */
export function Session({ children }: { children: (ready: boolean) => ReactNode }) {
  const session = authClient.useSession();
  const data = session.data;
  const workspaceId = data?.session.activeOrganizationId;
  let view: SessionView;
  if (!server) view = { kind: "no-server" };
  else if (data && workspaceId) {
    return (
      <ActiveWorkspace
        userId={data.user.id}
        name={data.user.name}
        email={data.user.email}
        workspaceId={workspaceId}
        sessionToken={data.session.token}
      >
        {children}
      </ActiveWorkspace>
    );
  } else if (data) view = { kind: "no-workspace", signOut };
  else if (session.isPending) view = { kind: "loading" };
  else if (session.error) view = { kind: "unavailable", retry: () => void session.refetch() };
  else view = { kind: "signed-out" };
  return <SessionContext value={view}>{children(false)}</SessionContext>;
}

/**
 * Signs out on the server; signed out here whatever it answers. Better Auth's Expo client forgets the session only
 * when the server answers, so offline (or with the server refusing) the stored session is cleared by hand: the
 * phone must never stay signed in after the person asked to leave. The server's session then lasts until it
 * expires.
 */
async function signOut(): Promise<void> {
  let failed = true;
  try {
    failed = Boolean((await authClient.signOut()).error);
  } catch {
    // A network failure.
  }
  if (!failed) return;
  // The keys `@better-auth/expo` keeps (storagePrefix "brigade", src/lib/auth-client.ts); "{}" is how it clears them.
  await SecureStore.setItemAsync("brigade_cookie", "{}");
  await SecureStore.setItemAsync("brigade_session_data", "{}");
  authClient.$store.notify("$sessionSignal");
}

function ActiveWorkspace({
  userId,
  name,
  email,
  workspaceId,
  sessionToken,
  children,
}: {
  userId: string;
  name: string;
  email: string;
  workspaceId: string;
  sessionToken: string;
  children: (ready: boolean) => ReactNode;
}) {
  const workspace = authClient.useActiveOrganization();
  const member = authClient.useActiveMember();
  const actor = memberActor(userId, member.data?.role);
  // Read by the sync client's optimistic runs, so a role change does not need a new client.
  const role = useRef(actor.role);
  useEffect(() => {
    role.current = actor.role;
  }, [actor.role]);

  const cookie = useRef("");
  // A refreshed session can come with a new cookie; the next socket sends it.
  useEffect(() => {
    void authClient.getCookie().then((value) => {
      cookie.current = value;
    });
  }, [sessionToken]);

  const [sync, setSync] = useState<WorkspaceSync | null>(null);
  useEffect(() => {
    const target = server;
    if (!target) return;
    let made: WorkspaceSync | null = null;
    let live = true;
    void authClient.getCookie().then((value) => {
      if (!live) return;
      cookie.current = value;
      made = createWorkspaceSync({
        server: target,
        workspaceId,
        actor: () => ({ kind: "user", id: userId, role: role.current }),
        cookie: () => cookie.current,
      });
      setCurrentSync(made);
      setSync(made);
    });
    return () => {
      live = false;
      // Closing drops the socket and every row it brought: nothing of this session outlives it.
      made?.client.close();
      setCurrentSync(null);
      setSync(null);
    };
  }, [userId, workspaceId]);

  const [paging, setPaging] = useState<Paging>("pending");
  useEffect(() => {
    if (!sync) return;
    let live = true;
    setPaging("pending");
    void registerPhone(phoneDeps(sync)).then((result) => {
      if (live) setPaging(result);
    });
    return () => {
      live = false;
    };
  }, [sync]);

  const leave = useCallback(async () => {
    // Stop paging this phone first, while the session can still say whose device it is.
    if (sync) await unregisterPhone(phoneDeps(sync));
    await signOut();
  }, [sync]);

  const ready = Boolean(sync && workspace.data && member.data);
  const value = useMemo<SessionView>(() => {
    if (ready) {
      return {
        kind: "ready",
        member: {
          userId,
          name,
          email,
          workspaceId,
          workspaceName: workspace.data!.name,
          role: actor.role,
          paging,
          signOut: leave,
        },
      };
    }
    if (workspace.error || member.error) {
      return {
        kind: "unavailable",
        retry: () => {
          void workspace.refetch();
          void member.refetch();
        },
      };
    }
    return { kind: "loading" };
  }, [ready, userId, name, email, workspaceId, workspace, member, actor.role, paging, leave]);

  if (!ready || !sync) return <SessionContext value={value}>{children(false)}</SessionContext>;
  return (
    <SyncProvider client={sync.client} shard={sync.shard}>
      <SessionContext value={value}>{children(true)}</SessionContext>
    </SyncProvider>
  );
}
