// `vp run setup:relay` (RFC 0015 section 8): picks the relay an instance pages phones through and sets it up.
//
//   1. Freecorps' relay (the default): the terms, a contact address confirmed by an emailed code, a new instance key
//      registered with `POST /v1/instances`, `RELAY_INSTANCE_KEY` and `RELAY_URL` set on the API Worker, and the
//      signed deep health to show it works.
//   2. Your own relay: for a company that wants no third party on the paging path, and only for its own app build.
//      Checks the Apple and Firebase prerequisites, deploys apps/relay to the same account with its secrets and closed
//      registration, registers the instance with the relay's admin token, and sets the API's secrets.
//   3. Not now: nothing changes; email still pages.
//
// Everything that touches the outside (wrangler, HTTP, files, the terminal) comes in through `Deps`, so the tests
// drive the whole flow against the relay's own code and a fake wrangler. Secret values never reach `io.print`, a
// command's arguments or a file in the repository: wrangler gets them on stdin (`wrangler secret bulk`), and the one
// file written (the instance key, so it can be kept) goes outside the repository with mode 0600.

import { isAbsolute, join, relative, resolve } from "node:path";
import {
  generateInstanceKey,
  importInstanceKey,
  signRequest,
} from "@freecorps/brigade-push/instance";

/**
 * The hosted relay's public address. PLACEHOLDER: Freecorps' relay has no public address yet (docs/open-questions.md
 * Q31). Until it has, `--relay-url` (or `BRIGADE_RELAY_URL`) must say where it is, and the script stops without it.
 */
export const FREECORPS_RELAY_URL: string | null = null;

/** The terms a registration on Freecorps' relay accepts (apps/relay wrangler.jsonc `RELAY_TERMS_VERSION`, D5). */
export const TERMS_VERSION = "draft-2026-11";
export const TERMS_URL = "https://github.com/freecorps/brigade/blob/main/docs/legal/relay-terms.md";
const YOUR_OWN_APP_DOCS =
  "https://github.com/freecorps/brigade/blob/main/apps/mobile/README.md#your-own-app";

export type Choice = "freecorps" | "own" | "none";
export type Environment = "production" | "staging" | "dev";

export type Options = {
  relay?: Choice;
  env: Environment;
  /** Freecorps' relay's address, while `FREECORPS_RELAY_URL` is a placeholder. */
  relayUrl?: string;
  /** Non-interactive acceptance of the terms: must be `TERMS_VERSION`. */
  acceptTerms?: string;
  contact?: string;
  code?: string;
  /** A key made by an earlier run (or kept from one), reused instead of a new one. */
  instanceKeyFile?: string;
  /** Where a new instance key is saved; by default under `~/.config/brigade/`. */
  keyOut?: string;
  /** Confirms what would otherwise be asked (switching relays) when not interactive. */
  yes: boolean;
  // Your own relay.
  apnsKeyFile?: string;
  apnsKeyId?: string;
  apnsTeamId?: string;
  bundleId?: string;
  fcmServiceAccountFile?: string;
  /** The relay's hostname, a custom domain on a zone of the same account (`relay.acme.example`). */
  relayDomain?: string;
  /** The company's app build's store link (`RELAY_APP_URL`). */
  appUrl?: string;
};

export type Command = {
  tool: "wrangler" | "vp";
  args: string[];
  cwd: string;
  /** Written to the command's stdin: how secret values reach wrangler. */
  input?: string;
  env?: Record<string, string>;
  /** Capture stdout instead of showing it. */
  capture?: boolean;
};

export type Deps = {
  io: {
    interactive: boolean;
    print(text: string): void;
    /** Only called when `interactive`. The answer, trimmed. */
    ask(question: string): Promise<string>;
  };
  run(command: Command): Promise<{ code: number; stdout: string }>;
  fetch: typeof fetch;
  readText(path: string): Promise<string>;
  /** Writes a file only its owner can read, making its directory if needed; fails if it exists. */
  writeSecret(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): number;
  repoRoot: string;
  home: string;
};

/** Stops the script with a message and an exit code; nothing after it runs. */
export class Stop extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message);
  }
}

type Key = { privateKey: string; publicKey: string; instance: string };
type Answer = { status: number; body: Record<string, unknown>; retryAfter: number | null };

const API_WORKER: Record<Environment, string> = {
  production: "brigade-api",
  staging: "brigade-api-staging",
  dev: "brigade-api-dev",
};
const RELAY_WORKER: Partial<Record<Environment, string>> = {
  production: "brigade-relay",
  dev: "brigade-relay-dev",
};

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const APPLE_ID = /^[A-Z0-9]{10}$/;
const BUNDLE_ID = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

