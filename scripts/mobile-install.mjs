#!/usr/bin/env node
// Builds apps/mobile on this computer and installs it on a phone plugged into (or paired with) it. No EAS build,
// no build credits.
//
//   vp run mobile:install                               asks: platform, variant, phone
//   vp run mobile:install --yes                         iOS (Android off macOS), release against production, no questions
//   vp run mobile:install --platform android --variant development
//   vp run mobile:install --device "Pixel"              part of the name, or the UDID / adb serial
//   vp run mobile:install --clean                       regenerate the native project first
//   vp run mobile:install --no-build                    reinstall the last build
//   vp run mobile:install --build-only                  build, install nothing
//   vp run mobile:install --from <file.ipa|file.apk>    install an artifact from `vp run mobile:build`
//
// Variants:
//   development  the dev client (Debug): loads JavaScript from Metro (`vp run --filter @freecorps/brigade-mobile
//                start`), and in development the app signs in and syncs through the dev server on the Metro host.
//   release      Release with the JavaScript embedded, no Metro, against the hosted Brigade: the
//                EXPO_PUBLIC_BRIGADE_URL repository variable the release workflow builds with (read with `gh`).
//                EXPO_PUBLIC_BRIGADE_URL in the environment points it at another origin instead. A local .env is
//                ignored, and the script checks the built bundle points where it should.
//
// iOS needs macOS with Xcode, so elsewhere Android is the default. iOS signs with Xcode automatic signing: an
// Apple account signed into Xcode (Settings > Accounts) with a paid team, picked from Xcode's accounts when
// there is one, else from --team or IOS_TEAM_ID. xcodebuild registers the phone and makes the development
// profile itself. With the App Store Connect API key in EXPO_ASC_API_KEY_PATH / EXPO_ASC_KEY_ID /
// EXPO_ASC_ISSUER_ID (the variables EAS reads), xcodebuild provisions every target without an account in Xcode.
// IOS_XCODE (a path to an Xcode.app) overrides the newest installed Xcode.
//
// Android needs the Android SDK (ANDROID_HOME, or Android Studio's default location) and a JDK (JAVA_HOME, or the
// one bundled with Android Studio). A release build against production is signed with the key in
// ~/.brigade/keystore.properties (storeFile, storePassword, keyAlias, keyPassword): the debug key is public, and an
// APK signed with it could replace the app and keep its signed-in session. Development builds use the debug key,
// so they cannot update an install signed with another key (and the other way round): uninstall first.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { extname, join } from "node:path";
import {
  androidToolchain,
  appId,
  capture,
  choose,
  mobile,
  parseOptions,
  root,
  run,
  xcode,
} from "./lib/mobile.mjs";

const options = parseOptions(import.meta.url, {
  platform: { type: "string" },
  variant: { type: "string" },
  device: { type: "string" },
  team: { type: "string", default: process.env.IOS_TEAM_ID },
  from: { type: "string" },
  yes: { type: "boolean", short: "y", default: false },
  clean: { type: "boolean", default: false },
  "no-build": { type: "boolean", default: false },
  "build-only": { type: "boolean", default: false },
  "no-launch": { type: "boolean", default: false },
});
const interactive = process.stdin.isTTY && !options.yes;
const building = !options["no-build"] && !options.from;
const releaseKeystore = join(homedir(), ".brigade/keystore.properties");

/**
 * The server a release build talks to: EXPO_PUBLIC_BRIGADE_URL from the environment, else the repository variable
 * the release workflow (.github/workflows/mobile.yml) builds with.
 */
function releaseServer() {
  const own = process.env.EXPO_PUBLIC_BRIGADE_URL?.trim();
  if (own) return { url: own, production: false };
  let url = "";
  try {
    url = capture("gh", ["variable", "get", "EXPO_PUBLIC_BRIGADE_URL"]).trim();
  } catch {
    // Said below.
  }
  assert.ok(
    url,
    "Could not read the EXPO_PUBLIC_BRIGADE_URL repository variable with `gh` (install it and run `gh auth login`), or set EXPO_PUBLIC_BRIGADE_URL to the server's origin.",
  );
  return { url, production: true };
}

