import { cloudflare } from "@cloudflare/vite-plugin";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";
import { TEST_TOKEN } from "./test/token.ts";

export default defineConfig(({ mode }) => ({
  plugins:
    mode === "test"
      ? [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: { bindings: { PROBE_ADMIN_TOKEN: TEST_TOKEN } },
          }),
        ]
      : [cloudflare()],
}));