/** Runs the whole setup; resolves to the exit code, or throws `Stop`. */
export async function setupRelay(options: Options, deps: Deps): Promise<number> {
  const { io } = deps;
  io.print("Brigade: which relay pages phones (RFC 0015 section 8)\n");
  const choice = options.relay ?? (await pickRelay(deps));
  if (choice === "none") return notNow(options, deps);
  // Each flow checks what it can locally (flags, files) before wrangler or the network is touched.
  if (choice === "freecorps") return freecorps(options, deps);
  return ownRelay(options, deps);
}

async function pickRelay(deps: Deps): Promise<Choice> {
  const { io } = deps;
  if (!io.interactive) {
    throw new Stop("Say which relay with --relay freecorps, --relay own or --relay none.", 2);
  }
  io.print(
    [
      "  1. Freecorps' relay (recommended). Works with the Brigade app from the App Store and Google Play.",
      "     Needs the relay's terms accepted and a contact address confirmed by email.",
      "  2. Your own relay. No third party on the paging path, but ONLY your company's own app build can be",
      "     paged through it: the store app cannot. Needs an Apple Developer account (APNs key), a Firebase",
      "     project and your own app build.",
      "  3. Not now. No phone is paged; email still pages.",
      "",
    ].join("\n"),
  );
  for (;;) {
    const answer = (await io.ask("Which one? [1] ")).toLowerCase();
    if (answer === "" || answer === "1") return "freecorps";
    if (answer === "2") return "own";
    if (answer === "3") return "none";
    io.print("Answer 1, 2 or 3.");
  }
}

function notNow(options: Options, deps: Deps): number {
  deps.io.print(
    [
      "No relay for now. Nothing was changed.",
      "",
      'Pages still go out by email (apps/api README "Email"), and the dashboard says that phones are not paged.',
      "Run `vp run setup:relay` again whenever you want phones paged.",
      `If this instance already had a relay and you want it off, delete its secrets from ${API_WORKER[options.env]}:`,
      "`wrangler secret delete RELAY_INSTANCE_KEY` (and RELAY_URL) in apps/api.",
    ].join("\n"),
  );
  return 0;
}

// ─── Freecorps' relay ────────────────────────────────────────────────────────────────────────────────────────────

