// `dev`: recompile messages and re-pack dist on change, so workspace consumers stay current.
import { spawn, type ChildProcess } from "node:child_process";

// A shell resolves `vpx`/`vp` (.cmd shims on Windows) the same way package scripts do.
const run = (command: string): ChildProcess =>
  spawn(command, { stdio: "inherit", shell: true, cwd: new URL("..", import.meta.url) });

const children = [run("vpx scripts/compile.ts --watch"), run("vp pack --watch")];
const stop = (code: number) => {
  for (const child of children) child.kill();
  process.exit(code);
};
for (const child of children) child.on("exit", (code) => stop(code ?? 1));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
