#!/usr/bin/env node
/**
 * Put screenshots and screen recordings on a GitHub pull request.
 *
 * GitHub hosts the files itself: `gh pr create|edit --attach <file>` uploads
 * them and rewrites `![alt](./file.png)` references in the body to the final
 * `https://github.com/user-attachments/assets/...` URLs. No asset branch.
 *
 * This script owns the markup and drives `gh` directly (no shell), so it
 * behaves the same from Bash, PowerShell, cmd, macOS and Linux.
 *
 *   node scripts/pr-media.mjs format  --before a.png --after b.png [--label Desktop] [--body-file body.md]
 *   node scripts/pr-media.mjs create  --title "..." --body-file body.md --after b.png [--before a.png] [--label L] [--base main] [--draft]
 *   node scripts/pr-media.mjs publish --pr 123 --after b.png [--before a.png] [--label L]
 *   node scripts/pr-media.mjs attach-list --before a.png --after b.png
 *
 * Repeat --before/--after for several comparisons and --label once per pair.
 * `--after` without `--before` is a net-new preview; when mixing pairs and
 * previews in one call, pass `--before -` for the previews. Add `--dry-run` to
 * `create` and `publish` to print the `gh` command instead of running it.
 *
 * Media must live inside the current working directory, with no whitespace in
 * the path. `test-results/pr-media/` is gitignored and works from any worktree.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

export const MARKER_START = "<!-- pr-media:start -->";
export const MARKER_END = "<!-- pr-media:end -->";

const IMAGE_EXTENSIONS = new Set([".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm"]);
const MAX_ATTACHMENTS = 50; // gh's per-command limit

const toPosix = (value) => value.replace(/\\/g, "/");

export function mediaKind(file) {
  const extension = extname(file).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  throw new Error(`Unsupported media file "${file}" (png, jpg, gif, webp, mp4, mov, webm)`);
}

/** `./relative/path.png` with forward slashes, the form gh rewrites. */
export function localRef(file, cwd = process.cwd()) {
  const path = toPosix(relative(cwd, resolve(cwd, file)));
  if (path === ".." || path.startsWith("../") || /^[A-Za-z]:\//.test(path)) {
    throw new Error(`Media files must be inside the working directory: "${file}"`);
  }
  if (/\s/.test(path)) throw new Error(`Media paths cannot contain whitespace: "${path}"`);
  return `./${path}`;
}

export function buildPairs({ before = [], after = [], labels = [] }) {
  if (after.length === 0) throw new Error("At least one --after file is required");
  if (before.length !== 0 && before.length !== after.length) {
    throw new Error("Provide either no --before files or one --before file for every --after file");
  }
  if (labels.length > after.length)
    throw new Error("Provide at most one --label for every --after file");
  return after.map((afterFile, index) => ({
    before: before.length && before[index] !== "-" ? before[index] : null,
    after: afterFile,
    label: labels[index] ?? null,
  }));
}

function validatePairs(pairs, cwd) {
  for (const pair of pairs) {
    for (const file of [pair.before, pair.after].filter(Boolean)) {
      if (!existsSync(resolve(cwd, file))) throw new Error(`Media file does not exist: "${file}"`);
      localRef(file, cwd);
    }
    if (pair.before && mediaKind(pair.before) !== mediaKind(pair.after)) {
      throw new Error(
        `Before and after must use the same media type: "${pair.before}" and "${pair.after}"`,
      );
    }
  }
}

const suffix = (label) => (label ? ` (${label})` : "");
const ref = (file, alt, cwd) => `![${alt}](${localRef(file, cwd)})`;

export function formatBlock(pairs, cwd = process.cwd()) {
  const lines = [MARKER_START];
  for (const pair of pairs) {
    const label = suffix(pair.label);
    if (mediaKind(pair.after) === "image") {
      if (pair.before) {
        lines.push(
          `| Before${label} | After${label} |`,
          "|:---:|:---:|",
          `| ${ref(pair.before, "Before", cwd)} | ${ref(pair.after, "After", cwd)} |`,
          "",
        );
      } else {
        lines.push(`| Preview${label} |`, "|:---:|", `| ${ref(pair.after, "Preview", cwd)} |`, "");
      }
    } else {
      // Videos render as players on their own line; a markdown table cannot hold them.
      if (pair.before) lines.push(`**Before${label}**`, "", ref(pair.before, "Before", cwd), "");
      const alt = pair.before ? "After" : "Preview";
      lines.push(`**${alt}${label}**`, "", ref(pair.after, alt, cwd), "");
    }
  }
  lines.push(MARKER_END);
  return `${lines.join("\n").trim()}\n`;
}

export function attachList(pairs, cwd = process.cwd()) {
  const files = [
    ...new Set(
      pairs
        .flatMap((pair) => [pair.before, pair.after])
        .filter(Boolean)
        .map((f) => localRef(f, cwd)),
    ),
  ];
  if (files.length > MAX_ATTACHMENTS)
    throw new Error(`gh accepts at most ${MAX_ATTACHMENTS} attachments per command`);
  return files;
}

/**
 * Replace an existing marked block, or insert the block after the opening
 * context: before the first `## ` heading when the body has one, otherwise at
 * the end. Every other byte of the body is preserved.
 */
