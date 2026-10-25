# @freecorps/brigade-mobile

The Brigade app for iOS and Android: Expo SDK 58, Expo Router, React Native 0.88 on Hermes. It is bundled by Metro,
not Vite (RFC 0002). The home screen is the workspace's live incident list (Brigade Sync, RFC 0004): declare, and
change an incident's status or severity. From it, `/legend` shows the severity and status legend, and a
development-only `/intl` route reports Hermes `Intl` support. Spike write-ups:
[S4](../../docs/spikes/s4-expo-workspace.md), [S3](../../docs/spikes/s3-sync-engine.md).

## Live data in development

The list connects to `ws://<Metro host>:5173/api/sync/demo`, the dashboard's dev server, so start it first with
`vp run dev` at the repository root. The host is the one the app loaded its bundle from (`hostUri`), and the dev
server listens on `localhost` only, so keep Metro on `localhost` too:

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=localhost bunx expo run:ios       # the Simulator shares the Mac's localhost
adb reverse tcp:8081 tcp:8081 && adb reverse tcp:5173 tcp:5173   # Android emulator or device, then:
REACT_NATIVE_PACKAGER_HOSTNAME=localhost bunx expo run:android
```

`EXPO_PUBLIC_BRIGADE_SYNC_URL` (a base such as `wss://brigade.example.com/api/sync`) overrides the URL; without
it, a release build has no URL and shows sync as unavailable.

## Run it

It runs as a development build (`expo-dev-client`), not in Expo Go. From this directory, after `vp install` at
the root:

```bash
bunx expo run:android   # prebuild android/, build, install and start Metro (emulator or device)
bunx expo run:ios       # the same on macOS with Xcode
vp run start            # Metro only, for an already installed development build
```

Use `bunx`, not `npx`: npm refuses to run in this repository because the root `devEngines` names Bun.

On macOS, the selected Xcode must have a Simulator runtime for its own iOS SDK. With several Xcodes installed, pick
one per command with `DEVELOPER_DIR=/Applications/<Xcode>.app/Contents/Developer bunx expo run:ios`, or install
the missing runtime for the selected Xcode with `xcodebuild -downloadPlatform iOS`.

`android/` and `ios/` are generated from `app.config.ts` and gitignored; change native settings there, never in
the generated folders.

```bash
vp test                 # locale, theme, Intl-probe, sync URL and incident wording logic (Node, no emulator)
vp run build            # cached expo export of the Android and iOS JS bundles into dist/: proves Metro resolves everything
```

## How it is wired

- **Workspace packages from source:** `metro.config.js` adds the `@freecorps/source` condition, and
  `tsconfig.json` sets the same `customConditions`. Import workspace packages with `import`, never `require`.
- **Entry and Intl:** `src/index.ts` (the `main` entry) imports `src/intl/setup.ts` before `expo-router/entry`.
  The setup records what Hermes supports, loads the `@formatjs` polyfills it
  lacks (`en` and `pt` data) and records again. Add locale data there when a locale is added.
- **Theme and locale:** the system light/dark setting picks `themes.light` or `themes.dark`. The device languages
  (or Android 13+/iOS per-app language) pick `en` or `pt-BR` through `resolveLocale`.
- **Icons:** `expo-symbols`, with an SF Symbol for iOS and a Material Symbol for Android and web for every glyph
  (`src/components/glyphs.ts`), never one family on both.
- **Splash ground on iOS:** `plugins/splash-ground.ts` points the launch screen at the light/dark ground, which
  `expo-splash-screen` only does when there is a splash image. Drop it once the app has one.
- **Autolinking:** `expo-router`'s optional peers (Reanimated, Worklets, Gesture Handler) are installed by Bun
  but excluded from autolinking until the app uses them.

## Windows

Native Android builds fail on the 260-character path limit with the Android SDK's default CMake (3.22.1, Ninja
1.10). Install CMake 3.31.6 from the Android SDK repository and point the generated project at it in
`android/local.properties` (`cmake.dir=…`). If the emulator cannot reach Metro over the network, run
`adb reverse tcp:8081 tcp:8081` and open the app against `127.0.0.1`.
