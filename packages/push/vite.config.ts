import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    // Build from the runtime tsconfig (src only, no Node types); the package one also covers tests.
    tsconfig: "src/tsconfig.json",
    dts: {
      generator: "tsgo",
    },
    // `@freecorps/source` condition for workspace consumers; publishConfig.exports keeps the dist-only map (RFC 0002).
    exports: { devExports: "@freecorps/source" },
  },
});
