// Compiles messages/*.json into src/paraglide (typed message functions + runtime).
// Runs offline: the message-format plugin comes from node_modules instead of the CDN URL
// that inlang projects normally list in `modules`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileProject, type CompilerOptions } from "@inlang/paraglide-js";
import messageFormatPlugin from "@inlang/plugin-message-format";
import { loadProjectFromDirectory, type InlangPlugin } from "@inlang/sdk";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const compilerOptions: CompilerOptions = {
  project: path.join(root, "project.inlang"),
  outdir: path.join(root, "src/paraglide"),
  // No cookies, window or AsyncLocalStorage: safe in Workers, browsers and Hermes.
  strategy: ["globalVariable", "baseLocale"],
  disableAsyncLocalStorage: true,
  emitTsDeclarations: true,
  emitGitIgnore: false,
  emitPrettierIgnore: false,
  emitReadme: false,
};

export async function compileMessages(): Promise<Record<string, string>> {
  const project = await loadProjectFromDirectory({
    path: compilerOptions.project,
    fs,
    // The plugin types its own settings key; the SDK expects the generic shape.
    providePlugins: [messageFormatPlugin as InlangPlugin],
  });
  try {
    const errors = await project.errors.get();
    if (errors.length > 0) throw new AggregateError(errors, "inlang project has errors");
    return await compileProject({ compilerOptions, project, projectPath: compilerOptions.project });
  } finally {
    await project.close();
  }
}

// Writes only files whose content changed and removes stale ones, so an unchanged catalog
// leaves src/paraglide untouched (keeps the `vp run` cache and a watching `vp pack` quiet).
async function write(): Promise<number> {
  const output = await compileMessages();
  const outdir = compilerOptions.outdir;
  let changed = 0;
  fs.mkdirSync(outdir, { recursive: true });
  for (const file of fs.readdirSync(outdir, { recursive: true, encoding: "utf8" })) {
    const full = path.join(outdir, file);
    if (fs.statSync(full).isFile() && !(file.replaceAll("\\", "/") in output)) {
      fs.rmSync(full);
      changed++;
    }
  }
  // Longest paths first, so a directory emptied above goes before its parent is checked.
  for (const file of fs
    .readdirSync(outdir, { recursive: true, encoding: "utf8" })
    .sort((a, b) => b.length - a.length)) {
    const full = path.join(outdir, file);
    if (fs.statSync(full).isDirectory() && fs.readdirSync(full).length === 0) fs.rmdirSync(full);
  }
  for (const [file, content] of Object.entries(output)) {
    const full = path.join(outdir, file);
    if (fs.existsSync(full) && fs.readFileSync(full, "utf8").replaceAll("\r\n", "\n") === content) {
      continue;
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    changed++;
  }
  return changed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`paraglide: ${await write()} file(s) changed in src/paraglide`);
  if (process.argv.includes("--watch")) {
    let queue = Promise.resolve();
    const recompile = () => {
      queue = queue.then(async () => {
        try {
          console.log(`paraglide: ${await write()} file(s) changed`);
        } catch (error) {
          console.error(error);
        }
      });
    };
    fs.watch(path.join(root, "messages"), recompile);
    fs.watch(path.join(compilerOptions.project, "settings.json"), recompile);
  }
}
