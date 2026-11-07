import { defineConfig } from "vite-plus";
import { workspaceSource } from "../../vite.workspace.ts";

// The workspace's Ember functions (ember/, RFC 0016 "The workspace shard"), tested in Node on a real Ember shard
// engine (`@freecorps/ember-server` on node:sqlite). The Worker's own tests (vite.config.ts) run in workerd, which has
// no node:sqlite.
export default defineConfig({
  plugins: [workspaceSource()],
  test: { include: ["ember/test/**/*.test.ts"] },
});
