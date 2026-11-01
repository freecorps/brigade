// `vp run setup:relay` (scripts/setup-relay/flow.ts) against the relay's own code: the fake relays below are
// `handle` from src/index.ts over a fake registry, and wrangler is a fake that records what it was asked and keeps
// the secrets it was given. Nothing here reaches Cloudflare, Apple or Google.

import { generateKeyPairSync } from "node:crypto";
import { generateInstanceKey, importInstanceKey } from "@freecorps/brigade-push/instance";
import { describe, expect, test } from "vite-plus/test";
import {
  childEnv,
  FREECORPS_RELAY_URL,
  setupRelay,
  Stop,
  SEND_PAIR,
  TERMS_VERSION,
  type Command,
  type Deps,
  type Options,
} from "../scripts/setup-relay/flow.ts";
import { handle, type RelayEnv } from "../src/index.ts";
import { fakeRegistry } from "./fake-registry.ts";

const HOSTED = "https://relay.freecorps.test";
/** apps/relay wrangler.jsonc's production vars: what a deploy without `--var` leaves. */
const CONFIG_VARS = {
  APNS_ENVIRONMENT: "production",
  APNS_TOPIC: "app.freecorps.brigade",
  RELAY_TERMS_VERSION: TERMS_VERSION,
};
const OWN_HOST = "relay.acme.example";
const HOME = "/home/oncall";
const REPO = "/repo";

// Throwaway keys, never real ones; example.com hosts, not Google's.
const APNS_KEY = generateKeyPairSync("ec", { namedCurve: "P-256" })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const FCM_SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account",
  project_id: "acme-brigade",
  private_key_id: "key-1",
  private_key: generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString(),
  client_email: "relay@acme-brigade.example.com",
  token_uri: "https://oauth2.example.com/token",
});
const randomKey = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

/** Fake APNs (a device that cannot exist: the provider token is fine), Google's token endpoint and FCM. */
async function providers(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname === "oauth2.example.com") {
    return Response.json({ access_token: "access", expires_in: 3599 });
  }
  if (url.hostname === "fcm.googleapis.com") return Response.json({ name: "m/1" });
  return new Response(JSON.stringify({ reason: "BadDeviceToken" }), { status: 400 });
}

type Answer = string | (() => string);

function harness(
  setup: {
    interactive?: boolean;
    answers?: Answer[];
    /** Secret names each Worker already has. */
    secrets?: Record<string, string[]>;
    /** The vars each Worker was last deployed with (an older script's `--var` flags, say). */
    vars?: Record<string, Record<string, string>>;
    hosted?: Partial<RelayEnv>;
    files?: Record<string, string>;
    unreachable?: boolean;
    /** How many calls to the own relay's domain fail before it answers (a new custom domain coming up). */
    ownDown?: number;
    failing?: (command: Command) => boolean;
    /** `secret list` fails for this Worker with a reason other than "not found". */
    listFails?: string;
    /** Workers that do not exist on the account (the API does, unless named here). */
    missing?: string[];
    /** Symlinks: path → what it points to. */
    links?: Record<string, string>;
  } = {},
) {
  let ownDown = setup.ownDown ?? 0;
  const sleeps: number[] = [];
  /** Every secret value any Worker was ever given, deleted ones included. */
  const given: string[] = [];
  const out: string[] = [];
  const questions: string[] = [];
  const answers = [...(setup.answers ?? [])];
  const commands: Command[] = [];
  const fetched: string[] = [];
  const files = new Map(Object.entries(setup.files ?? {}));
  /** What each Worker was given by `secret bulk` (values), or had already (names, value "kept"). */
  const secrets = new Map<string, Map<string, string>>();
  for (const [worker, names] of Object.entries(setup.secrets ?? {})) {
    secrets.set(worker, new Map(names.map((n) => [n, "kept"])));
  }
  const sent: { to: string; text: string }[] = [];
  const hostedRegistry = fakeRegistry();
  const ownRegistry = fakeRegistry();
  const hostedEnv: RelayEnv = {
    APNS_ENVIRONMENT: "production",
    APNS_TOPIC: "app.freecorps.brigade",
    APNS_KEY,
    APNS_KEY_ID: "KEYID12345",
    APNS_TEAM_ID: "TEAMID1234",
    RELAY_SEND_TOKEN: "hosted-send-token",
    REGISTRY: hostedRegistry,
    RELAY_TERMS_VERSION: TERMS_VERSION,
    RELAY_HANDLE_KEYS: JSON.stringify({ current: "k1", keys: { k1: randomKey() } }),
    RELAY_TAG_KEY: randomKey(),
    EMAIL: { send: async (message) => void sent.push(message) },
    EMAIL_FROM: "relay@freecorps.test",
    ...setup.hosted,
  };
  /** Each Worker's deployed vars: a deploy replaces them with wrangler.jsonc's and its `--var` flags. */
  const vars = new Map(Object.entries(setup.vars ?? {}));
  let deployed: { args: string[]; domain: string | null } | null = null;
  let relayWorker: string | null = null;
  /** The topic each APNs request from the own relay went to. */
  const ownTopics: string[] = [];

  const deps: Deps = {
    io: {
      interactive: setup.interactive ?? false,
      print: (text) => void out.push(text),
      ask: async (question) => {
        questions.push(question);
        const next = answers.shift();
        if (next === undefined) throw new Error(`unexpected question: ${question}`);
        return typeof next === "function" ? next() : next;
      },
    },
    run: async (command) => {
      commands.push(command);
      const ok = { code: 0, stdout: "", stderr: "" };
      if (setup.failing?.(command)) return { ...ok, code: 1 };
      const [verb, sub] = command.args;
      const name = command.args[command.args.indexOf("--name") + 1] ?? "";
      if (command.tool === "vp") return ok;
      if (verb === "secret" && sub === "list") {
        if (setup.listFails === name) {
          return { code: 1, stdout: "", stderr: "✘ [ERROR] Too many requests. [code: 971]\n" };
        }
        const exists =
          secrets.has(name) || (name.startsWith("brigade-api") && !setup.missing?.includes(name));
        if (!exists) {
          return {
            code: 1,
            stdout: "",
            stderr: `✘ [ERROR] A request to the Cloudflare API failed.\n  This Worker does not exist on your account. [code: 10007]\n`,
          };
        }
        const names = [...(secrets.get(name)?.keys() ?? [])];
        return {
          ...ok,
          stdout: JSON.stringify(names.map((n) => ({ name: n, type: "secret_text" }))),
        };
      }
      if (verb === "secret" && sub === "bulk") {
        const values = JSON.parse(command.input ?? "{}") as Record<string, string | null>;
        if (name.startsWith("brigade-relay")) relayWorker = name;
        // Cloudflare refuses a secret named like one of the Worker's deployed vars.
        const clash = Object.keys(values).find((key) => key in (vars.get(name) ?? {}));
        if (clash !== undefined) {
          return {
            code: 1,
            stdout: "",
            stderr: `✘ [ERROR] Binding name '${clash}' already in use. [code: 10053]\n`,
          };
        }
        const current = secrets.get(name) ?? new Map<string, string>();
        for (const [key, value] of Object.entries(values)) {
          if (value === null) current.delete(key);
          else {
            current.set(key, value);
            given.push(value);
          }
        }
        secrets.set(name, current);
        return ok;
      }
      if (verb === "deploy") {
        // The relay Worker the run set secrets on (the deploy names none: wrangler.jsonc does).
        const worker = relayWorker ?? "brigade-relay";
        const flags: Record<string, string> = {};
        command.args.forEach((arg, i) => {
          if (arg !== "--var") return;
          const [key = "", ...value] = (command.args[i + 1] ?? "").split(":");
          flags[key] = value.join(":");
        });
        vars.set(worker, { ...CONFIG_VARS, ...flags });
        const at = command.args.indexOf("--domain");
        deployed = {
          args: command.args,
          domain: at === -1 ? null : (command.args[at + 1] ?? null),
        };
        return ok;
      }
      throw new Error(`unexpected command: ${command.args.join(" ")}`);
    },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      fetched.push(`${request.method} ${request.url}`);
      if (setup.unreachable) throw new TypeError("fetch failed");
      const url = new URL(request.url);
      if (url.origin === HOSTED) return handle(request, hostedEnv, providers);
      if (url.hostname === OWN_HOST && deployed?.domain === OWN_HOST) {
        if (ownDown > 0) {
          ownDown--;
          throw new TypeError("fetch failed");
        }
        const own =
          secrets.get("brigade-relay") ??
          secrets.get("brigade-relay-dev") ??
          new Map<string, string>();
        // The deployed relay: its deployed vars, and the secrets it was given.
        const deployedVars = vars.get("brigade-relay") ?? vars.get("brigade-relay-dev") ?? {};
        const secret = (name: string) => own.get(name) ?? "";
        const optional = (name: "RELAY_APNS_TOPIC" | "RELAY_CLOSED") =>
          own.has(name) ? { [name]: secret(name) } : {};
        const env: RelayEnv = {
          APNS_ENVIRONMENT: "production",
          APNS_TOPIC: (deployedVars.APNS_TOPIC ?? CONFIG_VARS.APNS_TOPIC) as RelayEnv["APNS_TOPIC"],
          ...(deployedVars.RELAY_REGISTRATION === undefined
            ? {}
            : { RELAY_REGISTRATION: deployedVars.RELAY_REGISTRATION }),
          ...optional("RELAY_APNS_TOPIC"),
          ...optional("RELAY_CLOSED"),
          RELAY_TERMS_VERSION: TERMS_VERSION,
          REGISTRY: ownRegistry,
          APNS_KEY: secret("APNS_KEY"),
          APNS_KEY_ID: secret("APNS_KEY_ID"),
          APNS_TEAM_ID: secret("APNS_TEAM_ID"),
          RELAY_SEND_TOKEN: secret("RELAY_SEND_TOKEN"),
          FCM_SERVICE_ACCOUNT: secret("FCM_SERVICE_ACCOUNT"),
          RELAY_HANDLE_KEYS: secret("RELAY_HANDLE_KEYS"),
          RELAY_TAG_KEY: secret("RELAY_TAG_KEY"),
          RELAY_ADMIN_TOKEN: secret("RELAY_ADMIN_TOKEN"),
        };
        return handle(request, env, (provider) => {
          const topic = provider.headers.get("apns-topic");
          if (topic !== null) ownTopics.push(topic);
          return providers(provider);
        });
      }
      throw new TypeError("fetch failed");
    },
    readText: async (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`ENOENT ${path}`);
      return text;
    },
    writeSecret: async (path, content) => {
      if (files.has(path)) throw new Error("EEXIST");
      files.set(path, content);
    },
    exists: async (path) => files.has(path),
    realpath: async (path) => {
      for (const [from, to] of Object.entries(setup.links ?? {})) {
        if (path === from || path.startsWith(`${from}/`)) return to + path.slice(from.length);
      }
      // A directory exists when it is the root, the repository, the home or holds a file.
      const known = ["/", "/home", HOME, REPO];
      if (
        known.includes(path) ||
        [...files.keys()].some((f) => f === path || f.startsWith(`${path}/`))
      ) {
        return path;
      }
      throw new Error(`ENOENT ${path}`);
    },
    sleep: async (ms) => void sleeps.push(ms),
    now: () => Date.now(),
    repoRoot: REPO,
    home: HOME,
  };
  const run = (options: Partial<Options>) =>
    setupRelay({ env: "production", yes: false, ...options }, deps);
  /** The 6-digit code in the last email. */
  const code = () => /: (\d{6})\n/.exec(sent.at(-1)?.text ?? "")?.[1] ?? "";
  const keyFiles = () => [...files.keys()].filter((p) => p.includes("relay-instance-key"));
  /**
   * Every value a Worker was given, to check none of them leaked into output or arguments; the relay's URL and its
   * topic (the bundle id, `RELAY_APNS_TOPIC`) are not secret.
   */
  const secretValues = () =>
    given.filter((v) => v.length >= 16 && !v.startsWith("https://") && v !== OWN.bundleId);
  const leaks = () => {
    const visible = [...out, ...commands.flatMap((c) => c.args)].join("\n");
    return secretValues().filter((value) =>
      value.split("\n").some((line) => line.length >= 16 && visible.includes(line)),
    );
  };
  return {
    deps,
    run,
    out: () => out.join("\n"),
    questions,
    commands,
    fetched,
    files,
    secrets,
    sent,
    code,
    keyFiles,
    leaks,
    sleeps,
    hostedRegistry,
    ownRegistry,
    ownTopics,
    get deployed() {
      return deployed;
    },
  };
}

