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

  // The harness's D1 has no migrations, so this stops at the session; apps/api test/index.test.ts covers a member.
  test("/api/workspaces/:id reaches the API Worker and needs a session", async () => {
    const response = await get("/api/workspaces/ws_01J00000000000000000000000");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  test("bare /api runs the Worker first too (the API answers its own 404)", async () => {
    const response = await get("/api", navigate);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  test("/status/:slug reaches the API Worker, not index.html, and needs no session", async () => {
    const response = await get("/status/acme", navigate);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain("No status page here");
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

  // TEST ONLY (apps/api/src/workspace.ts): a deployment with it would never send its events, so never page.
  test.each(environments)("%s does not pause the outbox drain", (_name, config) => {
    expect(config?.vars?.OUTBOX_DRAIN).toBeUndefined();
  });

  // The email notifier (apps/api/src/email.ts): Email Sending through its binding, never sent from a local run
  // (`remote`), with the sender a secret (EMAIL_FROM) rather than a domain in the repo, and never the dev double.
  test.each(environments)("%s sends email through the EMAIL binding only", (_name, config) => {
    expect(config?.send_email).toEqual([{ name: "EMAIL" }]);
    expect(config?.vars?.EMAIL_LOG).toBeUndefined();
    expect(config?.vars?.EMAIL_FROM).toBeUndefined();
  });

  // The outbox drain's Queue and its consumer are not inherited either.
  test.each(environments)("%s produces to and consumes its own events queue", (name, config) => {
    const suffix = name === "dev" ? "-dev" : name === "staging" ? "-staging" : "";
    expect(config?.queues?.producers).toEqual([
      { binding: "EVENTS", queue: `brigade-events${suffix}` },
    ]);
    expect(config?.queues?.consumers).toEqual([
      expect.objectContaining({
        queue: `brigade-events${suffix}`,
        // QUEUE_MAX_RETRIES (apps/api/src/notify.ts), above MAX_PAGE_ATTEMPTS.
        max_retries: 10,
        dead_letter_queue: `brigade-events-dlq${suffix}`,
      }),
      // The dead-letter consumer records and acks; it never retries, and has no dead-letter queue of its own.
      { queue: `brigade-events-dlq${suffix}`, max_batch_size: 10, max_retries: 5 },
    ]);
  });

  // D1 and secrets settings are not inherited, so each environment repeats them.
  test.each(environments)("%s binds DB and requires the Better Auth secret", (_name, config) => {
    expect(config?.d1_databases?.map((database: { binding: string }) => database.binding)).toEqual([
      "DB",
    ]);
    expect(config?.secrets?.required).toEqual(["BETTER_AUTH_SECRET"]);
  });

  // The dead-man switch (apps/api src/watchdog.ts): its object is not inherited, so each environment binds it; its
  // cron is, so it is set once, at the top level, and no environment replaces it.
  test.each(environments)("%s binds the watchdog and keeps the minute cron", (_name, config) => {
    expect(config?.durable_objects?.bindings).toContainEqual({
      name: "WATCHDOG",
      class_name: "WatchdogDO",
    });
    expect(config?.triggers).toEqual(config === api ? { crons: ["* * * * *"] } : undefined);
  });
});

describe("public URLs", () => {
  const api = experimental_readRawConfig({ config: "../api/wrangler.jsonc" }).rawConfig;

  // Only the dashboard's dev environment is public (workers.dev, for testing on a phone); the API is reached through
  // the `API` binding alone, and no Worker has preview URLs.
  test("only the web Worker's dev environment has a workers.dev URL", () => {
    expect(rawConfig.workers_dev).toBe(false);
    expect(rawConfig.env?.dev?.workers_dev).toBe(true);
    expect(rawConfig.env?.staging?.workers_dev).toBeUndefined();
    expect(api.workers_dev).toBe(false);
    for (const config of [api.env?.dev, api.env?.staging]) {
      expect(config?.workers_dev).toBeUndefined();
    }
  });

  test("no Worker has preview URLs", () => {
    for (const config of [rawConfig, api]) {
      expect(config.preview_urls).toBe(false);
      expect(config.env?.dev?.preview_urls).toBeUndefined();
      expect(config.env?.staging?.preview_urls).toBeUndefined();
    }
  });
});

describe("wrangler.jsonc environments", () => {
  // Service bindings are not inherited by environments, so each one must name its own API Worker. No SLACK binding is
  // committed: it names a Worker that must exist first, so it is added with the Slack Worker's first deploy (RFC 0011),
  // and then it must name that environment's Slack Worker.
  test.each([
    ["top level (production)", rawConfig.services, ""],
    ["dev", rawConfig.env?.dev?.services, "-dev"],
    ["staging", rawConfig.env?.staging?.services, "-staging"],
  ])("%s binds API (and SLACK, once added) to its own Worker", (_name, services, suffix) => {
    const bindings = (services ?? []) as { binding: string; service: string }[];
    expect(bindings.filter((s) => s.binding === "API")).toEqual([
      { binding: "API", service: `brigade-api${suffix}` },
    ]);
    for (const slack of bindings.filter((s) => s.binding === "SLACK")) {
      // Production's Slack Worker is not named yet (RFC 0011): any `brigade-slack-*` will do there.
      if (suffix) expect(slack.service).toBe(`brigade-slack${suffix}`);
      else expect(slack.service).toMatch(/^brigade-slack(-[a-z0-9-]+)?$/);
    }
    expect(bindings.every((s) => s.binding === "API" || s.binding === "SLACK")).toBe(true);
  });
});
