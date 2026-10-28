import { cloudflare } from "@cloudflare/vite-plugin";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";
import { workspaceSource } from "../../vite.workspace.ts";

/**
 * DEV ONLY: lets a sync upgrade without a session act as the dev responder (src/actor.ts) in local runs, which
 * use the top-level (production) config. Only `vp dev` and the tests set it, never a build or a deployed
 * environment. No app relies on it since the mobile app signs in; it stays for local tools and the tests.
 * `EMAIL_LOG` makes the email notifier log what it would send instead (src/email.ts), unless `EMAIL_FROM` is set.
 * `SIGNUP: "open"`: anyone signs up locally and in the tests, as on `dev` (src/sign-up.ts); the tests of the other modes
 * pass their own.
 */
export const LOCAL_VARS = { SYNC_DEV_ACTOR: "1", EMAIL_LOG: "1", SIGNUP: "open" };

/**
 * Test-only Better Auth secret. Not a credential: it signs cookies inside one test run. Local dev and deployed
 * Workers read BETTER_AUTH_SECRET from apps/api/.dev.vars or `wrangler secret put`.
 */
const TEST_AUTH_SECRET = "brigade-tests-only-secret-not-for-deployments";

/**
 * Test-only key for sealing Slack bot tokens (src/slack-token.ts): 32 bytes of 7s, base64url. Not a credential: it
 * seals made-up tokens inside one test run. Deployed Workers get SLACK_TOKEN_KEY from `wrangler secret put`.
 */
const TEST_SLACK_TOKEN_KEY = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";

/**
 * Test-only key for sealing webhook signing secrets (src/webhook-routes.ts): 32 bytes of 9s, base64url. Not a
 * credential, like the Slack key above. Deployed Workers get WEBHOOK_SECRET_KEY from `wrangler secret put`.
 */
const TEST_WEBHOOK_SECRET_KEY = "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk";

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
                SLACK_TOKEN_KEY: TEST_SLACK_TOKEN_KEY,
                WEBHOOK_SECRET_KEY: TEST_WEBHOOK_SECRET_KEY,
                // Tests read events from the outbox; test/outbox.test.ts drives the drain itself.
                OUTBOX_DRAIN: "paused",
                // The dead-man switch's ping (src/watchdog.ts): a loopback URL nothing listens on;
                // test/watchdog.test.ts answers it with a stubbed `fetch`.
                DEAD_MAN_URL: "http://localhost/dead-man-test",
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
  test: {
    // Most tests sign people up through Better Auth first, which hashes each password (scrypt): two to four per
    // test, seconds of setup on a loaded runner (CI, or the whole monorepo's tests at once), past the default 5 s.
    testTimeout: 15_000,
    setupFiles: ["./test/apply-migrations.ts"],
    // A loopback TCP listener for the TCP check's real-socket test.
    globalSetup: ["./test/setup/tcp-listener.ts"],
  },
}));
