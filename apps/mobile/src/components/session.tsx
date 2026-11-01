import { DEVICE_HEADER, newId, type Role } from "@freecorps/brigade-schema";
import { SyncProvider, useQuery } from "@freecorps/brigade-sync/react";
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
import { InstanceContext } from "@/hooks/use-instance";
import { useUserLocale } from "@/hooks/use-user-locale";
import { forgetSession } from "@/lib/auth-client";
import { registerEverywhere, unregisterPhone, type Paging, type Registrations } from "@/lib/device";
import { drainer, type Drainable } from "@/lib/drain";
import {
  board,
  clientsFor,
  instances,
  relayDeps,
  type InstanceClients,
} from "@/lib/instance-clients";
import type { InstanceState } from "@/lib/switcher";
import { activeInstance } from "@/lib/instances";
import {
  devicePresent,
  pagingCycle,
  pagingNudges,
  tokenFanOut,
  removalWatch,
  type RemovalVerdict,
  type RemovalWatch as Watch,
} from "@/lib/paging";
import { dropQueues, openQueue } from "@/lib/pending";
import {
  finishDeps,
  keptSignOuts,
  nativePairing,
  oneShotMutate,
  permissions,
  phoneDeps,
  phoneDeviceId,
  pushTokens,
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
import { knownWorkspace, memberActor, settledRole, type Server } from "@/lib/sync";
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

/** New APNs or FCM tokens, told to every instance's registration cycle. */
const newPushTokens = tokenFanOut(pushTokens, (heard) => {
  const subscription = Notifications.addPushTokenListener(heard);
  return () => subscription.remove();
});

const finishing = new Map<string, Promise<FinishResult>>();

/**
 * One try at finishing the sign-outs kept from offline at `target` (src/lib/sign-out.ts), shared by everyone who asks
 * meanwhile. Each instance finishes only its own (the record names its origin).
 */
function finishLeftover(target: Server): Promise<FinishResult> {
  let running = finishing.get(target.auth);
  if (!running) {
    running = finishSignOut(finishDeps(target))
      .catch(() => "pending" as const)
      .finally(() => {
        finishing.delete(target.auth);
      });
    finishing.set(target.auth, running);
  }
  return running;
}

/**
 * Finishing kept sign-outs, then registering the phone with `register` (src/lib/paging.ts), while `enabled`: again on
 * a backoff while something is left undone, and soon (`MIN_TRY_GAP_MS` at most) when the phone is back online, the
 * app comes back to the foreground or a token is new. A new `register` starts over. One per instance, each on its own
 * backoff (RFC 0015 section 5): a failing instance never holds back another.
 */
function usePaging(
  target: Server,
  enabled: boolean,
  online: boolean,
  register: ((proceed: () => boolean) => Promise<Registrations>) | null,
): {
  paging: Registrations;
  retry: () => Promise<void>;
  stop: () => Promise<void>;
  removed: (workspaceId: string, verdict: Exclude<RemovalVerdict, undefined>) => void;
} {
  const [paging, setPaging] = useState<Registrations>({});
  const cycle = useRef<ReturnType<typeof pagingCycle> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    setPaging({});
    const made = pagingCycle({
      finish: () => finishLeftover(target),
      register,
      onPaging: setPaging,
      setTimer: (run, ms) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
      },
      now: Date.now,
      random: Math.random,
    });
    cycle.current = made;
    // iOS: a new or withdrawn PushKit token is registered at once, so calls only go to a token the app holds; and a new
    // APNs or FCM token likewise, in every workspace, or the others page a dead one. Only a new one: the listener also
    // hears the token each registration fetches. Critical Alerts or notifications turned on or off happen in Settings,
    // so coming back to the foreground registers them; not coming back from the app's own permission request.
    const nudges = pagingNudges(
      made,
      pushTokens,
      permissions,
      AppState.currentState,
      process.env.EXPO_OS,
    );
    const foreground = AppState.addEventListener("change", nudges.appState);
    const voipToken = BrigadeCall?.addListener("onVoipToken", nudges.voipToken);
    // One listener for every instance: a new token reaches each of them (src/lib/paging.ts `tokenFanOut`).
    const leaveTokens = newPushTokens.add(made);
    return () => {
      foreground.remove();
      voipToken?.remove();
      leaveTokens();
      void made.stop();
      if (cycle.current === made) cycle.current = null;
    };
  }, [target, enabled, register]);
  // Back online: no waiting out the backoff. The first run is the cycle's own.
  const wasOnline = useRef(online);
  useEffect(() => {
    const back = online && !wasOnline.current;
    wasOnline.current = online;
    if (back) cycle.current?.nudge();
  }, [online]);
  const retry = useCallback(() => cycle.current?.retry() ?? Promise.resolve(), []);
  const stop = useCallback(() => cycle.current?.stop() ?? Promise.resolve(), []);
  // The shard dropped the phone's device: not "on" any more, and registered again unless it keeps being dropped.
  const removed = useCallback(
    (workspaceId: string, verdict: Exclude<RemovalVerdict, undefined>) => {
      setPaging((current) => ({
        ...current,
        [workspaceId]: verdict === "again" ? "pending" : "failed",
      }));
      if (verdict === "again") cycle.current?.nudge();
    },
    [],
  );
  return { paging, retry, stop, removed };
}

