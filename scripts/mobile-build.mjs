#!/usr/bin/env node
// Builds a distributable apps/mobile artifact on this computer with `eas build --local`: EAS's own build steps run
// here, with the credentials EAS keeps (Android upload keystore, iOS distribution certificate and profiles). No
// EAS build credits; EAS only serves credentials and, later, submission.
//
//   vp run mobile:build                                  asks: platform, profile
//   vp run mobile:build --platform android --profile preview --yes
//   vp run mobile:build --platform ios --profile production
//   vp run mobile:build --out <dir>                      instead of BRIGADE_BUILDS_DIR or ~/brigade-builds
//
// Profiles are eas.json's: `development` (dev client, internal), `preview` (internal, Release) and `production`
// (store; its build number is incremented on EAS). Internal iOS builds are ad hoc: they install only on iPhones
// registered with `eas device:create` before the build. Android internal builds are APKs, production an AAB.
//
// Artifacts land outside the repository, in BRIGADE_BUILDS_DIR or ~/brigade-builds, named
// brigade-<platform>-<profile>-<commit>.<ext>: they survive `git clean` and worktree removal, every worktree
// shares them, and they cannot be committed. Install one with `vp run mobile:install --from <file>`; submit a
// production one with `eas submit --path <file>` (store submission waits for roadmap Phase 4).
//
// iOS needs macOS with Xcode, fastlane and CocoaPods. A production build uses the newest released Xcode (App Store
// Connect rejects beta builds); IOS_XCODE overrides. Android needs the Android SDK and a JDK, found as
// mobile:install finds them.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { androidToolchain, capture, choose, mobile, run, xcode } from "./lib/mobile.mjs";

const { values: options } = parseArgs({
  options: {
    platform: { type: "string" },
    profile: { type: "string" },
    out: {
      type: "string",
      default: process.env.BRIGADE_BUILDS_DIR || join(homedir(), "brigade-builds"),
    },
    yes: { type: "boolean", short: "y", default: false },
  },
});
const interactive = process.stdin.isTTY && !options.yes;
const eas = JSON.parse(readFileSync(join(mobile, "eas.json"), "utf8"));

/** A profile's setting, following `extends` like EAS does. */
function profileSetting(name, read) {
  for (let profile = eas.build[name]; profile; profile = eas.build[profile.extends]) {
    const value = read(profile);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** What EAS writes: an .ipa for devices, an APK or an AAB (the default, except for dev clients). */
function extension(platform, profile) {
  if (platform === "ios") return "ipa";
  const type = profileSetting(profile, (item) => item.android?.buildType);
  if (type) return type === "apk" ? "apk" : "aab";
  return profileSetting(profile, (item) => item.developmentClient) ? "apk" : "aab";
}

/** The commit the artifact is built from, marked when the tree has changes on top of it. */
function revision() {
  const sha = capture("git", ["rev-parse", "--short", "HEAD"]).trim();
  return capture("git", ["status", "--porcelain"]).trim() ? `${sha}-dirty` : sha;
}

/**
 * EAS's local build plugin, installed with Bun outside the repository. eas-cli otherwise starts it with `npx` from
 * apps/mobile, and npm refuses to run under the root `devEngines`, which names Bun. Its version follows eas-cli's.
 */
async function localBuildPlugin(version) {
  const dir = join(tmpdir(), "brigade-eas-build-plugin", version);
  const bin = join(dir, "node_modules/.bin/eas-cli-local-build-plugin");
  if (!existsSync(bin)) {
    await mkdir(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), '{ "private": true }\n');
    await run("bun", ["add", `eas-cli-local-build-plugin@${version}`], { cwd: dir });
  }
  return bin;
}

try {
  const platform =
    options.platform ??
    (await choose(
      interactive,
      "Platform?",
      [
        { value: "ios", label: "iOS (.ipa)" },
        { value: "android", label: "Android (.apk or .aab)" },
      ],
      process.platform === "darwin" ? "ios" : "android",
    ));
  assert.ok(
    ["ios", "android"].includes(platform),
    `--platform must be ios or android, not ${platform}.`,
  );
  const profiles = Object.keys(eas.build).filter((name) => name !== "base");
  const profile =
    options.profile ??
    (await choose(
      interactive,
      "Profile?",
      profiles.map((name) => ({ value: name, label: name })),
      "preview",
    ));
  assert.ok(
    profiles.includes(profile),
    `--profile must be one of ${profiles.join(", ")}, not ${profile}.`,
  );

  const env = { ...process.env };
  if (platform === "ios") {
    const picked = xcode({ release: profile === "production" });
    env.DEVELOPER_DIR = picked.developerDir;
    console.log(`\nXcode: ${picked.name}`);
  } else {
    Object.assign(env, androidToolchain().env);
  }

  // One eas-cli version for the build and its plugin.
  const easVersion = /eas-cli\/(\S+)/.exec(capture("bunx", ["eas-cli@latest", "--version"]))?.[1];
  assert.ok(easVersion, "Could not read eas-cli's version from `bunx eas-cli@latest --version`.");
  env.EAS_LOCAL_BUILD_PLUGIN_PATH = await localBuildPlugin(easVersion);

  const out = resolve(options.out);
  await mkdir(out, { recursive: true });
  const artifact = join(
    out,
    `brigade-${platform}-${profile}-${revision()}.${extension(platform, profile)}`,
  );
  console.log(
    `\nBuilding ${platform} ${profile} locally with eas build --local (several minutes).`,
  );
  await run(
    "bunx",
    [
      `eas-cli@${easVersion}`,
      "build",
      "--local",
      "--platform",
      platform,
      "--profile",
      profile,
      "--output",
      artifact,
      ...(interactive ? [] : ["--non-interactive"]),
    ],
    { cwd: mobile, env },
  );
  assert.ok(existsSync(artifact), `eas build finished but ${artifact} is missing.`);
  console.log(`\nBuilt ${artifact}`);
  if (profile === "production") {
    console.log(
      `Submit it (roadmap Phase 4, after the CLA): cd apps/mobile && bunx eas-cli@latest submit --platform ${platform} --profile production --path ${artifact}`,
    );
  } else {
    console.log(`Install it: vp run mobile:install --from ${artifact}`);
  }
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
}
