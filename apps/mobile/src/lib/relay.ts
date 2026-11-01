// Relay handles (RFC 0015 sections 2, 5 and 7): what an instance's `GET /api/config` says about its relay, which relay
// this app build is paged through, and the handle the app keeps per instance. The app asks the relay for a handle
// (`POST <relay>/v1/handles`) straight, never through the instance, and registers the handle instead of its tokens.
// Fallback (a paging path): an instance without a relay in `/config`, or a relay that does not answer, gets the raw
// tokens exactly as before. Pure, so it is tested in Node; src/lib/phone.ts wires it to fetch and secure storage.
import type { DeviceRegistration, HandleRegistration } from "@/lib/device";
import { originOf } from "@/lib/instances";

/** Freecorps' hosted Brigade (RFC 0002) and its relay (Q31): the store build's defaults. */
export const FREECORPS_BRIGADE = "https://brigade.freecorps.com.br";
export const FREECORPS_RELAY = "https://relay.brigade.freecorps.com.br";

/** A handle older than this is asked for again: it carries a relay key rotation to the phone (Q30). */
export const HANDLE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** How long a `/config` or `/v1/handles` request may take before registering goes on without it. */
export const RELAY_TIMEOUT_MS = 8_000;

const INSTANCE_ID = /^ins_[A-Za-z0-9_-]{22}$/;
const HANDLE = /^[A-Za-z0-9]{1,16}\.[A-Za-z0-9_-]{16,2048}$/;
const TAG = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

/** The relay an instance's `/config` names: where the app mints handles and the instance's id there. */
export type InstanceRelay = { origin: string; instance: string; app?: string };

/**
 * What `GET /api/config` said. `brigade`: an instance from step 3 on (it knows `envelope` and handles); without it, an
 * older Brigade, which refuses keys it does not know in `device.register`. `unreachable`: no answer, or not JSON.
 */
export type InstanceConfig =
  | { kind: "brigade"; versioned: boolean; relay?: InstanceRelay }
  | { kind: "unreachable" };

/** `/config`'s answer, read strictly: a relay with a bad origin or instance id is no relay. */
export function parseConfig(body: unknown): InstanceConfig {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { kind: "unreachable" };
  }
  const { brigade, relay } = body as Record<string, unknown>;
  const versioned = typeof brigade === "object" && brigade !== null;
  if (typeof relay !== "object" || relay === null) return { kind: "brigade", versioned };
  const { origin, instance, app } = relay as Record<string, unknown>;
  const relayOrigin = typeof origin === "string" ? originOf(origin) : undefined;
  if (relayOrigin === undefined || typeof instance !== "string" || !INSTANCE_ID.test(instance)) {
    return { kind: "brigade", versioned };
  }
  return {
    kind: "brigade",
    versioned,
    relay: {
      origin: relayOrigin,
      instance,
      ...(typeof app === "string" && app.startsWith("https://") ? { app } : {}),
    },
  };
}

type Fetch = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "json">>;

/** `GET <config>`, within `RELAY_TIMEOUT_MS`; never throws. */
export async function loadConfig(url: string, fetcher: Fetch): Promise<InstanceConfig> {
  try {
    const response = await withTimeout((signal) =>
      fetcher(url, { headers: { accept: "application/json" }, signal }),
    );
    if (!response.ok) return { kind: "unreachable" };
    return parseConfig(await response.json());
  } catch {
    return { kind: "unreachable" };
  }
}

/**
 * The relay this build is paged through, as an origin (Q32): `EXPO_PUBLIC_BRIGADE_RELAY_URL` when set; otherwise, a
 * build whose default instance is not Freecorps' hosted Brigade (a company's own build, or development) takes the relay
 * that instance's `/config` names; otherwise Freecorps' relay. Undefined while that `/config` cannot be read or names
 * no relay: not known yet (`relayPlan` then trusts only the build's own instance).
 */
