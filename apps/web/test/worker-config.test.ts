// The web Worker with its real wrangler.jsonc in front of the real API Worker (apps/api) and its
// WorkspaceDO, through the `API` service binding, in a local workerd from wrangler's test harness.
// Only the assets directory is added: in dev and production it is the client build output, which the
// Cloudflare Vite plugin fills in, so a two-file fixture stands in for it here.
import { createTestHarness, experimental_readRawConfig } from "wrangler";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

// Relative to apps/web, where `vp test` runs.
const { rawConfig } = experimental_readRawConfig({ config: "./wrangler.jsonc" });
const server = createTestHarness({
  workers: [
    {
      config: {
        ...rawConfig,
        assets: { ...rawConfig.assets, directory: "./test/fixtures/assets" },
      },
    },
    { configPath: "../api/wrangler.jsonc" },
  ],
});

// A browser navigation: with SPA fallback, only run_worker_first keeps these away from index.html.
const navigate = { headers: { "Sec-Fetch-Mode": "navigate", Accept: "text/html" } };
const get = (path: string, init?: { headers: Record<string, string> }) =>
  server.fetch(`http://web.test${path}`, init);

beforeAll(() => server.listen(), 60_000);
afterAll(() => server.close());

describe("web Worker → API Worker → WorkspaceDO, with the real configs", () => {
  test("/api/health reaches the API Worker with the prefix stripped", async () => {
    const response = await get("/api/health", navigate);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("/api/workspaces/demo round-trips through the WorkspaceDO", async () => {
    const response = await get("/api/workspaces/demo");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ workspace: "demo", tables: 0 });
  });

  test("bare /api runs the Worker first too (the API answers its own 404)", async () => {
    const response = await get("/api", navigate);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  test("a deep SPA path gets index.html", async () => {
    for (const path of ["/incidents/42", "/apis"]) {
      const response = await get(path, navigate);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-type"), path).toContain("text/html");
      expect(await response.text(), path).toContain("Brigade SPA fixture");
    }
  });

  test("a built asset is served as is", async () => {
    expect(await (await get("/app.js")).text()).toContain("built asset");
  });
});

describe("wrangler.jsonc environments", () => {
  // Service bindings are not inherited by environments, so each one must name its own API Worker.
  test.each([
    ["top level (production)", rawConfig.services],
    ["dev", rawConfig.env?.dev?.services],
    ["staging", rawConfig.env?.staging?.services],
  ])("%s binds API to its own API Worker", (name, services) => {
    const expected = {
      "top level (production)": "brigade-api",
      dev: "brigade-api-dev",
      staging: "brigade-api-staging",
    }[name];
    expect(services).toEqual([{ binding: "API", service: expected }]);
  });
});
