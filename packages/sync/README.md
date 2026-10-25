# @freecorps/brigade-sync

The Brigade Sync client for the web dashboard and the mobile app: the wire protocol, a framework-agnostic
`SyncClient` and React hooks. Design: [RFC 0004](../../docs/rfcs/0004-sync-engine.md). Mutations, queries and the
row store come from [`@freecorps/brigade-schema`](../schema/README.md); the same code runs on the server.

| Import                             | What                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `@freecorps/brigade-sync`          | `createSyncClient`, `SyncClient`, the protocol (re-exported)                  |
| `@freecorps/brigade-sync/protocol` | Message types, `PROTOCOL_VERSION`, `parseServerMessage`, `parseClientMessage` |
| `@freecorps/brigade-sync/react`    | `SyncProvider`, `useQuery`, `useMutation`, `useConnectionState` (React peer)  |

## Web and mobile

```tsx
import { createSyncClient } from "@freecorps/brigade-sync";
import { SyncProvider, useMutation, useQuery } from "@freecorps/brigade-sync/react";

// Once per app (module scope or a top-level `useState`), not per render.
const client = createSyncClient({
  url: (shard) => `wss://api.example.com/sync/${shard}`,
  // Only for the optimistic run; the server takes the actor from the authenticated socket.
  actor: () => ({ kind: "user", id: session.userId, role: session.role }),
  // React Native: Hermes has no crypto.getRandomValues, so pass expo-crypto's
  // (import * as Crypto from "expo-crypto"):
  // randomBytes: (n) => Crypto.getRandomBytes(n),
});

function App() {
  return (
    <SyncProvider client={client} shard={workspaceId}>
      <ActiveIncidents />
    </SyncProvider>
  );
}

function ActiveIncidents() {
  const { rows, status, pending } = useQuery("incidents.active", {});
  const declare = useMutation("incident.declare");
  const onDeclare = async (title: string) => {
    // The client's clock and randomness, so this works on web and on Hermes alike.
    const result = await declare({ id: client.newId("inc"), title, severity: "sev2" });
    if (!result.ok) showError(result.error); // typed: forbidden, invalid_args, conflict, expired, …
  };
  // rows already holds the new incident (number: null) while the server confirms it.
  return (
    <IncidentList
      rows={rows}
      loading={status === "loading"}
      pending={pending}
      onDeclare={onDeclare}
    />
  );
}
```

- `useQuery(name, args, { shard? })` returns `{ rows, status: "loading" | "ready" | "error", pending, error? }`.
  `rows` is the optimistic view: the server's rows with unconfirmed mutations applied. `pending` is true while
  `rows` differ from the server's confirmed result because of those mutations. Args are compared by value, so an
  inline object is fine.
- `useMutation(name, { shard? })` returns `(args) => Promise<{ ok: true, version } | { ok: false, error }>`. It
  never throws or rejects; a rejected mutation has already been rolled back from every view when it resolves.
  Error codes are the server's (`forbidden`, `invalid_args`, `not_found`, `invalid_transition`, `conflict`,
  `unknown_mutation`, `internal`) plus the client's: `invalid_args` for args that are not JSON or too large to
  send, `too_many_pending` (more than 500 unconfirmed), `expired` (still unconfirmed when the client reconnected
  more than 7 days after making it) and `closed`.
- `useConnectionState({ shard? })` returns the shard's socket state: `idle`, `connecting`, `open` or `waiting` (for
  a retry). It only reads; queries and mutations open the socket. A failed upgrade reaches a browser only as a
  close, so "never loaded and `waiting`" is the only sign the shard is unreachable.
- Without React: `client.query(shard, name, args)` returns a handle with `subscribe(listener)` and
  `getSnapshot()` (the `useSyncExternalStore` contract); `client.mutate(shard, name, args)`;
  `client.newId(prefix)`; `client.connectionState(shard)` and `client.onConnectionChange(shard, listener)` for an offline indicator; `client.close()`, after
  which every subscription holds a final `error` state with code `closed`.

The client uses the global `WebSocket`, `setTimeout` and `crypto.getRandomValues` unless given `transport`,
`timers` and `randomBytes`; `now`, `random` (backoff jitter), `clientId`, `backoff`, `idleCloseMs`, `lingerMs` and
`maxPending` are injectable too. Only the constructor throws, for a bad configuration (an invalid `clientId`, or a
missing global with no option given). `src/` uses no DOM or Node APIs, and only `src/react.ts` imports React.

## What it does

- **One socket per shard**, opened on the first subscription or mutation and closed 5 s after the last one is
  gone (a subscription outlives its last listener by 1 s, so remounts keep it).
- **Confirmed rows** per shard in a `createMemoryStore`; the view re-runs every pending mutation on top of them,
  in order, with the context (`actor`, `now`) of its first run. One that fails there drops out silently; only
  the server's rejection reaches the caller.
- **One frame per version**: a `patch` carries every subscription that version touched on the socket, so all of a
  shard's views move together.
- **Reconnects** with exponential backoff and jitter (500 ms doubling to 30 s), then sends `hello`, re-sends
  unconfirmed mutations with the same ids (the server de-duplicates for 7 days), and resumes every subscription
  from its own version and the shard's epoch (a restore or a re-created storage rotates the epoch, so the shard answers with a snapshot). A
  `protocol` error closes the socket and backs off without resetting the count. Mutations unconfirmed for 7 days
  fail with `expired`, on a timer, online or not.
- **No flicker**: a confirmed mutation stays in the view until every subscription of its shard is in sync on the
  current socket at its version, so a patch lost with a connection never makes its row disappear.
- **Never trusts the wire**: malformed frames, and data older than what a subscription received on the current
  socket, are reported to `onWarning` and ignored; so is anything from a socket the client has left.

## Tests

`tests/fake-server.ts` is a reference shard server over the shared core and the protocol parsers (versions, one
patch per version per socket, a change log for resumes with a snapshot fallback, de-duplication with retention,
result-before-patch). The `WorkspaceDO` implementation follows it.

The hooks are tested with a server render (`react-dom/server`, no DOM): wiring, the provider and
`getServerSnapshot`, which is always `loading` so hydration matches. A mounted test (effects, re-renders on
updates) needs `react-dom/client` with jsdom or happy-dom, or the deprecated react-test-renderer; it waits for
the first app that mounts the hooks. The live behaviour behind `useSyncExternalStore` is the `QueryHandle`,
covered by `tests/client.test.ts`.

License: MIT.
