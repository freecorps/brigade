import { DEVICE_HEADER, newId, type Role } from "@freecorps/brigade-schema";
import { SyncProvider } from "@freecorps/brigade-sync/react";
import { getRandomBytes } from "expo-crypto";
import { useNetworkState } from "expo-network";
import * as Notifications from "expo-notifications";
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
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { authClient, forgetSession, server } from "@/lib/auth-client";
import { registerEverywhere, unregisterPhone, type Paging, type Registrations } from "@/lib/device";
import { drainer, type Drainable } from "@/lib/drain";
import { pagingCycle } from "@/lib/paging";
import { dropQueues, openQueue } from "@/lib/pending";
import { pendingFiles } from "@/lib/pending-files";
import {
  finishDeps,
  keptSignOuts,
  phoneDeps,
  phoneDeviceId,
  phoneWorkspaces,
  registerAllWith,
  SESSION_LIFETIME_MS,
} from "@/lib/phone";
import { withoutWorkspaces, withWorkspace, type PhoneWorkspace } from "@/lib/phone-workspaces";
import {
  finishSignOut,
  inTime,
  SIGN_OUT_TIMEOUT_MS,
  signOutPhone,
  type FinishResult,
} from "@/lib/sign-out";
import { knownWorkspace, memberActor, settledRole, WORKSPACE_KEY, type Server } from "@/lib/sync";
import { createWorkspaceSync, setCurrentSync, type WorkspaceSync } from "@/lib/sync-client";
import { clearWidget, WidgetSnapshot } from "@/components/widget";
import { BrigadeCall } from "../../modules/brigade-call";

