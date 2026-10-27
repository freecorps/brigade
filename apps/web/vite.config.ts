import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite-plus";
// By path, not "@freecorps/brigade-ui": the config loader does not use the @freecorps/source condition,
// so the package name would need packages/ui built first (tests run before builds in CI).
import { themes } from "../../packages/ui/src/tokens.ts";
import { buildEnvironment } from "./src/lib/build-environment.ts";
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

/**
 * DEV ONLY: the API's optional secrets, from the shell (`DEAD_MAN_URL=… vp run dev`). `secrets.required` in
 * apps/api/wrangler.jsonc makes wrangler load only the required ones from `.dev.vars`, so a local run gets these
 * here instead; deployed Workers get them from `wrangler secret put`.
 */
function localSecrets(): Record<string, string> {
  const names = ["DEAD_MAN_URL", "RELAY_URL", "RELAY_SEND_TOKEN", "EMAIL_FROM", "DASHBOARD_URL"];
  return Object.fromEntries(
    names.flatMap((name) => (process.env[name] ? [[name, process.env[name]]] : [])),
  );
}

export default defineConfig(({ command, mode }) => ({
  // The header's badge and the overview's wording (src/lib/environment.ts).
  define: {
    "import.meta.env.BRIGADE_ENV": JSON.stringify(
      buildEnvironment(command, process.env.CLOUDFLARE_ENV),
    ),
  },
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
            // In dev it also gets the API's local-only vars (apps/api/vite.config.ts: the dev sync actor, and
            // the email notifier logging what it would send).
            auxiliaryWorkers:
              command === "serve"
                ? [
                    {
                      configPath: "../api/wrangler.jsonc",
                      config: { vars: { SYNC_DEV_ACTOR: "1", EMAIL_LOG: "1", ...localSecrets() } },
                    },
                  ]
                : [],
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
    include: ["test/**/*.test.ts", "test/**/*.test.tsx", "worker/**/*.test.ts"],
    // test/worker-config.test.ts starts workerd with both Workers.
    hookTimeout: 60_000,
  },
}));
