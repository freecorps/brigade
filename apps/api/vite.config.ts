import { cloudflare } from "@cloudflare/vite-plugin";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";
import { workspaceSource } from "../../vite.workspace.ts";

/**
 * DEV ONLY until auth exists: lets sync sockets act as the dev responder (src/workspace.ts) in local runs, which
 * use the top-level (production) config. Only `vp dev` and the tests set it, never a build, so it cannot reach a
 * deployed Worker; the deployed `dev` environment sets it in wrangler.jsonc.
 */
export const LOCAL_VARS = { SYNC_DEV_ACTOR: "1" };

export default defineConfig(({ command, mode }) => ({
  // The Vite plugin runs the Worker in dev and build; tests run it through the Vitest plugin instead.
  // `workspaceSource()` resolves packages/schema and packages/sync to their TypeScript source (RFC 0002).
  plugins:
    mode === "test"
      ? [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: { bindings: LOCAL_VARS },
          }),
          workspaceSource(),
        ]
      : [
          cloudflare(command === "serve" ? { config: { vars: LOCAL_VARS } } : {}),
          workspaceSource(),
        ],
}));
