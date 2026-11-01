// This instance's identity on the relay (RFC 0015 sections 1 and 7): its Ed25519 key (`RELAY_INSTANCE_KEY`), the
// signed calls made with it (`POST /v1/send`, `GET /v1/health?deep=1`), and what `GET /config` tells the app so it can
// mint handles for this instance. Signing is `@freecorps/brigade-push/instance`, the same module the relay verifies
// with, so the signed string never drifts between them.

import { importInstanceKey, signRequest, type InstanceKey } from "@freecorps/brigade-push/instance";

export type RelayInstanceEnv = {
  /** The relay Worker on this account, as a service binding: every relay call goes through it when bound. */
  RELAY?: Env["RELAY"];
  /**
   * The relay's base URL: where calls go when it is not bound, and, bound or not, the address `GET /config` gives the
   * app to mint handles at (its origin). A secret, so hostnames stay out of the repo.
   */
  RELAY_URL?: string;
  /**
   * The instance's Ed25519 private key, PKCS#8 in base64url (RFC 0015 section 1, made and registered by the setup
   * script). With it, devices registered with a relay handle are paged through `POST /v1/send` and the watchdog's
   * deep check is signed. Optional: without it only raw-token devices are paged (`RELAY_SEND_TOKEN`).
   */
  RELAY_INSTANCE_KEY?: string;
  /**
   * The instance's id on the relay (`ins_…`), for an instance whose key was rotated (RFC 0015 section 1): the id
   * comes from the first key and never changes, so after a rotation the key held now gives another id. Every handle
   * was sealed for the first id, so signing as any other would make the relay answer `handle_not_yours` for each.
   * Optional: without it, the id is the one the key gives (right until the first rotation).
   */
  RELAY_INSTANCE_ID?: string;
  /**
   * The store link of the company's own app build, for an instance on its own relay (RFC 0015 section 8): `GET
   * /config` gives it as `relay.app`, so the store app can send people there. Optional, https only.
   */
  RELAY_APP_URL?: string;
};

export type Fetch = (request: Request) => Promise<Response>;

/** The host of a call through the `RELAY` binding: never resolved, only the path matters. */
export const RELAY_BINDING_ORIGIN = "https://relay.internal";
export const RELAY_V1_SEND_PATH = "/v1/send";
export const RELAY_V1_DEEP_HEALTH_PATH = "/v1/health?deep=1";

/**
 * The version of what the apps rely on in this API (`GET /config` `brigade.api`): raised only by a change an app must
 * know about.
 */
export const BRIGADE_API_VERSION = 1;
/**
 * The oldest app version this instance supports (`GET /config` `brigade.minApp`, RFC 0015 section 5): an older app
 * says "Update the app". Raised when the API drops something old apps need (raw tokens, envelope version 1: Q29).
 */
export const MIN_APP_VERSION = "0.1.0";

/** Keys read per isolate, by the secrets' values: importing is WebCrypto work, done once. */
const keys = new Map<string, Promise<InstanceKey | undefined>>();

const INSTANCE_ID = /^ins_[A-Za-z0-9_-]{22}$/;

/**
 * The instance key from `RELAY_INSTANCE_KEY`, signing as `RELAY_INSTANCE_ID` when set (a rotated key) and as the id
 * the key gives otherwise. Undefined without a key, with one that is not an Ed25519 private key, or with an id that is
 * not one (logged once per isolate, never the key).
 */
export function instanceKey(
  env: Pick<RelayInstanceEnv, "RELAY_INSTANCE_KEY" | "RELAY_INSTANCE_ID">,
): Promise<InstanceKey | undefined> {
  const secret = env.RELAY_INSTANCE_KEY?.trim();
  if (!secret) return Promise.resolve(undefined);
  const id = env.RELAY_INSTANCE_ID?.trim() || undefined;
  const cacheKey = `${id ?? ""}\n${secret}`;
  let key = keys.get(cacheKey);
  if (!key) {
    key = (async () => {
      if (id !== undefined && !INSTANCE_ID.test(id)) {
        problem(
          "RELAY_INSTANCE_ID is not an instance id (ins_ and 22 base64url characters); the key is not used",
        );
        return undefined;
      }
      try {
        const imported = await importInstanceKey(secret);
        return id === undefined ? imported : { ...imported, instance: id };
      } catch (error) {
        problem(
          "RELAY_INSTANCE_KEY is not an Ed25519 private key (PKCS#8, base64url); ignored",
          String(error),
        );
        return undefined;
      }
    })();
    keys.set(cacheKey, key);
  }
  return key;
}

function problem(message: string, error?: string): void {
  console.error(JSON.stringify({ message, ...(error === undefined ? {} : { error }) }));
}

/** Whether a relay can be reached at all: through the binding or at `RELAY_URL`. */
export function relayReachable(env: Pick<RelayInstanceEnv, "RELAY" | "RELAY_URL">): boolean {
  return Boolean(env.RELAY || env.RELAY_URL);
}

/**
 * One call to the relay signed with the instance key (`Brigade-*` headers over method, path with query, instance,
 * timestamp and the body's SHA-256): through the `RELAY` binding when bound, else at `RELAY_URL` through `send`. The
 * path signed is the one of the URL requested, as the relay parses it. Rejects like an unreachable relay for a bad
 * `RELAY_URL`.
 */
export async function signedRelayCall(
  env: Pick<RelayInstanceEnv, "RELAY" | "RELAY_URL">,
  send: Fetch,
  key: InstanceKey,
  call: { method: "GET" | "POST"; path: string; body?: string; signal?: AbortSignal },
): Promise<Response> {
  const binding = env.RELAY;
  const url = new URL(call.path, binding ? RELAY_BINDING_ORIGIN : env.RELAY_URL);
  const body = call.body ?? "";
  const headers = new Headers(
    await signRequest({
      privateKey: key.privateKey,
      publicKey: key.publicKey,
      instance: key.instance,
      method: call.method,
      path: url.pathname + url.search,
      body,
      now: Date.now(),
    }),
  );
  if (call.body !== undefined) headers.set("Content-Type", "application/json");
  const request = new Request(url, {
    method: call.method,
    headers,
    ...(call.body !== undefined ? { body } : {}),
    ...(call.signal ? { signal: call.signal } : {}),
  });
  return binding ? binding.fetch(request) : send(request);
}

/**
 * `GET /config`'s `relay` (RFC 0015 sections 5 and 7): the relay's public origin (from `RELAY_URL`, an https URL, or
 * http on a loopback host for local runs), this instance's id and, for an own app build, its store link. Undefined
 * when phones cannot be paged with handles here (no key, or no relay address the app could reach): the app then signs
 * in without registering the phone. Nothing secret.
 */
export async function relayConfig(
  env: RelayInstanceEnv,
): Promise<{ origin: string; instance: string; app?: string } | undefined> {
  const origin = publicOrigin(env.RELAY_URL);
  if (origin === undefined) return undefined;
  const key = await instanceKey(env);
  if (!key) return undefined;
  const app = publicOrigin(env.RELAY_APP_URL, true);
  return { origin, instance: key.instance, ...(app === undefined ? {} : { app }) };
}

/** An https URL's origin (or the whole URL with `whole`); http only on a loopback host. Undefined for anything else. */
function publicOrigin(raw: string | undefined, whole = false): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return undefined;
  return whole ? url.href : url.origin;
}