/** Each command as `tool verb sub worker` (the deploy as `wrangler deploy`). */
function order(h: { commands: Command[] }): string[] {
  return h.commands.map((c) => {
    if (c.args[0] === "deploy") return `${c.tool} deploy`;
    const name = c.args.indexOf("--name");
    return [c.tool, ...c.args.slice(0, 2), ...(name === -1 ? [] : [c.args[name + 1]])].join(" ");
  });
}

async function stopped(promise: Promise<number>): Promise<Stop> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(Stop);
  return error as Stop;
}

const FREECORPS: Partial<Options> = {
  relay: "freecorps",
  relayUrl: HOSTED,
  acceptTerms: TERMS_VERSION,
  contact: "oncall@acme.example",
};

describe("Freecorps' relay", () => {
  test("asked step by step: terms, contact, the emailed code; sets the API's secrets and checks the relay", async () => {
    const h = harness({
      interactive: true,
      answers: ["", "y", "oncall@acme.example", () => h.code()],
    });
    expect(await h.run({ relayUrl: HOSTED })).toBe(0);
    expect(h.questions[0]).toMatch(/Which one/);
    expect(h.questions[1]).toMatch(/accept these terms \(version draft-2026-11\)/);
    expect(h.out()).toMatch(/PRELIMINARY TEMPLATE/);
    expect(h.out()).toContain("docs/legal/relay-terms.md");
    expect(h.sent[0]?.to).toBe("oncall@acme.example");

    const api = h.secrets.get("brigade-api");
    expect([...(api?.keys() ?? [])].sort()).toEqual(["RELAY_INSTANCE_KEY", "RELAY_URL"]);
    expect(api?.get("RELAY_URL")).toBe(HOSTED);
    // The key set is the one registered, and the one saved outside the repository for a password manager.
    const key = await importInstanceKey(api?.get("RELAY_INSTANCE_KEY") ?? "");
    const record = h.hostedRegistry.storage(`instance:${key.instance}`).get("record");
    expect(record).toMatchObject({
      status: "registered",
      terms: TERMS_VERSION,
      contact: "oncall@acme.example",
    });
    expect(h.keyFiles()).toEqual([
      `${HOME}/.config/brigade/relay-instance-key-brigade-api-${key.instance}`,
    ]);
    expect(h.files.get(h.keyFiles()[0] ?? "")?.trim()).toBe(api?.get("RELAY_INSTANCE_KEY"));
    expect(h.out()).toMatch(
      /Relay check: Freecorps' relay is reachable and this instance is registered \(APNs ok, FCM not_configured, handles ok\)/,
    );
    expect(h.out()).not.toMatch(/working/);
    // The app as released registers raw tokens, which Freecorps' relay does not page for a self-hosted instance.
    expect(h.out()).toMatch(
      /Phones on the app as released today are NOT paged through Freecorps' relay/,
    );
    expect(h.out()).not.toMatch(/Phones are paged once they open the app/);
    // vite.config.ts cannot be read here, so the binding step is said as one to check.
    expect(h.out()).toMatch(
      /REQUIRED, or no phone is paged: make sure the API has no RELAY service binding/,
    );
    // Secret values go to wrangler on stdin only: never printed, never an argument.
    expect(h.leaks()).toEqual([]);
    expect(h.commands.find((c) => c.args[1] === "bulk")?.args).toEqual([
      "secret",
      "bulk",
      "--name",
      "brigade-api",
    ]);
  });

  test("terms refused: nothing is made, sent or set", async () => {
    const h = harness({ interactive: true, answers: ["1", "n"] });
    const stop = await stopped(h.run({ relayUrl: HOSTED }));
    expect(stop.message).toMatch(/Terms not accepted/);
    expect(h.keyFiles()).toEqual([]);
    expect(h.fetched).toEqual([]);
    expect(h.commands.filter((c) => c.args[1] === "bulk")).toEqual([]);
  });

  test("a wrong code asks again with the tries left, then registers", async () => {
    const wrong = () => String((Number(h.code()) + 1) % 1_000_000).padStart(6, "0");
    const h = harness({ interactive: true, answers: ["y", wrong, () => h.code()] });
    expect(await h.run(FREECORPS_WITHOUT_TERMS)).toBe(0);
    expect(h.out()).toMatch(/That code is not the one emailed: 4 tries left/);
    expect(h.secrets.get("brigade-api")?.has("RELAY_INSTANCE_KEY")).toBe(true);
  });

  test("a wrong code with no questions stops, keeping the key for the next run", async () => {
    const h = harness();
    expect(await h.run(FREECORPS)).toBe(0);
    const keyFile = h.keyFiles()[0] ?? "";
    const wrong = String((Number(h.code()) + 1) % 1_000_000).padStart(6, "0");
    const stop = await stopped(h.run({ ...FREECORPS, code: wrong, instanceKeyFile: keyFile }));
    expect(stop.message).toMatch(/not the one emailed \(4 tries left\)/);
    expect(h.secrets.get("brigade-api")).toBeUndefined();
  });

  test("codes rate limited: the instance's three an hour, and the relay's limit per IP", async () => {
    const h = harness();
    expect(await h.run(FREECORPS)).toBe(0);
    const instanceKeyFile = h.keyFiles()[0] ?? "";
    expect(await h.run({ ...FREECORPS, instanceKeyFile })).toBe(0);
    expect(await h.run({ ...FREECORPS, instanceKeyFile })).toBe(0);
    const stop = await stopped(h.run({ ...FREECORPS, instanceKeyFile }));
    expect(stop.message).toMatch(
      /Too many codes .* wait \d+ minutes and run again \(with --instance-key-file/,
    );
    expect(h.sent).toHaveLength(3);

    const limited = harness({
      hosted: { CODE_LIMIT: { limit: async () => ({ success: false }) } },
    });
    const perIp = await stopped(limited.run(FREECORPS));
    expect(perIp.message).toMatch(/limiting calls from this address: wait 60 seconds/);
  });

  test("relay unreachable: says so, and neither sets nor saves anything, however often it is run", async () => {
    const h = harness({ unreachable: true });
    for (let run = 0; run < 2; run++) {
      const stop = await stopped(h.run(FREECORPS));
      expect(stop.message).toMatch(/Could not reach the relay at https:\/\/relay.freecorps.test/);
      expect(stop.message).toMatch(/Nothing was made or changed/);
    }
    // Checked before the key is made: no key file left per try.
    expect(h.keyFiles()).toEqual([]);
    expect(h.commands.filter((c) => c.args[1] === "bulk")).toEqual([]);
  });

  test("without --relay-url it goes to Freecorps' relay's address; an empty one stops before anything", async () => {
    expect(FREECORPS_RELAY_URL).toBe("https://relay.brigade.freecorps.com.br");
    const h = harness({ unreachable: true });
    const stop = await stopped(h.run({ ...FREECORPS, relayUrl: undefined }));
    expect(stop.message).toMatch(
      /Could not reach the relay at https:\/\/relay.brigade.freecorps.com.br/,
    );
    expect(h.fetched.every((f) => f.includes("https://relay.brigade.freecorps.com.br/"))).toBe(
      true,
    );
    expect(h.fetched.length).toBeGreaterThan(0);

    const empty = harness();
    const none = await stopped(empty.run({ ...FREECORPS, relayUrl: "" }));
    expect(none.code).toBe(2);
    expect(none.message).toMatch(/No relay address.*--relay-url/s);
    expect(empty.commands).toEqual([]);
    expect(empty.fetched).toEqual([]);
  });

  test("a closed relay given as Freecorps' says it is someone's own", async () => {
    const h = harness({ hosted: { RELAY_REGISTRATION: "closed" } });
    const stop = await stopped(h.run(FREECORPS));
    expect(stop.message).toMatch(/closed registration/);
  });

  test("non-interactive: the first run sends the code and says how to finish, the second registers", async () => {
    const h = harness();
    expect(await h.run(FREECORPS)).toBe(0);
    expect(h.questions).toEqual([]);
    const keyFile = h.keyFiles()[0] ?? "";
    expect(h.out()).toContain(`--instance-key-file ${keyFile} --code <the 6 digits>`);
    expect(h.secrets.get("brigade-api")).toBeUndefined();

    expect(await h.run({ ...FREECORPS, code: h.code(), instanceKeyFile: keyFile })).toBe(0);
    expect(h.secrets.get("brigade-api")?.get("RELAY_INSTANCE_KEY")).toBe(
      h.files.get(keyFile)?.trim(),
    );
    // Run again with the same key (finishing, or re-run): already registered, no new code.
    // The API has a key now, which only names show: the same key cannot be proven, so it asks (--yes) again.
    expect((await stopped(h.run({ ...FREECORPS, instanceKeyFile: keyFile }))).message).toMatch(
      /--yes/,
    );
    expect(await h.run({ ...FREECORPS, instanceKeyFile: keyFile, yes: true })).toBe(0);
    expect(h.sent).toHaveLength(1);
    expect(h.out()).toMatch(/already registered/);
  });

  test("non-interactive needs its answers as flags", async () => {
    const h = harness();
    expect((await stopped(h.run({ relay: undefined }))).message).toMatch(/--relay freecorps/);
    expect((await stopped(h.run({ ...FREECORPS, acceptTerms: undefined }))).message).toMatch(
      /--accept-terms draft-2026-11/,
    );
    expect((await stopped(h.run({ ...FREECORPS, acceptTerms: "draft-2020-01" }))).message).toMatch(
      /not the version/,
    );
    expect((await stopped(h.run({ ...FREECORPS, contact: undefined }))).message).toMatch(
      /--contact/,
    );
    expect((await stopped(h.run({ ...FREECORPS, code: "123456" }))).message).toMatch(
      /--code needs --instance-key-file/,
    );
    expect(h.commands).toEqual([]);
  });

  test("refuses to save the key inside the repository", async () => {
    const h = harness();
    const stop = await stopped(h.run({ ...FREECORPS, keyOut: `${REPO}/apps/api/key` }));
    expect(stop.message).toMatch(/inside the repository/);
    expect(h.files.size).toBe(0);
  });
});

const FREECORPS_WITHOUT_TERMS: Partial<Options> = { ...FREECORPS, acceptTerms: undefined };

describe("switching relays", () => {
  const HAD = {
    "brigade-api": ["RELAY_INSTANCE_KEY", "RELAY_URL", "RELAY_INSTANCE_ID", "RELAY_APP_URL"],
  };

  test("warns that every phone must open the app again, and stops unless confirmed", async () => {
    const asked = harness({ interactive: true, secrets: HAD, answers: ["n"] });
    const stop = await stopped(asked.run(FREECORPS));
    expect(stop.message).toMatch(/Nothing was changed/);
    expect(asked.out()).toMatch(/EVERY PHONE MUST OPEN THE APP ONCE AGAIN/);
    expect(asked.questions).toEqual(["Switch relays anyway? [y/N] "]);
    expect(asked.fetched).toEqual([]);

    const quiet = harness({ secrets: HAD });
    expect((await stopped(quiet.run(FREECORPS))).message).toMatch(/Pass --yes/);
  });

  test("confirmed, the new key replaces the old id and the own build's link", async () => {
    const h = harness({ secrets: HAD });
    expect(await h.run({ ...FREECORPS, yes: true })).toBe(0);
    const keyFile = h.keyFiles()[0] ?? "";
    expect(await h.run({ ...FREECORPS, yes: true, code: h.code(), instanceKeyFile: keyFile })).toBe(
      0,
    );
    const api = h.secrets.get("brigade-api");
    expect([...(api?.keys() ?? [])].sort()).toEqual(["RELAY_INSTANCE_KEY", "RELAY_URL"]);
    expect(api?.get("RELAY_INSTANCE_KEY")).not.toBe("kept");
  });

  test("to an own relay, also says the store app can no longer be paged", async () => {
    const h = harness({ interactive: true, secrets: HAD, answers: ["n"], files: OWN_FILES });
    await stopped(h.run({ ...OWN, appUrl: "" }));
    expect(h.out()).toMatch(/Brigade app from the stores can no longer be paged at all/);
    expect(h.commands.filter((c) => c.args[0] === "deploy")).toEqual([]);
  });
});

const OWN_FILES = {
  [`${HOME}/keys/AuthKey_ABCDE12345.p8`]: APNS_KEY,
  [`${HOME}/keys/fcm.json`]: FCM_SERVICE_ACCOUNT,
};
const OWN: Partial<Options> = {
  relay: "own",
  apnsKeyFile: "~/keys/AuthKey_ABCDE12345.p8",
  apnsKeyId: "ABCDE12345",
  apnsTeamId: "TEAM123456",
  bundleId: "com.acme.brigade",
  fcmServiceAccountFile: "~/keys/fcm.json",
  relayDomain: OWN_HOST,
  appUrl: "https://apps.apple.com/app/id000000000",
};

describe("your own relay", () => {
  test("deploys the relay with its secrets and closed registration, registers the instance, sets the API", async () => {
    const h = harness({ files: OWN_FILES });
    expect(await h.run(OWN)).toBe(0);
    expect(h.out()).toMatch(/ONLY YOUR COMPANY'S OWN APP BUILD CAN BE PAGED THROUGH IT/);

    const relay = h.secrets.get("brigade-relay");
    const pair = [...(relay?.keys() ?? [])].find((k) => k.startsWith(SEND_PAIR)) ?? "missing";
    // The pair marker shows the relay's and the API's send tokens were set in one step.
    expect(h.secrets.get("brigade-api")?.has(pair)).toBe(true);
    expect([...(relay?.keys() ?? [])].filter((k) => k !== pair).sort()).toEqual([
      "APNS_KEY",
      "APNS_KEY_ID",
      "APNS_TEAM_ID",
      "BRIGADE_OWN_RELAY",
      "FCM_SERVICE_ACCOUNT",
      "RELAY_APNS_TOPIC",
      "RELAY_CLOSED",
      "RELAY_HANDLE_KEYS",
      "RELAY_SEND_TOKEN",
      "RELAY_TAG_KEY",
    ]);
    expect(relay?.get("APNS_KEY")).toBe(APNS_KEY.trim());
    // The topic and closed registration are secrets, which every later deploy keeps.
    expect(relay?.get("RELAY_APNS_TOPIC")).toBe("com.acme.brigade");
    expect(relay?.get("RELAY_CLOSED")).toBe("1");
    // Secrets before the deploy (a new Worker needs its required ones), then the deploy with its domain and no vars;
    // after the registration the admin token goes, then the API's secrets.
    expect(order(h)).toEqual([
      "wrangler secret list brigade-api",
      "wrangler secret list brigade-relay",
      "vp build",
      "wrangler secret bulk brigade-relay",
      "wrangler deploy",
      "wrangler secret bulk brigade-relay",
      "wrangler secret bulk brigade-api",
    ]);
    expect(JSON.parse(h.commands[5]?.input ?? "")).toEqual({
      [pair]: "setup-relay",
      RELAY_ADMIN_TOKEN: null,
    });
    expect(h.deployed).toEqual({ args: ["deploy", "--domain", OWN_HOST], domain: OWN_HOST });
    // The deep health asked APNs for the company's topic, not wrangler.jsonc's `APNS_TOPIC`.
    expect(h.ownTopics).toEqual(["com.acme.brigade"]);

    const api = h.secrets.get("brigade-api");
    expect(api?.get("RELAY_URL")).toBe(`https://${OWN_HOST}`);
    expect(api?.get("RELAY_SEND_TOKEN")).toBe(relay?.get("RELAY_SEND_TOKEN"));
    expect(api?.get("RELAY_APP_URL")).toBe(OWN.appUrl);
    // The mark the dashboard reads, link or none.
    expect(api?.get("RELAY_KIND")).toBe("own");
    const key = await importInstanceKey(api?.get("RELAY_INSTANCE_KEY") ?? "");
    expect(h.ownRegistry.storage(`instance:${key.instance}`).get("record")).toMatchObject({
      status: "registered",
      terms: "none",
    });
    // No terms and no email on an own relay; the generated keys work (handles ok).
    expect(h.out()).not.toMatch(/Terms of Freecorps' relay/);
    expect(h.out()).toMatch(
      /Relay check: brigade-relay \(https:\/\/relay.acme.example\) is reachable and this instance is registered \(APNs ok, FCM ok, handles ok\)/,
    );
    expect(h.out()).toMatch(/Bind the relay to the API as RELAY/);
    expect(h.leaks()).toEqual([]);
  });

  test("run again on a relay with a topic, it says which topic it sets (a changed bundle id cannot be seen)", async () => {
    const h = harness({
      files: OWN_FILES,
      secrets: { "brigade-relay": ["BRIGADE_OWN_RELAY", "RELAY_APNS_TOPIC", "RELAY_CLOSED"] },
    });
    expect(await h.run({ ...OWN, bundleId: "com.acme.pager" })).toBe(0);
    expect(h.out()).toMatch(
      /brigade-relay's topic is set to com\.acme\.pager \(RELAY_APNS_TOPIC\): an app with another bundle id is no longer paged through it/,
    );
    expect(h.secrets.get("brigade-relay")?.get("RELAY_APNS_TOPIC")).toBe("com.acme.pager");
    // A first setup has no topic to change, and says nothing about one.
    const first = harness({ files: OWN_FILES });
    expect(await first.run(OWN)).toBe(0);
    expect(first.out()).not.toMatch(/topic is set to/);
  });

  test("run again, it keeps the relay's handle and tag keys", async () => {
    const h = harness({
      files: OWN_FILES,
      secrets: { "brigade-relay": ["BRIGADE_OWN_RELAY", "RELAY_HANDLE_KEYS", "RELAY_TAG_KEY"] },
    });
    // The fake relay needs real keys to answer the deep health; "kept" ones do not parse, which it reports.
    expect(await h.run(OWN)).toBe(0);
    const bulk = JSON.parse(h.commands.find((c) => c.args[1] === "bulk")?.input ?? "{}") as object;
    expect(Object.keys(bulk)).not.toContain("RELAY_HANDLE_KEYS");
    expect(Object.keys(bulk)).not.toContain("RELAY_TAG_KEY");
    expect(h.out()).toMatch(/keeps its RELAY_HANDLE_KEYS/);
  });

  test("a relay deployed with the old --var flags gets the topic and closed registration as secrets", async () => {
    // Set up by an earlier version of this script: the topic and registration are deployed vars, which a secret of
    // the same name would collide with.
    const old = {
      secrets: {
        "brigade-relay": [
          "BRIGADE_OWN_RELAY",
          "RELAY_SEND_TOKEN",
          "RELAY_HANDLE_KEYS",
          "RELAY_TAG_KEY",
        ],
      },
      vars: {
        "brigade-relay": {
          ...CONFIG_VARS,
          APNS_TOPIC: "com.acme.brigade",
          RELAY_REGISTRATION: "closed",
        },
      },
    };
    // The fake refuses what Cloudflare refuses: a secret named like a deployed var.
    const clash = harness({ files: OWN_FILES, ...old });
    const refused = await clash.deps.run({
      tool: "wrangler",
      args: ["secret", "bulk", "--name", "brigade-relay"],
      cwd: REPO,
      input: JSON.stringify({ RELAY_REGISTRATION: "closed" }),
    });
    expect(refused.code).toBe(1);

    const h = harness({ files: OWN_FILES, ...old });
    expect(await h.run({ ...OWN, yes: true })).toBe(0);
    const first = JSON.parse(h.commands.find((c) => c.args[1] === "bulk")?.input ?? "{}") as object;
    expect(first).toMatchObject({ RELAY_APNS_TOPIC: "com.acme.brigade", RELAY_CLOSED: "1" });
    expect(h.commands.find((c) => c.args[0] === "deploy")?.args).not.toContain("--var");
    // Deployed with no flags, the old vars are gone; the secrets keep the relay closed and on the company's topic:
    // the registration took no terms (only a closed relay allows that) and APNs was asked for that topic.
    expect(h.secrets.get("brigade-relay")?.get("RELAY_CLOSED")).toBe("1");
    const key = await importInstanceKey(
      h.secrets.get("brigade-api")?.get("RELAY_INSTANCE_KEY") ?? "",
    );
    expect(h.ownRegistry.storage(`instance:${key.instance}`).get("record")).toMatchObject({
      status: "registered",
      terms: "none",
    });
    expect(h.ownTopics).toEqual(["com.acme.brigade"]);
  });

  test("a bundle id either store would refuse stops before anything", async () => {
    for (const bundleId of [
      "com.acme-corp.brigade",
      "com.acme_corp.brigade",
      "com.1acme.brigade",
      "brigade",
    ]) {
      const h = harness({ files: OWN_FILES });
      expect((await stopped(h.run({ ...OWN, bundleId }))).message).toMatch(/--bundle-id/);
      expect(h.commands).toEqual([]);
    }
  });

  test("a missing prerequisite stops before anything is deployed", async () => {
    const h = harness({ files: OWN_FILES });
    const stop = await stopped(
      h.run({ ...OWN, fcmServiceAccountFile: undefined, apnsKeyId: "short" }),
    );
    expect(stop.message).toMatch(/Missing what your own relay needs/);
    expect(stop.message).toContain("--apns-key-id (A key id is 10 capital letters and digits.)");
    expect(stop.message).toContain("--fcm-service-account-file");
    expect(h.commands).toEqual([]);

    const notAKey = harness({ files: { ...OWN_FILES, [`${HOME}/keys/fcm.json`]: "{}" } });
    expect((await stopped(notAKey.run(OWN))).message).toMatch(
      /is not a Google service account JSON key/,
    );
    const storeId = harness({ files: OWN_FILES });
    expect(
      (await stopped(storeId.run({ ...OWN, bundleId: "app.freecorps.brigade" }))).message,
    ).toMatch(/store app's/);
  });

  test("asked, an empty answer for a prerequisite stops too", async () => {
    const h = harness({ interactive: true, answers: ["2", ""] });
    const stop = await stopped(h.run({}));
    expect(stop.message).toMatch(/--apns-key-file/);
    expect(h.commands).toEqual([]);
  });

  test("staging has no relay environment", async () => {
    const h = harness({ files: OWN_FILES });
    const stop = await stopped(h.run({ ...OWN, env: "staging" }));
    expect(stop.message).toMatch(/no staging environment/);
    expect(h.commands).toEqual([]);
  });

  test("dev builds and names the dev Workers", async () => {
    const h = harness({ files: OWN_FILES });
    expect(await h.run({ ...OWN, env: "dev" })).toBe(0);
    expect(h.commands.find((c) => c.tool === "vp")?.env).toEqual({ CLOUDFLARE_ENV: "dev" });
    expect(h.secrets.has("brigade-relay-dev")).toBe(true);
    expect(h.secrets.get("brigade-api-dev")?.has("RELAY_INSTANCE_KEY")).toBe(true);
  });
});

describe("not now", () => {
  test("changes nothing and says email still pages", async () => {
    const h = harness({ interactive: true, answers: ["3"] });
    expect(await h.run({})).toBe(0);
    // Email pages only when the API can send it: never said as if it always did.
    expect(h.out()).toMatch(
      /Pages go out by email only if the API can send email \(its EMAIL_FROM secret/,
    );
    expect(h.out()).not.toMatch(/email still pages|Pages still go out by email/);
    expect(h.out()).toMatch(/No phone is paged\./);
    // The dashboard's "Phones and pages" is not built yet: nothing says it shows anything.
    expect(h.out()).not.toMatch(/dashboard/);
    expect(h.commands).toEqual([]);
    expect(h.fetched).toEqual([]);
  });
});

describe("the API's RELAY binding (Freecorps' relay)", () => {
  const VITE_CONFIG = (bindings: string) =>
    `const X = 1;\nconst PRODUCTION_BINDINGS = {\n${bindings}\n};\n\nexport default {};\n`;

  test("found in the production build, removing it is a required step", async () => {
    const h = harness({
      files: {
        [`${REPO}/apps/api/vite.config.ts`]: VITE_CONFIG(
          '  services: [{ binding: "RELAY", service: "brigade-relay" }],\n  ai: { binding: "AI" },',
        ),
      },
    });
    expect(await h.run(FREECORPS)).toBe(0);
    expect(await h.run({ ...FREECORPS, code: h.code(), instanceKeyFile: h.keyFiles()[0] })).toBe(0);
    expect(h.out()).toMatch(
      /REQUIRED, or no phone is paged: remove the API's RELAY service binding \(it is in apps\/api\/vite.config.ts PRODUCTION_BINDINGS\)/,
    );
  });

  const BOUND = VITE_CONFIG(
    '  services: [{ binding: "RELAY", service: "brigade-relay" }],\n  ai: { binding: "AI" },',
  );
  /** brigade-relay as Freecorps' account has it: deployed by hand, so without the own-relay marker. */
  const HOSTED_RELAY_SECRETS = ["APNS_KEY", "RELAY_SEND_TOKEN", "RELAY_HANDLE_KEYS", "EMAIL_FROM"];

  test("to Freecorps' relay itself (Freecorps' own instance), the binding stays", async () => {
    const h = harness({
      files: { [`${REPO}/apps/api/vite.config.ts`]: BOUND },
      secrets: { "brigade-relay": HOSTED_RELAY_SECRETS },
    });
    expect(await h.run(FREECORPS)).toBe(0);
    expect(await h.run({ ...FREECORPS, code: h.code(), instanceKeyFile: h.keyFiles()[0] })).toBe(0);
    expect(h.out()).not.toMatch(/REQUIRED/);
    expect(h.out()).not.toMatch(/remove the API's RELAY service binding \(it is in/);
    expect(h.out()).toMatch(
      /The API's RELAY service binding goes to brigade-relay on this account, which this script did not set up:\n {2}on Freecorps' account that is Freecorps' relay itself, which now knows this instance, so the binding\n {2}stays/,
    );
    // Read from the account (names only), never changed.
    const relayCommands = h.commands.filter((c) => c.args.includes("brigade-relay"));
    expect(relayCommands.map((c) => c.args)).toEqual([
      ["secret", "list", "--name", "brigade-relay", "--format", "json"],
    ]);
    expect(h.secrets.get("brigade-relay")?.size).toBe(HOSTED_RELAY_SECRETS.length);
  });

  test("dev: brigade-relay-dev on this account, set up by hand, is Freecorps' dev relay", async () => {
    const jsonc = `{ "env": { "dev": { "services": [{ "binding": "RELAY", "service": "brigade-relay-dev" }] } } }`;
    const h = harness({
      files: { [`${REPO}/apps/api/wrangler.jsonc`]: jsonc },
      secrets: { "brigade-relay-dev": HOSTED_RELAY_SECRETS },
    });
    const dev = { ...FREECORPS, env: "dev" as const };
    expect(await h.run(dev)).toBe(0);
    expect(await h.run({ ...dev, code: h.code(), instanceKeyFile: h.keyFiles()[0] })).toBe(0);
    expect(h.out()).not.toMatch(/REQUIRED/);
    expect(h.out()).toMatch(/binding goes to brigade-relay-dev on this account/);
  });

  test("a company's own relay, another Worker, none at all or an unreadable account: still required", async () => {
    const cases: Parameters<typeof harness>[0][] = [
      // The relay this script deployed for the company: it does not know an instance registered with Freecorps'.
      {
        files: { [`${REPO}/apps/api/vite.config.ts`]: BOUND },
        secrets: { "brigade-relay": [...HOSTED_RELAY_SECRETS, "BRIGADE_OWN_RELAY"] },
      },
      // Not the hosted relay's Worker name, even though it exists without the marker.
      {
        files: {
          [`${REPO}/apps/api/vite.config.ts`]: VITE_CONFIG(
            '  services: [{ binding: "RELAY", service: "acme-relay" }],',
          ),
        },
        secrets: { "acme-relay": HOSTED_RELAY_SECRETS },
      },
      // A self-hosted copy's default binding, with no relay Worker on the account.
      { files: { [`${REPO}/apps/api/vite.config.ts`]: BOUND } },
      // wrangler cannot say.
      {
        files: { [`${REPO}/apps/api/vite.config.ts`]: BOUND },
        secrets: { "brigade-relay": HOSTED_RELAY_SECRETS },
        listFails: "brigade-relay",
      },
    ];
    for (const setup of cases) {
      const h = harness(setup);
      expect(await h.run(FREECORPS)).toBe(0);
      expect(await h.run({ ...FREECORPS, code: h.code(), instanceKeyFile: h.keyFiles()[0] })).toBe(
        0,
      );
      expect(h.out()).toMatch(
        /REQUIRED, or no phone is paged: remove the API's RELAY service binding \(it is in apps\/api\/vite.config.ts PRODUCTION_BINDINGS\)/,
      );
      expect(h.out()).not.toMatch(/Freecorps' relay itself/);
    }
  });

  test("not there, no such step", async () => {
    const h = harness({
      files: { [`${REPO}/apps/api/vite.config.ts`]: VITE_CONFIG('  ai: { binding: "AI" },') },
    });
    expect(await h.run(FREECORPS)).toBe(0);
    expect(await h.run({ ...FREECORPS, code: h.code(), instanceKeyFile: h.keyFiles()[0] })).toBe(0);
    expect(h.out()).not.toMatch(/REQUIRED/);
  });

  test("dev reads wrangler.jsonc, comments, URLs and trailing commas included", async () => {
    const jsonc = `{
  // a comment with "quotes"
  "name": "brigade-api", /* block */
  "vars": { "X": "https://example.com//path" },
  "env": {
    "dev": { "services": [{ "binding": "RELAY", "service": "brigade-relay-dev" },], },
    "staging": {},
  },
}`;
    const h = harness({ files: { [`${REPO}/apps/api/wrangler.jsonc`]: jsonc } });
    const dev = { ...FREECORPS, env: "dev" as const };
    expect(await h.run(dev)).toBe(0);
    expect(await h.run({ ...dev, code: h.code(), instanceKeyFile: h.keyFiles()[0] })).toBe(0);
    expect(h.out()).toMatch(
      /remove the API's RELAY service binding \(it is in apps\/api\/wrangler.jsonc env.dev/,
    );

    const staging = harness({ files: { [`${REPO}/apps/api/wrangler.jsonc`]: jsonc } });
    const stage = { ...FREECORPS, env: "staging" as const };
    expect(await staging.run(stage)).toBe(0);
    expect(
      await staging.run({ ...stage, code: staging.code(), instanceKeyFile: staging.keyFiles()[0] }),
    ).toBe(0);
    expect(staging.out()).not.toMatch(/REQUIRED/);
  });
});

describe("what a switch removes from the API", () => {
  async function finish(h: ReturnType<typeof harness>) {
    expect(await h.run({ ...FREECORPS, yes: true })).toBe(0);
    expect(
      await h.run({ ...FREECORPS, yes: true, code: h.code(), instanceKeyFile: h.keyFiles()[0] }),
    ).toBe(0);
    return h.secrets.get("brigade-api");
  }

  test("from an own relay (RELAY_APP_URL), its send token goes with its link", async () => {
    const h = harness({
      secrets: {
        "brigade-api": [
          "RELAY_INSTANCE_KEY",
          "RELAY_URL",
          "RELAY_APP_URL",
          "RELAY_SEND_TOKEN",
          "BRIGADE_SEND_PAIR_old",
        ],
      },
    });
    const api = await finish(h);
    expect(api?.has("RELAY_SEND_TOKEN")).toBe(false);
    expect(api?.has("RELAY_APP_URL")).toBe(false);
    // Its pair marker too: left behind, it would vouch for a token the API no longer has.
    expect([...(api?.keys() ?? [])].some((name) => name.startsWith("BRIGADE_SEND_PAIR_"))).toBe(
      false,
    );
  });

  test("from an own relay with no link (RELAY_KIND), its mark and send token go too", async () => {
    const h = harness({
      secrets: {
        "brigade-api": [
          "RELAY_INSTANCE_KEY",
          "RELAY_URL",
          "RELAY_KIND",
          "RELAY_SEND_TOKEN",
          "BRIGADE_SEND_PAIR_old",
        ],
      },
    });
    const api = await finish(h);
    expect(api?.has("RELAY_KIND")).toBe(false);
    expect(api?.has("RELAY_SEND_TOKEN")).toBe(false);
    expect([...(api?.keys() ?? [])].some((name) => name.startsWith("BRIGADE_SEND_PAIR_"))).toBe(
      false,
    );
  });

  test("an instance with no RELAY_APP_URL (ours) keeps its send token", async () => {
    const h = harness({
      secrets: { "brigade-api": ["RELAY_INSTANCE_KEY", "RELAY_URL", "RELAY_SEND_TOKEN"] },
    });
    const api = await finish(h);
    expect(api?.get("RELAY_SEND_TOKEN")).toBe("kept");
  });

  test("a reused key file still warns, and RELAY_INSTANCE_ID stays without the confirmation", async () => {
    const key = await generateInstanceKey();
    const file = `${HOME}/vault/key`;
    const had = { "brigade-api": ["RELAY_INSTANCE_KEY", "RELAY_INSTANCE_ID"] };
    const h = harness({ secrets: had, files: { [file]: key.privateKey } });
    const stop = await stopped(h.run({ ...FREECORPS, instanceKeyFile: file }));
    expect(stop.message).toMatch(/Pass --yes/);
    expect(h.out()).toMatch(/already has a relay set up/);
    expect(h.secrets.get("brigade-api")?.has("RELAY_INSTANCE_ID")).toBe(true);
    expect(h.commands.filter((c) => c.args[1] === "bulk")).toEqual([]);

    // RELAY_INSTANCE_ID with no RELAY_INSTANCE_KEY: nothing works to confirm replacing, and the id would make the API
    // sign as another instance with the new key, so it goes with no question.
    const odd = harness({ secrets: { "brigade-api": ["RELAY_INSTANCE_ID"] } });
    expect(await odd.run(FREECORPS)).toBe(0);
    expect(
      await odd.run({ ...FREECORPS, code: odd.code(), instanceKeyFile: odd.keyFiles()[0] }),
    ).toBe(0);
    expect(odd.questions).toEqual([]);
    expect(odd.secrets.get("brigade-api")?.has("RELAY_INSTANCE_ID")).toBe(false);
    expect(odd.secrets.get("brigade-api")?.has("RELAY_INSTANCE_KEY")).toBe(true);
  });

  test("an own relay removes a stale RELAY_INSTANCE_ID too", async () => {
    const h = harness({ files: OWN_FILES, secrets: { "brigade-api": ["RELAY_INSTANCE_ID"] } });
    expect(await h.run(OWN)).toBe(0);
    expect(h.secrets.get("brigade-api")?.has("RELAY_INSTANCE_ID")).toBe(false);
  });
});

describe("where the instance key is saved", () => {
  test("never inside the repository: a `..keys` folder, or a symlink into it", async () => {
    const dots = harness();
    expect((await stopped(dots.run({ ...FREECORPS, keyOut: `${REPO}/..keys/k` }))).message).toMatch(
      /inside the repository/,
    );
    const linked = harness({ links: { [`${HOME}/vault`]: `${REPO}/secrets` } });
    expect(
      (await stopped(linked.run({ ...FREECORPS, keyOut: `${HOME}/vault/k` }))).message,
    ).toMatch(/inside the repository/);
    expect(linked.files.size).toBe(0);
    // A sibling folder whose name starts like the repository's is outside it.
    const sibling = harness();
    expect(await sibling.run({ ...FREECORPS, keyOut: `${REPO}-keys/k` })).toBe(0);
    expect(sibling.files.has(`${REPO}-keys/k`)).toBe(true);
  });
});

describe("reading secret names", () => {
  test("a relay list that fails stops before anything changes; --assume-new-relay goes on", async () => {
    const h = harness({
      files: OWN_FILES,
      secrets: { "brigade-relay": ["BRIGADE_OWN_RELAY", "RELAY_HANDLE_KEYS", "RELAY_TAG_KEY"] },
      listFails: "brigade-relay",
    });
    const stop = await stopped(h.run(OWN));
    expect(stop.message).toMatch(
      /could not list the secrets of brigade-relay .*nothing was changed/s,
    );
    expect(stop.message).toContain("[code: 971]");
    expect(stop.message).toContain("--assume-new-relay");
    expect(order(h)).toEqual([
      "wrangler secret list brigade-api",
      "wrangler secret list brigade-relay",
    ]);
    expect(h.secrets.get("brigade-relay")?.get("RELAY_HANDLE_KEYS")).toBe("kept");

    const assumed = harness({ files: OWN_FILES, listFails: "brigade-relay" });
    expect(await assumed.run({ ...OWN, assumeNewRelay: true })).toBe(0);
    expect(assumed.secrets.get("brigade-relay")?.has("RELAY_HANDLE_KEYS")).toBe(true);
  });

  test("the API's list failing, or the API missing, stops too", async () => {
    const failing = harness({ listFails: "brigade-api" });
    expect((await stopped(failing.run(FREECORPS))).message).toMatch(
      /could not list the secrets of brigade-api/,
    );
    expect(failing.fetched).toEqual([]);
    const missing = harness({ missing: ["brigade-api"] });
    expect((await stopped(missing.run(FREECORPS))).message).toMatch(
      /brigade-api does not exist on this account yet: deploy the API first/,
    );
    expect(missing.fetched).toEqual([]);
  });

  test("a relay Worker this script did not set up is not taken over without --take-over-relay", async () => {
    const theirs = { "brigade-relay": ["APNS_KEY", "RELAY_SEND_TOKEN", "RELAY_HANDLE_KEYS"] };
    const h = harness({ files: OWN_FILES, secrets: theirs });
    const stop = await stopped(h.run(OWN));
    expect(stop.message).toMatch(/was not set up by this script\. Nothing was changed/);
    expect(stop.message).toContain("--take-over-relay");
    expect(order(h)).toEqual([
      "wrangler secret list brigade-api",
      "wrangler secret list brigade-relay",
    ]);

    const taken = harness({ files: OWN_FILES, secrets: theirs });
    expect(await taken.run({ ...OWN, takeOverRelay: true })).toBe(0);
    expect(taken.secrets.get("brigade-relay")?.get("RELAY_HANDLE_KEYS")).toBe("kept");
    expect(taken.secrets.get("brigade-relay")?.has("BRIGADE_OWN_RELAY")).toBe(true);
  });
});

describe("an own relay that stops halfway keeps paging", () => {
  // A relay this script set up before, and an API paging through it with the same send token (the shared pair marker
  // says so).
  const PAIR = "BRIGADE_SEND_PAIR_0A0B0C0D0E0F";
  const BEFORE = {
    "brigade-relay": [
      "BRIGADE_OWN_RELAY",
      "RELAY_SEND_TOKEN",
      PAIR,
      "RELAY_HANDLE_KEYS",
      "RELAY_TAG_KEY",
    ],
    "brigade-api": ["RELAY_INSTANCE_KEY", "RELAY_URL", "RELAY_SEND_TOKEN", PAIR],
  };
  const paging = (h: ReturnType<typeof harness>) => {
    const relay = h.secrets.get("brigade-relay")?.get("RELAY_SEND_TOKEN");
    expect(relay).toBeDefined();
    expect(h.secrets.get("brigade-api")?.get("RELAY_SEND_TOKEN")).toBe(relay);
  };
  const steps: [string, () => (c: Command) => boolean, RegExp][] = [
    ["the build", () => (c) => c.tool === "vp", /Building apps\/relay failed/],
    [
      "the relay's secrets",
      () => {
        let bulks = 0;
        return (c) => c.args[1] === "bulk" && c.args.includes("brigade-relay") && ++bulks === 1;
      },
      /could not set the secrets of brigade-relay.*The API is unchanged/s,
    ],
    [
      "the deploy",
      () => (c) => c.args[0] === "deploy",
      // The secrets went on before the deploy, and a secret write is live: said, not "as before".
      /Deploying brigade-relay failed.*The API is unchanged\. brigade-relay may already run with this run's secrets \(topic com\.acme\.brigade, closed registration\)/s,
    ],
    [
      "the API's secrets",
      () => (c) => c.args[1] === "bulk" && c.args.includes("brigade-api"),
      /could not set the secrets of brigade-api/,
    ],
  ];
  for (const [step, failing, message] of steps) {
    test(`stopped at ${step}`, async () => {
      const h = harness({ files: OWN_FILES, secrets: BEFORE, failing: failing() });
      expect((await stopped(h.run({ ...OWN, yes: true }))).message).toMatch(message);
      paging(h);
      expect(h.secrets.get("brigade-api")?.get("RELAY_SEND_TOKEN")).toBe("kept");
    });
  }

  test("stopped by a domain that never comes up, after a bounded wait", async () => {
    const h = harness({ files: OWN_FILES, secrets: BEFORE, ownDown: Infinity });
    const stop = await stopped(h.run({ ...OWN, yes: true }));
    expect(stop.message).toMatch(
      /still does not answer as the relay after 5 minutes.*The API is unchanged/s,
    );
    expect(h.sleeps).toHaveLength(29);
    paging(h);
  });

  test("stopped by a refused registration", async () => {
    const h = harness({ files: OWN_FILES, secrets: BEFORE });
    h.ownRegistry.failing = true;
    const stop = await stopped(h.run({ ...OWN, yes: true }));
    expect(stop.message).toMatch(/registry did not answer.*The API is unchanged/s);
    paging(h);
  });

  test("a domain that comes up after a while is waited for", async () => {
    const h = harness({ files: OWN_FILES, secrets: BEFORE, ownDown: 3 });
    expect(await h.run({ ...OWN, yes: true })).toBe(0);
    expect(h.sleeps).toEqual([10_000, 10_000, 10_000]);
  });

  test("finished, a relay and API that both had a send token keep it", async () => {
    const h = harness({ files: OWN_FILES, secrets: BEFORE });
    expect(await h.run({ ...OWN, yes: true })).toBe(0);
    paging(h);
    expect(h.secrets.get("brigade-relay")?.get("RELAY_SEND_TOKEN")).toBe("kept");
    expect(h.secrets.get("brigade-relay")?.has("RELAY_ADMIN_TOKEN")).toBe(false);
    for (const c of h.commands.filter((c) => c.args[1] === "bulk")) {
      expect(Object.keys(JSON.parse(c.input ?? "{}") as object)).not.toContain("RELAY_SEND_TOKEN");
    }
  });

  test("a relay with a token the API lacks gets a new one only after registering, right before the API", async () => {
    const lacking = { ...BEFORE, "brigade-api": ["RELAY_URL"] };
    const refused = harness({ files: OWN_FILES, secrets: lacking });
    refused.ownRegistry.failing = true;
    await stopped(refused.run(OWN));
    expect(refused.secrets.get("brigade-relay")?.get("RELAY_SEND_TOKEN")).toBe("kept");

    const h = harness({ files: OWN_FILES, secrets: lacking });
    expect(await h.run(OWN)).toBe(0);
    paging(h);
    expect(h.secrets.get("brigade-relay")?.get("RELAY_SEND_TOKEN")).not.toBe("kept");
    expect(order(h).slice(-2)).toEqual([
      "wrangler secret bulk brigade-relay",
      "wrangler secret bulk brigade-api",
    ]);
    const relayStep = JSON.parse(h.commands.at(-2)?.input ?? "{}") as Record<string, unknown>;
    const newPair = Object.keys(relayStep).find((k) => k.startsWith(SEND_PAIR) && k !== PAIR);
    expect(relayStep).toEqual({
      RELAY_SEND_TOKEN: expect.any(String),
      [PAIR]: null,
      [newPair ?? "missing"]: "setup-relay",
      RELAY_ADMIN_TOKEN: null,
    });
    expect(h.secrets.get("brigade-api")?.has(newPair ?? "missing")).toBe(true);
  });

  test("names alone do not keep a send token: without a shared pair marker both get a new one", async () => {
    // Both have a token, but nothing shows they are the same one (set by hand, or by an earlier relay).
    const unpaired = {
      "brigade-relay": BEFORE["brigade-relay"].filter((n) => n !== PAIR),
      "brigade-api": [
        "RELAY_INSTANCE_KEY",
        "RELAY_URL",
        "RELAY_SEND_TOKEN",
        "BRIGADE_SEND_PAIR_FFFF",
      ],
    };
    const h = harness({ files: OWN_FILES, secrets: unpaired });
    expect(await h.run({ ...OWN, yes: true })).toBe(0);
    paging(h);
    expect(h.secrets.get("brigade-api")?.get("RELAY_SEND_TOKEN")).not.toBe("kept");
    const pairs = (worker: string) =>
      [...(h.secrets.get(worker)?.keys() ?? [])].filter((k) => k.startsWith(SEND_PAIR));
    expect(pairs("brigade-api")).toEqual(pairs("brigade-relay"));
    expect(pairs("brigade-api")).toHaveLength(1);
  });

  test("a run that stopped with the tokens apart is put right by the next one", async () => {
    // The relay had no token: it gets one before the deploy, which then fails. The API keeps its old one.
    const apart = {
      "brigade-relay": ["BRIGADE_OWN_RELAY", "RELAY_HANDLE_KEYS", "RELAY_TAG_KEY"],
      "brigade-api": ["RELAY_INSTANCE_KEY", "RELAY_URL", "RELAY_SEND_TOKEN"],
    };
    let fail = true;
    const h = harness({
      files: OWN_FILES,
      secrets: apart,
      failing: (c) => fail && c.args[0] === "deploy",
    });
    await stopped(h.run({ ...OWN, yes: true }));
    const relayToken = h.secrets.get("brigade-relay")?.get("RELAY_SEND_TOKEN");
    expect(relayToken).not.toBe(h.secrets.get("brigade-api")?.get("RELAY_SEND_TOKEN"));
    // Both now have a token by name, but no shared pair: the rerun replaces both.
    fail = false;
    expect(await h.run({ ...OWN, yes: true })).toBe(0);
    paging(h);
  });
});

describe("an own relay's provider credentials", () => {
  const LIVE = {
    "brigade-relay": [
      "BRIGADE_OWN_RELAY",
      "APNS_KEY",
      "APNS_KEY_ID",
      "APNS_TEAM_ID",
      "FCM_SERVICE_ACCOUNT",
      "RELAY_HANDLE_KEYS",
      "RELAY_TAG_KEY",
    ],
  };
  const sent = (h: ReturnType<typeof harness>) =>
    Object.keys(JSON.parse(h.commands.find((c) => c.args[1] === "bulk")?.input ?? "{}") as object);

  test("a relay's live credentials are kept unless asked to replace them", async () => {
    const h = harness({ files: OWN_FILES, secrets: LIVE });
    expect(await h.run(OWN)).toBe(0);
    expect(sent(h)).not.toContain("APNS_KEY");
    expect(sent(h)).not.toContain("FCM_SERVICE_ACCOUNT");
    expect(h.secrets.get("brigade-relay")?.get("APNS_KEY")).toBe("kept");
    expect(h.out()).toMatch(/keeps its APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID, FCM_SERVICE_ACCOUNT/);

    const asked = harness({
      interactive: true,
      files: OWN_FILES,
      secrets: LIVE,
      answers: ["y", "n"],
    });
    expect(await asked.run(OWN)).toBe(0);
    expect(asked.questions[1]).toMatch(/already has APNS_KEY.*Replace them/);
    expect(asked.secrets.get("brigade-relay")?.get("APNS_KEY")).toBe("kept");
  });

  test("replaced on request, and a stop after that says so instead of claiming nothing changed", async () => {
    const h = harness({
      files: OWN_FILES,
      secrets: LIVE,
      failing: (c) => c.args[0] === "deploy",
    });
    const stop = await stopped(h.run({ ...OWN, replaceCredentials: true }));
    expect(stop.message).toMatch(/Its APNS_KEY, .* were replaced: if they are wrong/);
    expect(stop.message).not.toMatch(/pages go out as they did before/);
    expect(h.secrets.get("brigade-relay")?.get("APNS_KEY")).toBe(APNS_KEY.trim());
  });

  test("keys that are not an APNs EC key or an RSA service account key are refused before anything", async () => {
    const rsaPem = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    const notApns = harness({
      files: { ...OWN_FILES, [`${HOME}/keys/AuthKey_ABCDE12345.p8`]: rsaPem },
    });
    expect((await stopped(notApns.run(OWN))).message).toMatch(/is not an APNs .p8 key/);
    expect(notApns.commands).toEqual([]);
    const badFcm = JSON.stringify({ ...JSON.parse(FCM_SERVICE_ACCOUNT), private_key: APNS_KEY });
    const notRsa = harness({ files: { ...OWN_FILES, [`${HOME}/keys/fcm.json`]: badFcm } });
    expect((await stopped(notRsa.run(OWN))).message).toMatch(/is not a Google service account/);
    expect(notRsa.commands).toEqual([]);
  });
});

describe("the commands it starts", () => {
  test("never inherit the shell's CLOUDFLARE_ENV or this script's NODE_OPTIONS; --env alone picks the config", () => {
    const shell = {
      PATH: "/bin",
      CLOUDFLARE_ENV: "dev",
      NODE_OPTIONS: "--conditions=@freecorps/source",
    } as unknown as NodeJS.ProcessEnv; // the Worker's own env types augment ProcessEnv
    expect(childEnv(shell)).toEqual({ PATH: "/bin" });
    expect(childEnv(shell, { CLOUDFLARE_ENV: "dev" })).toEqual({
      PATH: "/bin",
      CLOUDFLARE_ENV: "dev",
    });
  });
});
