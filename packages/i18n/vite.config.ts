import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/messages.ts", "src/labels.ts"],
    // Ship Paraglide's output as is (one module per message, `m` a real ESM namespace) so consumers
    // tree-shake down to the messages they use; bundling it would turn `m` into a plain object.
    // server.js (Paraglide middleware) is unreachable from our entries, so it is not shipped.
    copy: [{ from: ["src/paraglide/**", "!src/paraglide/server.*"], to: "dist", flatten: false }],
    deps: {
      neverBundle: [/^\.\/paraglide\//],
      // tsdown <0.23 compatibility: resolve external dependency subpaths.
      // Remove to preserve subpath imports as written (the new default).
      // https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
      resolveDepSubpath: true,
    },
    dts: {
      generator: "tsgo",
      // src only, without Node types (src/tsconfig.json).
      tsconfig: "src/tsconfig.json",
    },
    exports: true,
  },
  test: {
    // Tests use schema sources so they run without building schema first (paths in tsconfig.json).
    alias: {
      "@freecorps/brigade-schema": fileURLToPath(
        new URL("../schema/src/index.ts", import.meta.url),
      ),
    },
  },
});