async function chooseDevice(devices, kind) {
  const label = (item) => `${item.name} (${item.model}${item.os ? `, ${item.os}` : ""}) ${item.id}`;
  const list = devices.map((item) => `  ${label(item)}`).join("\n");
  if (options.device) {
    const wanted = options.device.toLowerCase();
    // An exact id or name wins over a partial name, so "Pixel" can pick "Pixel" next to "Pixel 9".
    const exact = devices.filter(
      (item) => item.id.toLowerCase() === wanted || item.name.toLowerCase() === wanted,
    );
    const match = exact.length
      ? exact
      : devices.filter((item) => item.name.toLowerCase().includes(wanted));
    assert.ok(
      match.length === 1,
      `--device ${options.device} matches ${match.length} of these:\n${list || "  (none)"}`,
    );
    return match[0];
  }
  if (devices.length === 1) return devices[0];
  assert.ok(
    devices.length,
    kind === "ios"
      ? "No paired iPhone found. Plug it in (or pair it once in Xcode for Wi-Fi) and unlock it."
      : "No Android phone found. Turn on USB debugging (Settings > Developer options), plug it in and accept the prompt, or start an emulator.",
  );
  assert.ok(interactive, `Several phones are connected; pass --device <name or id>:\n${list}`);
  const id = await choose(
    interactive,
    "Which phone?",
    devices.map((item) => ({ value: item.id, label: label(item) })),
    devices[0].id,
  );
  return devices.find((item) => item.id === id);
}

/** The paid team Xcode has an account for; a Personal Team cannot provision the Freecorps App ID. */
function iosTeam() {
  if (options.team) return options.team;
  let teams = [];
  try {
    const plist = capture("defaults", ["export", "com.apple.dt.Xcode", "-"]);
    const json = capture(
      "plutil",
      ["-extract", "IDEProvisioningTeamByIdentifier", "json", "-o", "-", "-"],
      {
        input: plist,
      },
    );
    teams = Object.values(JSON.parse(json))
      .flat()
      .filter((team) => !team.isFreeProvisioningTeam);
  } catch {
    // No account in Xcode: the message below says what to do.
  }
  const ids = [...new Set(teams.map((team) => team.teamID))];
  assert.ok(
    ids.length === 1,
    ids.length
      ? `Xcode has several paid teams (${teams.map((team) => team.teamName).join(", ")}); pass --team <team id> or set IOS_TEAM_ID.`
      : "No paid Apple team in Xcode. Sign in under Xcode > Settings > Accounts, or pass --team <team id>.",
  );
  return ids[0];
}

/**
 * One `devicectl list devices` entry. devicectl marks `hardwareProperties`, `deviceProperties` and
 * `connectionProperties` deprecated in favour of `properties`, so read that first and fall back to the old fields.
 */
function iosDevice(item) {
  const hardware = item.properties?.hardware ?? item.hardwareProperties ?? {};
  const connection = item.properties?.connection ?? item.connectionProperties ?? {};
  const device = item.properties?.device ?? item.deviceProperties ?? {};
  const mode = item.properties?.state?.developerModeStatus ?? device.developerModeStatus;
  return {
    physical: hardware.reality === "physical" && hardware.platform === "iOS",
    paired: connection.pairingState === "paired",
    // `state` replaces `tunnelState` with the same values; a USB phone with no tunnel yet is "disconnected".
    reachable: (connection.state ?? connection.tunnelState) !== "unavailable",
    id: hardware.udid,
    name: device.name ?? "iPhone",
    model: hardware.marketingName,
    os: `iOS ${device.osVersionNumber ?? "?"}`,
    // "enabled" in the old shape, `{ enabled: { … } }` in the new one.
    developerMode:
      mode === "enabled" || (typeof mode === "object" && mode !== null && "enabled" in mode),
  };
}

