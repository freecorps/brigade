// @vitest-environment happy-dom
/// <reference lib="dom" />
// The hooks mounted in a client-rendered React tree (react-dom/client on happy-dom) against the reference server:
// rows render from the snapshot, an optimistic mutation shows at once and settles on confirm, a rejected one
// rolls back, and the connection state follows the socket.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vite-plus/test";
import { newId, type Actor, type IncidentStatus } from "@freecorps/brigade-schema";
import { createSyncClient, type MutationOutcome, type SyncClient } from "../src/client.ts";
import {
  SyncProvider,
  useConnectionState,
  useMutation,
  useQuery,
  useSyncClient,
} from "../src/react.ts";
import { FakeNetwork, FakeServer, FakeTimers } from "./fake-server.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);
const SHARD = "ws_1";
const ana: Actor = { kind: "user", id: "usr_ana", role: "responder" };
const ops: Actor = { kind: "system", id: "sys_alerts", role: "admin" };

let root: Root | undefined;
let current: SyncClient | undefined;

// Unmount and close inside act, even after a failed assertion, so nothing leaks into the next test.
afterEach(() => {
  act(() => {
    root?.unmount();
    current?.close();
  });
  root = undefined;
  current = undefined;
  document.body.innerHTML = "";
});

function setup() {
  const timers = new FakeTimers();
  const clock = () => T0 + timers.now;
  const server = new FakeServer(clock);
  const network = new FakeNetwork(server);
  let counter = 0;
  const randomBytes = (length: number) => new Uint8Array(length).fill(++counter % 256);
  const client = createSyncClient({
    url: (shard) => `wss://sync.test/sync/${shard}`,
    actor: ana,
    transport: network.transport(ana),
    timers,
    now: clock,
    random: () => 0.5,
    randomBytes,
  });
  current = client;
  const incidentId = () => newId("inc", clock(), randomBytes);
  return { client, network, server, shard: server.shard(SHARD), incidentId };
}

type Actions = {
  declare?: (title: string, id: string) => Promise<MutationOutcome>;
  setStatus?: (id: string, status: IncidentStatus) => Promise<MutationOutcome>;
};

/** A minimal list: one item per row with its number (or "new"), title and status, and a pending marker. */
function Incidents({ actions }: { actions: Actions }) {
  const { rows, status, pending } = useQuery("incidents.active", {});
  const connection = useConnectionState();
  const declare = useMutation("incident.declare");
  const setStatus = useMutation("incident.setStatus");
  actions.declare = (title, id) => declare({ id, title, severity: "sev2" });
  actions.setStatus = (id, next) => setStatus({ id, status: next });
  return createElement(
    "section",
    { "data-status": status, "data-pending": String(pending), "data-connection": connection },
    createElement(
      "ul",
      null,
      rows.map((row) =>
        createElement("li", { key: row.id }, `${row.number ?? "new"} ${row.title} ${row.status}`),
      ),
    ),
  );
}

function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
  return {
    container,
    items: () => [...container.querySelectorAll("li")].map((li) => li.textContent),
    section: () => container.querySelector("section")!,
  };
}

test("mounted hooks render rows, show an optimistic declare at once and settle it on confirm", async () => {
  const { client, network, shard, incidentId } = setup();
  shard.write(ops, "incident.declare", {
    id: incidentId(),
    title: "Checkout down",
    severity: "sev2", // The same as the declare below, so the list orders them by age.
  });
  const actions: Actions = {};
  const view = mount(
    createElement(SyncProvider, { client, shard: SHARD }, createElement(Incidents, { actions })),
  );
  expect(view.section().dataset.status).toBe("loading");
  expect(view.section().dataset.connection).toBe("connecting");

  act(() => network.flush());
  expect(view.section().dataset.status).toBe("ready");
  expect(view.section().dataset.connection).toBe("open");
  expect(view.items()).toEqual(["1 Checkout down triage"]);

  // Optimistic: on screen before the server has seen it, not numbered yet.
  let outcome!: Promise<MutationOutcome>;
  act(() => {
    outcome = actions.declare!("Search slow", incidentId());
  });
  expect(view.items()).toEqual(["new Search slow triage", "1 Checkout down triage"]);
  expect(view.section().dataset.pending).toBe("true");

  // Confirmed: the server's row (with its number) replaces the optimistic one.
  await act(async () => {
    network.flush();
    expect(await outcome).toEqual({ ok: true, version: 2 });
  });
  expect(view.items()).toEqual(["2 Search slow triage", "1 Checkout down triage"]);
  expect(view.section().dataset.pending).toBe("false");
});

test("a mutation the server rejects rolls back in the mounted list", async () => {
  const { client, network, shard, incidentId } = setup();
  const id = incidentId();
  shard.write(ops, "incident.declare", { id, title: "Checkout down", severity: "sev1" });
  const actions: Actions = {};
  const view = mount(
    createElement(SyncProvider, { client, shard: SHARD }, createElement(Incidents, { actions })),
  );
  act(() => network.flush());

  // Locally triage → declined is allowed, so it shows at once.
  let outcome!: Promise<MutationOutcome>;
  act(() => {
    outcome = actions.setStatus!(id, "declined");
  });
  expect(view.items()).toEqual([]); // Declined is not active: the row leaves the list optimistically.
  expect(view.section().dataset.pending).toBe("true");

  // Before the mutation reaches the shard, someone else moves the incident on; declined is no longer allowed.
  shard.write(ops, "incident.setStatus", { id, status: "investigating" });
  await act(async () => {
    network.flush();
    expect(await outcome).toMatchObject({ ok: false, error: { code: "invalid_transition" } });
  });
  expect(view.items()).toEqual(["1 Checkout down investigating"]);
  expect(view.section().dataset.pending).toBe("false");

  // The connection state follows the socket: waiting while the network is down.
  act(() => network.disconnect());
  act(() => network.flush());
  expect(view.section().dataset.connection).toBe("waiting");
});

test("useConnectionState follows a new shard option; useSyncClient returns the provider's client", () => {
  const { client, network } = setup();
  const actions: Actions = {};
  let seen: SyncClient | undefined;
  function Other({ shard }: { shard: string }) {
    seen = useSyncClient();
    return createElement("output", null, useConnectionState({ shard }));
  }
  const tree = (shard: string) =>
    createElement(
      SyncProvider,
      { client, shard: SHARD },
      createElement(Incidents, { actions }),
      createElement(Other, { shard }),
    );
  const view = mount(tree("ws_2"));
  act(() => network.flush());
  const output = () => view.container.querySelector("output")!.textContent;
  expect(output()).toBe("idle"); // Nothing opened ws_2.
  act(() => root!.render(tree(SHARD)));
  expect(output()).toBe("open");
  expect(seen).toBe(client);
  // It now listens to ws_1: a drop there shows, which a subscription left on ws_2 would miss.
  act(() => network.disconnect());
  act(() => network.flush());
  expect(output()).toBe("waiting");
});
