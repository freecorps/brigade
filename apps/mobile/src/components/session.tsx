import type { Role } from "@freecorps/brigade-schema";
import { SyncProvider } from "@freecorps/brigade-sync/react";
import { useNetworkState } from "expo-network";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";
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
import { authClient, forgetSession, server } from "@/lib/auth-client";
import { registerPhone, unregisterPhone, type Paging } from "@/lib/device";
import { pagingCycle } from "@/lib/paging";
import { finishDeps, keptSignOuts, phoneDeps, SESSION_LIFETIME_MS } from "@/lib/phone";
import { finishSignOut, signOutPhone, type FinishResult } from "@/lib/sign-out";
import { knownWorkspace, memberActor, WORKSPACE_KEY, type Server } from "@/lib/sync";
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
  /** Finishes a kept sign-out and registers again now, instead of at the next try; resolves when done. */
  retryPaging: () => Promise<void>;
  /**
   * `kept`: the shard could not be told, so the phone may page them until it is next online. `stuck`: nor could
   * their session be kept to tell it later.
   */
  signOut: () => Promise<"released" | "kept" | "stuck">;
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

/** False only when the phone knows it has no connection; unknown counts as online, so nothing waits on it. */
export function useOnline(): boolean {
  const network = useNetworkState();
  return (network.isInternetReachable ?? network.isConnected) !== false;
}

/** The latest value, for effects that should run on something else changing. */
function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

let finishing: Promise<FinishResult> | null = null;

/** One try at finishing the sign-outs kept from offline (src/lib/sign-out.ts), shared by everyone who asks meanwhile. */
function finishLeftover(target: Server): Promise<FinishResult> {
  finishing ??= finishSignOut(finishDeps(target))
    .catch(() => "pending" as const)
    .finally(() => {
      finishing = null;
    });
  return finishing;
}

/**
 * Finishing kept sign-outs, then registering the phone with `register` (src/lib/paging.ts), while `enabled`: again on
 * a backoff while something is left undone, and right away when the phone is back online or the app comes back to
 * the foreground. A new `register` starts over.
 */
function usePaging(
  enabled: boolean,
  online: boolean,
  register: ((proceed: () => boolean) => Promise<Paging>) | null,
): { paging: Paging; retry: () => Promise<void>; stop: () => Promise<void> } {
  const [paging, setPaging] = useState<Paging>("pending");
  const cycle = useRef<ReturnType<typeof pagingCycle> | null>(null);
  useEffect(() => {
    const target = server;
    if (!enabled || !target) return;
    setPaging("pending");
    const made = pagingCycle({
      finish: () => finishLeftover(target),
      register,
      onPaging: setPaging,
      setTimer: (run, ms) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
      },
    });
    cycle.current = made;
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") void made.retry();
    });
    return () => {
      foreground.remove();
      void made.stop();
      if (cycle.current === made) cycle.current = null;
    };
  }, [enabled, register]);
  // Back online: no waiting out the backoff. The first run is the cycle's own.
  const wasOnline = useRef(online);
  useEffect(() => {
    const back = online && !wasOnline.current;
    wasOnline.current = online;
    if (back) void cycle.current?.retry();
  }, [online]);
  const retry = useCallback(() => cycle.current?.retry() ?? Promise.resolve(), []);
  const stop = useCallback(() => cycle.current?.stop() ?? Promise.resolve(), []);
  return { paging, retry, stop };
}

/**
 * Who is signed in, from Better Auth's session (kept in secure storage, so the app opens signed in offline). With a
 * session and an active workspace it opens the workspace's shard as the member and registers the phone for pages;
 * `children` gets whether a member is ready, for the signed-in screens' guard. At launch, whenever the phone is
 * back online and until it is done, it finishes a sign-out that could not reach the shard, so a phone signed out
 * offline stops paging the person who left before the next one registers it.
 */
