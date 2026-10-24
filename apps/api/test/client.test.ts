// The real `SyncClient` from packages/sync over real WebSockets into WorkspaceDO.
import { exports } from "cloudflare:workers";
import { describe, expect, test } from "vite-plus/test";
import { newId, type IncidentRow } from "@freecorps/brigade-schema";
import { createSyncClient, type SyncSocket, type Transport } from "@freecorps/brigade-sync";
import { parseServerMessage } from "@freecorps/brigade-sync/protocol";

/** Opens sockets through the Worker's fetch handler (workerd has no outbound `new WebSocket` to itself). */
const transport: Transport = (url) => {
  let ws: WebSocket | undefined;
  type Handler = ((event: never) => void) | null;
  const fire = (handler: Handler, event: unknown) =>
    (handler as ((event: unknown) => void) | null)?.(event);
  const socket: SyncSocket = {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: (data) => ws?.send(data),
    close: (code, reason) => ws?.close(code, reason),
  };
  void exports.default
    .fetch(url.replace(/^wss?:/, "http:"), { headers: { Upgrade: "websocket" } })
    .then((response) => {
      ws = response.webSocket ?? undefined;
      if (!ws) return fire(socket.onclose, {});
      ws.accept();
      ws.addEventListener("message", (event) => fire(socket.onmessage, { data: event.data }));
      ws.addEventListener("close", () => fire(socket.onclose, {}));
      fire(socket.onopen, {});
    });
  return socket;
};

let names = 0;
const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));

function client(warnings: string[]) {
  return createSyncClient({
    url: (shard) => `ws://api.test/sync/${shard}`,
    actor: { kind: "user", id: "usr_dev", role: "responder" },
    transport,
    onWarning: (message) => warnings.push(message),
  });
}

/** Resolves once `handle`'s state satisfies `done`. */
function until<R>(
  handle: {
    subscribe(listener: () => void): () => void;
    getSnapshot(): { rows: readonly R[]; status: string };
  },
  done: (state: { rows: readonly R[]; status: string }) => boolean,
) {
  return new Promise<{ rows: readonly R[]; status: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(JSON.stringify(handle.getSnapshot()))), 3000);
    const check = () => {
      const state = handle.getSnapshot();
      if (!done(state)) return;
      clearTimeout(timer);
      queueMicrotask(() => unsubscribe());
      resolve(state);
    };
    const unsubscribe = handle.subscribe(check);
    check();
  });
}

// The per-version patch (`{ type: "patch", version, subs }`) lands with the client slice under review; until this
// branch is rebased on it, the client's parser refuses the server's patches, so only the patch-free test runs.
const clientReadsPatches = parseServerMessage(
  JSON.stringify({ type: "patch", version: 1, subs: {} }),
).ok;

describe("SyncClient against WorkspaceDO", () => {
  test("a mutation's result and a later snapshot reach real clients", async () => {
    const shard = `client-${++names}`;
    const warnings: string[] = [];
    const ana = client(warnings);
    const bia = client(warnings);
    const id = newId("inc", Date.now(), random);
    expect(
      await ana.mutate(shard, "incident.declare", { id, title: "Checkout down", severity: "sev1" }),
    ).toEqual({
      ok: true,
      version: 1,
    });
    const state = await until<IncidentRow>(
      bia.query(shard, "incidents.active", {}),
      (s) => s.status === "ready",
    );
    expect(state.rows).toEqual([
      expect.objectContaining({ id, number: 1, title: "Checkout down" }),
    ]);
    ana.close();
    bia.close();
    expect(warnings).toEqual([]);
  });

  test.skipIf(!clientReadsPatches)("two clients stay in sync through patches", async () => {
    const shard = `client-${++names}`;
    const warnings: string[] = [];
    const ana = client(warnings);
    const bia = client(warnings);
    const anaView = ana.query(shard, "incidents.active", {});
    const biaView = bia.query(shard, "incidents.active", {});
    await until(anaView, (s) => s.status === "ready");
    await until(biaView, (s) => s.status === "ready");

    const id = newId("inc", Date.now(), random);
    const declared = ana.mutate(shard, "incident.declare", {
      id,
      title: "Checkout down",
      severity: "sev1",
    });
    expect(await declared).toEqual({ ok: true, version: 1 });
    const seen = await until<IncidentRow>(biaView, (s) => s.rows.some((row) => row.id === id));
    expect(seen.rows[0]).toMatchObject({ id, number: 1 });

    expect(await bia.mutate(shard, "incident.setStatus", { id, status: "resolved" })).toEqual({
      ok: true,
      version: 2,
    });
    await until<IncidentRow>(anaView, (s) => s.rows.length === 0);
    ana.close();
    bia.close();
    expect(warnings).toEqual([]);
  });
});