async function installIos(variant, target) {
  const { name: xcodeName, developerDir } = xcode();
  const env = { ...process.env, DEVELOPER_DIR: developerDir };
  const buildEnv = { ...env, ...target, EXPO_NO_DOTENV: "1" };

  let device;
  if (!options["build-only"]) {
    // A private temp folder, removed even when devicectl or the JSON fails.
    const dir = await mkdtemp(join(tmpdir(), "brigade-devices-"));
    let paired;
    try {
      const file = join(dir, "devices.json");
      capture("xcrun", ["devicectl", "list", "devices", "--json-output", file], { env });
      paired = JSON.parse(readFileSync(file, "utf8"))
        .result.devices.map(iosDevice)
        .filter((item) => item.physical && item.paired);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    // A phone paired over Wi-Fi stays paired when it is away; only reachable ones can take an install.
    const phones = paired.filter((item) => item.reachable);
    assert.ok(
      phones.length || !paired.length,
      `No reachable iPhone. Paired but away: ${paired.map((item) => item.name).join(", ")}. Plug it in or bring it onto this Wi-Fi, unlocked.`,
    );
    device = await chooseDevice(phones, "ios");
    assert.ok(
      device.developerMode,
      `Turn on Developer Mode on ${device.name}: Settings > Privacy & Security > Developer Mode.`,
    );
    console.log(`\nPhone: ${device.name} (${device.model}, ${device.os})`);
  }

  const configuration = variant === "release" ? "Release" : "Debug";
  const derived = join(mobile, "ios/build");
  let app = options.from ?? join(derived, `Build/Products/${configuration}-iphoneos/Brigade.app`);
  if (building) {
    const team = iosTeam();
    await prebuild("ios", buildEnv);
    await mkdir(join(derived, "logs"), { recursive: true });
    const log = join(derived, "logs/xcodebuild.log");
    await rm(app, { recursive: true, force: true });
    console.log(
      `\nBuilding ${configuration} with ${xcodeName} (several minutes on a cold cache; log: ${log}).`,
    );
    await run(
      "xcodebuild",
      [
        "-workspace",
        "Brigade.xcworkspace",
        "-scheme",
        "Brigade",
        "-configuration",
        configuration,
        "-destination",
        "generic/platform=iOS",
        "-derivedDataPath",
        derived,
        "-allowProvisioningUpdates",
        "-allowProvisioningDeviceRegistration",
        ...appStoreConnectKeyArgs(),
        `DEVELOPMENT_TEAM=${team}`,
        "CODE_SIGN_STYLE=Automatic",
        "build",
      ],
      { cwd: join(mobile, "ios"), env: buildEnv, log },
    ).catch((error) => {
      // Seen with a newly installed Xcode beta, which saw no account although another Xcode had one.
      throw new Error(
        `${error.message}\nIf it says "No Accounts", sign in to ${xcodeName} (Settings > Accounts) with the Apple account of the Freecorps team, or build with EAS's credentials instead: vp run mobile:build --platform ios, then --from <the .ipa>.`,
      );
    });
  }
  assert.ok(existsSync(app), `${app} is missing; build first (drop --no-build).`);
  if (variant === "release") assertServer(readFileSync(join(app, "main.jsbundle")), target);
  if (!device) return console.log(`\nBuilt ${app}`);

  console.log(`\nInstalling on ${device.name}.`);
  // devicectl installs an app bundle (.app): unpack an .ipa from `mobile:build` first.
  const unpacked =
    extname(app).toLowerCase() === ".ipa"
      ? await mkdtemp(join(tmpdir(), "brigade-ipa-"))
      : undefined;
  try {
    if (unpacked) {
      await run("ditto", ["-x", "-k", app, unpacked]);
      const payload = join(unpacked, "Payload");
      const bundle =
        existsSync(payload) && readdirSync(payload).find((name) => name.endsWith(".app"));
      assert.ok(bundle, `${app} has no Payload/*.app inside.`);
      app = join(payload, bundle);
    }
    await run("xcrun", ["devicectl", "device", "install", "app", "--device", device.id, app], {
      env,
    });
  } finally {
    if (unpacked) await rm(unpacked, { recursive: true, force: true });
  }
  if (!options["no-launch"]) {
    await run(
      "xcrun",
      [
        "devicectl",
        "device",
        "process",
        "launch",
        "--device",
        device.id,
        "--terminate-existing",
        appId,
      ],
      { env },
    ).catch(() =>
      console.warn("Installed, but could not open it: unlock the phone and tap Brigade."),
    );
  }
}

/**
 * Lets xcodebuild create and refresh the development profiles of every target (the app, the Notification Service
 * Extension, the widget) without an Apple account in Xcode, through the App Store Connect API key EAS uses too.
 * Without EAS's variables Xcode falls back to its signed-in account.
 */
function appStoreConnectKeyArgs() {
  const {
    EXPO_ASC_API_KEY_PATH: path,
    EXPO_ASC_KEY_ID: id,
    EXPO_ASC_ISSUER_ID: issuer,
  } = process.env;
  if (!path || !id || !issuer) return [];
  assert.ok(existsSync(path), `EXPO_ASC_API_KEY_PATH points at ${path}, which does not exist.`);
  return [
    "-authenticationKeyPath",
    path,
    "-authenticationKeyID",
    id,
    "-authenticationKeyIssuerID",
    issuer,
  ];
}

async function installAndroid(variant, target, production) {
  assert.ok(
    !building || !production || existsSync(releaseKeystore),
    `${releaseKeystore} not found. A release build against production needs the release key: the debug key is public. Add it, or point EXPO_PUBLIC_BRIGADE_URL at another server.`,
  );
  const toolchain = androidToolchain();
  const { adb } = toolchain;
  assert.ok(
    existsSync(adb),
    `${adb} is missing; install "Android SDK Platform-Tools" from Android Studio's SDK Manager.`,
  );
  const env = { ...process.env, ...toolchain.env };
  const buildEnv = { ...env, ...target, EXPO_NO_DOTENV: "1" };

  let device;
  if (!options["build-only"]) {
    const lines = capture(adb, ["devices", "-l"]).split(/\r?\n/).slice(1).filter(Boolean);
    const unauthorized = lines.filter((line) => /\bunauthorized\b/.test(line));
    const phones = lines
      .filter((line) => /\sdevice\s/.test(`${line} `))
      .map((line) => {
        const id = line.split(/\s+/)[0];
        const model = /model:(\S+)/.exec(line)?.[1]?.replace(/_/g, " ") ?? "Android";
        // A phone that drops off mid-listing should not hide the others.
        let version = "";
        try {
          version = capture(adb, ["-s", id, "shell", "getprop", "ro.build.version.release"]).trim();
        } catch {
          // Label it without.
        }
        return { id, name: model, model: version ? `Android ${version}` : "Android" };
      });
    if (!phones.length && unauthorized.length) {
      throw new Error(
        "The phone has not allowed this computer yet: unlock it and accept the USB debugging prompt.",
      );
    }
    device = await chooseDevice(phones, "android");
    console.log(`\nPhone: ${device.name} (${device.model})`);
  }

  const android = join(mobile, "android");
  const type = variant === "release" ? "release" : "debug";
  const apk = options.from ?? join(android, `app/build/outputs/apk/${type}/app-${type}.apk`);
  if (building) {
    await prebuild("android", buildEnv);
    if (type === "release") applyReleaseSigning(join(android, "app/build.gradle"));
    await mkdir(join(android, "build/logs"), { recursive: true });
    const log = join(android, "build/logs/gradle.log");
    await rm(apk, { force: true });
    console.log(`\nBuilding the ${type} APK (several minutes on a cold cache; log: ${log}).`);
    // The template's 2 GB heap can run D8 out of memory merging the Release dex.
    await run(
      join(android, process.platform === "win32" ? "gradlew.bat" : "gradlew"),
      [
        `assemble${type === "release" ? "Release" : "Debug"}`,
        "--console=plain",
        "-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g",
      ],
      { cwd: android, env: buildEnv, log },
    );
  }
  assert.ok(existsSync(apk), `${apk} is missing; build first (drop --no-build).`);
  if (variant === "release") {
    // The APK is a zip; the bundle is one entry of it.
    assertServer(
      execFileSync("unzip", ["-p", apk, "assets/index.android.bundle"], {
        maxBuffer: 256 * 1024 * 1024,
      }),
      target,
    );
  }
  if (!device) return console.log(`\nBuilt ${apk}`);

  console.log(`\nInstalling on ${device.name}.`);
  await run(adb, ["-s", device.id, "install", "-r", apk]).catch((error) => {
    throw new Error(
      `${error.message}\nIf it says INSTALL_FAILED_UPDATE_INCOMPATIBLE, the installed app was signed with another key (an EAS build, or another computer): uninstall Brigade from the phone and run again.`,
    );
  });
  if (variant !== "release") {
    // Metro (8081) and the dashboard's dev server (5173) on this computer, as `localhost` on the phone.
    for (const port of ["8081", "5173"]) {
      await run(adb, ["-s", device.id, "reverse", `tcp:${port}`, `tcp:${port}`]).catch(() =>
        console.warn(
          `Installed, but could not forward port ${port}: run adb reverse tcp:${port} tcp:${port}.`,
        ),
      );
    }
  }
  if (!options["no-launch"]) {
    // `monkey` exits with an error on Android 16 emulators, so start the launcher activity by name.
    const shell = ["-s", device.id, "shell"];
    try {
      const activity = capture(adb, [
        ...shell,
        "cmd",
        "package",
        "resolve-activity",
        "--brief",
        "-c",
        "android.intent.category.LAUNCHER",
        appId,
      ])
        .trim()
        .split(/\r?\n/)
        .pop();
      await run(adb, [...shell, "am", "start", "-n", activity], {
        log: join(tmpdir(), "brigade-launch.log"),
      });
    } catch {
      console.warn("Installed, but could not open it: unlock the phone and tap Brigade.");
    }
  }
}

/** `expo prebuild` rewrites android/ from the template, so this runs after every one. */
function applyReleaseSigning(gradleFile) {
  if (!existsSync(releaseKeystore)) {
    console.warn(`\n${releaseKeystore} not found: signing Release with the debug key.`);
    return;
  }
  let gradle = readFileSync(gradleFile, "utf8");
  if (gradle.includes("brigadeKeystoreProps")) return;
  const debugConfig = /( {8}debug \{\n {12}storeFile file\('debug\.keystore'\)[\s\S]*? {8}\}\n)/;
  const releaseUsesDebug =
    /( {8}release \{\n(?: {12}\/\/.*\n)*) {12}signingConfig signingConfigs\.debug/;
  assert.ok(
    debugConfig.test(gradle) && releaseUsesDebug.test(gradle) && gradle.includes("\nandroid {"),
    "android/app/build.gradle no longer matches the template this script patches; update applyReleaseSigning.",
  );
  gradle = gradle
    .replace(
      debugConfig,
      `$1        release {
            storeFile file(brigadeKeystoreProps.getProperty('storeFile'))
            storePassword brigadeKeystoreProps.getProperty('storePassword')
            keyAlias brigadeKeystoreProps.getProperty('keyAlias')
            keyPassword brigadeKeystoreProps.getProperty('keyPassword')
        }
`,
    )
    .replace(releaseUsesDebug, "$1            signingConfig signingConfigs.release")
    .replace(
      "\nandroid {",
      `
def brigadeKeystoreProps = new Properties()
new File(System.getProperty('user.home'), '.brigade/keystore.properties').withInputStream { brigadeKeystoreProps.load(it) }

android {`,
    );
  writeFileSync(gradleFile, gradle);
  console.log("Signing Release with the key in ~/.brigade.");
}

/** A reused build (or a stale native project) could point at another server. */
function assertServer(bundle, target) {
  assert.ok(
    bundle.includes(target.EXPO_PUBLIC_BRIGADE_URL),
    `The build does not point at ${target.EXPO_PUBLIC_BRIGADE_URL}; rebuild without --no-build.`,
  );
}

async function prebuild(platform, env) {
  if (!existsSync(join(root, "node_modules"))) await run("bun", ["install", "--frozen-lockfile"]);
  console.log(`\nGenerating the native project${options.clean ? " from scratch" : ""}.`);
  await run(
    "bunx",
    ["expo", "prebuild", "--platform", platform, ...(options.clean ? ["--clean"] : [])],
    {
      cwd: mobile,
      env,
    },
  );
}

try {
  const fromPlatform =
    options.from &&
    { ".apk": "android", ".ipa": "ios", ".app": "ios" }[extname(options.from).toLowerCase()];
  if (options.from) {
    assert.ok(fromPlatform, `--from takes an .apk, .ipa or .app, not ${options.from}.`);
    assert.ok(
      !options.variant,
      "--variant does not apply to --from: the artifact is already built.",
    );
  }
  const platform =
    options.platform ??
    fromPlatform ??
    (await choose(
      interactive,
      "Platform?",
      [
        { value: "ios", label: "iOS" },
        { value: "android", label: "Android" },
      ],
      process.platform === "darwin" ? "ios" : "android",
    ));
  assert.ok(
    ["ios", "android"].includes(platform),
    `--platform must be ios or android, not ${platform}.`,
  );
  if (options.from) {
    assert.ok(existsSync(options.from), `--from ${options.from} does not exist.`);
    assert.ok(platform === fromPlatform, `--from ${options.from} is not an ${platform} build.`);
  }
  const variant = options.from
    ? "artifact"
    : (options.variant ??
      (await choose(
        interactive,
        "Variant?",
        [
          { value: "release", label: "Release (JavaScript embedded, against the hosted Brigade)" },
          { value: "development", label: "Development (dev client; JavaScript from Metro)" },
        ],
        "release",
      )));
  assert.ok(
    ["development", "release", "artifact"].includes(variant),
    `--variant must be development or release, not ${variant}.`,
  );
  const server = variant === "release" ? releaseServer() : undefined;
  // eas.json's production profile sets the same pair.
  const target = server
    ? {
        EXPO_PUBLIC_BRIGADE_URL: server.url,
        EXPO_PUBLIC_BRIGADE_ENV: server.production ? "production" : "development",
      }
    : {};
  console.log(
    `\n${platform === "ios" ? "iOS" : "Android"}, ${options.from ?? variant}${server ? ` against ${server.url}${server.production ? " (production)" : ""}` : ""}.`,
  );
  await (platform === "ios"
    ? installIos(variant, target)
    : installAndroid(variant, target, server?.production));
  if (variant === "development" && !options["build-only"]) {
    console.log(
      "\nStart Metro with `vp run --filter @freecorps/brigade-mobile start` and the dev server with `vp run dev`.",
    );
  }
  console.log("\nDone.");
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
}
