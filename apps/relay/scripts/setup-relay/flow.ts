// `vp run setup:relay` (RFC 0015 section 8): picks the relay an instance pages phones through and sets it up.
//
//   1. Freecorps' relay (the default): the terms, a contact address confirmed by an emailed code, a new instance key
//      registered with `POST /v1/instances`, `RELAY_INSTANCE_KEY` and `RELAY_URL` set on the API Worker, and the
//      signed deep health to show it works.
//   2. Your own relay: for a company that wants no third party on the paging path, and only for its own app build.
//      Checks the Apple and Firebase prerequisites, deploys apps/relay to the same account with its secrets, its topic
//      and closed registration (secrets too, so a later deploy keeps them), registers the instance with the relay's
//      admin token, and sets the API's secrets.
//   3. Not now: nothing changes; email still pages.
//
// Everything that touches the outside (wrangler, HTTP, files, the terminal) comes in through `Deps`, so the tests
// drive the whole flow against the relay's own code and a fake wrangler. Secret values never reach `io.print`, a
// command's arguments or a file in the repository: wrangler gets them on stdin (`wrangler secret bulk`), and the one
// file written (the instance key, so it can be kept) goes outside the repository with mode 0600.

import { createPrivateKey } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  generateInstanceKey,
  importInstanceKey,
  signRequest,
} from "@freecorps/brigade-push/instance";

/** The hosted relay's public address (docs/open-questions.md Q31); `--relay-url` (or `BRIGADE_RELAY_URL`) overrides it. */
export const FREECORPS_RELAY_URL = "https://relay.brigade.freecorps.com.br";

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
  /** Freecorps' relay's address, in place of `FREECORPS_RELAY_URL` (a test or staging relay, say). */
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
  /** Treat the relay Worker as new when wrangler cannot list its secrets (and cannot say it does not exist). */
  assumeNewRelay?: boolean;
  /** Take over a relay Worker this script did not set up (no `BRIGADE_OWN_RELAY` secret). */
  takeOverRelay?: boolean;
  /** Replace the APNs and Firebase credentials a relay already has (otherwise they are kept, or asked). */
  replaceCredentials?: boolean;
};

export type Command = {
  tool: "wrangler" | "vp";
  args: string[];
  cwd: string;
  /** Written to the command's stdin: how secret values reach wrangler. */
  input?: string;
  env?: Record<string, string>;
  /** Capture stdout and stderr instead of showing them. */
  capture?: boolean;
};

export type Deps = {
  io: {
    interactive: boolean;
    print(text: string): void;
    /** Only called when `interactive`. The answer, trimmed. */
    ask(question: string): Promise<string>;
  };
  run(command: Command): Promise<{ code: number; stdout: string; stderr: string }>;
  fetch: typeof fetch;
  readText(path: string): Promise<string>;
  /** The path with every symlink resolved; throws for a path that does not exist. */
  realpath(path: string): Promise<string>;
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
    /** The relay could not be reached (yet): a new custom domain may still be coming up. */
    readonly unreachable = false,
  ) {
    super(message);
  }
}

/**
 * The secret this script sets on a relay it deploys (its value says nothing). A relay Worker without it was set up
 * some other way, Freecorps' own included, and is not taken over without `--take-over-relay`.
 */
export const OWN_RELAY_MARKER = "BRIGADE_OWN_RELAY";
/**
 * The prefix of the secret this script sets on the relay and the API, in the same step as a shared `RELAY_SEND_TOKEN`:
 * `BRIGADE_SEND_PAIR_<id>`. Only names can be read, so the same name on both is what shows the tokens match.
 */
