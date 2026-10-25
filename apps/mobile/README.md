# @freecorps/brigade-mobile

The Brigade app for iOS and Android: Expo SDK 58, Expo Router, React Native 0.88 on Hermes. It is bundled by Metro,
not Vite (RFC 0002). The home screen is the workspace's live incident list (Brigade Sync, RFC 0004): declare, and
change an incident's status or severity. From it, `/legend` shows the severity and status legend, and a
development-only `/intl` route reports Hermes `Intl` support. Another development-only route, `/push`, shows the
APNs device token and the device public key that encrypted pushes are sealed to. Spike write-ups:
[S4](../../docs/spikes/s4-expo-workspace.md), [S3](../../docs/spikes/s3-sync-engine.md),
[S1](../../docs/spikes/s1-apns-encryption.md).

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

## On a phone, and builds for distribution

Builds run on your own computer. EAS keeps the signing credentials and will submit to the stores, but its cloud
builders are only for (re)generating credentials, since each cloud build spends build credits. From the
repository root:

```bash
vp run mobile:install                    # build and install on a phone over USB or Wi-Fi (asks platform, variant, phone)
vp run mobile:install --platform android --variant release --device Pixel
vp run mobile:build                      # eas build --local: a signed .ipa / .apk / .aab in ~/brigade-builds
vp run mobile:install --from ~/brigade-builds/brigade-ios-preview-<commit>.ipa
```

- **`mobile:install`** (`scripts/mobile-install.mjs`) runs `expo prebuild`, then `xcodebuild` or Gradle, then
  installs with `xcrun devicectl` (iPhone) or `adb` (Android device or emulator) and opens the app. The
  `development` variant is the dev client: start Metro (`vp run start` here) and `vp run dev` at the root; on
  Android the script runs `adb reverse` for both ports. The `release` variant embeds the JavaScript and needs
  `EXPO_PUBLIC_BRIGADE_SYNC_URL` at build time to sync. Flags: `--device <name or id>`, `--clean`, `--no-build`,
  `--build-only`, `--no-launch`, `--from <artifact>`, `--yes`.
  - iOS signs with Xcode automatic signing, from an Apple account signed into Xcode with the Freecorps team (or
    `--team` / `IOS_TEAM_ID`); xcodebuild registers the iPhone and makes the development profile. The phone needs
    Developer Mode on. The newest installed Xcode builds and installs (`IOS_XCODE` overrides): SDK 58's template
    has a UIScene delegate, so the iOS 27 SDK does not crash it at launch.
  - Android signs with the debug key, so a local build cannot update an EAS-signed install (or the other way
    round): uninstall first.
- **`mobile:build`** (`scripts/mobile-build.mjs`) runs `eas build --local` for an `eas.json` profile: EAS's build
  steps on this machine, with the credentials EAS keeps. `development` and `preview` are internal: an ad hoc .ipa
  (only iPhones registered with `bunx eas-cli@latest device:create` before the build) or an APK. `production` is
  an .ipa or AAB for the stores, built with the newest released Xcode. Artifacts are named
  `brigade-<platform>-<profile>-<commit>.<ext>` and go to `~/brigade-builds` (`--out` or `BRIGADE_BUILDS_DIR`
  overrides): outside the repository, so they survive `git clean` and worktree removal and cannot be committed.
  iOS needs fastlane and CocoaPods. On a Mac whose login keychain holds another Apple Distribution certificate
  of the same team, the iOS archive can fail with "Provisioning profile … doesn't include signing certificate"
  (see spike S4).
- **Submitting** waits for roadmap Phase 4 (after the CLA). It will be `bunx eas-cli@latest submit --platform
  <ios|android> --profile production --path <artifact>` from this directory, once `eas.json`'s `submit.production`
  has the App Store Connect app and the Play service account.
- **A cloud build** (`bunx eas-cli@latest build --platform <platform> --profile <profile>`) is only for when EAS
  must create or regenerate credentials, such as a new distribution certificate or keystore. A newly registered
  iPhone should not need one: a local build goes through the same credentials step, which updates the ad hoc
  profile (not tried yet).

`android/` and `ios/` are generated from `app.config.ts` and gitignored; change native settings there, never in
the generated folders.

```bash
vp test                 # locale, theme, Intl-probe, sync URL, incident wording and config plugin logic (Node, no emulator)
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
- **Encrypted pushes (iOS):** `plugins/notification-service.ts` adds the `BrigadeNotificationService` extension
  target, the push, App Group and time-sensitive entitlements, and fallback strings generated from
  `packages/i18n` (`push_fallback_*`). The local module `modules/brigade-push` creates the device key in the
  Keychain shared through the App Group `group.app.freecorps.brigade`; the extension
  (`modules/brigade-push/extension`) decrypts with it (HPKE, `packages/push` on the server side) or shows the
  fallback. `aps-environment` is `development` locally and `production` on EAS. For local builds signed for a
  device, set `APPLE_TEAM_ID` (never committed) and build with `xcodebuild -allowProvisioningUpdates`; the commands
  are in the S1 write-up.
- **Autolinking:** `expo-router`'s optional peers (Reanimated, Worklets, Gesture Handler) are installed by Bun
  but excluded from autolinking until the app uses them.

## Windows

Native Android builds fail on the 260-character path limit with the Android SDK's default CMake (3.22.1, Ninja
1.10). Install CMake 3.31.6 from the Android SDK repository and point the generated project at it in
`android/local.properties` (`cmake.dir=…`). If the emulator cannot reach Metro over the network, run
`adb reverse tcp:8081 tcp:8081` and open the app against `127.0.0.1`.
