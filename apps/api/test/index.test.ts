import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, test, vi } from "vite-plus/test";
import worker, { WorkspaceDO } from "../src/index.ts";

const api = (path: string, init?: RequestInit) =>
  exports.default.fetch(`http://api.test${path}`, init);

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
    for (const path of ["/health", "/workspaces/acme"]) {
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

  test("rejects invalid workspace ids with 400", async () => {
    for (const id of ["ACME", "-acme", "a".repeat(64), "acme%2Fother", "a%20b", "%E0%A4%A"]) {
      const response = await api(`/workspaces/${id}`);
      expect(response.status, id).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_workspace_id" });
    }
  });

  test("GET /workspaces/:id round-trips through the WorkspaceDO's SQLite", async () => {
    for (const id of ["acme", "a".repeat(63)]) {
      const response = await api(`/workspaces/${id}`);
      expect(response.status, id).toBe(200);
      expect(await response.json()).toEqual({
        workspace: id,
        tables: 0,
        databaseSize: expect.any(Number),
      });
    }
  });

  test("maps Durable Object failures to 503 or 500 and logs one JSON line", async () => {
    const cases: [Record<string, boolean>, number, string][] = [
      [{ retryable: true }, 503, "unavailable"],
      [{ overloaded: true }, 503, "unavailable"],
      [{}, 500, "internal"],
    ];
    for (const [flags, status, error] of cases) {
      const failing = Object.assign(new Error("boom"), flags);
      const stub = vi.spyOn(env.WORKSPACE, "getByName").mockReturnValue({
        info: () => Promise.reject(failing),
      } as unknown as ReturnType<typeof env.WORKSPACE.getByName>);
      const log = vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await worker.fetch(new Request("http://api.test/workspaces/acme"), env);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(log.mock.calls[0]![0]))).toEqual({
        message: "WorkspaceDO.info failed",
        error: "Error: boom",
      });
      stub.mockRestore();
      log.mockRestore();
    }
  });
});

describe("WorkspaceDO", () => {
  test("info() reads from its own SQLite storage", async () => {
    const stub = env.WORKSPACE.getByName("globex");
    const info = await stub.info();
    await runInDurableObject(stub, (instance, state) => {
      expect(instance).toBeInstanceOf(WorkspaceDO);
      expect(info).toEqual({ tables: 0, databaseSize: state.storage.sql.databaseSize });
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