export const SEND_PAIR = "BRIGADE_SEND_PAIR_";
/** How long a new custom domain may take to answer before the script gives up (bounded: 30 tries, 10 s apart). */
const DOMAIN_TRIES = 30;
const DOMAIN_WAIT_MS = 10_000;

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
/** The app's bundle id rule, the same as `APP_ID_PATTERN` in apps/mobile `plugins/app-id.ts` (both stores accept it). */
const BUNDLE_ID = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/;

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
      "  3. Not now. No phone is paged; pages go out by email only if the API has EMAIL_FROM set.",
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
      "No phone is paged. Pages go out by email only if the API can send email (its EMAIL_FROM secret,",
      'apps/api README "Email"); without it, nobody is paged at all.',
      "Run `vp run setup:relay` again whenever you want phones paged.",
      `If this instance already had a relay and you want it off, delete its secrets from ${API_WORKER[options.env]}:`,
      "`wrangler secret delete RELAY_INSTANCE_KEY` (and RELAY_URL, and RELAY_INSTANCE_ID if set) in apps/api.",
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
  // Before the key: a relay that cannot be reached (its domain not attached yet, say) leaves no key file behind.
  await reachRelay(deps, relay);
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
      ...replacedRelaySecrets(existing),
    },
    key.file,
  );

  await deepHealth(deps, relay, key, "Freecorps' relay");
  const binding = await relayBinding(options, deps);
  io.print(
    [
      "",
      "Done. Next:",
      ...(binding === false
        ? []
        : [
            binding === true
              ? `- REQUIRED, or no phone is paged: remove the API's RELAY service binding (it is in ${bindingSource(options.env)}),`
              : `- REQUIRED, or no phone is paged: make sure the API has no RELAY service binding (${bindingSource(options.env)}),`,
            `  then build and deploy ${API_WORKER[options.env]} again. The API sends through that binding, to a relay Worker`,
            "  on this account, before RELAY_URL, and that relay does not know this instance. The check above asked",
            '  Freecorps\' relay directly, so it does not cover this (apps/api README "Push relay").',
          ]),
      `- Keep the instance key (${key.file}) in a password manager, then delete the file. If it is lost, this`,
      "  instance gets a new id and every phone must open the app once to be paged again.",
      "- Phones on the app as released today are NOT paged through Freecorps' relay: they register raw device",
      "  tokens, which the relay takes only with a send token (RELAY_SEND_TOKEN) a self-hosted instance never gets.",
      "  A phone is paged here once it runs an app release that asks the relay for handles (RFC 0015 step 4) and",
      "  has registered with this instance. Until then, pages reach people by email only if EMAIL_FROM is set.",
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
  const relayDir = join(deps.repoRoot, "apps/relay");
  // Read before anything is asked or changed: a relay Worker set up some other way (Freecorps' own, say) is not
  // turned into a closed relay by mistake.
  const relaySecrets = await listSecrets(deps, relayWorker, relayDir, {
    assumeNew: options.assumeNewRelay === true,
  });
  if (relaySecrets !== null && !relaySecrets.has(OWN_RELAY_MARKER) && !options.takeOverRelay) {
    throw new Stop(
      [
        `${relayWorker} already exists on this account and was not set up by this script. Nothing was changed.`,
        "Deploying over it would replace its APNs and Firebase keys, its topic, and open registration with closed: if",
        "it is a relay other instances use, they would stop being paged. If it is yours to replace, run again with",
        "--take-over-relay.",
      ].join("\n"),
    );
  }
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
  const relay = `https://${needs.relayDomain}`;
  // Made (and saved) before anything changes, so a key that cannot be saved stops the run with nothing deployed.
  const key = await instanceKey(options, deps);

  // Handle and tag keys a relay has are kept: new ones would make every phone's handle useless.
  const known = relaySecrets ?? new Set<string>();
  const adminToken = randomSecret();

  // Provider credentials a relay already has are live: replaced only when asked to (`--replace-credentials`, or yes to
  // the question), since a key from the wrong team or Firebase project stops every page through it at once.
  const credentials: Record<string, string> = {
    APNS_KEY: needs.apnsKey,
    APNS_KEY_ID: needs.apnsKeyId,
    APNS_TEAM_ID: needs.apnsTeamId,
    FCM_SERVICE_ACCOUNT: needs.fcmServiceAccount,
  };
  const live = Object.keys(credentials).filter((name) => known.has(name));
  let replace = options.replaceCredentials === true;
  if (live.length > 0 && !replace && io.interactive) {
    replace = await confirm(
      deps,
      `${relayWorker} already has ${live.join(", ")}. Replace them with the ones given? Wrong ones stop every page through it.`,
      false,
    );
  }
  for (const name of live) {
    if (!replace) delete credentials[name];
  }
  if (live.length > 0 && !replace) {
    io.print(`${relayWorker} keeps its ${live.join(", ")} (--replace-credentials replaces them).`);
  }

  // The send token pages phones that still register raw tokens (`/send`). Only names can be read, so a shared pair
  // marker (`BRIGADE_SEND_PAIR_<id>`, set on both Workers in the same step as the token) is what shows the relay's and
  // the API's tokens are the same one: kept then, so a rerun opens no gap. Otherwise a new token and a new marker go
  // on both, one right after the other, after the registration.
  const relayPairs = [...known].filter((name) => name.startsWith(SEND_PAIR));
  const apiPairs = [...existing].filter((name) => name.startsWith(SEND_PAIR));
  const keepSendToken =
    known.has("RELAY_SEND_TOKEN") &&
    existing.has("RELAY_SEND_TOKEN") &&
    relayPairs.some((name) => apiPairs.includes(name));
  const sendToken = keepSendToken ? null : randomSecret();
  const pair = keepSendToken ? null : `${SEND_PAIR}${randomHex(6)}`;
  const before: Record<string, string> = {
    ...credentials,
    // Secrets, not `deploy --var`: a later deploy without flags (CI, by hand) keeps them. Set before the deploy, so the
    // Worker is closed from its first version; a relay deployed with the old `--var` flags gets them on this run.
    RELAY_APNS_TOPIC: needs.bundleId,
    // `RELAY_CLOSED`, not `RELAY_REGISTRATION`: a relay set up with the old flags has a var by that name, and a
    // secret may not share a var's name. That var keeps it closed until this run's deploy drops it.
    RELAY_CLOSED: "1",
    // Only this run uses it, to register the instance; deleted once it has.
    RELAY_ADMIN_TOKEN: adminToken,
    [OWN_RELAY_MARKER]: "setup-relay",
  };
  // A relay with no send token yet needs one to deploy (`secrets.required`); it accepts nothing on `/send` before,
  // so setting it now stops no page. Its pair marker comes only with the API's token, after the registration.
  if (sendToken !== null && !known.has("RELAY_SEND_TOKEN")) before.RELAY_SEND_TOKEN = sendToken;
  if (!known.has("RELAY_HANDLE_KEYS")) {
    const id = `k${new Date(deps.now()).toISOString().slice(0, 10).replaceAll("-", "")}`;
    before.RELAY_HANDLE_KEYS = JSON.stringify({ current: id, keys: { [id]: randomSecret() } });
  } else {
    io.print(
      `${relayWorker} keeps its RELAY_HANDLE_KEYS, so handles phones already have stay valid.`,
    );
  }
  if (!known.has("RELAY_TAG_KEY")) before.RELAY_TAG_KEY = randomSecret();
  else io.print(`${relayWorker} keeps its RELAY_TAG_KEY (it never rotates).`);
  if (keepSendToken)
    io.print(`${relayWorker} and the API keep their RELAY_SEND_TOKEN (same pair).`);

  // Only names can be read, so a changed bundle id cannot be told from the same one: say what the topic becomes.
  if (known.has("RELAY_APNS_TOPIC")) {
    io.print(
      `${relayWorker}'s topic is set to ${needs.bundleId} (RELAY_APNS_TOPIC): an app with another bundle id is no longer paged through it.`,
    );
  }
  // Each secret write is live at once (a new version of the Worker), and the topic and closed registration go on
  // before the deploy (an older relay's vars would otherwise drop first): from there on, a stop says so.
  const replaced = live.length > 0 && replace;
  const unchanged = [
    "The API is unchanged.",
    `${relayWorker} may already run with this run's secrets (topic ${needs.bundleId}, closed registration${replaced ? `, ${live.join(", ")}` : ""}), even if what followed failed.`,
    ...(replaced
      ? [
          `Its ${live.join(", ")} were replaced: if they are wrong, pages through it fail until they are fixed.`,
        ]
      : []),
    "Run again (same flags) to finish.",
  ].join(" ");
  io.print(`\nBuilding apps/relay (${options.env})…`);
  const build = await deps.run({
    tool: "vp",
    args: ["build"],
    cwd: relayDir,
    ...(options.env === "dev" ? { env: { CLOUDFLARE_ENV: "dev" } } : {}),
  });
  if (build.code !== 0) {
    throw new Stop(
      `Building apps/relay failed (exit ${build.code}); see above. Nothing was deployed.`,
    );
  }

  // Before the deploy: a Worker that does not exist yet needs its required secrets first, and `secret bulk` makes it.
  await setSecrets(deps, relayWorker, relayDir, before, null, unchanged);
  io.print(`Deploying ${relayWorker} at ${relay}…`);
  const deploy = await deps.run({
    tool: "wrangler",
    args: ["deploy", "--domain", needs.relayDomain],
    cwd: relayDir,
  });
  if (deploy.code !== 0) {
    throw new Stop(
      `Deploying ${relayWorker} failed (exit ${deploy.code}); see above. ${unchanged}`,
    );
  }

  const answer = await untilReachable(deps, relay, unchanged, () =>
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
  if (answer.status !== 200 && answer.status !== 201) {
    throw new Stop(`${describe(answer, key.file)} ${unchanged}`);
  }
  io.print(`Registered with ${relayWorker} as ${key.instance}.`);

  // Now, one right after the other: the relay's new send token (unless it went on before the deploy) and pair
  // marker, the admin token gone, then the API's secrets with the same token and marker. Old markers go, so a pair
  // left by a run that stopped between the two never matches.
  const swap = (pairs: string[]) =>
    sendToken === null || pair === null
      ? {}
      : { [pair]: "setup-relay", ...Object.fromEntries(pairs.map((name) => [name, null])) };
  await setSecrets(
    deps,
    relayWorker,
    relayDir,
    {
      ...(sendToken !== null && known.has("RELAY_SEND_TOKEN")
        ? { RELAY_SEND_TOKEN: sendToken }
        : {}),
      ...swap(relayPairs),
      RELAY_ADMIN_TOKEN: null,
    },
    key.file,
  );
  await setSecrets(
    deps,
    API_WORKER[options.env],
    join(deps.repoRoot, "apps/api"),
    {
      RELAY_INSTANCE_KEY: key.privateKey,
      RELAY_URL: relay,
      ...(sendToken !== null ? { RELAY_SEND_TOKEN: sendToken } : {}),
      ...swap(apiPairs),
      ...(appUrl ? { RELAY_APP_URL: appUrl } : {}),
      // What tells the dashboard (and a later switch) this is an own relay, link or none.
      RELAY_KIND: "own",
      ...staleInstanceId(existing),
    },
    key.file,
  );

  await deepHealth(deps, relay, key, `${relayWorker} (${relay})`);
  io.print(
    [
      "",
      "Done. Next:",
      `- Bind the relay to the API as RELAY, so pages go Worker to Worker with no hop over the internet: the`,
      `  production build already binds RELAY to brigade-relay (apps/api/vite.config.ts PRODUCTION_BINDINGS), and`,
      `  dev to brigade-relay-dev (apps/api/wrangler.jsonc env.dev \`services\`). Build and deploy the API again so it`,
      "  binds the relay just deployed (a binding to a Worker that does not exist fails the deploy).",
      `- The topic (${needs.bundleId}) and closed registration are the relay's secrets RELAY_APNS_TOPIC and`,
      "  RELAY_CLOSED: deploying apps/relay again, with no flags, keeps them.",
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
    file("an APNs .p8 key (an EC P-256 private key)", isApnsKey),
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
          : "A bundle id looks like com.acme.brigade: letters and digits, each part starting with a letter, no - or _.",
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
      ["project_id", "private_key", "client_email"].every((k) => typeof record[k] === "string") &&
      // A key the relay can sign its JWTs with (RS256), checked here, before it is set anywhere.
      createPrivateKey(record.private_key as string).asymmetricKeyType === "rsa"
    );
  } catch {
    return false;
  }
}

/** An APNs token key: a PEM holding an EC P-256 private key, as Apple's `.p8` files are (checked locally). */
function isApnsKey(text: string): boolean {
  try {
    const key = createPrivateKey(text);
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
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

/**
 * A new custom domain can take minutes to answer (DNS, a certificate). Retries, 10 s apart and at most
 * `DOMAIN_TRIES` times, while the relay cannot be reached or answers as something that is not the relay yet (an edge
 * error with no relay body); gives up with `unchanged` said.
 */
async function untilReachable(
  deps: Deps,
  relay: string,
  unchanged: string,
  call: () => Promise<Answer>,
): Promise<Answer> {
  for (let attempt = 1; ; attempt++) {
    let notYet: string;
    try {
      const answer = await call();
      if (answer.status < 500 || typeof answer.body.error === "string") return answer;
      notYet = `it answers ${answer.status}`;
    } catch (error) {
      if (!(error instanceof Stop) || !error.unreachable) throw error;
      notYet = "it does not answer";
    }
    if (attempt >= DOMAIN_TRIES) {
      throw new Stop(
        `${relay} still does not answer as the relay after ${Math.round((DOMAIN_TRIES * DOMAIN_WAIT_MS) / 60_000)} minutes (${notYet}). Check the custom domain in the Cloudflare dashboard. ${unchanged}`,
      );
    }
    deps.io.print(
      `${relay}: ${notYet} yet (a new domain takes a few minutes); trying again in ${DOMAIN_WAIT_MS / 1000} s (${attempt}/${DOMAIN_TRIES})…`,
    );
    await deps.sleep(DOMAIN_WAIT_MS);
  }
}

// ─── Shared steps ────────────────────────────────────────────────────────────────────────────────────────────────

/** The names of the API Worker's secrets (never their values): whether a relay was set up before. */
async function apiSecrets(options: Options, deps: Deps): Promise<Set<string>> {
  const worker = API_WORKER[options.env];
  const names = await listSecrets(deps, worker, join(deps.repoRoot, "apps/api"), {
    assumeNew: false,
  });
  if (names === null) {
    throw new Stop(
      `${worker} does not exist on this account yet: deploy the API first (apps/api README "Self-host setup"). Nothing was changed.`,
    );
  }
  return names;
}

/** wrangler's codes for a Worker that does not exist (its isWorkerNotFoundError: 10007, and 10090 for a legacy environment). */
const NOT_FOUND = /\[code: 100(?:07|90)\]/;

/**
 * A Worker's secret names (never values), or `null` when wrangler says the Worker does not exist. Any other failure
 * (no login, a rate limit, Cloudflare or the network down) stops the script: read as "no secrets", it would make new
 * keys over ones phones depend on. `assumeNew` takes such a failure as a Worker that does not exist.
 */
async function listSecrets(
  deps: Deps,
  worker: string,
  cwd: string,
  { assumeNew }: { assumeNew: boolean },
): Promise<Set<string> | null> {
  const listed = await deps.run({
    tool: "wrangler",
    args: ["secret", "list", "--name", worker, "--format", "json"],
    cwd,
    capture: true,
  });
  if (listed.code !== 0) {
    if (NOT_FOUND.test(listed.stderr) || NOT_FOUND.test(listed.stdout)) return null;
    if (assumeNew) {
      deps.io.print(
        `wrangler could not list the secrets of ${worker}; taking it as a new Worker (--assume-new-relay).`,
      );
      return null;
    }
    const said = listed.stderr.trim().split("\n").filter(Boolean).slice(-3).join("\n  ");
    throw new Stop(
      [
        `wrangler could not list the secrets of ${worker} (exit ${listed.code}), so nothing was changed:`,
        ...(said ? [`  ${said}`] : []),
        "Log in (`wrangler login`, or CLOUDFLARE_API_TOKEN) and run again.",
        ...(worker.startsWith("brigade-relay")
          ? [
              "If the relay Worker really does not exist yet, --assume-new-relay goes on (it would otherwise replace the",
              "relay's handle keys, and every phone would have to open the app again).",
            ]
          : []),
      ].join("\n"),
    );
  }
  try {
    const names = (JSON.parse(listed.stdout) as { name?: unknown }[]).map((s) => s.name);
    return new Set(names.filter((n): n is string => typeof n === "string"));
  } catch {
    throw new Stop(`wrangler listed the secrets of ${worker} in a form this script does not read.`);
  }
}

/**
 * Warns and asks again when the API already has an instance key: only names can be read, so a key reused from a
 * file cannot be shown to be the same one. Resolves to whether the operator confirmed replacing a relay set up before.
 */
async function confirmSwitch(
  options: Options,
  deps: Deps,
  existing: Set<string>,
  to: "freecorps" | "own",
): Promise<boolean> {
  if (!existing.has("RELAY_INSTANCE_KEY")) return false;
  const warning = [
    "",
    `${API_WORKER[options.env]} already has a relay set up (RELAY_INSTANCE_KEY is set). Unless the key this run uses is`,
    "the very one it has, the instance gets a new key and id on the relay, so every handle phones hold stops working:",
    "EVERY PHONE MUST OPEN THE APP ONCE AGAIN to be paged.",
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
  return true;
}

/**
 * What setting up Freecorps' relay removes from the API: a stale instance id, and an own relay's leftovers.
 * `RELAY_KIND` (set by the own-relay flow) or `RELAY_APP_URL` marks an own relay: both, its `RELAY_SEND_TOKEN` (which
 * Freecorps' relay never accepts from a self-hosted instance) and the `SEND_PAIR` markers that vouched for that token go.
 * An API with neither (our own instance) keeps its send token.
 */
function replacedRelaySecrets(existing: Set<string>): Record<string, null> {
  const removed: Record<string, null> = { ...staleInstanceId(existing) };
  if (existing.has("RELAY_APP_URL") || existing.has("RELAY_KIND")) {
    if (existing.has("RELAY_APP_URL")) removed.RELAY_APP_URL = null;
    if (existing.has("RELAY_KIND")) removed.RELAY_KIND = null;
    if (existing.has("RELAY_SEND_TOKEN")) removed.RELAY_SEND_TOKEN = null;
    // The pair markers vouched for that token: left behind, a later own-relay run would keep a token the API lost.
    for (const name of existing) if (name.startsWith(SEND_PAIR)) removed[name] = null;
  }
  return removed;
}

/**
 * `RELAY_INSTANCE_ID`, removed whenever this script installs an instance key. The script registers and checks the key
 * as the id the key itself gives (`importInstanceKey`, a key file included), so after it the API must sign as that id:
 * an id left over (from a rotation, or a key deleted by hand) would make the API sign as another instance, and the relay
 * would refuse every handle page while the script's own check passed. Replacing a working key still needs the switch
 * confirmation first (`confirmSwitch`, before anything changes); an API with an id and no key has nothing working to
 * keep.
 */
function staleInstanceId(existing: Set<string>): Record<string, null> {
  return existing.has("RELAY_INSTANCE_ID") ? { RELAY_INSTANCE_ID: null } : {};
}

/**
 * The environment of a command this script starts. Not this script's `--conditions=@freecorps/source`
 * (vite.config.ts): wrangler and vp run as they do by hand. Nor a CLOUDFLARE_ENV left in the shell: the environment
 * is `--env`'s alone, passed per command, so a production run never builds or deploys the dev config.
 */
export function childEnv(
  parent: NodeJS.ProcessEnv,
  extra?: Record<string, string>,
): NodeJS.ProcessEnv {
  const { NODE_OPTIONS: _ours, CLOUDFLARE_ENV: _shell, ...inherited } = parent;
  return { ...inherited, ...extra };
}

function bindingSource(env: Environment): string {
  return env === "production"
    ? "apps/api/vite.config.ts PRODUCTION_BINDINGS"
    : `apps/api/wrangler.jsonc env.${env} \`services\``;
}

/**
 * Whether the API's build for `env` binds `RELAY`: the production build adds it from vite.config.ts
 * `PRODUCTION_BINDINGS`, the other environments have it in wrangler.jsonc. `null` when the files cannot be read.
 */
async function relayBinding(options: Options, deps: Deps): Promise<boolean | null> {
  try {
    if (options.env === "production") {
      const config = await deps.readText(join(deps.repoRoot, "apps/api/vite.config.ts"));
      const start = config.indexOf("const PRODUCTION_BINDINGS");
      if (start === -1) return null;
      const block = config.slice(start, config.indexOf("\n};", start));
      return /binding:\s*["']RELAY["']/.test(block);
    }
    const config = JSON.parse(
      stripJsonc(await deps.readText(join(deps.repoRoot, "apps/api/wrangler.jsonc"))),
    ) as { env?: Record<string, { services?: { binding?: unknown }[] }> };
    const environment = config.env?.[options.env];
    if (!environment) return null;
    return (environment.services ?? []).some((s) => s.binding === "RELAY");
  } catch {
    return null;
  }
}

/** JSON with comments and trailing commas to JSON, leaving strings (URLs with `//`) alone. */
function stripJsonc(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
      if (i === 0) break;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
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
  // Compared with symlinks resolved on both sides (the file's directory may not exist yet: its nearest existing
  // ancestor is resolved), and `..keys` is a folder inside the repository, not a way out of it.
  const inRepo = relative(await canonical(deps, deps.repoRoot), await canonical(deps, file));
  if (inRepo !== ".." && !inRepo.startsWith(`..${sep}`) && !isAbsolute(inRepo)) {
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
  /** Said when it fails, in place of the default for a registered instance. */
  onFailure?: string,
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
        (onFailure
          ? ` ${onFailure}`
          : keyFile
            ? ` The instance is registered: run again with --instance-key-file ${keyFile} to finish with the same key.`
            : ""),
    );
  }
}

async function deepHealth(deps: Deps, relay: string, key: Key, label: string): Promise<void> {
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
    const parts = `${part("apns").replace("apns", "APNs")}, ${part("fcm").replace("fcm", "FCM")}, ${handles}`;
    // What this proves: the relay answers, knows this instance and reaches its providers. Not that the API pages
    // through it (a RELAY binding elsewhere would win), so it never says "paging works".
    io.print(
      answer.body.ok === true
        ? `\nRelay check: ${label} is reachable and this instance is registered (${parts}).`
        : `\nRelay check: ${label} is reachable and this instance is registered, but the relay reports a problem (${parts}).`,
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

/** The relay's plain `GET /health`, unsigned. Throws `Stop` unless it answers as a Brigade relay. */
async function reachRelay(deps: Deps, relay: string): Promise<void> {
  const nothing = "Nothing was made or changed.";
  let response: Response;
  try {
    response = await deps.fetch(new URL("/health", relay), {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Stop(
      `Could not reach the relay at ${relay} (${messageOf(error)}). ${nothing} Check the address and the network, then run again.`,
      1,
      true,
    );
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {}
  if (!response.ok || (body as { ok?: unknown } | null)?.ok !== true) {
    throw new Stop(
      `${relay} does not look like a Brigade relay (GET /health answered ${response.status}). ${nothing}`,
    );
  }
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
      1,
      true,
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
    // Also what a custom domain answers before the Worker is routed there: retried while one comes up.
    throw new Stop(`${relay} does not look like a Brigade relay (404).`, 1, true);
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
        "No relay address: give it with --relay-url https://… (or BRIGADE_RELAY_URL),",
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

/** `bytes` random bytes as upper-case hex, for a secret's name. */
function randomHex(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .toString("hex")
    .toUpperCase();
}

/** 32 random bytes, base64url: handle and tag keys, tokens. */
function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("base64url");
}

/** `path` with symlinks resolved, through its nearest ancestor that exists. */
async function canonical(deps: Deps, path: string): Promise<string> {
  const absolute = resolve(path);
  const rest: string[] = [];
  for (let at = absolute; ; at = dirname(at)) {
    try {
      return join(await deps.realpath(at), ...rest);
    } catch {
      if (dirname(at) === at) return absolute;
      rest.unshift(basename(at));
    }
  }
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
