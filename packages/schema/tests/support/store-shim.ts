// What `src/store.ts` resolves to in the Ember test run (vite.ember.config.ts): the real module, with
// `createMemoryStore` replaced by a store whose rows live on an Ember shard engine.
export * from "../../src/store.ts";
export { createEmberMemoryStore as createMemoryStore } from "./ember-memory-store.ts";
