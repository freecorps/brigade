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
      },
    },
    // Declarations from a tsconfig without the source condition: the schema's come from its built `dist` (it builds
    // first, being a dependency), since tsgo emits declarations for the files under this package only.
    tsconfig: "src/tsconfig.json",
    deps: {
      alwaysBundle: [SCHEMA],
      dts: { alwaysBundle: [SCHEMA] },
    },
    dts: {
      generator: "tsgo",
    },
    // `@freecorps/source` condition for workspace consumers; publishConfig.exports keeps the dist-only map (RFC 0002).
    exports: { devExports: "@freecorps/source" },
  },
});
