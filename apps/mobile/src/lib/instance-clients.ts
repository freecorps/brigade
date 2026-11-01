// Everything the app keeps for one instance (RFC 0015 section 5 "Storage is per instance"), made once per instance:
// its Better Auth client and session, its server URLs, its list of workspaces this phone is registered in, its queue
// files and its relay handle. The list of instances lives in secure storage (src/lib/instances.ts); the device key is
// the native side's, one per origin (modules/brigade-push).
import Constants from "expo-constants";
import { getRandomBytes } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import {
  brigadeAuthClient,
  defaultOrigin,
  sessionKept,
  storeSessionCookie,
  type AuthClient,
} from "@/lib/auth-client";
import type { DeviceDeps } from "@/lib/device";
import {
  judgeAddress,
  loadAddressConfig,
  checkSafely,
  readAddress,
  type AddressCheck,
} from "@/lib/instance-address";
import {
  activeInstance,
  addAndKeep,
  DEFAULT_INSTANCE,
  INSTANCES_KEY,
  instanceAt,
  instancesStore,
  instanceStorage,
  sessionHome,
  type Instance,
  type InstanceStorage,
} from "@/lib/instances";
import type { PendingFiles } from "@/lib/pending";
import { pendingFilesFor } from "@/lib/pending-files";
import { phoneWorkspacesAt } from "@/lib/phone";
import type { PhoneWorkspacesStore } from "@/lib/phone-workspaces";
import { buildRelay, loadConfig, withHandle, type InstanceConfig } from "@/lib/relay";
import { instanceBoard, relayCache, relayView, type RelayView } from "@/lib/switcher";
import { serverAt, type Server } from "@/lib/sync";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A new instance id: 12 letters and digits. */
function newInstanceId(): string {
  return Array.from(getRandomBytes(12), (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

/** The instances this phone signs in to, the build's default one first until the member adds others. */
export const instances = instancesStore({
  read: () => SecureStore.getItemAsync(INSTANCES_KEY),
  write: (raw) => SecureStore.setItemAsync(INSTANCES_KEY, raw),
  defaultOrigin,
  newId: newInstanceId,
});

export type InstanceClients = {
  instance: Instance;
  server: Server;
  authClient: AuthClient;
  storage: InstanceStorage;
  phoneWorkspaces: PhoneWorkspacesStore;
  pendingFiles: PendingFiles;
};

const made = new Map<string, InstanceClients>();

/** The clients of `instance`, made on first use; a new origin under the same id (a new build) makes new ones. */
export function clientsFor(instance: Instance): InstanceClients {
  const key = `${instance.id} ${instance.origin}`;
  let clients = made.get(key);
  if (!clients) {
    const storage = instanceStorage(instance.id);
    const server = serverAt(instance.origin);
    clients = {
      instance,
      server,
      authClient: brigadeAuthClient(server.auth, SecureStore, storage.auth),
      storage,
      phoneWorkspaces: phoneWorkspacesAt(storage.workspaces),
      pendingFiles: pendingFilesFor(instance.id),
    };
    made.set(key, clients);
  }
  return clients;
}

/** The clients of the instance the app shows; undefined without any (a release build with no server). */
export function activeClients(): InstanceClients | undefined {
  const active = activeInstance(instances.current());
  return active ? clientsFor(active) : undefined;
}

/** The clients of the instance at `origin`; undefined when the phone has none there. */
export function clientsAt(origin: string): InstanceClients | undefined {
  const instance = instanceAt(instances.current(), origin);
  return instance ? clientsFor(instance) : undefined;
}

/** `GET /api/config` of `server`, as src/lib/relay.ts reads it. */
function configOf(server: Server): Promise<InstanceConfig> {
  return loadConfig(server.config, (url, init) => fetch(url, init));
}

let relayOfBuild: Promise<string | undefined> | undefined;

/** This build's relay (src/lib/relay.ts `buildRelay`); asked again while it is not known. */
export function thisBuildRelay(): Promise<string | undefined> {
  relayOfBuild ??= buildRelay({
    env: process.env.EXPO_PUBLIC_BRIGADE_RELAY_URL,
    defaultOrigin,
    defaultConfig: () =>
      defaultOrigin ? configOf(serverAt(defaultOrigin)) : Promise.resolve({ kind: "unreachable" }),
  }).then((relay) => {
    if (relay === undefined) relayOfBuild = undefined;
    return relay;
  });
  return relayOfBuild;
}

/**
 * What each instance's session says of the member there and whether this phone is paged, published by
 * src/components/session.tsx for the switcher and the incident list's notice (src/lib/switcher.ts).
 */
export const board = instanceBoard();

const relays = relayCache(async (key) => {
  const [id, origin] = key.split(" ") as [string, string];
  const [config, build] = await Promise.all([configOf(serverAt(origin)), thisBuildRelay()]);
  return relayView(config, build, id === DEFAULT_INSTANCE);
});

/**
 * Which relay the instance at `instance` pages through (src/lib/switcher.ts `relayView`), read once per launch and
 * origin; asked again after an answer that said nothing (`unknown`) or a failure.
 */
export function relayOf(instance: Instance): Promise<RelayView> {
  return relays(`${instance.id} ${instance.origin}`);
}

/**
 * The checks before adding the instance at `input` (RFC 0015 section 5 "Checking the address"): the address read
 * (`http://` only on a private address in a development build), its `/api/config` asked, and judged for this app's
 * version and this build's relay.
 */
export function checkInstance(input: string): Promise<AddressCheck> {
  const dev = typeof __DEV__ !== "undefined" && __DEV__;
  // Never throws: a failure reads as "Couldn't reach", which the screens say (`checkSafely`).
  return checkSafely(
    async () => {
      const read = readAddress(input, dev);
      if ("problem" in read) return read;
      const [config, build] = await Promise.all([
        loadAddressConfig(read.origin, (url, init) => fetch(url, init)),
        thisBuildRelay(),
      ]);
      return {
        origin: read.origin,
        verdict: judgeAddress(config, {
          appVersion: Constants.expoConfig?.version,
          thisBuild: build,
          isDefault: read.origin === defaultOrigin,
        }),
      };
    },
    input,
    dev,
  );
}

/**
 * Where the phone keeps a session for the dashboard at `origin`, when it does (src/lib/auth-client.ts `sessionKept`,
 * from secure storage, so a session still loading or offline counts): the list is read from storage first, not taken
 * as last held in memory, and the build's default origin, not listed, is looked for under its keys from before
 * (`sessionHome`), where a cookie may be left. Undefined when none is kept.
 */
export async function sessionAt(origin: string): Promise<Instance | undefined> {
  const list = await instances.load();
  const home = sessionHome(list, origin, defaultOrigin);
  if (!home) return undefined;
  return (await sessionKept(SecureStore, instanceStorage(home.id).auth)) ? home : undefined;
}

/**
 * A QR sign-in's session (RFC 0015 section 6), kept for the instance at `origin` and no other: the instance is added
 * (or found), the session stored under its own prefix (src/lib/auth-client.ts `storeSessionCookie`) and its client
 * told to read it. Not made active: the caller opens it once it said who signed in. When the session could not be
 * kept, the row is removed again only if this call created it (`created`): an instance that was already stored, even
 * if not yet read into memory, stays. Throws `full` when the phone has the most instances it can, and `SessionExists`
 * when a session is kept there already (signed in meanwhile): it is never replaced.
 */
export async function keepSignIn(origin: string, cookie: string): Promise<Instance> {
  const instance = await addAndKeep(instances, origin, (one) =>
    storeSessionCookie(SecureStore, instanceStorage(one.id).auth, cookie),
  );
  clientsFor(instance).authClient.$store.notify("$sessionSignal");
  return instance;
}

/** Registering with `clients`' instance by a relay handle, kept under its own key (src/lib/relay.ts `withHandle`). */
export function relayDeps(clients: InstanceClients): Pick<DeviceDeps, "handles" | "dropHandle"> {
  const key = clients.storage.handle;
  return {
    handles: (args) =>
      withHandle(args, {
        config: () => configOf(clients.server),
        thisBuild: thisBuildRelay,
        isDefault: clients.instance.id === DEFAULT_INSTANCE,
        read: () => SecureStore.getItemAsync(key),
        write: (raw) =>
          raw === null ? SecureStore.deleteItemAsync(key) : SecureStore.setItemAsync(key, raw),
        fetch: (url, init) => fetch(url, init),
        now: Date.now,
      }),
    dropHandle: () => SecureStore.deleteItemAsync(key),
  };
}