async function freecorps(options: Options, deps: Deps): Promise<number> {
  const { io } = deps;
  const relay = relayOrigin(options.relayUrl ?? FREECORPS_RELAY_URL);
  if (!io.interactive && options.acceptTerms === undefined) {
    throw new Stop(
      `Accept the terms with --accept-terms ${TERMS_VERSION} after reading them (${TERMS_URL}).`,
      2,
    );
  }
  if (options.acceptTerms !== undefined && options.acceptTerms !== TERMS_VERSION) {
    throw new Stop(
      `--accept-terms ${options.acceptTerms} is not the version this script shows (${TERMS_VERSION}): read ${TERMS_URL}.`,
      2,
    );
  }
  if (!io.interactive && options.contact === undefined) {
    throw new Stop("Give a contact address with --contact.", 2);
  }
  if (options.code !== undefined && options.instanceKeyFile === undefined) {
    throw new Stop(
      "--code needs --instance-key-file: the code was emailed for the key the earlier run made and saved.",
      2,
    );
  }
  const existing = await apiSecrets(options, deps);
  await confirmSwitch(options, deps, existing, "freecorps");

  // The terms first: nothing is made or sent before they are accepted.
  io.print(
    [
      "",
      "Terms of Freecorps' relay",
      `  ${TERMS_URL} (version ${TERMS_VERSION})`,
      "  This is a PRELIMINARY TEMPLATE, not yet reviewed by counsel; the final text replaces it on the",
      "  project's site before self-hosters are pointed at the relay. In short:",
      "  - free for any instance within the limits; a paid service built on it needs an agreement;",
      "  - the relay never reads pages (they are encrypted for each phone), but sees handles, urgency and time,",
      "    and the IP address of phones that ask it for a handle;",
      "  - Freecorps writes to the contact address before limiting or revoking an instance.",
      "",
    ].join("\n"),
  );
  // Accepted by flag (checked above), or asked.
  if (
    options.acceptTerms === undefined &&
    !(await confirm(deps, `Do you accept these terms (version ${TERMS_VERSION})?`, false))
  ) {
    throw new Stop("Terms not accepted: nothing was registered and nothing was changed.");
  }

  const contact = await contactAddress(options, deps);
  const key = await instanceKey(options, deps);

  // The emailed code: asked for unless this run finishes an earlier one (`--code`).
  let code = options.code;
  let registered = false;
  if (code === undefined) {
    const sent = await requestCode(deps, relay, key, contact);
    if (sent === "registered") registered = true;
    else if (!io.interactive) {
      io.print(
        [
          "",
          `Then run this again with the code to finish:`,
          `  vp run setup:relay -- --relay freecorps --env ${options.env} --relay-url ${relay} \\`,
          `    --accept-terms ${TERMS_VERSION} --contact ${contact} \\`,
          `    --instance-key-file ${key.file} --code <the 6 digits>`,
        ].join("\n"),
      );
      return 0;
    }
  }

  for (;;) {
    if (!registered && code === undefined) code = await askCode(deps);
    const answer = await relayCall(
      deps,
      relay,
      key,
      "POST",
      "/v1/instances",
      registered ? { terms: TERMS_VERSION } : { terms: TERMS_VERSION, contact, code },
    );
    if (answer.status === 200 || answer.status === 201) break;
    const error = answer.body.error;
    if (error === "code_invalid") {
      const left = typeof answer.body.triesLeft === "number" ? answer.body.triesLeft : 0;
      if (io.interactive && left > 0) {
        io.print(`That code is not the one emailed: ${left} ${left === 1 ? "try" : "tries"} left.`);
        code = undefined;
        continue;
      }
      throw new Stop(
        left > 0
          ? `That code is not the one emailed (${left} ${left === 1 ? "try" : "tries"} left): run again with the right --code.`
          : `That code is not the one emailed, and no tries are left: run again without --code (and with --instance-key-file ${key.file}) for a new one.`,
      );
    }
    if (error === "code_expired") {
      if (
        io.interactive &&
        (await confirm(deps, "That code has expired or was used up. Send a new one?", true))
      ) {
        if ((await requestCode(deps, relay, key, contact)) === "registered") registered = true;
        code = undefined;
        continue;
      }
      throw new Stop(
        `The code has expired or was used up: run again without --code (and with --instance-key-file ${key.file}) for a new one.`,
      );
    }
    if (error === "terms_outdated") {
      throw new Stop(
        `The relay now asks for terms version ${String(answer.body.terms)}, not ${TERMS_VERSION}: update Brigade, read the new terms and run again (with --instance-key-file ${key.file}).`,
      );
    }
    throw new Stop(describe(answer, key.file));
  }
  io.print(`Registered with the relay as ${key.instance}.`);

  await setSecrets(
    deps,
    API_WORKER[options.env],
    join(deps.repoRoot, "apps/api"),
    {
      RELAY_INSTANCE_KEY: key.privateKey,
      RELAY_URL: relay,
      // Keys this script makes are original keys, whose id is their own: an id kept from a rotation would sign as
      // another instance.
      ...(existing.has("RELAY_INSTANCE_ID") ? { RELAY_INSTANCE_ID: null } : {}),
      // The store app pages through Freecorps' relay: an own build's link would send people elsewhere.
      ...(existing.has("RELAY_APP_URL") ? { RELAY_APP_URL: null } : {}),
    },
    key.file,
  );

  await deepHealth(deps, relay, key);
  io.print(
    [
      "",
      "Done. Next:",
      `- Keep the instance key (${key.file}) in a password manager, then delete the file. If it is lost, this`,
      "  instance gets a new id and every phone must open the app once to be paged again.",
      "- The API reaches a relay through its RELAY service binding when it has one, before RELAY_URL. The",
      "  production build binds RELAY to a brigade-relay Worker on this account (apps/api/vite.config.ts",
      "  PRODUCTION_BINDINGS; dev: apps/api/wrangler.jsonc env.dev `services`). With Freecorps' relay, remove that",
      "  binding, then build and deploy the API again.",
      "- Phones are paged once they open the app and register with this instance.",
    ].join("\n"),
  );
  return 0;
}

async function contactAddress(options: Options, deps: Deps): Promise<string> {
  let contact = options.contact;
  for (;;) {
    if (contact === undefined) {
      if (!deps.io.interactive) throw new Stop("Give a contact address with --contact.", 2);
      deps.io.print(
        "The relay writes to a contact address about this instance (before limiting or revoking it), and emails it a code now.",
      );
      contact = await deps.io.ask("Contact address: ");
    }
    if (EMAIL.test(contact) && contact.length <= 254) return contact;
    if (!deps.io.interactive) throw new Stop(`${contact} is not an email address.`, 2);
    deps.io.print(`${contact} is not an email address.`);
    contact = undefined;
  }
}

