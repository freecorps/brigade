// Adding an instance (RFC 0015 section 5 "Checking the address"): the address the member typed or scanned, read as a
// dashboard origin, and what the instance's `GET /api/config` says about it before anyone signs in there. Pure, so it
// is tested in Node; src/screens/connect.tsx asks it with fetch and this build's relay.
import { originOf } from "@/lib/instances";
import { FREECORPS_BRIGADE, RELAY_TIMEOUT_MS } from "@/lib/relay";

/** Why an address is not one the app goes to. */
export type AddressProblem =
  /** Not a web address at all. */
  | "invalid"
  /** `http://` outside a development build on a private address: the session would cross the network in clear. */
  | "insecure";

/**
 * The dashboard origin in what the member typed: `brigade.example.com` reads as `https://brigade.example.com`, and a
 * path or query is dropped (the API is always under the origin's `/api`). HTTPS only; `dev` (a development build) also
 * allows `http://` on a private address (this machine, the LAN, the Simulator's host).
 */
export function readAddress(
  input: string,
  dev: boolean,
): { origin: string } | { problem: AddressProblem } {
  const value = input.trim();
  if (value === "" || /\s/.test(value)) return { problem: "invalid" };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { problem: "invalid" };
  }
  const origin = originOf(withScheme);
  // A credential in the address would be sent with every request; no host is no instance.
  if (origin === undefined || !url.hostname || url.username || url.password) {
    return { problem: "invalid" };
  }
  if (url.protocol === "http:" && !(dev && privateHost(url.hostname)))
    return { problem: "insecure" };
  return { origin };
}

/** This machine, a private network (RFC 1918, link-local, unique local) or a `.local` name. */
export function privateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host) || host.startsWith("fe80:")) return true;
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return false;
  const [a, b] = parts.map(Number) as [number, number];
  return (
    a === 127 ||
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254)
  );
}

/** What the instance's `/config` said, read for adding it (src/lib/relay.ts `parseConfig` reads it for registering). */
export type AddressConfig =
  /** No answer, a server error or a timeout: maybe the network, maybe the instance; try again. */
  | { kind: "unreachable" }
  /** An answer that is not a Brigade's `/config` (a 404, a web page, other JSON). */
  | { kind: "not-brigade" }
  | {
      kind: "brigade";
      /** `brigade.minApp`: the oldest app version it supports; absent on an instance from before step 3. */
      minApp?: string;
      /** `relay.origin`, `relay.app`: absent when it cannot page through a relay with handles. */
      relay?: { origin: string; app?: string };
    };

/**
 * `/config` as an answer to "is this a Brigade?": a Brigade's has `brigade` (from step 3 on) or the sign-up mode every
 * Brigade has served since RFC 0002 (`signUp`), so an instance from before step 3 is still one.
 */
export function readAddressConfig(status: number, body: unknown): AddressConfig {
  if (status >= 500 || status === 429) return { kind: "unreachable" };
  if (status < 200 || status >= 300) return { kind: "not-brigade" };
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { kind: "not-brigade" };
  }
  const { brigade, signUp, relay } = body as Record<string, unknown>;
  const versioned = typeof brigade === "object" && brigade !== null && !Array.isArray(brigade);
  if (!versioned && typeof signUp !== "string") return { kind: "not-brigade" };
  const minApp = versioned ? Reflect.get(brigade, "minApp") : undefined;
  let relayOf: { origin: string; app?: string } | undefined;
  if (typeof relay === "object" && relay !== null) {
    const { origin, app } = relay as Record<string, unknown>;
    const relayOrigin = typeof origin === "string" ? originOf(origin) : undefined;
    if (relayOrigin !== undefined) {
      relayOf = {
        origin: relayOrigin,
        ...(typeof app === "string" && app.startsWith("https://") ? { app } : {}),
      };
    }
  }
  return {
    kind: "brigade",
    ...(typeof minApp === "string" && parseVersion(minApp) ? { minApp } : {}),
    ...(relayOf ? { relay: relayOf } : {}),
  };
}

type Fetch = (url: string, init: RequestInit) => Promise<Pick<Response, "status" | "json">>;

/** `GET <origin>/api/config` within `RELAY_TIMEOUT_MS`; never throws. */
export async function loadAddressConfig(origin: string, fetcher: Fetch): Promise<AddressConfig> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), RELAY_TIMEOUT_MS);
  try {
    const response = await fetcher(`${origin}/api/config`, {
      headers: { accept: "application/json" },
      signal: abort.signal,
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return readAddressConfig(response.status, body);
  } catch {
    return { kind: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The answer to adding an instance:
 * - `not-brigade`, `unreachable`: nothing to add;
 * - `update-app`: this app is older than the instance supports;
 * - `own-app`: it pages through another relay, so only through its own app build: it would sign in and never be
 *   paged here (`app`: that build's link, when `/config` has one);
 * - `no-relay`: sign-in allowed, but it cannot page this phone (no push set up, or from before relay handles);
 * - `ok`.
 */
export type AddressVerdict =
  | { kind: "not-brigade" }
  | { kind: "unreachable" }
  | { kind: "update-app"; minApp: string }
  | { kind: "own-app"; relay: string; app?: string }
  | { kind: "no-relay" }
  | { kind: "ok"; relay: string };

/**
 * `config` judged for this app: `appVersion` (the build's), `thisBuild` (this build's relay; undefined while it is not
 * known, when no instance can be told to be foreign, as src/lib/relay.ts `relayPlan` does) and whether `origin` is the
 * build's default instance (never foreign: the build was made for it).
 */
export function judgeAddress(
  config: AddressConfig,
  input: { appVersion: string | undefined; thisBuild: string | undefined; isDefault: boolean },
): AddressVerdict {
  if (config.kind !== "brigade") return { kind: config.kind };
  if (config.minApp && input.appVersion && olderVersion(input.appVersion, config.minApp)) {
    return { kind: "update-app", minApp: config.minApp };
  }
  if (!config.relay) return input.isDefault ? { kind: "ok", relay: "" } : { kind: "no-relay" };
  if (
    !input.isDefault &&
    input.thisBuild !== undefined &&
    config.relay.origin !== input.thisBuild
  ) {
    return {
      kind: "own-app",
      relay: config.relay.origin,
      ...(config.relay.app ? { app: config.relay.app } : {}),
    };
  }
  return { kind: "ok", relay: config.relay.origin };
}

/** `1.2.3` as numbers; undefined for anything else (a pre-release suffix is ignored). */
export function parseVersion(value: string): [number, number, number] | undefined {
  const match = /^(\d{1,6})\.(\d{1,6})(?:\.(\d{1,6}))?(?:[-+].*)?$/.exec(value.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

/** Whether version `a` is older than `b`; false when either does not read (never blocks on a typo). */
export function olderVersion(a: string, b: string): boolean {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index++) {
    if (left[index]! !== right[index]!) return left[index]! < right[index]!;
  }
  return false;
}

/** The host as the app names it in full ("You are signing in to brigade.example.com"), with a port when it has one. */
export function hostOf(origin: string): string {
  return origin.replace(/^[a-z]+:\/\//i, "");
}

/**
 * How the app names an instance in a list: Freecorps' hosted Brigade as "Freecorps", every other by its host. The full
 * host is always on its details sheet.
 */
export function instanceLabel(origin: string): string {
  return origin === FREECORPS_BRIGADE ? "Freecorps" : hostOf(origin);
}
