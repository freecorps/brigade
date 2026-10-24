import { cloudflare } from "@cloudflare/vite-plugin";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";
import { workspaceSource } from "../../vite.workspace.ts";

export default defineConfig(({ mode }) => ({
  // The Vite plugin runs the Worker in dev and build; tests run it through the Vitest plugin instead.
  plugins: [
    mode === "test"
      ? cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })
      : cloudflare(),
    workspaceSource(),
  ],
}));
