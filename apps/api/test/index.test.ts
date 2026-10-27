import { env, exports } from "cloudflare:workers";
import { createExecutionContext, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import worker, { WorkspaceDO } from "../src/index.ts";

// store_rows, shard_meta, change_log, mutation_results, outbox, outbox_drain, page_deliveries, page_events, page_steps,
// receipt_key, receipt_rate, email_sends, email_keys, probe_pushes, member_repair, invitation_sends,
// invitation_repair, slack_states, slack_commands, slack_messages, slack_events, webhook_events, webhook_sends and
// webhook_emails, created when the shard starts.
const SYNC_TABLES = 24;

const ORIGIN = "http://api.test";
const api = (path: string, init?: RequestInit) => exports.default.fetch(`${ORIGIN}${path}`, init);

let people = 0;
/** A new client IP (TEST-NET-2) per sign-up: sign-up is rate-limited per IP. */
const clientIp = () => `198.51.100.${(++people % 250) + 1}`;

type Person = { id: string; cookie: string };

async function signUp(name: string): Promise<Person> {
  const response = await api("/auth/sign-up/email", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "cf-connecting-ip": clientIp() },
    body: JSON.stringify({
      name,
      email: `${name.toLowerCase()}-i${people}@example.com`,
      password: "correct horse battery staple",
    }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return { id: body.user.id, cookie };
}

/** Ana owns a new workspace; Eva is signed in but not a member. */
async function workspace() {
  const [ana, eva] = await Promise.all([signUp("Ana"), signUp("Eva")]);
  const created = await api("/workspaces", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: ana.cookie },
    body: JSON.stringify({ name: "Acme" }),
  });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  return { id, ana, eva };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api worker", () => {
  test("GET and HEAD /health return 200", async () => {
    const get = await api("/health");
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ ok: true });
    const head = await api("/health", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  test("other methods on known routes return 405 with Allow", async () => {
    const { id } = await workspace();
    for (const path of ["/health", `/workspaces/${id}`]) {
      const response = await api(path, { method: "POST" });
      expect(response.status, path).toBe(405);
      expect(response.headers.get("Allow")).toBe("GET, HEAD");
    }
  });

  test("unknown paths return 404", async () => {
    for (const path of ["/nope", "/workspaces/", "/workspaces/acme/", "/workspaces/acme/x"]) {
      const response = await api(path);
      expect(response.status, path).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    expect((await api("/nope", { method: "POST" })).status).toBe(404);
  });

  test("rejects anything but a workspace's own id with 400", async () => {
    for (const id of ["acme", "ACME", "-acme", "a".repeat(64), "acme%2Fother", "%E0%A4%A"]) {
      const response = await api(`/workspaces/${id}`);
      expect(response.status, id).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_workspace_id" });
    }
  });

  test("GET /workspaces/:id needs a session and membership, and never wakes a shard otherwise", async () => {
    const { id, eva } = await workspace();
    const getByName = vi.spyOn(env.WORKSPACE, "getByName");
    const anonymous = await api(`/workspaces/${id}`);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "unauthenticated" });
    const outsider = await api(`/workspaces/${id}`, { headers: { Cookie: eva.cookie } });
    expect(outsider.status).toBe(403);
    expect(await outsider.json()).toEqual({ error: "not_a_member" });
    // A made-up workspace answers like one the caller is not in.
    const madeUp = await api("/workspaces/ws_01J00000000000000000000000", {
      headers: { Cookie: eva.cookie },
    });
    expect(madeUp.status).toBe(403);
    expect(getByName).not.toHaveBeenCalled();
  });

  test("GET /workspaces/:id round-trips through the member's WorkspaceDO SQLite", async () => {
    const { id, ana } = await workspace();
    const response = await api(`/workspaces/${id}`, { headers: { Cookie: ana.cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      workspace: id,
      tables: SYNC_TABLES,
      databaseSize: expect.any(Number),
    });
    const head = await api(`/workspaces/${id}`, {
      method: "HEAD",
      headers: { Cookie: ana.cookie },
    });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  test.for([
    [{ retryable: true }, 503, "unavailable"],
    [{ overloaded: true }, 503, "unavailable"],
    [{}, 500, "internal"],
  ] as const)(
    "maps Durable Object error %o to %i and logs one JSON line",
    async ([flags, status, error]) => {
      const { id, ana } = await workspace();
      const failing = Object.assign(new Error("boom"), flags);
      vi.spyOn(env.WORKSPACE, "getByName").mockReturnValue({
        info: () => Promise.reject(failing),
      } as unknown as ReturnType<typeof env.WORKSPACE.getByName>);
      const log = vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await worker.fetch(
        new Request(`${ORIGIN}/workspaces/${id}`, { headers: { Cookie: ana.cookie } }),
        env,
        createExecutionContext(),
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(log.mock.calls[0]![0]))).toEqual({
        message: "WorkspaceDO.info failed",
        workspace: id,
        retryable: "retryable" in flags,
        overloaded: "overloaded" in flags,
        error: "Error: boom",
      });
    },
  );
});

describe("WorkspaceDO", () => {
  test("info() reads from its own SQLite storage", async () => {
    const stub = env.WORKSPACE.getByName("globex");
    const info = await stub.info();
    await runInDurableObject(stub, (instance, state) => {
      expect(instance).toBeInstanceOf(WorkspaceDO);
      expect(info).toEqual({ tables: SYNC_TABLES, databaseSize: state.storage.sql.databaseSize });
    });
  });

  test("different names map to different instances", async () => {
    const ids = await Promise.all(
      ["acme", "globex"].map((name) =>
        runInDurableObject(env.WORKSPACE.getByName(name), (_instance, state) =>
          state.id.toString(),
        ),
      ),
    );
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[0]).toBe(env.WORKSPACE.idFromName("acme").toString());
  });
});