async function askCode(deps: Deps): Promise<string> {
  for (;;) {
    const code = (await deps.io.ask("The 6-digit code from the email: ")).replace(/\s/g, "");
    if (/^\d{6}$/.test(code)) return code;
    deps.io.print("The code is 6 digits.");
  }
}

/** Asks the relay to email a code. `registered`: the instance already is (a run finishing an earlier one). */
async function requestCode(
  deps: Deps,
  relay: string,
  key: Key & { file: string },
  contact: string,
): Promise<"sent" | "registered"> {
  const answer = await relayCall(deps, relay, key, "POST", "/v1/instances/contact", { contact });
  if (answer.status === 200) {
    const minutes = Math.round(Number(answer.body.expiresInSeconds ?? 900) / 60);
    deps.io.print(
      `The relay emailed a 6-digit code to ${contact}; it is valid for ${minutes} minutes.`,
    );
    return "sent";
  }
  if (answer.body.error === "already_registered") {
    deps.io.print(`${key.instance} is already registered with this relay.`);
    return "registered";
  }
  throw new Stop(describe(answer, key.file));
}

// ─── Your own relay ──────────────────────────────────────────────────────────────────────────────────────────────

type Prerequisites = {
  apnsKey: string;
  apnsKeyId: string;
  apnsTeamId: string;
  bundleId: string;
  fcmServiceAccount: string;
  relayDomain: string;
};

