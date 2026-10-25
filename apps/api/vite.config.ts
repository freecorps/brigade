import { cloudflare } from "@cloudflare/vite-plugin";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";
import { workspaceSource } from "../../vite.workspace.ts";

/**
 * DEV ONLY: lets a sync upgrade without a session act as the dev responder (src/actor.ts) in local runs, which
 * use the top-level (production) config. Only `vp dev` and the tests set it, never a build or a deployed
 * environment; the mobile app relies on it until it can sign in.
 */
export const LOCAL_VARS = { SYNC_DEV_ACTOR: "1" };

/**
 * Test-only Better Auth secret. Not a credential: it signs cookies inside one test run. Local dev and deployed
 * Workers read BETTER_AUTH_SECRET from apps/api/.dev.vars or `wrangler secret put`.
 */
const TEST_AUTH_SECRET = "brigade-tests-only-secret-not-for-deployments";

export default defineConfig(async ({ command, mode }) => ({
  // The Vite plugin runs the Worker in dev and build; tests run it through the Vitest plugin instead.
  // `workspaceSource()` resolves packages/schema and packages/sync to their TypeScript source (RFC 0002).
  plugins:
    mode === "test"
      ? [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                ...LOCAL_VARS,
                BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
                // test/apply-migrations.ts applies these to the local D1 before the tests run.
                TEST_MIGRATIONS: await readD1Migrations("./migrations"),
              },
            },
          }),
          workspaceSource(),
        ]
      : [
          cloudflare(command === "serve" ? { config: { vars: LOCAL_VARS } } : {}),
          workspaceSource(),
        ],
  test: { setupFiles: ["./test/apply-migrations.ts"] },
}));
