# @freecorps/brigade-mobile

The Brigade app for iOS and Android: Expo SDK 58, Expo Router, React Native 0.88 on Hermes. It is bundled by Metro,
not Vite (RFC 0002). It opens on sign-in (email and password; accounts are created on the dashboard). Signed in, the
app is the system's tab bar (Expo Router's `NativeTabs`: UITabBarController on iOS, Material 3's navigation bar on
Android), each tab with its own stack: **Incidents**, the workspace's live incident list (Brigade Sync, RFC 0004), to
declare (a form sheet, from the header's + on iOS and a floating action button on Android; a row's severity and status sit under its title) and, with a long press
on a row (a context menu on iOS, a dropdown on Android), to change an incident's status or severity; **On call** (whether the member is on call, their next shifts and overrides, who
every schedule has now; a tap on a schedule covers it); and **Account**, a settings screen with a glyph for each row (a tile on iOS, a Material Symbol on Android) (workspaces, whether this
phone is paged, calls, email switches, the legend, Sign out). Incidents, calls and sheets open above the tabs from the root stack, so a page opens its
incident whichever tab is showing. Controls come from `@expo/ui` (SwiftUI on iOS, Jetpack Compose on Android) where it
has one, and are drawn by the app only where it does not; chrome and grounds use the system's semantic colours
(`src/theme/system-colors.ts`), while brand, severity and status colours stay packages/ui's. Each incident
opens `/incidents/<number>`: severity and status, roles, details, who was paged and the timeline, as on the dashboard, in the system's grouped list; updates are written and edited in a form sheet (`/incidents/<number>/update`, from the header's compose button on iOS and a floating action button on Android), and a long press on one of your own updates edits it, removes it or opens its links. The list
says whether the member is on call (and until when, or when their next shift is) and opens `/oncall`: their shifts
and overrides, who every schedule has now, and an override for themselves (`schedule.addOverride`, from now for 1 to
24 hours) or removing their own. From the Account tab, `/legend` shows the severity and status legend, and a development-only `/intl` route reports Hermes
`Intl` support. Another development-only route, `/push`, shows the
APNs device token and the device public key that encrypted pushes are sealed to. Spike write-ups:
[S4](../../docs/spikes/s4-expo-workspace.md), [S3](../../docs/spikes/s3-sync-engine.md),
[S1](../../docs/spikes/s1-apns-encryption.md).

## Live data in development

The app signs in at `http://<Metro host>:5173/api/auth` and syncs at `ws://<Metro host>:5173/api/sync/<workspace>`,
the dashboard's dev server, so start it first with `vp run dev` in `apps/web` (with `apps/api/.dev.vars` holding a
`BETTER_AUTH_SECRET` and `vp run --filter @freecorps/brigade-web db:migrate` run once), and sign up on the dashboard. The host is the one the app loaded its bundle from (`hostUri`), and the dev
server listens on `localhost` only, so keep Metro on `localhost` too:

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=localhost bunx expo run:ios       # the Simulator shares the Mac's localhost
adb reverse tcp:8081 tcp:8081 && adb reverse tcp:5173 tcp:5173   # Android emulator or device, then:
REACT_NATIVE_PACKAGER_HOSTNAME=localhost bunx expo run:android
```

`EXPO_PUBLIC_BRIGADE_URL` (the dashboard's origin, such as `https://brigade.example.com`) overrides the server;
without it, a release build has no server and sign-in says so.

## Sign-in

- **Better Auth's Expo client** (`@better-auth/expo`, `src/lib/auth-client.ts`) signs in with email and password and
  keeps the session in secure storage (`expo-secure-store`: the Keychain on iOS, the Keystore on Android), so the app
  opens signed in offline; the workspace and role are remembered too (`brigade_workspace`) and read again once
  online. It sends the session back as a `Cookie` header it sets itself, and the app's scheme as
  `expo-origin` (`brigade://`), which the API trusts (`apps/api/src/auth.ts`). A QR sign-in's session is stored the
  same way, under that instance's prefix (`storeSessionCookie`). OAuth through the system browser comes later (RFC 0002).
- **The sync socket** (`src/lib/sync-client.ts`) sends the same `Cookie` header on the upgrade; the API checks it like
  the dashboard's and hands the shard the member (RFC 0004 "Socket topology"). One client per member and workspace
  (`src/components/session.tsx`), closed on sign-out, so no socket or row outlives its session.
- **Pages:** after sign-in the app registers the phone with `device.register` (its key, permission and APNs or FCM
  token, `src/lib/device.ts`); Sign out asks first, unregisters it (`device.unregister`, giving up after 5 s offline) and then
  ends the session. Offline it signs out on the phone only, keeps the session aside and finishes both once it is back
  online, before anyone else registers the phone (`src/lib/sign-out.ts`, RFC 0006 "A handed-over phone"). An Android
  build without Firebase (below) has no FCM token, so it shows "Not on this phone yet", muted.
