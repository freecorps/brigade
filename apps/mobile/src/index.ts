// The app's entry (package.json `main`). Measuring the engine and loading the Intl polyfills it lacks
// must happen before Expo Router evaluates any route or packages/i18n formats anything.
import "./intl/setup";
import "expo-router/entry";
