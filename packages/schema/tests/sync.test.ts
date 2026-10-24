// The optimistic protocol of RFC 0004, played out over the shared core: a client applies pending mutations
// optimistically, the server applies them authoritatively, and the client rebases what is still pending on
// every server state it receives. It must end up exactly where the server is.
import { expect, test } from "vite-plus/test";
import {
  createMemoryStore,
  mutations,
  newId,
  runMutation,
  TABLES,
  type BrigadeTables,
  type MemoryStore,
  type MutationContext,
  type MutationResult,
  type TableName,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 24, 12, 0, 0);
const ID = newId("inc", T, (n) => new Uint8Array(n).fill(7));

type Pending = { mutationId: string; name: string; args: unknown; ctx: MutationContext };
type Store = MemoryStore<BrigadeTables>;

const SYNCED = (Object.keys(TABLES) as TableName[]).filter((table) => !TABLES[table].serverOnly);

/** What the server sends clients: the synced tables only. */
const serverState = (server: Store) =>
  Object.fromEntries(SYNCED.map((table) => [table, server.scan(table)]));

/**
 * The client's optimistic view: the last server state plus every pending mutation re-applied with its original
 * context. A pending mutation that fails here is dropped from the view silently; only the server's own result
 * is shown to the user.
 */
function rebase(server: Store, pending: Pending[]): Store {
  const view = createMemoryStore<BrigadeTables>(serverState(server));
  for (const mutation of pending) {
    runMutation(mutations, mutation.name, mutation.args, view, mutation.ctx);
  }
  return view;
}

const ana = (now: number): MutationContext => ({
  actor: { kind: "user", id: "usr_ana", role: "responder" },
  now,
  server: false,
});
const serverCtx = (pending: Pending, now: number): MutationContext => ({
  ...pending.ctx,
  now,
  server: true,
});
const send = (server: Store, pending: Pending, now: number): MutationResult =>
  runMutation(mutations, pending.name, pending.args, server, serverCtx(pending, now));

test("a client's optimistic view converges on the server's state", () => {
  const server = createMemoryStore<BrigadeTables>();
  const pending: Pending[] = [
    {
      mutationId: "m1",
      name: "incident.declare",
      args: { id: ID, title: "Checkout is down", severity: "sev2" },
      ctx: ana(T),
    },
    {
      mutationId: "m2",
      name: "incident.setSeverity",
      args: { id: ID, severity: "sev1" },
      ctx: ana(T + 10),
    },
    {
      mutationId: "m3",
      name: "incident.setStatus",
      args: { id: ID, status: "investigating" },
      ctx: ana(T + 20),
    },
  ];

  // Offline: everything is optimistic, with no incident number yet.
  let view = rebase(server, pending);
  expect(view.get("incidents", ID)).toMatchObject({
    number: null,
    severity: "sev1",
    status: "investigating",
    updatedAt: T + 20,
  });
  // Re-applying with the original contexts is deterministic.
  expect(rebase(server, pending).dump()).toEqual(view.dump());

  // The server confirms the declare; the client rebases the rest on the server's row (now numbered).
  expect(send(server, pending.shift()!, T + 500).ok).toBe(true);
  view = rebase(server, pending);
  expect(view.get("incidents", ID)).toMatchObject({
    number: 1,
    declaredAt: T + 500,
    severity: "sev1",
    status: "investigating",
  });

  // The server confirms the rest; nothing is pending and the client holds exactly the server's rows.
  for (const [i, mutation] of pending.entries()) {
    expect(send(server, mutation, T + 600 + i).ok).toBe(true);
  }
  view = rebase(server, []);
  expect(view.dump()).toEqual(serverState(server));
  expect(view.scan("counters")).toEqual([]);
});

test("a pending mutation that no longer applies drops out of the view; the server's rejection is the result", () => {
  const server = createMemoryStore<BrigadeTables>();
  const declare: Pending = {
    mutationId: "m1",
    name: "incident.declare",
    args: { id: ID, title: "DB lag", severity: "sev3" },
    ctx: ana(T),
  };
  expect(send(server, declare, T + 100).ok).toBe(true);

  // Ana starts fixing, optimistically…
  const fixing: Pending = {
    mutationId: "m2",
    name: "incident.setStatus",
    args: { id: ID, status: "fixing" },
    ctx: ana(T + 200),
  };
  expect(rebase(server, [fixing]).get("incidents", ID)?.status).toBe("fixing");

  // …but Bia declines the incident first. Ana's pending change no longer applies and drops out silently.
  const bia: MutationContext = {
    actor: { kind: "user", id: "usr_bia", role: "responder" },
    now: T + 250,
    server: true,
  };
  expect(
    runMutation(mutations, "incident.setStatus", { id: ID, status: "declined" }, server, bia).ok,
  ).toBe(true);
  expect(rebase(server, [fixing]).dump()).toEqual(serverState(server));

  // The server rejects it too; that result is what the client surfaces.
  const result = send(server, fixing, T + 300);
  expect(!result.ok && result.error.code).toBe("invalid_transition");
  expect(rebase(server, []).dump()).toEqual(serverState(server));
});

test("rebasing a mutation the server already applied leaves exactly the server's state", () => {
  const server = createMemoryStore<BrigadeTables>();
  const pending: Pending[] = [
    {
      mutationId: "m1",
      name: "incident.declare",
      args: { id: ID, title: "API errors", severity: "sev2" },
      ctx: ana(T),
    },
    {
      mutationId: "m2",
      name: "incident.setSeverity",
      args: { id: ID, severity: "sev1" },
      ctx: ana(T + 10),
    },
  ];
  // The server applied both, but the client has not received their results yet: the patch arrives first.
  for (const [i, mutation] of pending.entries()) {
    expect(send(server, mutation, T + 100 + i).ok).toBe(true);
  }
  // Re-applying them on the server's state fails ("already exists", "no change") and drops them silently.
  expect(rebase(server, pending).dump()).toEqual(serverState(server));
});