export async function buildRelay(input: {
  env: string | undefined;
  defaultOrigin: string | undefined;
  defaultConfig: () => Promise<InstanceConfig>;
}): Promise<string | undefined> {
  const explicit = input.env?.trim();
  if (explicit) return originOf(explicit);
  if (input.defaultOrigin === undefined || input.defaultOrigin === FREECORPS_BRIGADE) {
    return FREECORPS_RELAY;
  }
  const config = await input.defaultConfig();
  return config.kind === "brigade" ? config.relay?.origin : undefined;
}

/**
 * How to register with an instance:
 * - `raw`: the push tokens, as before relay handles (no relay in `/config`, or `/config` not read);
 * - `foreign`: the instance pages through another relay, so through its own app build: this app is never paged by it
 *   and registers nothing there;
 * - `relay`: ask this relay for a handle.
 * The build's default instance is never `foreign`: the build was made for it, whatever its relay.
 */
export type RelayPlan =
  | { kind: "raw" }
  | { kind: "foreign"; relay: InstanceRelay }
  | { kind: "relay"; relay: InstanceRelay };

export function relayPlan(
  config: InstanceConfig,
  thisBuild: string | undefined,
  isDefault: boolean,
): RelayPlan {
  if (config.kind !== "brigade" || !config.relay) return { kind: "raw" };
  if (isDefault || config.relay.origin === thisBuild) return { kind: "relay", relay: config.relay };
  // A build whose relay is not known yet cannot tell another instance's relay is foreign: raw tokens, as before.
  if (thisBuild === undefined) return { kind: "raw" };
  return { kind: "foreign", relay: config.relay };
}

/** What `POST /v1/handles` seals (apps/relay `parseMint`): Android sends no VoIP token, its calls ring through FCM. */
export type HandleRequest = {
  instance: string;
  platform: "ios" | "android";
  environment: "sandbox" | "production";
  pushToken: string;
  voipToken?: string;
};

export function handleRequest(relay: InstanceRelay, args: DeviceRegistration): HandleRequest {
  return {
    instance: relay.instance,
    platform: args.platform,
    environment: args.environment,
    pushToken: args.pushToken,
    ...(args.platform === "ios" && args.voipToken ? { voipToken: args.voipToken } : {}),
  };
}

/** The handle kept for an instance (Q30), with what it was sealed for and when. */
export type HandleRecord = HandleRequest & {
  relay: string;
  handle: string;
  tag: string;
  /** When the relay gave it (ms). */
  at: number;
};

export function parseHandleRecord(raw: string | null): HandleRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const { relay, handle, tag, at, instance, platform, environment, pushToken, voipToken } = value;
    if (typeof relay !== "string" || typeof handle !== "string" || !HANDLE.test(handle))
      return null;
    if (typeof tag !== "string" || !TAG.test(tag) || typeof at !== "number") return null;
    if (typeof instance !== "string" || typeof pushToken !== "string") return null;
    if (platform !== "ios" && platform !== "android") return null;
    if (environment !== "sandbox" && environment !== "production") return null;
    if (voipToken !== undefined && typeof voipToken !== "string") return null;
    return {
      relay,
      handle,
      tag,
      at,
      instance,
      platform,
      environment,
      pushToken,
      ...(voipToken === undefined ? {} : { voipToken }),
    };
  } catch {
    return null;
  }
}

/**
 * Whether the kept handle still serves (Q30): sealed by this relay for this instance id, for these tokens (push and
 * VoIP, platform and environment), and younger than `HANDLE_MAX_AGE_MS`. Anything else asks the relay for a new one.
 */
export function handleServes(
  record: HandleRecord | null,
  relay: InstanceRelay,
  want: HandleRequest,
  now: number,
): record is HandleRecord {
  if (!record) return false;
  if (record.relay !== relay.origin || record.instance !== want.instance) return false;
  if (record.platform !== want.platform || record.environment !== want.environment) return false;
  if (
    record.pushToken !== want.pushToken ||
    (record.voipToken ?? null) !== (want.voipToken ?? null)
  ) {
    return false;
  }
  return now - record.at >= 0 && now - record.at < HANDLE_MAX_AGE_MS;
}

