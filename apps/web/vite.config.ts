import { cloudflare } from "@cloudflare/vite-plugin";
import { themes } from "@freecorps/brigade-ui";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite-plus";
import { workspaceSource } from "../../vite.workspace.ts";

/**
 * Fills the page-ground colours into index.html from packages/ui, so the browser chrome (the status bar
 * on phones) matches the theme from the first paint without a colour literal in the app. The inline
 * script picks one once it knows the theme; React keeps it in sync afterwards.
 */
function themeColor(): Plugin {
  return {
    name: "brigade:theme-color",
    transformIndexHtml: {
      order: "pre",
      handler: (html) =>
        html
          .replaceAll("%BRIGADE_GROUND_LIGHT%", themes.light.background)
          .replaceAll("%BRIGADE_GROUND_DARK%", themes.dark.background),
    },
  };
}

export default defineConfig(({ command, mode }) => ({
  plugins:
    mode === "test"
      ? [workspaceSource()]
      : [
          // File-based routes in src/routes; writes src/routeTree.gen.ts (committed).
          tanstackRouter({ target: "react", autoCodeSplitting: true }),
          react(),
          tailwindcss(),
          themeColor(),
          cloudflare({
            // `vp dev` also runs the API Worker (and its WorkspaceDO), so one command serves the SPA,
            // this Worker and the API; the `API` service binding resolves to it by name. The build
            // only bundles this Worker: apps/api builds and deploys on its own.
            auxiliaryWorkers: command === "serve" ? [{ configPath: "../api/wrangler.jsonc" }] : [],
          }),
          workspaceSource(),
        ],
  resolve: { tsconfigPaths: true },
  run: {
    tasks: {
      build: {
        command: "vp build",
        // Files the build both reads and writes would make it uncacheable: the router plugin rewrites
        // src/routeTree.gen.ts (from the route files, which stay tracked) and the Cloudflare plugin
        // rewrites its deploy redirect in .wrangler/deploy (still restored as an output).
        cache: { input: [{ auto: true }, "!src/routeTree.gen.ts", "!.wrangler/deploy/**"] },
      },
    },
  },
  test: {
    include: ["test/**/*.test.ts", "worker/**/*.test.ts"],
    // test/worker-config.test.ts starts workerd with both Workers.
    hookTimeout: 60_000,
  },
}));
