// React bindings for the sync client: `SyncProvider`, `useQuery`, `useMutation`, `useConnectionState`. React DOM and React Native
// alike: no DOM APIs, only `useSyncExternalStore` over `SyncClient.query` handles.

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  mutations,
  queries,
  ArgsOf,
  QueryArgsOf,
  QueryRowOf,
} from "@freecorps/brigade-schema";
import type { ConnectionState, MutationOutcome, QueryState, SyncClient } from "./client.ts";

type Queries = typeof queries;
type Mutations = typeof mutations;

type SyncContextValue = { client: SyncClient; shard: string };

const SyncContext = createContext<SyncContextValue | null>(null);

export type SyncProviderProps = {
  client: SyncClient;
  /** The shard hooks read and write by default: the workspace id for `WorkspaceDO` (`/sync/<workspaceId>`). */
  shard: string;
  children?: ReactNode;
};

/** Makes a client and its default shard available to `useQuery` and `useMutation` below it. */
export function SyncProvider({ client, shard, children }: SyncProviderProps) {
  const value = useMemo(() => ({ client, shard }), [client, shard]);
  return createElement(SyncContext.Provider, { value }, children);
}

function useSync(): SyncContextValue {
  const value = useContext(SyncContext);
  if (!value)
    throw new Error(
      "useQuery, useMutation and useConnectionState need a <SyncProvider> above them",
    );
  return value;
}

export type HookOptions = {
  /** Another shard than the provider's, e.g. an incident's. */
  shard?: string;
};

/**
 * Subscribes to a named query and re-renders when its rows change. `rows` is the optimistic view; `pending` says
 * whether it holds unconfirmed changes. Args are compared by value (JSON), so an inline object is fine.
 */
export function useQuery<N extends keyof Queries>(
  name: N,
  args: QueryArgsOf<Queries[N]>,
  options: HookOptions = {},
): QueryState<QueryRowOf<Queries[N]>> {
  const sync = useSync();
  const shard = options.shard ?? sync.shard;
  const argsKey = JSON.stringify(args) ?? "";
  // `args` is read through `argsKey`: a new object with the same content keeps the same handle.
  const handle = useMemo(
    () => sync.client.query(shard, name, args),
    [sync.client, shard, name, argsKey],
  );
  return useSyncExternalStore(handle.subscribe, handle.getSnapshot, handle.getServerSnapshot);
}

/**
 * A function that runs the named mutation on the provider's shard: applied optimistically at once, resolved with
 * the server's typed result.
 */
export function useMutation<N extends keyof Mutations>(
  name: N,
  options: HookOptions = {},
): (args: ArgsOf<Mutations[N]>) => Promise<MutationOutcome> {
  const sync = useSync();
  const shard = options.shard ?? sync.shard;
  return useCallback(
    (args: ArgsOf<Mutations[N]>) => sync.client.mutate(shard, name, args),
    [sync.client, shard, name],
  );
}

/**
 * The socket state of the provider's shard (`idle`, `connecting`, `open`, `waiting` for a retry), for a "live" or
 * "reconnecting" indicator. Only reads: the shard's queries and mutations open and close the socket.
 */
export function useConnectionState(options: HookOptions = {}): ConnectionState {
  const sync = useSync();
  const shard = options.shard ?? sync.shard;
  const subscribe = useCallback(
    (listener: () => void) => sync.client.onConnectionChange(shard, listener),
    [sync.client, shard],
  );
  const getSnapshot = useCallback(() => sync.client.connectionState(shard), [sync.client, shard]);
  return useSyncExternalStore(subscribe, getSnapshot, idle);
}

const idle = (): ConnectionState => "idle";