async function ownRelay(options: Options, deps: Deps): Promise<number> {
  const { io } = deps;
  const relayWorker = RELAY_WORKER[options.env];
  io.print(
    [
      "",
      "Your own relay",
      "  ONLY YOUR COMPANY'S OWN APP BUILD CAN BE PAGED THROUGH IT. Apple and Google deliver a push only when it is",
      "  signed with the keys of whoever published the app, so a relay with your keys reaches only an app you built",
      "  and signed (your bundle id, App Group and extensions). The Brigade app from the stores cannot be paged by it.",
      "",
      "  It needs:",
      "  - an Apple Developer account with an APNs key: the .p8 file, its key id and your team id;",
      '  - a Firebase project for Android and its service account JSON (apps/relay README "Setting up FCM");',
      "  - the bundle id of your company's app build (the APNs topic);",
      "  - a hostname for the relay on a zone of this Cloudflare account (relay.acme.example): phones reach it there.",
      `  Building the app is yours to do: ${YOUR_OWN_APP_DOCS}`,
      "",
    ].join("\n"),
  );
  if (!relayWorker) {
    throw new Stop(
      `apps/relay has no ${options.env} environment (only production and dev): use --env production or --env dev.`,
      2,
    );
  }
  const needs = await prerequisites(options, deps);
  const appUrl = await storeLink(options, deps);
  const existing = await apiSecrets(options, deps);
  await confirmSwitch(options, deps, existing, "own");
  if (
    io.interactive &&
    !(await confirm(
      deps,
      `Deploy apps/relay as ${relayWorker} to the account wrangler is logged in to, and point ${API_WORKER[options.env]} at it?`,
      true,
    ))
  ) {
    throw new Stop("Nothing was deployed or changed.");
  }
  const relayDir = join(deps.repoRoot, "apps/relay");
  const relay = `https://${needs.relayDomain}`;

  // Keys a relay must keep: new handle or tag keys would make every phone's handle useless.
  const relaySecrets = await listSecrets(deps, relayWorker, relayDir);
  const adminToken = randomSecret();
  const sendToken = randomSecret();
  const secrets: Record<string, string> = {
    APNS_KEY: needs.apnsKey,
    APNS_KEY_ID: needs.apnsKeyId,
    APNS_TEAM_ID: needs.apnsTeamId,
    FCM_SERVICE_ACCOUNT: needs.fcmServiceAccount,
    // `/send` (raw tokens, the app before handles) and the relay's required secrets. The API gets the same one.
    RELAY_SEND_TOKEN: sendToken,
    // Only this run uses it, to register the instance; a later run makes a new one.
    RELAY_ADMIN_TOKEN: adminToken,
  };
  if (!relaySecrets.has("RELAY_HANDLE_KEYS")) {
    const id = `k${new Date(deps.now()).toISOString().slice(0, 10).replaceAll("-", "")}`;
    secrets.RELAY_HANDLE_KEYS = JSON.stringify({ current: id, keys: { [id]: randomSecret() } });
  } else
    io.print(
      `${relayWorker} keeps its RELAY_HANDLE_KEYS, so handles phones already have stay valid.`,
    );
  if (!relaySecrets.has("RELAY_TAG_KEY")) secrets.RELAY_TAG_KEY = randomSecret();
  else io.print(`${relayWorker} keeps its RELAY_TAG_KEY (it never rotates).`);

  io.print(`\nBuilding apps/relay (${options.env})…`);
  const build = await deps.run({
    tool: "vp",
    args: ["build"],
    cwd: relayDir,
    ...(options.env === "dev" ? { env: { CLOUDFLARE_ENV: "dev" } } : {}),
  });
  if (build.code !== 0)
    throw new Stop(`Building apps/relay failed (exit ${build.code}); see above.`);

  // Before the deploy: a Worker that does not exist yet needs its required secrets first, and `secret bulk` makes it.
  await setSecrets(deps, relayWorker, relayDir, secrets, null);
  io.print(`Deploying ${relayWorker} at ${relay}…`);
  const deploy = await deps.run({
    tool: "wrangler",
    args: [
      "deploy",
      "--var",
      `APNS_TOPIC:${needs.bundleId}`,
      "--var",
      "RELAY_REGISTRATION:closed",
      "--domain",
      needs.relayDomain,
    ],
    cwd: relayDir,
  });
  if (deploy.code !== 0)
    throw new Stop(`Deploying ${relayWorker} failed (exit ${deploy.code}); see above.`);

  const key = await instanceKey(options, deps);
  const answer = await untilReachable(deps, relay, () =>
    relayCall(
      deps,
      relay,
      key,
      "POST",
      "/v1/instances",
      {},
      { Authorization: `Bearer ${adminToken}` },
    ),
  );
  if (answer.status !== 200 && answer.status !== 201) throw new Stop(describe(answer, key.file));
  io.print(`Registered with ${relayWorker} as ${key.instance}.`);

  await setSecrets(
    deps,
    API_WORKER[options.env],
    join(deps.repoRoot, "apps/api"),
    {
      RELAY_INSTANCE_KEY: key.privateKey,
      RELAY_URL: relay,
      RELAY_SEND_TOKEN: sendToken,
      ...(appUrl ? { RELAY_APP_URL: appUrl } : {}),
      ...(existing.has("RELAY_INSTANCE_ID") ? { RELAY_INSTANCE_ID: null } : {}),
    },
    key.file,
  );

  await deepHealth(deps, relay, key);
  io.print(
    [
      "",
      "Done. Next:",
      `- Bind the relay to the API as RELAY, so pages go Worker to Worker with no hop over the internet: the`,
      `  production build already binds RELAY to brigade-relay (apps/api/vite.config.ts PRODUCTION_BINDINGS), and`,
      `  dev to brigade-relay-dev (apps/api/wrangler.jsonc env.dev \`services\`). Build and deploy the API again so it`,
      "  binds the relay just deployed (a binding to a Worker that does not exist fails the deploy).",
      `- Keep APNS_TOPIC (${needs.bundleId}) and RELAY_REGISTRATION ("closed") in apps/relay/wrangler.jsonc \`vars\``,
      "  of your copy: a deploy without the flags this script passed puts the config's values back.",
      `- Keep the instance key (${key.file}) in a password manager, then delete the file.`,
      `- Build and publish your company's app (bundle id ${needs.bundleId}, relay ${relay}): ${YOUR_OWN_APP_DOCS}`,
    ].join("\n"),
  );
  return 0;
}