/** The signed-in member in their active workspace: what every signed-in screen reads. */
export type Member = {
  userId: string;
  name: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  role: Role;
  /** Whether this phone gets pages for the open workspace (registered on sign-in). */
  paging: Paging;
  /**
   * Every workspace this phone pages the member for (each one they opened on it, the open one first) and whether it
   * does, as the last registration said (RFC 0006 "Device registration").
   */
  pagedWorkspaces: (PhoneWorkspace & { paging: Paging })[];
  /** Finishes a kept sign-out and registers again now, instead of at the next try; resolves when done. */
  retryPaging: () => Promise<void>;
  /**
   * `kept`: the shard could not be told, so the phone may page them until it is next online. `stuck`: nor could
   * their session be kept to tell it later.
   */
  signOut: () => Promise<"released" | "kept" | "stuck">;
  /** Whether changes not sent yet are kept on the phone: signing out deletes them. */
  unsent: () => boolean;
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
  register: ((proceed: () => boolean) => Promise<Registrations>) | null,
): { paging: Registrations; retry: () => Promise<void>; stop: () => Promise<void> } {
  const [paging, setPaging] = useState<Registrations>({});
  const cycle = useRef<ReturnType<typeof pagingCycle> | null>(null);
  useEffect(() => {
    const target = server;
    if (!enabled || !target) return;
    setPaging({});
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
    // iOS: a new or withdrawn PushKit token is registered at once, so calls only go to a token the app holds; and a new
    // APNs token likewise, in every workspace, or the others page a dead one. Critical Alerts or notifications turned
    // on or off happen in Settings, so coming back to the foreground registers them.
    const voipToken = BrigadeCall?.addListener("onVoipToken", () => void made.retry());
    const pushToken = Notifications.addPushTokenListener(() => void made.retry());
    return () => {
      foreground.remove();
      voipToken?.remove();
      pushToken.remove();
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
      // Keyed: switching workspaces opens the new one from scratch (its own socket, queue of unsent changes and
      // registration), while the old one's registration stays, so its pages still arrive (RFC 0006).
      <ActiveWorkspace
        key={`${data.user.id}:${workspaceId}`}
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
  return (
    <>
      <ClearWidgetWhen signedOut={view.kind === "signed-out" || view.kind === "no-workspace"} />
      <SessionContext value={view}>{children(false)}</SessionContext>
    </>
  );
}

/**
 * Nobody's shifts on the widget without a member in a workspace: a session that ended or was forgotten (not only an
 * explicit sign-out) clears it too.
 */
function ClearWidgetWhen({ signedOut }: { signedOut: boolean }) {
  useEffect(() => {
    if (signedOut) clearWidget();
  }, [signedOut]);
  return null;
}

/**
 * Signs out on the server; signed out here whatever it answers: `@better-auth/expo` forgets the stored session
 * before the request goes out, so offline the phone is signed out too and the server's session lasts until it
 * expires. True when the server answered.
 */
async function signOutHere(): Promise<boolean> {
  // Never longer than `SIGN_OUT_TIMEOUT_MS`: unanswered by then, it is kept and finished later (src/lib/sign-out.ts),
  // and the server finishes what it started on its own.
  return inTime(
    async () => {
      // Named, so the server takes this phone off the member's other workspaces too (RFC 0006 "Device
      // registration").
      const device = await phoneDeviceId();
      return !(
        await authClient.signOut(
          device ? { fetchOptions: { headers: { [DEVICE_HEADER]: device } } } : undefined,
        )
      ).error;
    },
    SIGN_OUT_TIMEOUT_MS,
    false,
  );
}

/**
 * The sync clients of workspaces switched away from with changes not sent yet, kept open until the shard confirmed
 * them (src/lib/drain.ts), by member and workspace.
 */
const draining = drainer<Drainable & { sync: WorkspaceSync }>({
  setTimer: (run, ms) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
  now: Date.now,
});

/** Nothing of the member who leaves is sent or registered again: their draining clients and their workspaces. */
async function forgetMember(): Promise<void> {
  draining.closeAll();
  await phoneWorkspaces.clear();
}

/** Signing out without a workspace: nothing pages this phone for it. */
async function signOut(): Promise<void> {
  await signOutHere();
  await forgetMember();
  clearWidget();
  await SecureStore.deleteItemAsync(WORKSPACE_KEY).catch(() => {});
  await dropQueues(pendingFiles).catch(() => {});
}

/**
 * A workspace switched away from: its client stays open until the shard confirmed what it still has to send (an ack
 * made while reconnecting must still stop the escalation), then closes, dropping the socket and every row it
 * brought (src/lib/drain.ts). With nothing left it closes at once.
 */
function leaveBehind(key: string, sync: WorkspaceSync): void {
  draining.keep(key, {
    sync,
    // Without a kept queue (it could not be opened) nothing says what is left: closed at once, as before.
    unsent: () => sync.queue?.unsent() ?? false,
    close: () => sync.client.close(),
  });
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
    void authClient.getCookie().then(
      (value) => {
        cookie.current = value;
      },
      () => {},
    );
  }, [sessionToken]);

  const [sync, setSync] = useState<WorkspaceSync | null>(null);
  useEffect(() => {
    const target = server;
    if (!target) return;
    const key = `${userId}:${workspaceId}`;
    let made: WorkspaceSync | null = null;
    let live = true;
    // Switched back while its changes were still going out: the same client, with them.
    const kept = draining.take(key);
    if (kept) {
      made = kept.sync;
      setCurrentSync(made);
      setSync(made);
      return () => {
        live = false;
        setCurrentSync(null);
        setSync(null);
        if (made) leaveBehind(key, made);
      };
    }
    // A cookie that cannot be read still opens the workspace: the upgrade then refuses it and the screen says so,
    // instead of loading forever. A queue that cannot be read opens it too, without keeping changes.
    void Promise.all([
      authClient.getCookie().catch(() => ""),
      openQueue(pendingFiles, { userId, workspaceId }, () =>
        newId("cli", Date.now(), getRandomBytes),
      ).catch((error: unknown) => {
        // Changes made this launch then live only in memory, as before restarts kept them.
        console.warn(
          "Brigade could not open the queue of unsent changes; they won't survive a restart",
          error,
        );
        return undefined;
      }),
    ]).then(([value, queue]) => {
      if (!live) return;
      cookie.current = value;
      made = createWorkspaceSync({
        server: target,
        workspaceId,
        actor: () => ({ kind: "user", id: userId, role: role.current }),
        cookie: () => cookie.current,
        queue,
      });
      setCurrentSync(made);
      setSync(made);
    });
    return () => {
      live = false;
      setCurrentSync(null);
      setSync(null);
      if (made) leaveBehind(key, made);
    };
  }, [userId, workspaceId]);

  // Changes kept from before a restart are applied as the member's role, so they go back only once it is known:
  // run as the `viewer` a role still loading reads as, they would drop out of the view until the shard answered
  // (src/lib/pending.ts). The screens that track them wait for it too.
  const roleNow = settledRole(userId, liveRole, known);
  const [restored, setRestored] = useState<WorkspaceSync | null>(null);
  useEffect(() => {
    if (!sync || roleNow === undefined) return;
    role.current = roleNow;
    sync.restore();
    setRestored(sync);
  }, [sync, roleNow]);

  // The workspaces this phone pages the member for: this one joins them as it opens (RFC 0006).
  const listed = useSyncExternalStore(phoneWorkspaces.subscribe, () =>
    phoneWorkspaces.current(userId),
  );
  useEffect(() => {
    void phoneWorkspaces.update(userId, (list) => withWorkspace(list, workspaceId, liveName));
  }, [userId, workspaceId, liveName]);
  const ids = listed?.workspaces.some((workspace) => workspace.id === workspaceId)
    ? listed.workspaces.map((workspace) => workspace.id).join(",")
    : null;

  // Someone who signed out offline first: their device has to come off the shard before this one can take it.
  // Then the phone registers in every workspace it was opened in, so a new token reaches all of them.
  const register = useMemo(() => {
    const target = server;
    if (!sync || !target || ids === null) return null;
    const deps = phoneDeps(
      sync,
      target,
      registerAllWith(target, () => authClient.getCookie()),
    );
    return (proceed: () => boolean) =>
      registerEverywhere(deps, ids.split(","), workspaceId, proceed, (gone) => {
        void phoneWorkspaces.update(userId, (list) => withoutWorkspaces(list, gone));
      });
  }, [sync, ids, workspaceId, userId]);
  const {
    paging: registrations,
    retry: retryPaging,
    stop: stopPaging,
  } = usePaging(register !== null, online, register);
  const paging = registrations[workspaceId] ?? "pending";
  const pagedWorkspaces = useMemo(
    () =>
      (listed?.workspaces ?? []).map((workspace) => ({
        ...workspace,
        paging: registrations[workspace.id] ?? "pending",
      })),
    [listed, registrations],
  );

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
    // Their shifts leave the home and lock screens with them.
    clearWidget();
    // Nothing they queued is sent or shown after they leave, whoever signs in next, nor registered for them again.
    await sync?.queue?.drop().catch(() => {});
    await forgetMember();
    await dropQueues(pendingFiles).catch(() => {});
    return result;
  }, [sync, userId, workspaceId, stopPaging]);

  const ready = Boolean(sync && restored === sync && workspaceName !== undefined);
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
          pagedWorkspaces,
          retryPaging,
          signOut: leave,
          unsent: () => sync?.queue?.unsent() ?? false,
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
    pagedWorkspaces,
    retryPaging,
    leave,
  ]);

  if (!ready || !sync) return <SessionContext value={value}>{children(false)}</SessionContext>;
  return (
    <SyncProvider client={sync.client} shard={sync.shard}>
      <WidgetSnapshot userId={userId} workspaceId={workspaceId} workspaceName={workspaceName!} />
      <SessionContext value={value}>{children(true)}</SessionContext>
    </SyncProvider>
  );
}