export function Session({ children }: { children: (ready: boolean) => ReactNode }) {
  const session = authClient.useSession();
  const online = useOnline();
  // Better Auth does not ask again by itself: a session it could not read is read again on reconnect.
  const refetch = useLatest(session.refetch);
  const failed = Boolean(session.error);
  useEffect(() => {
    if (online && failed) void refetch.current();
  }, [online, failed, refetch]);

  const data = session.data;
  const workspaceId = data?.session.activeOrganizationId;
  // With nobody in a workspace to register for, kept sign-outs are still finished; ActiveWorkspace does both.
  usePaging(!(data && workspaceId), online, null);
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
        online={online}
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
 * Signs out on the server; signed out here whatever it answers: `@better-auth/expo` forgets the stored session
 * before the request goes out, so offline the phone is signed out too and the server's session lasts until it
 * expires. True when the server answered.
 */
async function signOutHere(): Promise<boolean> {
  try {
    return !(await authClient.signOut()).error;
  } catch {
    // A network failure.
    return false;
  }
}

/** Signing out without a workspace: nothing pages this phone for it. */
async function signOut(): Promise<void> {
  await signOutHere();
  await SecureStore.deleteItemAsync(WORKSPACE_KEY).catch(() => {});
}

function ActiveWorkspace({
  userId,
  name,
  email,
  workspaceId,
  sessionToken,
  online,
  children,
}: {
  userId: string;
  name: string;
  email: string;
  workspaceId: string;
  sessionToken: string;
  online: boolean;
  children: (ready: boolean) => ReactNode;
}) {
  const workspace = authClient.useActiveOrganization();
  const member = authClient.useActiveMember();

  // The workspace and role as last read: offline, the app opens with them and reads them again once online.
  const [known, setKnown] = useState<{ name: string; role: Role } | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void SecureStore.getItemAsync(WORKSPACE_KEY)
      .catch(() => null)
      .then((raw) => {
        if (live) setKnown(knownWorkspace(raw, userId, workspaceId));
      });
    return () => {
      live = false;
    };
  }, [userId, workspaceId]);
  const liveName = workspace.data?.name;
  const liveRole = member.data?.role;
  useEffect(() => {
    if (liveName === undefined || liveRole === undefined) return;
    const role = memberActor(userId, liveRole).role;
    void SecureStore.setItemAsync(
      WORKSPACE_KEY,
      JSON.stringify({ userId, workspaceId, name: liveName, role }),
    ).catch(() => {});
  }, [userId, workspaceId, liveName, liveRole]);
  const refetchWorkspace = useLatest(workspace.refetch);
  const refetchMember = useLatest(member.refetch);
  // Back online: read them again, so a remembered name or role does not linger.
  const wasOnline = useRef(online);
  useEffect(() => {
    const back = online && !wasOnline.current;
    wasOnline.current = online;
    if (!back) return;
    void refetchWorkspace.current();
    void refetchMember.current();
  }, [online, refetchWorkspace, refetchMember]);

  const workspaceName = liveName ?? known?.name;
  const actor = memberActor(userId, liveRole ?? known?.role);
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

  // Someone who signed out offline first: their device has to come off the shard before this one can take it.
  const register = useMemo(
    () => (sync ? (proceed: () => boolean) => registerPhone(phoneDeps(sync), proceed) : null),
    [sync],
  );
  const {
    paging,
    retry: retryPaging,
    stop: stopPaging,
  } = usePaging(register !== null, online, register);

  const leave = useCallback(async () => {
    // No registration the cycle started may reach the shard after the phone comes off it below.
    await stopPaging();
    const result = await signOutPhone(
      { userId, workspaceId },
      {
        cookie: () => authClient.getCookie(),
        // Stop paging this phone first, while the session can still say whose device it is.
        unregister: sync ? () => unregisterPhone(phoneDeps(sync)) : null,
        signOut: signOutHere,
        forget: () => forgetSession(authClient),
        add: keptSignOuts.add,
        origin: server?.auth ?? "",
        now: Date.now,
        lifetime: SESSION_LIFETIME_MS,
      },
    );
    await SecureStore.deleteItemAsync(WORKSPACE_KEY).catch(() => {});
    return result;
  }, [sync, userId, workspaceId, stopPaging]);

  const ready = Boolean(sync && workspaceName !== undefined && (liveRole ?? known?.role));
  const value = useMemo<SessionView>(() => {
    if (ready) {
      return {
        kind: "ready",
        member: {
          userId,
          name,
          email,
          workspaceId,
          workspaceName: workspaceName!,
          role: actor.role,
          paging,
          retryPaging,
          signOut: leave,
        },
      };
    }
    // Still reading what was remembered: not a failure yet.
    if (known !== undefined && (workspace.error || member.error)) {
      return {
        kind: "unavailable",
        retry: () => {
          void workspace.refetch();
          void member.refetch();
        },
      };
    }
    return { kind: "loading" };
  }, [
    ready,
    userId,
    name,
    email,
    workspaceId,
    workspaceName,
    known,
    workspace,
    member,
    actor.role,
    paging,
    retryPaging,
    leave,
  ]);

  if (!ready || !sync) return <SessionContext value={value}>{children(false)}</SessionContext>;
  return (
    <SyncProvider client={sync.client} shard={sync.shard}>
      <SessionContext value={value}>{children(true)}</SessionContext>
    </SyncProvider>
  );
}