async function prerequisites(options: Options, deps: Deps): Promise<Prerequisites> {
  const { io } = deps;
  const missing: string[] = [];
  const get = async (
    given: string | undefined,
    question: string,
    flag: string,
    check: (value: string) => Promise<string | null>,
  ): Promise<string> => {
    let value = given;
    for (;;) {
      if (value === undefined || value === "") {
        if (!io.interactive) {
          missing.push(flag);
          return "";
        }
        value = await io.ask(question);
        if (value === "") {
          throw new Stop(`Missing what your own relay needs, so nothing was deployed: ${flag}.`);
        }
      }
      const problem = await check(value);
      if (problem === null) return value;
      if (!io.interactive) {
        missing.push(`${flag} (${problem})`);
        return "";
      }
      io.print(problem);
      value = undefined;
    }
  };
  const file = (what: string, valid: (text: string) => boolean) => async (path: string) => {
    const full = expandHome(path, deps.home);
    if (!(await deps.exists(full))) return `${path} does not exist.`;
    return valid(await deps.readText(full)) ? null : `${path} is not ${what}.`;
  };
  const apnsKeyFile = await get(
    options.apnsKeyFile,
    "Path of the APNs key (.p8): ",
    "--apns-key-file",
    file("an APNs .p8 key", (text) => text.includes("-----BEGIN PRIVATE KEY-----")),
  );
  const apnsKeyId = await get(options.apnsKeyId, "APNs key id: ", "--apns-key-id", async (v) =>
    APPLE_ID.test(v) ? null : "A key id is 10 capital letters and digits.",
  );
  const apnsTeamId = await get(
    options.apnsTeamId,
    "Apple team id: ",
    "--apns-team-id",
    async (v) => (APPLE_ID.test(v) ? null : "A team id is 10 capital letters and digits."),
  );
  const bundleId = await get(
    options.bundleId,
    "Bundle id of your app build (com.acme.brigade): ",
    "--bundle-id",
    async (v) =>
      v === "app.freecorps.brigade"
        ? "app.freecorps.brigade is the store app's: your build needs its own bundle id."
        : BUNDLE_ID.test(v)
          ? null
          : "A bundle id looks like com.acme.brigade.",
  );
  const fcmFile = await get(
    options.fcmServiceAccountFile,
    "Path of the Firebase service account JSON: ",
    "--fcm-service-account-file",
    file("a Google service account JSON key", isServiceAccount),
  );
  const relayDomain = await get(
    options.relayDomain,
    "Hostname for the relay (relay.acme.example): ",
    "--relay-domain",
    async (v) => (HOSTNAME.test(v) ? null : "Give a hostname such as relay.acme.example."),
  );
  if (missing.length > 0) {
    throw new Stop(
      `Missing what your own relay needs, so nothing was deployed: ${missing.join(", ")}.`,
    );
  }
  return {
    apnsKey: (await deps.readText(expandHome(apnsKeyFile, deps.home))).trim(),
    apnsKeyId,
    apnsTeamId,
    bundleId,
    fcmServiceAccount: (await deps.readText(expandHome(fcmFile, deps.home))).trim(),
    relayDomain: relayDomain.toLowerCase(),
  };
}

function isServiceAccount(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    return (
      record.type === "service_account" &&
      ["project_id", "private_key", "client_email"].every((k) => typeof record[k] === "string")
    );
  } catch {
    return false;
  }
}

async function storeLink(options: Options, deps: Deps): Promise<string | null> {
  let link = options.appUrl;
  for (;;) {
    if (link === undefined) {
      if (!deps.io.interactive) return null;
      link = await deps.io.ask(
        "Store link of your app build, so the store app can send people there (optional, Enter to skip): ",
      );
    }
    if (link === "") return null;
    try {
      if (new URL(link).protocol === "https:") return link;
    } catch {}
    if (!deps.io.interactive) throw new Stop(`--app-url ${link} is not an https:// link.`, 2);
    deps.io.print("Give an https:// link, or press Enter to skip.");
    link = undefined;
  }
}

/** A new custom domain can take a minute to answer: retries while the relay cannot be reached at all. */
async function untilReachable(
  deps: Deps,
  relay: string,
  call: () => Promise<Answer>,
): Promise<Answer> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof Stop) || attempt >= 6) throw error;
      deps.io.print(
        `${relay} does not answer yet (a new domain takes a moment); trying again in 10 s…`,
      );
      await deps.sleep(10_000);
    }
  }
}

// ─── Shared steps ────────────────────────────────────────────────────────────────────────────────────────────────

/** The names of the API Worker's secrets (never their values): whether a relay was set up before. */
async function apiSecrets(options: Options, deps: Deps): Promise<Set<string>> {
  return listSecrets(deps, API_WORKER[options.env], join(deps.repoRoot, "apps/api"));
}

async function listSecrets(deps: Deps, worker: string, cwd: string): Promise<Set<string>> {
  const listed = await deps.run({
    tool: "wrangler",
    args: ["secret", "list", "--name", worker, "--format", "json"],
    cwd,
    capture: true,
  });
  if (listed.code !== 0) {
    // A Worker not deployed yet has no secrets; wrangler says so with a failure, like a missing login does.
    if (worker.startsWith("brigade-relay")) return new Set();
    throw new Stop(
      `wrangler could not list the secrets of ${worker} (exit ${listed.code}). Log in (\`wrangler login\`, or CLOUDFLARE_API_TOKEN) and deploy the API first (apps/api README "Self-host setup").`,
    );
  }
  try {
    const names = (JSON.parse(listed.stdout) as { name?: unknown }[]).map((s) => s.name);
    return new Set(names.filter((n): n is string => typeof n === "string"));
  } catch {
    throw new Stop(`wrangler listed the secrets of ${worker} in a form this script does not read.`);
  }
}

