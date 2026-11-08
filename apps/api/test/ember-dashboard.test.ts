// The dashboard's client for a workspace on Ember (RFC 0016 step 4; packages/sync/src/ember.ts) against this Worker:
// a token from `POST /ember-token/:workspace`, Ember's socket at `/ember/ws`, and the workspace's named queries and
// mutations through `workspace:query` / `workspace:mutate`, with Brigade's optimistic run first.
import { exports } from "cloudflare:workers";
import { env } from "cloudflare:workers";
import { describe, expect, test, vi } from "vite-plus/test";
import { newId, type Actor } from "@freecorps/brigade-schema";
import { createEmberSyncClient } from "@freecorps/brigade-sync/ember";
import { switchWorkspace } from "../src/ember-migration.ts";
import { sessionCookie } from "./session.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";
let people = 0;
const clientIp = () => `198.55.${Math.floor(++people / 250) % 250}.${(people % 250) + 1}`;

const api = (
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
) =>
  exports.default.fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      "cf-connecting-ip": clientIp(),
      ...init.headers,
    },
  });

/** Ember's client wants a WebSocket constructor; this one upgrades through the Worker's own fetch. */
class WorkerSocket {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  #socket: WebSocket | undefined;

  constructor(url: string) {
    const { pathname, search } = new URL(url);
    void api(`${pathname}${search}`, { headers: { Upgrade: "websocket" } }).then(
      (response) => {
        const socket = response.webSocket;
        if (!socket) {
          this.readyState = 3;
          this.onerror?.({});
          this.onclose?.({ code: 1006 });
          return;
        }
        socket.accept();
        this.#socket = socket;
        socket.addEventListener("message", (event) => this.onmessage?.({ data: event.data }));
        socket.addEventListener("close", (event) => {
          this.readyState = 3;
          this.onclose?.(event);
        });
        this.readyState = 1;
        this.onopen?.({});
      },
      () => {
        this.readyState = 3;
        this.onclose?.({ code: 1006 });
      },
    );
  }

  send(data: string): void {
    this.#socket?.send(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.#socket?.close(code ?? 1000, reason);
  }
}

/** A signed-in owner of a new workspace, switched to Ember. */
async function onEmber() {
  const address = `dashboard-${people}-${Math.random().toString(36).slice(2)}@example.com`;
  const signedUp = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name: "Ana", email: address, password: PASSWORD }),
  });
  expect(signedUp.status).toBe(200);
  const { user } = (await signedUp.json()) as { user: { id: string } };
  const cookie = await sessionCookie(address, PASSWORD);
  const created = await api("/workspaces", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({ name: "Acme" }),
  });
  const { id: workspaceId } = (await created.json()) as { id: string };
  expect((await switchWorkspace(env, workspaceId)).ok).toBe(true);
  return { workspaceId, cookie, actor: { kind: "user", id: user.id, role: "owner" } as Actor };
}

describe("the dashboard on Ember", () => {
  test("loads a workspace's incidents and declares one, shown at once and then confirmed", async () => {
    const { workspaceId, cookie, actor } = await onEmber();
    const tokens: string[] = [];
    const sync = createEmberSyncClient({
      url: `${ORIGIN}/ember`,
      token: async (id) => {
        const response = await api(`/ember-token/${id}`, {
          method: "POST",
          headers: { Cookie: cookie },
        });
        expect(response.status).toBe(200);
        const { token } = (await response.json()) as { token: string };
        tokens.push(token);
        return token;
      },
      actor,
      WebSocket: WorkerSocket,
      connectivity: null,
      onWarning: () => {},
    });
    const incidents = sync.query(workspaceId, "incidents.active", {});
    const off = incidents.subscribe(() => {});
    await vi.waitFor(() => expect(incidents.getSnapshot().status).toBe("ready"), {
      timeout: 10_000,
    });
    expect(incidents.getSnapshot().rows).toEqual([]);
    expect(tokens).toHaveLength(1);

    const id = newId("inc", Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n)));
    const outcome = sync.mutate(workspaceId, "incident.declare", { id, title: "Checkout down" });
    expect(incidents.getSnapshot()).toMatchObject({ pending: true, rows: [{ id, number: null }] });
    expect(await outcome).toEqual({ ok: true });
    await vi.waitFor(() => expect(incidents.getSnapshot().pending).toBe(false), {
      timeout: 10_000,
    });
    expect(incidents.getSnapshot().rows).toMatchObject([{ id, title: "Checkout down", number: 1 }]);

    // Refused by the shard's own rules: Brigade's error, nothing left behind.
    const again = await sync.mutate(workspaceId, "incident.declare", { id, title: "Twice" });
    expect(again).toMatchObject({ ok: false });
    expect(incidents.getSnapshot().rows).toMatchObject([{ id, title: "Checkout down" }]);
    off();
    sync.close();
  });
});