export function placeBlock(body, block) {
  const start = body.indexOf(MARKER_START);
  const end = body.indexOf(MARKER_END);
  if (start !== -1 || end !== -1) {
    if (start === -1 || end === -1 || end < start)
      throw new Error("PR body contains an incomplete pr-media marker block");
    const afterEnd = end + MARKER_END.length;
    if (body.indexOf(MARKER_START, afterEnd) !== -1 || body.indexOf(MARKER_END, afterEnd) !== -1) {
      throw new Error("PR body contains multiple pr-media marker blocks");
    }
    const prefix = body.slice(0, start).trimEnd();
    const rest = body.slice(afterEnd).trim();
    return [prefix, block.trim(), rest].filter(Boolean).join("\n\n") + "\n";
  }
  const normalized = body.replace(/\r\n/g, "\n");
  const heading = normalized.search(/^## /m);
  if (heading > 0) {
    const prefix = normalized.slice(0, heading).trimEnd();
    const rest = normalized.slice(heading).trim();
    return [prefix, block.trim(), rest].filter(Boolean).join("\n\n") + "\n";
  }
  const prefix = normalized.trimEnd();
  return prefix ? `${prefix}\n\n${block}` : block;
}

/** Local refs that gh should have rewritten but did not. */
export function leftoverLocalRefs(body) {
  const start = body.indexOf(MARKER_START);
  const end = body.indexOf(MARKER_END);
  const scope = start !== -1 && end > start ? body.slice(start, end) : body;
  return [...scope.matchAll(/\]\((\.\/[^)\s]+)\)/g)].map((m) => m[1]);
}

function gh(args, { dryRun = false, input } = {}) {
  if (dryRun) {
    console.log(["gh", ...args].map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(" "));
    return "";
  }
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "inherit"],
  });
  if (result.error) throw new Error(`Could not run gh: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`gh ${args[0]} ${args[1] ?? ""} failed with exit code ${result.status}`);
  return result.stdout;
}

function verifyPublished(prRef, dryRun) {
  if (dryRun) return;
  const body = gh(["pr", "view", prRef, "--json", "body", "--jq", ".body"]);
  const leftovers = leftoverLocalRefs(body);
  if (leftovers.length) {
    throw new Error(
      `gh did not rewrite these references; the PR still points at local files:\n  ${leftovers.join("\n  ")}`,
    );
  }
  const urls = [...body.matchAll(/https:\/\/github\.com\/user-attachments\/assets\/[\w-]+/g)].map(
    (m) => m[0],
  );
  console.log(`Published ${urls.length} attachment(s) on ${prRef}.`);
}

function withTempBody(text, fn) {
  const dir = mkdtempSync(join(tmpdir(), "pr-media-"));
  const file = join(dir, "body.md");
  try {
    writeFileSync(file, text, "utf8");
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const OPTIONS = {
  before: { type: "string", multiple: true },
  after: { type: "string", multiple: true },
  label: { type: "string", multiple: true },
  "body-file": { type: "string" },
  title: { type: "string" },
  base: { type: "string", default: "main" },
  draft: { type: "boolean", default: false },
  pr: { type: "string" },
  "dry-run": { type: "boolean", default: false },
  help: { type: "boolean", default: false },
};

function usage() {
  return readFileSync(new URL(import.meta.url), "utf8")
    .split("*/")[0]
    .split("\n")
    .slice(2)
    .map((l) => l.replace(/^ \* ?/, ""))
    .join("\n");
}

function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }
  const { values } = parseArgs({ args: rest, options: OPTIONS });
  if (values.help) {
    console.log(usage());
    return;
  }
  const cwd = process.cwd();
  const pairs = buildPairs({ before: values.before, after: values.after, labels: values.label });
  validatePairs(pairs, cwd);
  const block = formatBlock(pairs, cwd);
  const attachArgs = attachList(pairs, cwd).flatMap((file) => ["--attach", file]);
  const dryRun = values["dry-run"];

  switch (command) {
    case "format": {
      const body = values["body-file"] ? readFileSync(values["body-file"], "utf8") : null;
      process.stdout.write(body === null ? block : placeBlock(body, block));
      return;
    }
    case "attach-list": {
      process.stdout.write(`${attachList(pairs, cwd).join("\n")}\n`);
      return;
    }
    case "create": {
      if (!values.title) throw new Error("create needs --title");
      if (!values["body-file"]) throw new Error("create needs --body-file");
      const body = placeBlock(readFileSync(values["body-file"], "utf8"), block);
      const url = withTempBody(body, (file) =>
        gh(
          [
            "pr",
            "create",
            "--base",
            values.base,
            "--title",
            values.title,
            "--body-file",
            file,
            ...(values.draft ? ["--draft"] : []),
            ...attachArgs,
          ],
          { dryRun },
        ),
      ).trim();
      if (url) console.log(url);
      verifyPublished(url || values.base, dryRun);
      return;
    }
    case "publish": {
      if (!values.pr) throw new Error("publish needs --pr <number|url>");
      const current = dryRun
        ? ""
        : gh(["pr", "view", values.pr, "--json", "body", "--jq", ".body"]);
      const body = placeBlock(current, block);
      withTempBody(body, (file) =>
        gh(["pr", "edit", values.pr, "--body-file", file, ...attachArgs], { dryRun }),
      );
      verifyPublished(values.pr, dryRun);
      return;
    }
    default:
      throw new Error(`Unknown command "${command}". Use format, create, publish or attach-list.`);
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(String(error?.message ?? error));
  process.exit(1);
}
