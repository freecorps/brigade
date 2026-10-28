import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";
import { workspaceSource } from "../../vite.workspace.ts";

// The Vite plugin runs and builds the Worker; `workspaceSource()` resolves packages/schema and packages/i18n to their
// TypeScript source (RFC 0002). The Worker is a KV read and a call to the API's `StatusPages` entrypoint, both reached
// through `env`, so the tests run in Node with a fake KV, limiter and API.
export default defineConfig(({ mode }) => ({
  plugins: mode === "test" ? [workspaceSource()] : [cloudflare(), workspaceSource()],
  test: { include: ["test/**/*.test.ts"] },
}));
