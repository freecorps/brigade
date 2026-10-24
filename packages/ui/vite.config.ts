import { defineConfig } from "vite-plus";
import { workspaceSource } from "../../vite.workspace.ts";

export default defineConfig({
  plugins: [workspaceSource()],
  pack: {
    // Build from the runtime tsconfig (src only, no Node types); the package one also covers tests.
    tsconfig: "src/tsconfig.json",
    deps: {
      // tsdown <0.23 compatibility: resolve external dependency subpaths.
      resolveDepSubpath: true,
    },
    dts: {
      generator: "tsgo",
    },
    exports: {
      devExports: "source",
      // The CSS is generated from src/tokens.ts (`vp run generate`), committed and shipped from src
      // so apps can import it without building this package first.
      customExports: {
        "./tokens.css": "./src/tokens.css",
        "./theme.css": "./src/theme.css",
      },
    },
  },
});
