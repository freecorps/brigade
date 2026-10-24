import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { workspaceSource } from "../../vite.workspace.ts";

export default defineConfig(({ command, mode }) => ({
  plugins:
    mode === "test"
      ? [workspaceSource()]
      : [
          // File-based routes in src/routes; writes src/routeTree.gen.ts (committed).
          tanstackRouter({ target: "react", autoCodeSplitting: true }),
          react(),
          tailwindcss(),
          cloudflare({
            // `vp dev` also runs the API Worker (and its WorkspaceDO), so one command serves the SPA,
            // this Worker and the API; the `API` service binding resolves to it by name. The build
            // only bundles this Worker: apps/api builds and deploys on its own.
            auxiliaryWorkers: command === "serve" ? [{ configPath: "../api/wrangler.jsonc" }] : [],
          }),
          workspaceSource(),
        ],
  resolve: { tsconfigPaths: true },
  test: {
    include: ["test/**/*.test.ts", "worker/**/*.test.ts"],
  },
}));