- **Relay handles** (`src/lib/relay.ts`, RFC 0015 sections 2 and 7): before registering, the app reads the
  instance's `/api/config`. When it names this build's relay (below, "Your own app"), the app asks the relay for a
  handle (`POST /v1/handles`) and registers the handle instead of its tokens; it keeps the handle per instance and asks
  again only for a new push or VoIP token, a new relay or instance id, or a handle 30 days old (Q30). No relay, or a
  relay that does not answer: the raw tokens, as before.
- **Several instances** (`src/lib/instances.ts`, `src/lib/instance-clients.ts`, RFC 0015 section 5): up to 5, each
  with its own session (secure storage prefix `brigade:<id>`), workspaces, queue, handle and device key; the build's
  instance keeps the keys from before, so an existing install stays signed in. The app shows one; every other stays
  registered in the background on its own backoff. Pages, the Acknowledge and calls go to the instance the page sealed.
- **Adding, switching and removing instances** (RFC 0015 sections 5, 6 and 8): "Another instance" on the sign-in
  screen and "Add an instance" in the Account tab (`src/screens/add-instance.tsx`) take an address (HTTPS; a
  development build also takes `http://` on a private address, such as the dev server) or the dashboard's QR code
  (`src/screens/scan.tsx`, expo-camera's barcode scanner). The address is checked against its `/api/config` first
  (`src/lib/instance-address.ts`). `brigade://connect?server=<origin>[&code=<code>]`, from the system camera or the
  scanner, opens `src/screens/connect.tsx`; with a code it signs in by device approval (`src/lib/qr-sign-in.ts`):
  the phone shows a 2-digit number the member types on the dashboard. The Account tab lists every instance with its
  workspaces and paging state; each has a details sheet (`src/screens/instance-details.tsx`) with its relay and
  Remove. Try it against the dev server: `xcrun simctl openurl booted 'brigade://connect?server=http://localhost:5173'`.

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
vp run mobile:install --yes              # iOS, release against the hosted Brigade, no questions
vp run mobile:install --platform android --variant development --device Pixel
vp run mobile:build                      # eas build --local: a signed .ipa / .apk / .aab in ~/brigade-builds
vp run mobile:install --from ~/brigade-builds/brigade-ios-preview-<commit>.ipa
```

- **`mobile:install`** (`scripts/mobile-install.mjs`) runs `expo prebuild`, then `xcodebuild` or Gradle, then
  installs with `xcrun devicectl` (iPhone) or `adb` (Android device or emulator) and opens the app. The
  `development` variant is the dev client: start Metro (`vp run start` here) and `vp run dev` at the root; on
  Android the script runs `adb reverse` for both ports. The `release` variant (the default) embeds the JavaScript
  and talks to the hosted Brigade, the `EXPO_PUBLIC_BRIGADE_URL` repository variable the release workflow uses
  (read with `gh`); `EXPO_PUBLIC_BRIGADE_URL` in the environment points it elsewhere. It ignores a local `.env` and
  checks the built bundle points at that server. On Android it signs with the key in
  `~/.brigade/keystore.properties`, and refuses a production build without it (the debug key is public). Flags: `--device <name or id>`, `--clean`, `--no-build`,
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

## Over-the-air updates and CI builds

`expo-updates` is in the app: a release build checks the `production` channel (`preview` and `development` for those
profiles, `eas.json`) at launch, downloads a newer update in the background and runs it from the next launch, so a
change shows up within two cold launches. The runtime version is the native fingerprint (`runtimeVersion: { policy:
"fingerprint" }`): an update reaches only builds with the same native code, never one it could crash.

From `main`, `.github/workflows/mobile.yml` ships the app after CI passes, when it or a package it bundles changed
(RFC 0002 "Continuous delivery"). Per platform it computes the fingerprint: if a build with it was made there
before, it publishes an EAS Update to `production`; if not (a native dependency, a config plugin or `app.config.ts`
changed), it builds a production .ipa or .aab with `eas build --local` on GitHub's runners and keeps it as a run
artifact for 14 days. Install one from the run's artifacts with `vp run mobile:install --from <file>`.

- The fingerprint covers the app config, so the workflow pins what the config reads from the environment:
  `BRIGADE_APS_ENVIRONMENT=production` and `GOOGLE_SERVICES_FILE` in the runner's temp directory. A build made on
  your computer reads the Firebase file from another path, so its Android fingerprint differs and CI updates do not
  reach it; use the CI build for phones that should follow `main`.
- Repository settings: the `EXPO_TOKEN` secret (an EAS robot token), `GOOGLE_SERVICES_JSON` (the Firebase file's
  contents) and the `EXPO_PUBLIC_BRIGADE_URL` variable. Without them nothing ships: no server, no sign-in; no
  Firebase, no pages.
- Rolling an update back: `bunx eas-cli@latest update:republish --group <previous group id>` (`eas update:list`).

`android/` and `ios/` are generated from `app.config.ts` and gitignored; change native settings there, never in
the generated folders.

```bash
vp test                 # locale, theme, Intl-probe, server URLs, device registration, incident wording, widget snapshot and config plugins (Node)
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
  Keychain shared through the App Group `group.app.freecorps.brigade` (`group.<BRIGADE_APP_ID>`, "Your own app"); the
  extension
  (`modules/brigade-push/extension`) decrypts with it (HPKE, `packages/push` on the server side) or shows the
  fallback. `aps-environment` is `development` locally and `production` on EAS. For local builds signed for a
  device, set `APPLE_TEAM_ID` (never committed) and build with `xcodebuild -allowProvisioningUpdates`; the commands
  are in the S1 write-up.
- **"I'm on call" widget (iOS):** `plugins/widget.ts` adds the `BrigadeWidget` WidgetKit extension (home screen
  small, lock screen rectangular and inline) from `modules/brigade-widget/widget`, with the App Group and
  `Localizable.strings` generated from packages/i18n (`widget_*`). While a member is signed in,
  `src/components/widget.tsx` writes a snapshot of their on-call stretches and open incidents
  (`src/lib/widget.ts`: times, a count and the app's locale, no names or credentials) through the local module
  `modules/brigade-widget` into the App Group, and signing out clears it. The widget never reaches the network: it
  lays out an entry per handoff, so it flips on time with the app closed, and past 24 hours asks to open Brigade. The
  widget cannot run Paraglide, so it bundles its strings and the snapshot names the app's language, which the widget
  uses over the system's. Its decisions are in `src/lib/widget.ts` (tested) and mirrored in `WidgetState.swift`.
  The extension is its own target (`<BRIGADE_APP_ID>.Widget`, App Group `group.<BRIGADE_APP_ID>`; for the store app
  `app.freecorps.brigade.Widget` and `group.app.freecorps.brigade`), so the first EAS build after it needs its
  credentials once, interactively (`eas credentials -p ios`, or an interactive `eas build`): the App ID with App
  Groups on, and an ad hoc and an App Store profile for it. Until then a non-interactive build stops at the
  credentials step. A local build (`mobile:install`) has Xcode create the App ID, but without the App Group: assign
  `group.<BRIGADE_APP_ID>` to `<BRIGADE_APP_ID>.Widget` once in the Developer portal (Identifiers → App Groups →
  Configure), or the build stops on the widget's profile.
- **Critical Alerts (off):** `BRIGADE_CRITICAL_ALERTS=1` at build time adds the entitlement, asks for Critical Alerts
  with the notification permission and reports them in `device.register`; SEV1 pages then ring through silent mode
  on phones that allow them. Leave it unset until Apple grants the entitlement (RFC 0006 "Critical Alerts").
- **Pages as calls (spike S6):** the local module `modules/brigade-call` rings a page natively (Android: a
  self-managed `ConnectionService`, a `CallStyle` notification and a full-screen ringing screen; iOS: PushKit and
  CallKit), reads it aloud and takes the ack ("press 1"), and `plugins/incoming-call.ts` adds the `voip` background
  mode and the Android strings from `packages/i18n`. The development-only `/call-test` screen rings a test call;
  on Android, `adb shell am broadcast -a app.freecorps.brigade.call.DEBUG_RING -n
  <BRIGADE_APP_ID>/app.freecorps.brigade.call.DebugCallReceiver --es title … --es body … --es incident <id>`
  does the same from a shell (the package before the `/` is the app's, `app.freecorps.brigade` for the store app;
  the action and the class name stay as they are, being the module's). The paging decisions live in `src/lib/call-route.ts`, tested in CI, and the native code
  mirrors them; the Kotlin copy also has JVM tests: `./gradlew :brigade-call:testDebugUnitTest` in the prebuilt
  `android/` (with `ANDROID_HOME` set). See the S6 write-up.
- **Android pages (FCM):** `modules/brigade-push/android` keeps the device key in the Android Keystore and its
  `FirebaseMessagingService` opens each page, shows it on the "Pages" channel (or rings it through
  `modules/brigade-call`), opens the incident on a tap and posts the receipt (RFC 0006 "Android pages"). Its HPKE and
  payload parsing have JVM tests: `./gradlew :brigade-push:testDebugUnitTest` in the prebuilt `android/`. The build
  needs the Firebase project's `google-services.json`, which is never committed:
  1. In the Firebase console, create the project (or use the team's) and add an Android app with the package name
     `app.freecorps.brigade`.
  2. Download `google-services.json` outside the repository, to `~/.config/brigade/google-services.json` (picked up
     when it exists) or anywhere with `GOOGLE_SERVICES_FILE=/path/to/google-services.json` at build time
     (`plugins/google-services.ts` sets `android.googleServicesFile`). For EAS builds, upload it as a file
     environment variable named `GOOGLE_SERVICES_FILE`.
  3. Give the relay a service account of the same project (apps/relay/README.md, "Setting up FCM").

  Without the file the app builds and runs with no FCM: the account section says pages are not set up on the phone.

- **Autolinking:** `expo-router`'s optional peers (Reanimated, Worklets, Gesture Handler) are installed by Bun
  but excluded from autolinking until the app uses them.

## Your own app

A company that runs its own relay (`vp run setup:relay`, apps/api README "Push relay") can only page an app it built
and signed itself: Apple and Google deliver a push only with the publisher's keys. This is what that build needs; the
publishing (App Store, Google Play, TestFlight, an MDM or an internal store) is the company's. A stub until the store
app ships (RFC 0015 "Order of work" step 5):

- **Its own identifiers.** Set `BRIGADE_APP_ID` at build time (and for `vp run mobile:install`, which launches the
  app by it): the bundle id and Android package, `app.freecorps.brigade` when unset (`plugins/app-id.ts`). It must
  suit both stores: two or more parts of letters and digits, each starting with a letter (no `-`, which Android
  refuses, and no `_`, which Apple refuses); `vp run setup:relay --bundle-id` takes the same. Everything else follows
  it: the App Group the Notification Service Extension and the widget share with the app is `group.<BRIGADE_APP_ID>`,
  which the plugins put in the entitlements and in each target's Info.plist (`BrigadeAppGroup`, read by the Swift
  code), and the extensions' bundle ids are `<bundle id>.NotificationService` and `<bundle id>.Widget`. For EAS
  builds, set it as an environment variable of the build profile. The relay's topic (`RELAY_APNS_TOPIC`, which
  `vp run setup:relay` sets from `--bundle-id`) is that bundle id. After changing it on a machine that already has
  `ios/` and `android/`, prebuild with `--clean` (`mobile:install --clean`): a prebuild without it updates the
  extensions' bundle ids and drops the store app's App Group, but anything else left from the old id stays.
- **Apple:** an Apple Developer account with App IDs for the app and both extensions, the App Group, Push
  Notifications, VoIP (PushKit, for calls) and, if granted, Critical Alerts (`BRIGADE_CRITICAL_ALERTS=1`); an APNs key
  (`.p8`) for the relay. Local builds take the team id from `APPLE_TEAM_ID`.
- **Android:** a Firebase project with an Android app for the package, its `google-services.json` for the build
  (`GOOGLE_SERVICES_FILE`, "How it is wired" above) and a service account for the relay.
- **Its instance:** `EXPO_PUBLIC_BRIGADE_URL`, the dashboard's origin the build signs in to.
- **Its relay:** `EXPO_PUBLIC_BRIGADE_RELAY_URL`, the relay this build is paged through (`src/lib/relay.ts`
  `buildRelay`, Q32). Unset, a build whose `EXPO_PUBLIC_BRIGADE_URL` is not Freecorps' hosted Brigade takes the relay
  its instance's `/config` names (`relay.origin`), so a company's build rarely sets it; the store build uses
  `https://relay.brigade.freecorps.com.br`. The app asks that relay for handles only for instances whose `/config`
  names it; an instance on another relay pages through its own app, so this one registers nothing there. An instance
  with no relay in `/config`, or a relay that does not answer, gets the raw tokens, which it pages through the relay's
  `/send` with `RELAY_SEND_TOKEN` (the setup script sets it on both).
- **Store accounts and EAS:** the `owner`, EAS project id and update URL in `app.config.ts` are Freecorps'; the
  company's copy points them at its own Expo account (`eas init`), and its own App Store Connect and Google Play
  accounts for `eas submit`.

Its store link, given to the setup script (`RELAY_APP_URL`), lets the store app send people to it when they add the
instance (RFC 0015 section 8).

## Windows

Native Android builds fail on the 260-character path limit with the Android SDK's default CMake (3.22.1, Ninja
1.10). Install CMake 3.31.6 from the Android SDK repository and point the generated project at it in
`android/local.properties` (`cmake.dir=…`). If the emulator cannot reach Metro over the network, run
`adb reverse tcp:8081 tcp:8081` and open the app against `127.0.0.1`.
