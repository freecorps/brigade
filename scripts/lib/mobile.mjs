// Shared by scripts/mobile-install.mjs and scripts/mobile-build.mjs: prompts, child processes, and finding Xcode,
// the Android SDK and a JDK on this machine.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const mobile = join(root, "apps/mobile");
/**
 * The bundle id rule both stores accept: `APP_ID_PATTERN` in apps/mobile/plugins/app-id.ts, copied rather than imported
 * (Node would warn on every run: apps/mobile is not `"type": "module"`); a test there keeps the two the same.
 */
export const APP_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/;
/** The build's bundle id and Android package: `BRIGADE_APP_ID`, else the store app's. */
export const appId = (() => {
  const value = process.env.BRIGADE_APP_ID?.trim();
  if (!value) return "app.freecorps.brigade";
  if (!APP_ID_PATTERN.test(value)) {
    console.error(
      `BRIGADE_APP_ID ${JSON.stringify(value)} is not a bundle id both stores accept (com.acme.brigade: letters and digits, each part starting with a letter, no - or _).`,
    );
    process.exit(1);
  }
  return value;
})();
const windows = process.platform === "win32";

/**
 * The script's options. `--help` prints the usage at the top of the script (its leading `//` comment); an unknown
 * option prints a one-line error instead of a stack trace.
 */
export function parseOptions(scriptUrl, options) {
  const usage = () =>
    readFileSync(fileURLToPath(scriptUrl), "utf8")
      .split(/\r?\n/)
      .slice(1)
      .filter((line, index, lines) => lines.slice(0, index + 1).every((l) => l.startsWith("//")))
      .map((line) => line.replace(/^\/\/ ?/, ""))
      .join("\n");
  try {
    const { values } = parseArgs({
      options: { ...options, help: { type: "boolean", short: "h", default: false } },
    });
    if (values.help) {
      console.log(usage());
      process.exit(0);
    }
    return values;
  } catch (error) {
    console.error(`${error.message}\n\n${usage()}`);
    process.exit(2);
  }
}

/** Asks on a terminal; without one (or with --yes) takes the default. */
export async function choose(interactive, question, choices, fallback) {
  if (!interactive) return fallback;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`\n${question}`);
    choices.forEach((choice, index) =>
      console.log(
        `  ${index + 1}) ${choice.label}${choice.value === fallback ? " (default)" : ""}`,
      ),
    );
    for (;;) {
      const answer = (await prompt.question("> ")).trim();
      if (!answer) return fallback;
      const picked =
        choices[Number(answer) - 1] ?? choices.find((choice) => choice.value === answer);
      if (picked) return picked.value;
    }
  } finally {
    prompt.close();
  }
}

/** Runs a command with inherited output, or into `log` with the errors printed on failure. */
export function run(command, args, { cwd = root, env = process.env, log } = {}) {
  const name = `${command} ${args[0] ?? ""}`.trim();
  // Node refuses to spawn .bat/.cmd files without a shell. Quote every part ourselves and pass the line verbatim:
  // `/s` strips only the outer pair, so arguments with spaces (Gradle's jvmargs, paths) survive. Not yet run on
  // Windows.
  let verbatim = false;
  if (windows && /\.(bat|cmd)$/i.test(command)) {
    const quote = (part) => `"${String(part).replace(/"/g, '""')}"`;
    [command, args] = [
      "cmd.exe",
      ["/d", "/s", "/c", `"${[command, ...args].map(quote).join(" ")}"`],
    ];
    verbatim = true;
  }
  return new Promise((done, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsVerbatimArguments: verbatim,
      stdio: ["inherit", log ? "pipe" : "inherit", log ? "pipe" : "inherit"],
    });
    const output = log ? createWriteStream(log) : null;
    child.stdout?.pipe(output, { end: false });
    child.stderr?.pipe(output, { end: false });
    child.once("error", reject);
    child.once("close", async (code) => {
      // Read the log only once everything piped into it is on disk.
      if (output) await new Promise((flushed) => output.end(flushed));
      if (code === 0) return done();
      if (log) {
        const lines = (await readFile(log, "utf8").catch(() => "")).split(/\r?\n/);
        const errors = lines
          .filter((line) => /error:|\*\* BUILD FAILED \*\*|FAILURE:|What went wrong/.test(line))
          .slice(-20);
        console.error((errors.length ? errors : lines.slice(-40)).join("\n"));
      }
      reject(new Error(`${name} exited ${code}${log ? `; full log: ${log}` : ""}`));
    });
  });
}