/**
 * The instances this phone signs in to (RFC 0015 section 5): the active one is shown (`InstanceSession`), and every
 * other keeps the phone registered and its kept sign-outs finished in the background (`BackgroundInstance`), so
 * looking at one never stops another's pages. An install from before several instances has the build's default
 * instance alone, with the session it had.
 */
export function Session({ children }: { children: (ready: boolean) => ReactNode }) {
  const list = useSyncExternalStore(instances.subscribe, instances.current);
  useEffect(() => {
    void instances.load();
  }, []);
  const active = activeInstance(list);
  const clients = active ? clientsFor(active) : undefined;
  return (
    <InstanceContext value={clients}>
      {list.instances
        .filter((instance) => instance.id !== active?.id)
        .map((instance) => (
          <BackgroundInstance key={instance.id} clients={clientsFor(instance)} />
        ))}
      {clients ? (
        // Keyed: switching instances opens the other from scratch, as switching workspaces does.
        <InstanceSession
          key={`${clients.instance.id} ${clients.instance.origin}`}
          clients={clients}
        >
          {children}
        </InstanceSession>
      ) : (
        <SessionContext value={{ kind: "no-server" }}>{children(false)}</SessionContext>
      )}
    </InstanceContext>
  );
}

/**
 * An instance the app does not show: while its member is signed in, the phone stays registered in every workspace it
 * was opened in there (`POST /devices/register`, or the open workspace's shard for an instance from before it), on its
 * own backoff; and its kept sign-outs are finished either way.
 */
function BackgroundInstance({ clients }: { clients: InstanceClients }) {
  const session = clients.authClient.useSession();
  const online = useOnline();
  const userId = session.data?.user.id;
  const workspaceId = session.data?.session.activeOrganizationId ?? undefined;
  const store = clients.phoneWorkspaces;
  const listed = useSyncExternalStore(store.subscribe, () =>
    userId ? store.current(userId) : null,
  );
  useEffect(() => {
    if (userId) void store.read(userId);
  }, [store, userId]);
  const ids = listed ? listed.workspaces.map((workspace) => workspace.id).join(",") : null;
  const register = useMemo(() => {
    if (!userId || !workspaceId || ids === null) return null;
    const cookie = () => clients.authClient.getCookie();
    const deps = phoneDeps(
      { mutate: oneShotMutate(clients.server, workspaceId, userId, cookie) },
      clients.server,
      registerAllWith(clients.server, cookie),
      relayDeps(clients),
    );
    return (proceed: () => boolean) =>
      registerEverywhere(deps, ids ? ids.split(",") : [], workspaceId, proceed, (gone) => {
        void store.update(userId, (list) => withoutWorkspaces(list, gone));
      });
  }, [clients, store, userId, workspaceId, ids]);
  const { paging } = usePaging(clients.server, true, online, register);
  const user = session.data?.user;
  usePublish(
    clients.instance.id,
    user
      ? {
          kind: "signed-in",
          userId: user.id,
          name: user.name,
          email: user.email,
          ...(workspaceId ? { workspaceId } : {}),
          workspaces: listed?.workspaces ?? [],
          registrations: paging,
        }
      : // A session that could not be read is not a sign-out.
        session.isPending || session.error
        ? { kind: "unknown" }
        : { kind: "signed-out" },
  );
  return null;
}

/**
 * Tells the switcher (src/lib/instance-clients.ts `board`) what the member's session at instance `id` is now; a new
 * state only when it changed.
 */
function usePublish(id: string, state: InstanceState) {
  const key = JSON.stringify(state);
  useEffect(() => {
    board.publish(id, JSON.parse(key) as InstanceState);
  }, [id, key]);
}

