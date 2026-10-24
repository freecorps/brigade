import { defineConfig } from "vite-plus";
import { workspaceSource } from "../../vite.workspace.ts";

export default defineConfig({
  plugins: [workspaceSource()],
  pack: {
    entry: ["src/index.ts", "src/protocol.ts", "src/react.ts"],
    // Build from the runtime tsconfig (src only, no Node or DOM types); the package one also covers tests.
    tsconfig: "src/tsconfig.json",
    deps: {
      // tsdown <0.23 compatibility: resolve external dependency subpaths.
      resolveDepSubpath: true,
    },
    dts: {
      generator: "tsgo",
    },
    // `@freecorps/source` condition for workspace consumers; publishConfig.exports keeps the dist-only map (RFC 0002).
    exports: { devExports: "@freecorps/source" },
  },
});
