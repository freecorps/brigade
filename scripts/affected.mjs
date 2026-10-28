#!/usr/bin/env node
// Which workspace packages a range of commits touched, plus every package that depends on one of them (dependencies
// and devDependencies alike: a Worker bundles both). The deploy workflows use it to deploy only what changed.
//
//   node scripts/affected.mjs --base <sha> [--head <sha>]
//
// Prints a JSON array of package names. Under GitHub Actions it also writes `packages=<that array>` to
// $GITHUB_OUTPUT. Everything counts as affected when there is no base (first run), the base is not in the history
// (a force push), or a file every package builds with changed (ROOT_INPUTS). Markdown never counts.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

// The root workspace's `workspaces` globs, all of the `<dir>/*` form.
const WORKSPACE_DIRS = ["packages", "apps", "integrations", "tools", "spikes"];

// Root files every package's install, check or build reads.
const ROOT_INPUTS = new Set([
  "bun.lock",
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
  "vite.workspace.ts",
]);

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Every workspace package: its name, directory (repository-relative) and workspace dependencies. */
export function readWorkspace(root = ".") {
  const packages = [];
  for (const parent of WORKSPACE_DIRS) {
    if (!existsSync(join(root, parent))) continue;
    for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
      const manifest = join(root, parent, entry.name, "package.json");
      if (!entry.isDirectory() || !existsSync(manifest)) continue;
      const json = JSON.parse(readFileSync(manifest, "utf8"));
      const deps = { ...json.dependencies, ...json.devDependencies, ...json.peerDependencies };
      packages.push({
        name: json.name,
        dir: `${parent}/${entry.name}`,
        deps: Object.keys(deps).filter((dep) => String(deps[dep]).startsWith("workspace:")),
      });
    }
  }
  return packages;
}

/** The affected package names, sorted: those owning a changed file and, transitively, their dependents. */
export function affected(packages, changedFiles) {
  const files = changedFiles.filter((file) => !file.endsWith(".md"));
  if (files.some((file) => ROOT_INPUTS.has(file)))
    return packages.map((pkg) => pkg.name).toSorted(byName);
  const hit = new Set(
    packages
      .filter((pkg) => files.some((file) => file.startsWith(`${pkg.dir}/`)))
      .map((pkg) => pkg.name),
  );
  // Dependents until nothing new joins: the graph is small, so a fixed point beats building a reverse index.
  for (let grew = true; grew;) {
    grew = false;
    for (const pkg of packages) {
      if (!hit.has(pkg.name) && pkg.deps.some((dep) => hit.has(dep))) {
        hit.add(pkg.name);
        grew = true;
      }
    }
  }
  return [...hit].toSorted(byName);
}

function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function inHistory(sha) {
  try {
    git("merge-base", "--is-ancestor", sha, "HEAD");
    return true;
  } catch {
    return false;
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { base: { type: "string" }, head: { type: "string" } } });
  const head = values.head || "HEAD";
  const packages = readWorkspace();
  const base = values.base?.trim();
  const everything = !base || !inHistory(base);
  if (everything)
    console.error(base ? `${base} is not in the history: everything` : "No base: everything");
  const changed = everything
    ? []
    : git("diff", "--name-only", base, head).split("\n").filter(Boolean);
  const names = everything
    ? packages.map((pkg) => pkg.name).toSorted(byName)
    : affected(packages, changed);
  const json = JSON.stringify(names);
  console.log(json);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `packages=${json}\n`);
}
