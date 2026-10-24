import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, test } from "vite-plus/test";
import { WorkspaceDO } from "../src/index.ts";

describe("api worker", () => {
  test("GET /health returns ok", async () => {
    const response = await exports.default.fetch("http://api.test/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("rejects invalid workspace ids", async () => {
    for (const id of ["ACME", "-acme", "a".repeat(64), "acme%2Fother", "a%20b", "%E0%A4%A"]) {
      const response = await exports.default.fetch(`http://api.test/workspaces/${id}`);
      expect(response.status, id).toBe(400);
    }
  });

  test("unknown routes and methods return 404", async () => {
    expect((await exports.default.fetch("http://api.test/nope")).status).toBe(404);
    expect((await exports.default.fetch("http://api.test/workspaces/acme/x")).status).toBe(404);
    const post = await exports.default.fetch("http://api.test/health", { method: "POST" });
    expect(post.status).toBe(404);
  });

  test("GET /workspaces/:id round-trips through the WorkspaceDO's SQLite", async () => {
    const response = await exports.default.fetch("http://api.test/workspaces/acme");
    expect(response.status).toBe(200);
    const body = await response.json<Record<string, unknown>>();
    expect(body).toEqual({
      workspace: "acme",
      id: env.WORKSPACE.idFromName("acme").toString(),
      tables: 0,
      databaseSize: expect.any(Number),
    });
  });
});

describe("WorkspaceDO", () => {
  test("info() reads from its own SQLite storage", async () => {
    const stub = env.WORKSPACE.getByName("globex");
    const info = await stub.info();
    await runInDurableObject(stub, (instance, state) => {
      expect(instance).toBeInstanceOf(WorkspaceDO);
      expect(info).toEqual({
        id: state.id.toString(),
        tables: 0,
        databaseSize: state.storage.sql.databaseSize,
      });
    });
  });
});
