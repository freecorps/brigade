import { defineConfig } from "vite-plus";
import { workspaceSource } from "../../vite.workspace.ts";

// Only unit tests run under Vite+ (pure logic in src/lib and src/intl, no React Native): Metro bundles
// the app. They run in Node on CI, without an emulator.
export default defineConfig({
  plugins: [workspaceSource()],
  resolve: { tsconfigPaths: true },
  run: {
    tasks: {
      // The Android and iOS JS bundles, no native build: proves in CI that Metro resolves every import
      // (workspace packages from source) and that Hermes compiles the bundle. Expo CLI also writes its
      // own state to .expo/, which is neither an input nor an output.
      build: {
        command: "expo export --platform android --platform ios --output-dir dist",
        cache: { input: [{ auto: true }, "!dist/**", "!.expo/**"] },
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
