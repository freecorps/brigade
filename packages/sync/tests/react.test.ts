// The hooks without a DOM: a server render runs them once (with `getServerSnapshot`), which is enough to check the
// wiring. The live behaviour behind `useSyncExternalStore` is the `QueryHandle`, tested in client.test.ts.
// A mounted test (effects, re-renders on updates) needs a renderer: react-dom/client needs a DOM (jsdom or
// happy-dom) and react-test-renderer is deprecated, so it waits for the first app that mounts the hooks (S3's web
// slice, then S4 on device).
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vite-plus/test";
import { newId, type Actor } from "@freecorps/brigade-schema";
import { createSyncClient, type MutationOutcome } from "../src/client.ts";
import { SyncProvider, useMutation, useQuery } from "../src/react.ts";
import { FakeNetwork, FakeServer, FakeTimers } from "./fake-server.ts";

const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);
const ana: Actor = { kind: "user", id: "usr_ana", role: "responder" };

function setup() {
  const timers = new FakeTimers();
  const server = new FakeServer(() => T0 + timers.now);
  const network = new FakeNetwork(server);
  const client = createSyncClient({
    url: (shard) => `wss://sync.test/sync/${shard}`,
    actor: ana,
    transport: network.transport(ana),
    timers,
    now: () => T0 + timers.now,
    randomBytes: (n) => new Uint8Array(n).fill(3),
  });
  return { client, network };
}

test("useQuery reads the provider's shard and starts loading", () => {
  const { client } = setup();
  function Active() {
    const { status, rows, pending } = useQuery("incidents.active", {});
    return createElement("p", null, `${status} ${rows.length} ${pending}`);
  }
  const html = renderToString(
    createElement(SyncProvider, { client, shard: "ws_1" }, createElement(Active)),
  );
  expect(html).toBe("<p>loading 0 false</p>");
});

test("useMutation returns a function that mutates the provider's shard", async () => {
  const { client, network } = setup();
  let declare:
    | ((args: { id: string; title: string; severity: "sev1" }) => Promise<MutationOutcome>)
    | undefined;
  function Declare() {
    declare = useMutation("incident.declare");
    return null;
  }
  renderToString(createElement(SyncProvider, { client, shard: "ws_1" }, createElement(Declare)));
  const outcome = declare!({
    id: newId("inc", T0, (n) => new Uint8Array(n)),
    title: "From a hook",
    severity: "sev1",
  });
  network.flush();
  expect(await outcome).toEqual({ ok: true, version: 1 });
  expect(network.sockets.map((socket) => socket.url)).toEqual(["wss://sync.test/sync/ws_1"]);
});

test("hooks outside a provider fail with a clear error", () => {
  function Lost() {
    useQuery("incidents.active", {});
    return null;
  }
  expect(() => renderToString(createElement(Lost))).toThrow(/SyncProvider/);
});

test("a server render shows loading even when the client already holds the query's rows", () => {
  const { client, network } = setup();
  const handle = client.query("ws_1", "incidents.active", {});
  const stop = handle.subscribe(() => {});
  network.flush();
  expect(handle.getSnapshot().status).toBe("ready");
  // Hydration needs the server's render and the first client render to agree: both start from loading.
  expect(handle.getServerSnapshot()).toEqual({ rows: [], status: "loading", pending: false });
  function Active() {
    const { status } = useQuery("incidents.active", {});
    return createElement("p", null, status);
  }
  const html = renderToString(
    createElement(SyncProvider, { client, shard: "ws_1" }, createElement(Active)),
  );
  expect(html).toBe("<p>loading</p>");
  stop();
});
