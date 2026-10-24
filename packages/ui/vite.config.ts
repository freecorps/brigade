import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    // Build from the runtime tsconfig (src only); the root one also covers tests and schema source.
    tsconfig: "src/tsconfig.json",
    deps: {
      // tsdown <0.23 compatibility: resolve external dependency subpaths.
      resolveDepSubpath: true,
    },
    dts: {
      generator: "tsgo",
    },
    exports: {
      // The CSS is generated from src/tokens.ts (`vp run generate`), committed and shipped from src
      // so apps can import it without building this package first.
      customExports: {
        "./tokens.css": "./src/tokens.css",
        "./theme.css": "./src/theme.css",
      },
    },
  },
  test: {
    // Read packages/schema from source so tests do not depend on it being built first.
    alias: {
      "@freecorps/brigade-schema": fileURLToPath(
        new URL("../schema/src/index.ts", import.meta.url),
      ),
    },
  },
});
