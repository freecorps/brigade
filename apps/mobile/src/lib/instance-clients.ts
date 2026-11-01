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
  readAddress,
  type AddressProblem,
  type AddressVerdict,
} from "@/lib/instance-address";
import {
  activeInstance,
  DEFAULT_INSTANCE,
  INSTANCES_KEY,
  instanceAt,
  instancesStore,
  instanceStorage,
  type Instance,
  type InstanceStorage,
} from "@/lib/instances";
import type { PendingFiles } from "@/lib/pending";
import { pendingFilesFor } from "@/lib/pending-files";
import { phoneWorkspacesAt } from "@/lib/phone";
import type { PhoneWorkspacesStore } from "@/lib/phone-workspaces";
import { buildRelay, loadConfig, withHandle, type InstanceConfig } from "@/lib/relay";
import { instanceBoard, relayView, type RelayView } from "@/lib/switcher";
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

const relays = new Map<string, Promise<RelayView>>();

/**
 * Which relay the instance at `instance` pages through (src/lib/switcher.ts `relayView`), read once per launch and
 * origin; asked again after an answer that said nothing (`unknown`).
 */
export function relayOf(instance: Instance): Promise<RelayView> {
  const key = `${instance.id} ${instance.origin}`;
  let view = relays.get(key);
  if (!view) {
    view = Promise.all([configOf(serverAt(instance.origin)), thisBuildRelay()]).then(
      ([config, build]) => {
        const read = relayView(config, build, instance.id === DEFAULT_INSTANCE);
        if (read.kind === "unknown") relays.delete(key);
        return read;
      },
    );
    relays.set(key, view);
  }
  return view;
}

/**
 * The checks before adding the instance at `input` (RFC 0015 section 5 "Checking the address"): the address read
 * (`http://` only on a private address in a development build), its `/api/config` asked, and judged for this app's
 * version and this build's relay.
 */
export async function checkInstance(
  input: string,
): Promise<{ origin: string; verdict: AddressVerdict } | { problem: AddressProblem }> {
  const read = readAddress(input, typeof __DEV__ !== "undefined" && __DEV__);
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
}

/**
 * The instance at `origin` when the phone keeps a session there (src/lib/auth-client.ts `sessionKept`, from secure
 * storage, so a session still loading or offline counts); undefined otherwise.
 */
export async function sessionAt(origin: string): Promise<Instance | undefined> {
  const instance = instanceAt(instances.current(), origin);
  if (!instance) return undefined;
  return (await sessionKept(SecureStore, instanceStorage(instance.id).auth)) ? instance : undefined;
}

/**
 * A QR sign-in's session (RFC 0015 section 6), kept for the instance at `origin` and no other: the instance is added
 * (or found), the session stored under its own prefix (src/lib/auth-client.ts `storeSessionCookie`) and its client
 * told to read it. Not made active: the caller opens it once it said who signed in. An instance added for it is
 * removed again when the session could not be kept. Throws `full` when the phone has the most instances it can, and
 * `SessionExists` when a session is kept there already (signed in meanwhile): it is never replaced.
 */
export async function keepSignIn(origin: string, cookie: string): Promise<Instance> {
  const before = instanceAt(instances.current(), origin);
  const added = await instances.add(origin);
  if (typeof added === "string") throw new Error(added);
  try {
    await storeSessionCookie(SecureStore, instanceStorage(added.id).auth, cookie);
  } catch (error) {
    if (!before) await instances.remove(added.id).catch(() => {});
    throw error;
  }
  clientsFor(added).authClient.$store.notify("$sessionSignal");
  return added;
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
