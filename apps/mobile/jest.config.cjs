/**
 * Routing tests (`src/**\/*.test.tsx`) run in Jest with Expo's preset, which `expo-router/testing-library` needs (it
 * renders the real router over React Native); the unit tests (`*.test.ts`) run in Vite+.
 */
module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/src/**/*.test.tsx"],
  // The first test loads and transforms the whole layout (React Native, Expo Router, the workspace packages): about
  // 7 s on CI's runners, past Jest's 5 s default. The others take well under a second.
  testTimeout: 30_000,
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    // Babel adds its helpers to workspace packages too, which do not depend on them.
    "^@babel/runtime/(.*)$": "<rootDir>/node_modules/@babel/runtime/$1",
  },
  // Workspace packages from their TS source, as Metro reads them (RFC 0002).
  testEnvironmentOptions: { customExportConditions: ["@freecorps/source", "react-native"] },
  // jest-expo's patterns, with Bun's store (`node_modules/.bun/<pkg>@<version>/node_modules/<pkg>`) let through as
  // they let pnpm's: the packages inside it are still matched by name.
  transformIgnorePatterns: [
    "/node_modules/(?!(\\.bun|@freecorps|react-native|@react-native|@react-native-community|expo|@expo|react-navigation|@react-navigation|standard-navigation))",
    "/node_modules/react-native-reanimated/plugin/",
    "/node_modules/@react-native/babel-preset/",
  ],
};
