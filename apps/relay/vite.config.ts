import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";
import { workspaceSource } from "../../vite.workspace.ts";

// The Vite plugin runs and builds the Worker; `workspaceSource()` resolves packages/push to its TypeScript
// source (RFC 0002). The APNs and HTTP logic is plain WebCrypto and fetch, so the tests run in Node without it;
// the deployed Worker was checked against APNs by hand (docs/spikes/s1-apns-encryption.md).
export default defineConfig(({ mode }) => ({
  plugins: mode === "test" ? [workspaceSource()] : [cloudflare(), workspaceSource()],
  // `cloudflare:workers` exists only in workerd: the tests get a stand-in for `DurableObject` (src/registry.ts).
  resolve:
    mode === "test"
      ? {
          alias: {
            "cloudflare:workers": new URL("test/cloudflare-workers.ts", import.meta.url).pathname,
          },
        }
      : {},
  test: { include: ["test/**/*.test.ts"] },
}));
