// scripts/affected.mjs decides what the deploy workflows ship: these pin what counts as changed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { affected, readWorkspace } from "./affected.mjs";

// schema <- sync <- web, schema <- api (a devDependency), push <- relay, and a Worker nothing depends on.
const WORKSPACE = [
  { name: "schema", dir: "packages/schema", deps: [] },
  { name: "sync", dir: "packages/sync", deps: ["schema"] },
  { name: "push", dir: "packages/push", deps: [] },
  { name: "api", dir: "apps/api", deps: ["schema"] },
  { name: "web", dir: "apps/web", deps: ["sync"] },
  { name: "relay", dir: "apps/relay", deps: ["push"] },
  { name: "slack", dir: "integrations/slack", deps: [] },
];
// The script's order: by code unit, as `<` compares.
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const ALL = WORKSPACE.map((pkg) => pkg.name).toSorted(byName);

describe("affected", () => {
  test("a package's own change, and every package that depends on it, however far", () => {
    assert.deepEqual(affected(WORKSPACE, ["packages/schema/src/index.ts"]), [
      "api",
      "schema",
      "sync",
      "web",
    ]);
    assert.deepEqual(affected(WORKSPACE, ["packages/push/src/seal.ts"]), ["push", "relay"]);
  });

  test("a leaf changes alone", () => {
    assert.deepEqual(affected(WORKSPACE, ["apps/web/src/main.tsx", "apps/web/package.json"]), [
      "web",
    ]);
  });

  test("markdown never counts, in a package or at the root", () => {
    assert.deepEqual(
      affected(WORKSPACE, ["apps/api/README.md", "docs/rfcs/0002.md", "AGENTS.md"]),
      [],
    );
  });

  test("files outside every package count for none", () => {
    assert.deepEqual(affected(WORKSPACE, [".github/workflows/ci.yml", "scripts/pr-media.mjs"]), []);
  });

  test("the lockfile or a root config counts as every package", () => {
    for (const file of [
      "bun.lock",
      "package.json",
      "tsconfig.json",
      "vite.config.ts",
      "vite.workspace.ts",
    ]) {
      assert.deepEqual(affected(WORKSPACE, [file]), ALL, file);
    }
  });

  test("a directory that only starts like a package's is not it", () => {
    assert.deepEqual(affected(WORKSPACE, ["apps/api-docs/index.ts"]), []);
  });
});

describe("readWorkspace", () => {
  test("names, directories and workspace dependencies only, from every workspace directory", () => {
    const root = mkdtempSync(join(tmpdir(), "affected-"));
    const manifest = (dir, json) => {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, "package.json"), JSON.stringify(json));
    };
    manifest("packages/schema", { name: "@x/schema" });
    manifest("apps/api", {
      name: "@x/api",
      dependencies: { "@x/schema": "workspace:*", hono: "^4" },
      devDependencies: { "@x/slack": "workspace:*", vitest: "catalog:" },
    });
    manifest("integrations/slack", {
      name: "@x/slack",
      peerDependencies: { "@x/schema": "workspace:^" },
    });
    mkdirSync(join(root, "apps/no-manifest"), { recursive: true });
    const found = Object.fromEntries(readWorkspace(root).map((pkg) => [pkg.name, pkg]));
    assert.deepEqual(Object.keys(found).toSorted(byName), ["@x/api", "@x/schema", "@x/slack"]);
    assert.deepEqual(found["@x/api"], {
      name: "@x/api",
      dir: "apps/api",
      deps: ["@x/schema", "@x/slack"],
    });
    assert.deepEqual(found["@x/slack"].deps, ["@x/schema"]);
  });
});

describe("the command", () => {
  const run = (...args) =>
    JSON.parse(
      execFileSync("node", ["scripts/affected.mjs", ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  const everything = readWorkspace()
    .map((pkg) => pkg.name)
    .toSorted(byName);

  test("no base, or one not in the history (a force push), is everything", () => {
    assert.deepEqual(run(), everything);
    assert.deepEqual(run("--base", ""), everything);
    assert.deepEqual(run("--base", "0000000000000000000000000000000000000000"), everything);
  });

  test("the same commit as base and head is nothing", () => {
    assert.deepEqual(run("--base", "HEAD", "--head", "HEAD"), []);
  });
});