async function confirmSwitch(
  options: Options,
  deps: Deps,
  existing: Set<string>,
  to: "freecorps" | "own",
): Promise<void> {
  // A key reused from a file is the same instance finishing its setup, not a switch.
  if (!existing.has("RELAY_INSTANCE_KEY") || options.instanceKeyFile) return;
  const warning = [
    "",
    `${API_WORKER[options.env]} already has a relay set up (RELAY_INSTANCE_KEY is set). Setting one up again gives`,
    "this instance a new key and id on the relay, so every handle phones hold stops working: EVERY PHONE MUST OPEN",
    "THE APP ONCE AGAIN to be paged.",
    ...(to === "own"
      ? [
          "And with your own relay the Brigade app from the stores can no longer be paged at all: only your company's",
          "own app build can.",
        ]
      : []),
    "",
  ].join("\n");
  deps.io.print(warning);
  if (deps.io.interactive) {
    if (!(await confirm(deps, "Switch relays anyway?", false))) {
      throw new Stop("Nothing was changed: the relay set up before stays.");
    }
  } else if (!options.yes) {
    throw new Stop("Nothing was changed. Pass --yes to switch relays anyway.");
  }
}

/** The key from `--instance-key-file`, or a new one saved outside the repository before anything uses it. */
async function instanceKey(options: Options, deps: Deps): Promise<Key & { file: string }> {
  if (options.instanceKeyFile) {
    const file = expandHome(options.instanceKeyFile, deps.home);
    let text: string;
    try {
      text = (await deps.readText(file)).trim();
    } catch {
      throw new Stop(`Could not read ${options.instanceKeyFile}.`, 2);
    }
    try {
      const imported = await importInstanceKey(text);
      deps.io.print(`Using the instance key in ${file} (${imported.instance}).`);
      return { privateKey: text, publicKey: imported.publicKey, instance: imported.instance, file };
    } catch {
      throw new Stop(`${options.instanceKeyFile} does not hold an instance key.`, 2);
    }
  }
  const key = await generateInstanceKey();
  const file = expandHome(
    options.keyOut ??
      join(
        deps.home,
        ".config",
        "brigade",
        `relay-instance-key-${API_WORKER[options.env]}-${key.instance}`,
      ),
    deps.home,
  );
  const inRepo = relative(resolve(deps.repoRoot), resolve(file));
  if (!inRepo.startsWith("..") && !isAbsolute(inRepo)) {
    throw new Stop(
      `${file} is inside the repository: keep the instance key outside it (--key-out).`,
      2,
    );
  }
  try {
    await deps.writeSecret(file, `${key.privateKey}\n`);
  } catch (error) {
    throw new Stop(
      `Could not save the instance key to ${file}: ${messageOf(error)}. Choose another --key-out.`,
    );
  }
  deps.io.print(`Made the instance key ${key.instance}, saved (readable by you only) to ${file}.`);
  return { ...key, file };
}

/** Sets (or, for `null`, deletes) a Worker's secrets, the values through wrangler's stdin only. */
async function setSecrets(
  deps: Deps,
  worker: string,
  cwd: string,
  secrets: Record<string, string | null>,
  keyFile: string | null,
): Promise<void> {
  const names = Object.entries(secrets).map(([name, value]) =>
    value === null ? `${name} (removed)` : name,
  );
  deps.io.print(`Setting ${names.join(", ")} on ${worker}…`);
  const result = await deps.run({
    tool: "wrangler",
    args: ["secret", "bulk", "--name", worker],
    cwd,
    input: JSON.stringify(secrets),
  });
  if (result.code !== 0) {
    throw new Stop(
      `wrangler could not set the secrets of ${worker} (exit ${result.code}); see above.` +
        (keyFile
          ? ` The instance is registered: run again with --instance-key-file ${keyFile} to finish with the same key.`
          : ""),
    );
  }
}

async function deepHealth(deps: Deps, relay: string, key: Key): Promise<void> {
  const { io } = deps;
  let answer: Answer;
  try {
    answer = await relayCall(deps, relay, key, "GET", "/v1/health?deep=1");
  } catch (error) {
    io.print(`\nRelay check: could not reach ${relay} (${messageOf(error)}).`);
    return;
  }
  const part = (name: string) => {
    const value = answer.body[name];
    if (typeof value !== "object" || value === null) return `${name} unknown`;
    const { status, reason } = value as { status?: unknown; reason?: unknown };
    return `${name} ${String(status)}${typeof reason === "string" ? ` (${reason})` : ""}`;
  };
  if (answer.status === 200 || (answer.status === 503 && "apns" in answer.body)) {
    const handles = answer.body.handles === true ? "handles ok" : "handles not set up";
    io.print(
      `\nRelay check: ${answer.body.ok === true ? "working" : "NOT working"} (${part("apns").replace("apns", "APNs")}, ${part("fcm").replace("fcm", "FCM")}, ${handles}).`,
    );
    if (answer.body.ok !== true) {
      io.print(
        "Pages to phones will fail until that is fixed; the instance's watchdog emails its operators too.",
      );
    }
    return;
  }
  io.print(`\nRelay check: refused. ${describe(answer, null)}`);
}

