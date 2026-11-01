#!/usr/bin/env node
// `vp run setup:relay` (RFC 0015 section 8; apps/api README "Push relay"): which relay pages this instance's phones.
// The flow is in flow.ts; this file reads the flags and wires the terminal, wrangler, files and fetch to it.
//
//   vp run setup:relay                                   # asks everything
//   vp run setup:relay -- --relay freecorps --relay-url https://… --accept-terms draft-2026-11 \
//     --contact oncall@acme.example [--code 123456 --instance-key-file <path>]   # no questions (CI, scripts)
//   vp run setup:relay -- --relay own --apns-key-file ~/keys/AuthKey.p8 --apns-key-id … --apns-team-id … \
//     --bundle-id com.acme.brigade --fcm-service-account-file ~/keys/fcm.json --relay-domain relay.acme.example
//   vp run setup:relay -- --relay none
//
// `--env production|staging|dev` picks the Workers (default production). Questions are asked only on a terminal
// and without `--non-interactive`; otherwise every answer comes from a flag.

import { spawn } from "node:child_process";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  childEnv,
  setupRelay,
  Stop,
  type Choice,
  type Command,
  type Deps,
  type Environment,
} from "./flow.ts";

const usage = `Usage: vp run setup:relay -- [--relay freecorps|own|none] [--env production|staging|dev]
  [--non-interactive] [--yes]
  Freecorps' relay: [--relay-url <https://…>] [--accept-terms <version>] [--contact <address>]
                    [--code <6 digits> --instance-key-file <path>] [--key-out <path>]
  Your own relay:   [--apns-key-file <.p8>] [--apns-key-id <id>] [--apns-team-id <id>] [--bundle-id <id>]
                    [--fcm-service-account-file <json>] [--relay-domain <host>] [--app-url <store link>]
                    [--take-over-relay] (a relay Worker this script did not set up)
                    [--assume-new-relay] (wrangler cannot list the relay's secrets, and it does not exist)`;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

async function main(): Promise<number> {
  // `vp run setup:relay -- --relay …` passes the `--` through, which parseArgs reads as the end of the options.
  const args = process.argv.slice(2);
  const { values } = parseArgs({
    args: args[0] === "--" ? args.slice(1) : args,
    options: {
      relay: { type: "string" },
      env: { type: "string", default: "production" },
      "relay-url": { type: "string" },
      "accept-terms": { type: "string" },
      contact: { type: "string" },
      code: { type: "string" },
      "instance-key-file": { type: "string" },
      "key-out": { type: "string" },
      "apns-key-file": { type: "string" },
      "apns-key-id": { type: "string" },
      "apns-team-id": { type: "string" },
      "bundle-id": { type: "string" },
      "fcm-service-account-file": { type: "string" },
      "relay-domain": { type: "string" },
      "app-url": { type: "string" },
      "non-interactive": { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
      "assume-new-relay": { type: "boolean", default: false },
      "take-over-relay": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(usage);
    return 0;
  }
  if (values.relay !== undefined && !["freecorps", "own", "none"].includes(values.relay)) {
    throw new Stop(`--relay is freecorps, own or none.\n${usage}`, 2);
  }
  if (!["production", "staging", "dev"].includes(values.env)) {
    throw new Stop(`--env is production, staging or dev.\n${usage}`, 2);
  }

  const interactive = Boolean(process.stdin.isTTY) && !values["non-interactive"];
  const terminal = interactive
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null;
  const deps: Deps = {
    io: {
      interactive,
      print: (text) => console.log(text),
      ask: async (question) => {
        if (!terminal) throw new Stop("A question needs an answer: give it as a flag.", 2);
        return (await terminal.question(question)).trim();
      },
    },
    run,
    fetch: globalThis.fetch,
    readText: (path) => readFile(path, "utf8"),
    realpath: (path) => realpath(path),
    writeSecret: async (path, content) => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      // `wx`: never overwrite a key kept from an earlier run.
      await writeFile(path, content, { mode: 0o600, flag: "wx" });
    },
    exists: (path) =>
      access(path).then(
        () => true,
        () => false,
      ),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    now: () => Date.now(),
    repoRoot,
    home: homedir(),
  };
  try {
    return await setupRelay(
      {
        ...(values.relay ? { relay: values.relay as Choice } : {}),
        env: values.env as Environment,
        ...defined({
          relayUrl: values["relay-url"] ?? process.env.BRIGADE_RELAY_URL,
          acceptTerms: values["accept-terms"],
          contact: values.contact,
          code: values.code,
          instanceKeyFile: values["instance-key-file"],
          keyOut: values["key-out"],
          apnsKeyFile: values["apns-key-file"],
          apnsKeyId: values["apns-key-id"],
          apnsTeamId: values["apns-team-id"],
          bundleId: values["bundle-id"],
          fcmServiceAccountFile: values["fcm-service-account-file"],
          relayDomain: values["relay-domain"],
          appUrl: values["app-url"],
        }),
        yes: values.yes,
        assumeNewRelay: values["assume-new-relay"],
        takeOverRelay: values["take-over-relay"],
      },
      deps,
    );
  } finally {
    terminal?.close();
  }
}

function defined<T extends Record<string, string | undefined>>(
  record: T,
): Partial<Record<keyof T, string>> {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined)) as Partial<
    Record<keyof T, string>
  >;
}

/** Runs the package's own wrangler or the repository's vp. Secret values only ever go in on stdin. */
function run(command: Command): Promise<{ code: number; stdout: string; stderr: string }> {
  const bin = join(
    command.tool === "vp" ? repoRoot : command.cwd,
    "node_modules",
    ".bin",
    command.tool,
  );
  return new Promise((done, fail) => {
    const child = spawn(bin, command.args, {
      cwd: command.cwd,
      env: childEnv(process.env, command.env),
      stdio: [
        command.input === undefined ? "inherit" : "pipe",
        command.capture ? "pipe" : "inherit",
        command.capture ? "pipe" : "inherit",
      ],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", fail);
    child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
    if (command.input !== undefined) child.stdin?.end(command.input);
  });
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (error instanceof Stop) {
      console.error(`\n${error.message}`);
      process.exit(error.code);
    }
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
