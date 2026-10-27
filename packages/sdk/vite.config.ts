import { defineConfig } from "vite-plus";
import { workspaceSource } from "../../vite.workspace.ts";

// `@freecorps/brigade-schema` is bundled, code and types: the published SDK depends on nothing (RFC 0002 "Layout").
const SCHEMA = /^@freecorps\/brigade-schema$/;

export default defineConfig({
  plugins: [workspaceSource()],
  pack: {
    entry: ["src/index.ts"],
    // Workers, Node 20+, Deno, Bun and browsers: no Node built-ins, plain ES2022, `.mjs` and `.d.mts` all the same.
    platform: "neutral",
    target: "es2022",
    fixedExtension: true,
    inputOptions: {
      // The schema package's source, so only the modules the SDK uses ship: none of them does anything on import.
      resolve: { conditionNames: ["@freecorps/source", "import", "default"] },
      treeshake: {
        moduleSideEffects: (id: string) => !id.includes("/packages/schema/src/"),
        // Making a mutation, a query or a validator has no effect but its value: unused, it is dropped.
        manualPureFunctions: ["defineMutation", "defineQuery", "defineRegistry", "v"],
        // Nothing in it has getters: reading a property (a spread of a mutation's fields) does nothing either, so the
        // monitors' and the other mutations' validators are dropped with them.
        propertyReadSideEffects: false,
      },
    },
    // Build from the runtime tsconfig (src only, no Node types); the package one also covers tests.
    tsconfig: "src/tsconfig.json",
    deps: {
      alwaysBundle: [SCHEMA],
      dts: { alwaysBundle: [SCHEMA] },
    },
    dts: {
      generator: "tsgo",
      // The schema's declarations from its built `dist`, not its source (tsconfig.pack.json).
      tsconfig: "tsconfig.pack.json",
    },
    // `@freecorps/source` condition for workspace consumers; publishConfig.exports keeps the dist-only map (RFC 0002).
    exports: { devExports: "@freecorps/source" },
  },
});
