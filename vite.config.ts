import { defineConfig } from "vite-plus";

export default defineConfig({
  // Skills are vendored from upstream (skills-lock.json); formatting them breaks their hashes.
  fmt: {
    ignorePatterns: [".agents/**", ".claude/**", "skills-lock.json"],
  },
  lint: {
    ignorePatterns: [".agents/**", ".claude/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