/** A command's standard output; `input`, when given, is its standard input. */
export function capture(command, args, { env = process.env, input } = {}) {
  return execFileSync(command, args, {
    cwd: root,
    env,
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  }).toString();
}

const firstExisting = (paths) => paths.find((path) => path && existsSync(path));

/** A path set by hand wins, and a wrong one fails rather than quietly picking another install. */
function fromEnv(name) {
  const value = process.env[name]?.trim();
  assert.ok(!value || existsSync(value), `${name} points at ${value}, which does not exist.`);
  return value || undefined;
}

/**
 * The Xcode to build and install with: IOS_XCODE (a path to an Xcode.app), else the newest one in /Applications,
 * which also has device support for the newest iPhones. With `release`, betas are skipped: App Store Connect
 * rejects builds made with a beta Xcode. Expo SDK 58's template has a UIScene delegate, so the iOS 27 SDK is fine.
 */
export function xcode({ release = false } = {}) {
  assert.ok(
    process.platform === "darwin",
    "iOS builds need macOS with Xcode. Use --platform android here.",
  );
  const chosen = fromEnv("IOS_XCODE");
  if (chosen)
    return {
      path: chosen,
      name: chosen.split("/").pop(),
      developerDir: join(chosen, "Contents/Developer"),
    };
  const xcodes = readdirSync("/Applications")
    .filter((name) => /^Xcode.*\.app$/.test(name))
    .flatMap((name) => {
      const path = join("/Applications", name);
      const plist = join(path, "Contents/version.plist");
      const read = (key) => capture("plutil", ["-extract", key, "raw", "-o", "-", plist]).trim();
      try {
        // Beta builds end in a letter (27A5252f); releases do not (17F42).
        return [
          {
            path,
            name,
            version: read("CFBundleShortVersionString"),
            beta: /[a-z]$/.test(read("ProductBuildVersion")),
          },
        ];
      } catch {
        // Half-installed (no version.plist yet): skip it rather than stop.
        return [];
      }
    })
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  assert.ok(xcodes.length, "Install Xcode from the App Store (or set IOS_XCODE).");
  const picked = release ? xcodes.find((item) => !item.beta) : xcodes[0];
  assert.ok(
    picked,
    "Store builds need a released Xcode, and only betas are installed. Install one (or set IOS_XCODE).",
  );
  return { ...picked, developerDir: join(picked.path, "Contents/Developer") };
}

/** The Android SDK and a JDK, from ANDROID_HOME / JAVA_HOME or Android Studio's defaults. */
export function androidToolchain() {
  const sdk = firstExisting([
    fromEnv("ANDROID_HOME"),
    fromEnv("ANDROID_SDK_ROOT"),
    process.platform === "darwin" && join(homedir(), "Library/Android/sdk"),
    windows && process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android/Sdk"),
    !windows && join(homedir(), "Android/Sdk"),
  ]);
  assert.ok(sdk, "Android SDK not found. Install Android Studio or set ANDROID_HOME.");
  const javaHome = firstExisting([
    fromEnv("JAVA_HOME"),
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
    windows &&
      process.env.ProgramFiles &&
      join(process.env.ProgramFiles, "Android/Android Studio/jbr"),
    "/opt/android-studio/jbr",
    join(homedir(), "android-studio/jbr"),
  ]);
  assert.ok(javaHome, "No JDK found. Install Android Studio (it bundles one) or set JAVA_HOME.");
  const adb = join(sdk, "platform-tools", windows ? "adb.exe" : "adb");
  return { sdk, javaHome, adb, env: { ANDROID_HOME: sdk, JAVA_HOME: javaHome } };
}
