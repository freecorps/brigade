// Metro, not Vite, bundles the app (RFC 0002). Expo's defaults already handle the Bun workspace: they
// watch the repository root and every workspace, resolve from both node_modules folders, follow Bun's
// isolated-install symlinks and read package.json `exports`.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Resolve workspace packages to their TypeScript source, as tsconfig's `customConditions` and the
// `workspaceSource()` Vite plugin do (RFC 0002), so the app never needs a package built first.
// Metro matches conditions in the order of each package's `exports` map, where this one comes first.
// Only `import` uses `exports`; workspace packages must not be `require`d.
config.resolver.unstable_conditionNames = [
  "@freecorps/source",
  ...(config.resolver.unstable_conditionNames ?? []),
];

module.exports = config;
