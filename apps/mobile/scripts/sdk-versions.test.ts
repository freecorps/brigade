// Guards against shipping Expo SDK packages from different patch releases. TestFlight build 0.1.0 (21) crashed at
// launch: expo-camera 58.0.14 was installed with expo 58.0.19, whose expo-modules-core (58.0.26) lacked a symbol the
// newer camera's precompiled framework links against. `expo install --check` alone did not catch it: 58.0.14 is
// within the `~58.0.12` that expo 58.0.19 asks for. Neither check needs the network.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const appRoot = join(import.meta.dirname, "..");

type Manifest = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const readManifest = (dir: string): Manifest =>
  JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;

/** Every expo-* and @expo/* package the app resolves, directly or through another one, by install directory. */
function installedExpoPackages(): Map<string, Manifest> {
  const found = new Map<string, Manifest>();
  const visit = (dir: string) => {
    const manifest = readManifest(dir);
    const resolve = createRequire(join(dir, "package.json")).resolve;
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      if (!name.startsWith("expo") && !name.startsWith("@expo/")) continue;
      let packageDir: string;
      try {
        packageDir = dirname(resolve(`${name}/package.json`));
      } catch {
        continue; // an optional peer that is not installed
      }
      if (found.has(packageDir)) continue;
      found.set(packageDir, readManifest(packageDir));
      visit(packageDir);
    }
  };
  visit(appRoot);
  return found;
}

const semver = (version: string) => version.split(".").map(Number) as [number, number, number];
const newer = (a: string, b: string) => {
  const [x, y] = [semver(a), semver(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
};

describe("Expo SDK packages", () => {
  it("match the versions the installed expo expects (expo install --check)", () => {
    const cli = createRequire(join(appRoot, "package.json")).resolve("expo/bin/cli");
    // EXPO_OFFLINE: validate against the installed expo's bundledNativeModules.json instead of Expo's API.
    // Throws, with the output, when a dependency is outside its expected range.
    const output = execFileSync(process.execPath, [cli, "install", "--check"], {
      cwd: appRoot,
      env: { ...process.env, CI: "1", EXPO_OFFLINE: "1", EXPO_NO_TELEMETRY: "1" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(output).toContain("Dependencies are up to date");
  }, 60_000);

  // Expo publishes its packages from one monorepo, and each one's devDependency on expo is the exact expo of the
  // release it was published with. A package published after the installed expo can depend on native API that
  // the installed expo-modules-core does not have yet: bump expo to the newest patch (`expo install expo@~58.0.x`,
  // then `expo install --fix`).
  it("were not released after the installed expo", () => {
    const packages = [...installedExpoPackages().values()];
    const expo = packages.find((manifest) => manifest.name === "expo");
    expect(expo).toBeDefined();
    const ahead = packages
      .filter(({ devDependencies }) => /^\d+\.\d+\.\d+$/.test(devDependencies?.expo ?? ""))
      .filter(({ devDependencies }) => newer(devDependencies!.expo!, expo!.version))
      .map(
        ({ name, version, devDependencies }) =>
          `${name}@${version} (released with expo ${devDependencies!.expo})`,
      );
    expect(ahead, `newer than expo ${expo!.version}`).toEqual([]);
  });
});