/** One signed call to the relay. Throws `Stop` when the relay cannot be reached at all. */
async function relayCall(
  deps: Deps,
  relay: string,
  key: Key,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Answer> {
  const url = new URL(path, relay);
  const text = body === undefined ? "" : JSON.stringify(body);
  const signed = await signRequest({
    privateKey: key.privateKey,
    publicKey: key.publicKey,
    instance: key.instance,
    method,
    path: url.pathname + url.search,
    body: text,
    now: deps.now(),
  });
  let response: Response;
  try {
    response = await deps.fetch(url, {
      method,
      headers: {
        ...signed,
        ...headers,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: text }),
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Stop(
      `Could not reach the relay at ${relay} (${messageOf(error)}). Check the address and the network, then run again.`,
    );
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Stop(`${relay} answered with a redirect: give the relay's final address.`);
  }
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {}
  if (response.status === 404 && (typeof parsed !== "object" || parsed === null)) {
    throw new Stop(`${relay} does not look like a Brigade relay (404).`);
  }
  const retry = Number(response.headers.get("Retry-After"));
  return {
    status: response.status,
    body: typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {},
    retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null,
  };
}

function describe(answer: Answer, keyFile: string | null): string {
  const error = typeof answer.body.error === "string" ? answer.body.error : `HTTP ${answer.status}`;
  const wait = answer.retryAfter === null ? "a while" : duration(answer.retryAfter);
  const again = keyFile ? ` (with --instance-key-file ${keyFile}, to keep this key)` : "";
  switch (error) {
    case "rate_limited":
      return `The relay is limiting calls from this address: wait ${wait} and run again${again}.`;
    case "too_many_codes":
      return `Too many codes were asked for this instance or this address: wait ${wait} and run again${again}.`;
    case "registration_closed":
      return "This relay registers only its company's own instance (closed registration): it is not Freecorps' relay. Check --relay-url, or choose your own relay.";
    case "instance_revoked":
      return "This instance was revoked on the relay: write to the relay's operators (the contact in its terms).";
    case "instance_unregistered":
      return "The relay does not know this instance: register it first (run this again).";
    case "email_failed":
      return `The relay could not email the code: try again in a few minutes${again}.`;
    case "not_configured":
      return "The relay is not set up to register instances yet (no email sender or terms version).";
    case "invalid_contact":
      return "The relay refused the contact address.";
    case "admin_unauthorized":
      return "The relay refused the admin token: run this again to make and set a new one.";
    case "bad_signature":
    case "missing_signature":
    case "stale_timestamp":
      return `The relay refused the instance's signature (${error}): check this computer's clock and the key.`;
    case "registry_unavailable":
      return `The relay's registry did not answer: try again in a few minutes${again}.`;
    default:
      return `The relay answered ${answer.status} (${error}).`;
  }
}

function relayOrigin(value: string | null | undefined): string {
  if (!value) {
    throw new Stop(
      [
        "Freecorps' relay has no public address yet, so this script does not know where to register.",
        "Give it with --relay-url https://… (or BRIGADE_RELAY_URL) once Freecorps publishes it,",
        "or choose your own relay (--relay own), or none for now (--relay none).",
      ].join("\n"),
      2,
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Stop(`${value} is not a URL.`, 2);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Stop("The relay's address must be https:// (plain http only for localhost).", 2);
  }
  return url.origin;
}

async function confirm(deps: Deps, question: string, byDefault: boolean): Promise<boolean> {
  for (;;) {
    const answer = (
      await deps.io.ask(`${question} ${byDefault ? "[Y/n]" : "[y/N]"} `)
    ).toLowerCase();
    if (answer === "") return byDefault;
    if (["y", "yes"].includes(answer)) return true;
    if (["n", "no"].includes(answer)) return false;
    deps.io.print("Answer y or n.");
  }
}

/** 32 random bytes, base64url: handle and tag keys, tokens. */
function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("base64url");
}

function expandHome(path: string, home: string): string {
  return path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path;
}

function duration(seconds: number): string {
  return seconds < 120 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
