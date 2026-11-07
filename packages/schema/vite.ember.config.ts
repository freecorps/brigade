import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

// The package's tests a second time, every `createMemoryStore` backed by an Ember shard engine through
// `createEmberStore` (tests/support/ember-memory-store.ts): the same mutations and queries, run over Ember's `ctx.db`
// (RFC 0016 "The workspace shard"). `tests/store.test.ts` is the memory store's own test (with tables Brigade does
// not have) and stays in the plain run; `tests/ember-store.test.ts` covers the Ember store itself.
const store = fileURLToPath(new URL("src/store.ts", import.meta.url));
const emberStore = fileURLToPath(new URL("src/ember-store.ts", import.meta.url));
const support = fileURLToPath(new URL("tests/support/", import.meta.url));
const shim = fileURLToPath(new URL("tests/support/store-shim.ts", import.meta.url));

export default defineConfig({
  plugins: [
    {
      name: "brigade-ember-store",
      enforce: "pre",
      async resolveId(source, importer, options) {
        if (!importer || importer.startsWith(support) || importer === emberStore) return null;
        if (!source.endsWith("store.ts")) return null;
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
        return resolved?.id === store ? shim : null;
      },
    },
  ],
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/store.test.ts", "tests/ember-store.test.ts"],
  },
});
