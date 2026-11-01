import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    // `instance` is its own entry: instances and the relay import it, and the API's bundle of the main entry stays
    // the size it was (its tests run close to workerd's 1 MiB message limit, issue to follow).
    entry: ["src/index.ts", "src/instance.ts"],
    // Build from the runtime tsconfig (src only, no Node types); the package one also covers tests.
    tsconfig: "src/tsconfig.json",
    dts: {
      generator: "tsgo",
    },
    // `@freecorps/source` condition for workspace consumers; publishConfig.exports keeps the dist-only map (RFC 0002).
    exports: { devExports: "@freecorps/source" },
  },
});
