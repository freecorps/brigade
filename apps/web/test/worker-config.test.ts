// The web Worker with its real wrangler.jsonc in front of the real API Worker (apps/api) and its
// WorkspaceDO, through the `API` service binding, in a local workerd from wrangler's test harness.
// Only the assets directory is added: in dev and production it is the client build output, which the
// Cloudflare Vite plugin fills in, so a two-file fixture stands in for it here.
import { createTestHarness, experimental_readRawConfig } from "wrangler";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

// The harness bundles apps/api with wrangler's esbuild, which does not know the `@freecorps/source` condition
// (RFC 0002): add it to wrangler's defaults so packages/schema and packages/sync resolve to their source, as in
// `vp dev`, without a build first.
process.env.WRANGLER_BUILD_CONDITIONS = "@freecorps/source,workerd,worker,browser";

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
    // As in `vp dev` (vite.config.ts): the dev sync actor, set only for local runs, and a Better Auth secret
    // that only signs cookies inside this test run (deployed Workers get theirs from `wrangler secret put`).
    {
      configPath: "../api/wrangler.jsonc",
      vars: {
        SYNC_DEV_ACTOR: "1",
        BETTER_AUTH_SECRET: "brigade-tests-only-secret-not-for-deployments",
      },
    },
  ],
});

// A browser navigation: with SPA fallback, only run_worker_first keeps these away from index.html.
const navigate = { headers: { "Sec-Fetch-Mode": "navigate", Accept: "text/html" } };
// On localhost, as `vp dev` serves it: the dev actor only answers requests for a local host (apps/api src/actor.ts).
const get = (path: string, init?: { headers: Record<string, string> }) =>
  server.fetch(`http://localhost${path}`, init);

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
    // The shard's sync tables and its probe pushes (apps/api/README.md).
    expect(await response.json()).toMatchObject({ workspace: "demo", tables: 6 });
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

  test("/api/sync/demo upgrades to a WebSocket through the service binding", async () => {
    const response = await get("/api/sync/demo", { headers: { Upgrade: "websocket" } });
    expect(response.status).toBe(101);
    const socket = response.webSocket!;
    socket.accept();
    const frame = new Promise<string>((resolve) =>
      socket.addEventListener("message", (event) => resolve(event.data as string)),
    );
    socket.send(JSON.stringify({ type: "hello", protocol: 1, clientId: "web" }));
    socket.send(
      JSON.stringify({ type: "subscribe", subId: "s", query: "incidents.active", args: {} }),
    );
    expect(JSON.parse(await frame)).toMatchObject({
      type: "snapshot",
      subId: "s",
      version: 0,
      rows: [],
    });
    socket.close(1000, "done");
  });
});

describe("apps/api wrangler.jsonc: the dev sync actor and auth", () => {
  const api = experimental_readRawConfig({ config: "../api/wrangler.jsonc" }).rawConfig;
  const environments = [
    ["top level (production)", api],
    ["dev", api.env?.dev],
    ["staging", api.env?.staging],
  ] as const;

  test("there are exactly these environments", () => {
    expect(Object.keys(api.env ?? {}).sort()).toEqual(["dev", "staging"]);
  });

  // DEV ONLY (apps/api/src/actor.ts): a deployment with it lets anyone without a session act as a responder.
  test.each(environments)("%s does not set SYNC_DEV_ACTOR", (_name, config) => {
    expect(config?.vars?.SYNC_DEV_ACTOR).toBeUndefined();
  });

  // D1 and secrets settings are not inherited, so each environment repeats them.
  test.each(environments)("%s binds DB and requires the Better Auth secret", (_name, config) => {
    expect(config?.d1_databases?.map((database: { binding: string }) => database.binding)).toEqual([
      "DB",
    ]);
    expect(config?.secrets?.required).toEqual(["BETTER_AUTH_SECRET"]);
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
