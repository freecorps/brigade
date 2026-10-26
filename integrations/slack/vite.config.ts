import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";
import { workspaceSource } from "../../vite.workspace.ts";

// The Vite plugin runs and builds the Worker; `workspaceSource()` resolves packages/schema and packages/i18n to their
// TypeScript source (RFC 0002). Signing, OAuth and the Web API are plain WebCrypto and fetch, and the API is reached
// through an interface (src/bridge.ts), so the tests run in Node with a fake bridge and a fake Slack.
export default defineConfig(({ mode }) => ({
  plugins: mode === "test" ? [workspaceSource()] : [cloudflare(), workspaceSource()],
  test: { include: ["test/**/*.test.ts"] },
}));
