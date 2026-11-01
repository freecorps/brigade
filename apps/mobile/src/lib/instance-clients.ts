// Everything the app keeps for one instance (RFC 0015 section 5 "Storage is per instance"), made once per instance:
// its Better Auth client and session, its server URLs, its list of workspaces this phone is registered in, its queue
// files and its relay handle. The list of instances lives in secure storage (src/lib/instances.ts); the device key is
// the native side's, one per origin (modules/brigade-push).
import { getRandomBytes } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { brigadeAuthClient, defaultOrigin, type AuthClient } from "@/lib/auth-client";
import type { DeviceDeps } from "@/lib/device";
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