/** `POST <relay>/v1/handles`: `{ handle, tag }`, or null for any other answer (refused, unreachable, malformed). */
export async function mintHandle(
  relay: string,
  request: HandleRequest,
  fetcher: Fetch,
): Promise<{ handle: string; tag: string } | null> {
  try {
    const response = await withTimeout((signal) =>
      fetcher(`${relay}/v1/handles`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(request),
        signal,
      }),
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { handle?: unknown; tag?: unknown } | null;
    if (typeof body?.handle !== "string" || !HANDLE.test(body.handle)) return null;
    if (typeof body.tag !== "string" || !TAG.test(body.tag)) return null;
    return { handle: body.handle, tag: body.tag };
  } catch {
    return null;
  }
}

/** Where an instance's handle is kept, and its `/config`. */
export type HandleDeps = {
  config: () => Promise<InstanceConfig>;
  /** This build's relay (`buildRelay`); undefined while not known. */
  thisBuild: () => Promise<string | undefined>;
  /** Whether this is the build's default instance. */
  isDefault: boolean;
  read: () => Promise<string | null>;
  write: (raw: string | null) => Promise<void>;
  fetch: Fetch;
  now: () => number;
};

/**
 * The registration to send this instance: with a handle (the kept one while it serves, else a new one from the relay),
 * or `args` as it is when there is no relay or the relay does not answer, or `foreign`. `envelope: 2` goes to an
 * instance that says its version in `/config` (it seals version 2 for it, RFC 0015 section 4). Never throws.
 */
export async function withHandle(
  args: DeviceRegistration,
  deps: HandleDeps,
): Promise<DeviceRegistration | HandleRegistration | "foreign"> {
  const config = await deps.config().catch((): InstanceConfig => ({ kind: "unreachable" }));
  const kept = await deps
    .read()
    .then(parseHandleRecord)
    .catch(() => null);
  const versioned = config.kind === "brigade" && config.versioned;
  const raw: DeviceRegistration = versioned ? { ...args, envelope: 2 } : args;
  if (config.kind === "unreachable") {
    // `/config` did not answer: the kept handle, while it serves the relay it came from, rather than flip the device
    // to raw tokens and back on a flaky read.
    if (kept) {
      const keptRelay = { origin: kept.relay, instance: kept.instance };
      if (handleServes(kept, keptRelay, handleRequest(keptRelay, args), deps.now())) {
        return registrationWith(args, kept);
      }
    }
    return raw;
  }
  const plan = relayPlan(config, await deps.thisBuild().catch(() => undefined), deps.isDefault);
  if (plan.kind === "foreign") return "foreign";
  if (plan.kind === "raw") return raw;
  const want = handleRequest(plan.relay, args);
  if (handleServes(kept, plan.relay, want, deps.now())) return registrationWith(args, kept);
  const minted = await mintHandle(plan.relay.origin, want, deps.fetch);
  // The relay did not answer: raw tokens, as before handles.
  if (!minted) return raw;
  const record: HandleRecord = { ...want, relay: plan.relay.origin, ...minted, at: deps.now() };
  await deps.write(JSON.stringify(record)).catch(() => {});
  return registrationWith(args, record);
}

function registrationWith(args: DeviceRegistration, record: HandleRecord): HandleRegistration {
  const { pushToken: _push, voipToken, envelope: _envelope, ...rest } = args;
  return {
    ...rest,
    handle: record.handle,
    tag: record.tag,
    // iOS rings through the PushKit token sealed in the handle; Android through the FCM token, when it can ring.
    voip: args.platform === "ios" ? record.voipToken !== undefined : voipToken !== null,
    envelope: 2,
  };
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  // Not `AbortSignal.timeout`, which Hermes may lack.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), RELAY_TIMEOUT_MS);
  try {
    return await run(abort.signal);
  } finally {
    clearTimeout(timer);
  }
}