/**
 * Who is signed in to the active instance, from Better Auth's session (kept in secure storage, so the app opens signed
 * in offline). With a session and an active workspace it opens the workspace's shard as the member and registers the
 * phone for pages; `children` gets whether a member is ready, for the signed-in screens' guard. At launch, whenever
 * the phone is back online and until it is done, it finishes a sign-out that could not reach the shard, so a phone
 * signed out offline stops paging the person who left before the next one registers it.
 */
function InstanceSession({
  clients,
  children,
}: {
  clients: InstanceClients;
  children: (ready: boolean) => ReactNode;
}) {
  const { authClient, server } = clients;
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
  // Emails to them come in the phone's language (RFC 0008).
  useUserLocale(authClient, data?.user);
  // With nobody in a workspace to register for, kept sign-outs are still finished; ActiveWorkspace does both.
  usePaging(server, !(data && workspaceId), online, null);
  let view: SessionView;
  if (data && workspaceId) {
    return (
      // Keyed: switching workspaces opens the new one from scratch (its own socket, queue of unsent changes and
      // registration), while the old one's registration stays, so its pages still arrive (RFC 0006).
      <ActiveWorkspace
        key={`${data.user.id}:${workspaceId}`}
        clients={clients}
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
  } else if (data) view = { kind: "no-workspace", signOut: () => signOut(clients) };
  else if (session.isPending) view = { kind: "loading" };
  else if (session.error) view = { kind: "unavailable", retry: () => void session.refetch() };
  else view = { kind: "signed-out" };
  return (
    <>
      <Publish
        id={clients.instance.id}
        state={
          data
            ? {
                kind: "signed-in",
                userId: data.user.id,
                name: data.user.name,
                email: data.user.email,
                workspaces: [],
                registrations: {},
              }
            : view.kind === "signed-out"
              ? { kind: "signed-out" }
              : { kind: "unknown" }
        }
      />
      <ClearWidgetWhen signedOut={view.kind === "signed-out" || view.kind === "no-workspace"} />
      <SessionContext value={view}>{children(false)}</SessionContext>
    </>
  );
}

function Publish({ id, state }: { id: string; state: InstanceState }) {
  usePublish(id, state);
  return null;
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
async function signOutHere({ authClient, server }: InstanceClients): Promise<boolean> {
  // Never longer than `SIGN_OUT_TIMEOUT_MS`: unanswered by then, it is kept and finished later (src/lib/sign-out.ts),
  // and the server finishes what it started on its own.
  return inTime(
    async () => {
      // Named, so the server takes this phone off the member's other workspaces too (RFC 0006 "Device
      // registration").
      const device = await phoneDeviceId(server.auth);
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
 * them (src/lib/drain.ts), by instance, member and workspace (`drainKey`).
 */
const draining = drainer<Drainable & { sync: WorkspaceSync }>({
  setTimer: (run, ms) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
  now: Date.now,
});

function drainKey(instanceId: string, userId: string, workspaceId: string): string {
  return `${instanceId} ${userId}:${workspaceId}`;
}

/**
 * Nothing of the member who leaves an instance is sent or registered again: their draining clients and their
 * workspaces there. The native side forgets that instance too, so its version 2 pages show the fallback text and send
 * no receipt until the next registration there (RFC 0015 section 4); the other instances are untouched. Only on an
 * explicit sign-out: a session that merely ended keeps it.
 */
async function forgetMember(clients: InstanceClients): Promise<void> {
  draining.closeAll(`${clients.instance.id} `);
  nativePairing.forget(clients.instance.origin);
  await clients.phoneWorkspaces.clear();
}

/** Signing out without a workspace: nothing pages this phone for it. */
async function signOut(clients: InstanceClients): Promise<void> {
  await signOutHere(clients);
  await forgetMember(clients);
  clearWidget();
  await SecureStore.deleteItemAsync(clients.storage.workspace).catch(() => {});
  await dropQueues(clients.pendingFiles).catch(() => {});
}

/**
 * Opens instance `id` (the switcher, RFC 0015 section 5), in `workspaceId` when given: that workspace is made active
 * there first, with that instance's own session, so it opens on it. A workspace that could not be made active (offline)
 * still opens the instance, on the workspace it had. The instance left keeps paging this phone in the background.
 */
export async function openInstance(id: string, workspaceId?: string): Promise<void> {
  const instance = instances.current().instances.find((one) => one.id === id);
  if (!instance) return;
  if (workspaceId) {
    await clientsFor(instance)
      .authClient.organization.setActive({ organizationId: workspaceId })
      .catch(() => undefined);
  }
  await instances.activate(id);
}

/**
 * Removes instance `id` from this phone (RFC 0015 section 5 "Removing one"), signing out of it first so it stops
 * paging this phone: the shown instance by its own sign-out (`signOutShown`: the member's, which takes the phone off
 * the open workspace's shard), any other by `/sign-out` with this phone's device id, which the server takes off the
 * member's every workspace there. `kept`: the server did not hear it, so the instance stays listed (signed out here)
 * and its background session finishes the sign-out when it can (src/lib/sign-out.ts); removing it then works. Every
 * other instance is untouched. The last instance is never removed (src/lib/switcher.ts `removal`).
 */
export async function removeInstance(
  id: string,
  signOutShown?: () => Promise<unknown>,
): Promise<"removed" | "kept" | "failed"> {
  const list = instances.current();
  const instance = list.instances.find((one) => one.id === id);
  if (!instance || list.instances.length <= 1) return "failed";
  const clients = clientsFor(instance);
  try {
    if (signOutShown) await signOutShown();
    else if ((await clients.authClient.getCookie().catch(() => "")) !== "") {
      await signOutBackground(clients);
    }
    // Anything kept from an offline sign-out there is finished now, or the instance stays.
    if ((await finishLeftover(clients.server)) === "pending") return "kept";
    await SecureStore.deleteItemAsync(clients.storage.handle).catch(() => {});
    await instances.remove(id);
    board.forget(id);
    return "removed";
  } catch {
    return "failed";
  }
}

/**
 * Signs out of an instance the app does not show: `/sign-out` with the phone's device id, which takes this phone off
 * the member's workspaces there; unanswered, kept to finish later (src/lib/sign-out.ts). Then nothing of the member's
 * there is kept, as `signOut` does.
 */
async function signOutBackground(clients: InstanceClients): Promise<void> {
  // As last read (the background instance keeps it), so this works offline too.
  const data = clients.authClient.$store.atoms.session?.get().data as
    | { user: { id: string }; session: { activeOrganizationId?: string | null } }
    | null
    | undefined;
  await signOutPhone(
    { userId: data?.user.id ?? "", workspaceId: data?.session.activeOrganizationId ?? "" },
    {
      cookie: () => clients.authClient.getCookie(),
      unregister: null,
      signOut: () => signOutHere(clients),
      forget: () => forgetSession(clients.authClient),
      add: keptSignOuts.add,
      origin: clients.server.auth,
      now: Date.now,
      lifetime: SESSION_LIFETIME_MS,
    },
  );
  await forgetMember(clients);
  await SecureStore.deleteItemAsync(clients.storage.workspace).catch(() => {});
  await dropQueues(clients.pendingFiles).catch(() => {});
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
  clients,
  userId,
  name,
  email,
  workspaceId,
  sessionToken,
  online,
  children,
}: {
  clients: InstanceClients;
  userId: string;
  name: string;
  email: string;
  workspaceId: string;
  sessionToken: string;
  online: boolean;
  children: (ready: boolean) => ReactNode;
}) {
  const { authClient, server, phoneWorkspaces, pendingFiles } = clients;
  const knownKey = clients.storage.workspace;
  const workspace = authClient.useActiveOrganization();
  const member = authClient.useActiveMember();

  // The workspace and role as last read: offline, the app opens with them and reads them again once online.
  const [known, setKnown] = useState<{ name: string; role: Role } | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void SecureStore.getItemAsync(knownKey)
      .catch(() => null)
      .then((raw) => {
        if (live) setKnown(knownWorkspace(raw, userId, workspaceId));
      });
    return () => {
      live = false;
    };
  }, [knownKey, userId, workspaceId]);
  const liveName = workspace.data?.name;
  const liveRole = member.data?.role;
  useEffect(() => {
    if (liveName === undefined || liveRole === undefined) return;
    const role = memberActor(userId, liveRole).role;
    void SecureStore.setItemAsync(
      knownKey,
      JSON.stringify({ userId, workspaceId, name: liveName, role }),
    ).catch(() => {});
  }, [knownKey, userId, workspaceId, liveName, liveRole]);
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
  }, [authClient, sessionToken]);

  const [sync, setSync] = useState<WorkspaceSync | null>(null);
  useEffect(() => {
    const target = server;
    const key = drainKey(clients.instance.id, userId, workspaceId);
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
  }, [clients, authClient, server, pendingFiles, userId, workspaceId]);

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
  }, [phoneWorkspaces, userId, workspaceId, liveName]);
  const ids = listed?.workspaces.some((workspace) => workspace.id === workspaceId)
    ? listed.workspaces.map((workspace) => workspace.id).join(",")
    : null;

  // Someone who signed out offline first: their device has to come off the shard before this one can take it.
  // Then the phone registers in every workspace it was opened in, so a new token reaches all of them.
  const register = useMemo(() => {
    if (!sync || ids === null) return null;
    const deps = phoneDeps(
      sync,
      server,
      registerAllWith(server, () => authClient.getCookie()),
      relayDeps(clients),
    );
    return (proceed: () => boolean) =>
      registerEverywhere(deps, ids.split(","), workspaceId, proceed, (gone) => {
        void phoneWorkspaces.update(userId, (list) => withoutWorkspaces(list, gone));
      });
  }, [clients, authClient, server, phoneWorkspaces, sync, ids, workspaceId, userId]);
  const {
    paging: registrations,
    retry,
    stop: stopPaging,
    removed,
  } = usePaging(server, register !== null, online, register);
  // One per member and workspace; Try again starts its count over.
  const watch = useMemo(() => removalWatch(Date.now), [userId, workspaceId]);
  const retryPaging = useCallback(() => {
    watch.reset();
    return retry();
  }, [watch, retry]);
  const paging = registrations[workspaceId] ?? "pending";
  const pagedWorkspaces = useMemo(
    () =>
      (listed?.workspaces ?? []).map((workspace) => ({
        ...workspace,
        paging: registrations[workspace.id] ?? "pending",
      })),
    [listed, registrations],
  );
  usePublish(clients.instance.id, {
    kind: "signed-in",
    userId,
    name,
    email,
    workspaceId,
    workspaces: (listed?.workspaces ?? []).map((workspace) =>
      workspace.id === workspaceId && liveName ? { ...workspace, name: liveName } : workspace,
    ),
    registrations,
  });

  const leave = useCallback(async () => {
    // No registration the cycle started may reach the shard after the phone comes off it below.
    await stopPaging();
    const result = await signOutPhone(
      { userId, workspaceId },
      {
        cookie: () => authClient.getCookie(),
        // Stop paging this phone first, while the session can still say whose device it is.
        unregister: sync ? () => unregisterPhone(phoneDeps(sync, server)) : null,
        signOut: () => signOutHere(clients),
        forget: () => forgetSession(authClient),
        add: keptSignOuts.add,
        origin: server.auth,
        now: Date.now,
        lifetime: SESSION_LIFETIME_MS,
      },
    );
    await SecureStore.deleteItemAsync(knownKey).catch(() => {});
    // Their shifts leave the home and lock screens with them.
    clearWidget();
    // Nothing they queued is sent or shown after they leave, whoever signs in next, nor registered for them again.
    await sync?.queue?.drop().catch(() => {});
    await forgetMember(clients);
    await dropQueues(pendingFiles).catch(() => {});
    return result;
  }, [clients, authClient, server, knownKey, pendingFiles, sync, userId, workspaceId, stopPaging]);

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
      <RemovalWatch
        key={`${userId}:${workspaceId}`}
        origin={server.auth}
        watch={watch}
        registered={paging === "on"}
        onRemoved={(verdict) => {
          // The shard dropped the device: the relay may have refused its handle (`handle_not_yours` expires the
          // device), so the next registration asks for a new one rather than send the same handle again.
          const drop = relayDeps(clients).dropHandle ?? (async () => {});
          void drop()
            .catch(() => {})
            .finally(() => removed(workspaceId, verdict));
        }}
      />
      <SessionContext value={value}>{children(true)}</SessionContext>
    </SyncProvider>
  );
}

/**
 * Registers the phone again when the open workspace's shard drops its device while the app holds it registered
 * (evicted as `replaced`, removed from the dashboard): from the synced `member_devices` summaries, so the account
 * section does not say "Paged on this phone" until the next launch (src/lib/paging.ts `removalWatch`).
 */
function RemovalWatch({
  origin,
  watch,
  registered,
  onRemoved,
}: {
  /** The instance's Better Auth URL: the device key is its own. */
  origin: string;
  watch: Watch;
  registered: boolean;
  onRemoved: (verdict: Exclude<RemovalVerdict, undefined>) => void;
}) {
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void phoneDeviceId(origin).then((id) => {
      if (live) setDeviceId(id);
    });
    return () => {
      live = false;
    };
  }, [origin, registered]);
  const devices = useQuery("devices.all", {});
  const latest = useLatest(onRemoved);
  const present = devicePresent(deviceId, devices);
  useEffect(() => {
    const verdict = watch.see(present, registered);
    if (verdict) latest.current(verdict);
  }, [watch, present, registered, latest]);
  return null;
}
