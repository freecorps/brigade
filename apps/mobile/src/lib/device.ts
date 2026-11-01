// Registering this phone for pages (RFC 0006 "Device registration"): the `device.register` mutation's args, from
// what the push module reports. Pure, so it is tested in Node; the `/push` screen sends it.
import { newId, type PushEnvironment } from "@freecorps/brigade-schema";

export type DeviceRegistration = {
  id: string;
  platform: "ios" | "android";
  environment: PushEnvironment;
  pushToken: string;
  voipToken: string | null;
  publicKey: string;
  /**
   * Present (true) only when Critical Alerts are allowed (RFC 0006 "Critical Alerts"): left out otherwise, so an
   * instance from before the capability, whose `device.register` refuses unknown keys, still registers the phone.
   */
  criticalAlerts?: true;
  /** The newest envelope the app opens (RFC 0015 section 4), only to an instance that knows the key (src/lib/relay.ts). */
  envelope?: 2;
};

/**
 * `device.register` with a relay handle (RFC 0015 section 7): the raw tokens left out, so the instance never sees them.
 * `voip`: whether the handle can ring as a call.
 */
export type HandleRegistration = Omit<
  DeviceRegistration,
  "pushToken" | "voipToken" | "envelope"
> & {
  handle: string;
  tag: string;
  voip: boolean;
  envelope: 2;
};

/** What the app sends `device.register`. */
export type RegistrationArgs = DeviceRegistration | HandleRegistration;

export function hasHandle(args: RegistrationArgs): args is HandleRegistration {
  return "handle" in args;
}

/**
 * `device.register` codes that say a handle is no good (an instance that refused its form answers `invalid_args`): the
 * kept handle is dropped, the raw tokens sent at once, and a new handle asked for on the next registration (Q30).
 */
export const HANDLE_REFUSALS: ReadonlySet<string> = new Set([
  "bad_handle",
  "handle_not_yours",
  "invalid_args",
]);

/**
 * The device's id, derived from its public key (the first 10 bytes of the key's x coordinate, as a ULID's
 * randomness, at time 0), so the same phone registers under the same id on every launch without storing one: a
 * second registration with nothing changed is a no-op on the shard. A new key (reinstall) is a new device, and the
 * shard drops the old one by its push token.
 */
export function deviceId(publicKey: string): string {
  const bytes = fromBase64url(publicKey);
  return newId("dev", 0, () => bytes.subarray(1, 11));
}

/** The push module's key functions (modules/brigade-push), as `devicePublicKey` reads them. */
export type DeviceKeys = {
  getPublicKey(): Promise<string>;
  getInstancePublicKey?(origin: string): Promise<string>;
};

/**
 * This phone's device key for the instance at `url` (any of its URLs): one key per instance, keyed by its origin
 * (RFC 0015 section 4), so the device id differs at each instance. The native side moves the key from before keys
 * per instance to the first origin it is asked for, so the instance this build talks to keeps the phone's device id.
 * Without a usable origin, on an app binary from before keys per instance, or when the native side refuses the origin
 * (a parser stricter than `URL`'s), the key it always had: registering is never stopped by the origin's form.
 */
export async function devicePublicKey(keys: DeviceKeys, url?: string): Promise<string> {
  const origin = url === undefined ? undefined : instanceOrigin(url);
  if (origin && keys.getInstancePublicKey) {
    try {
      return await keys.getInstancePublicKey(origin);
    } catch {
      // The key it always had, below.
    }
  }
  return keys.getPublicKey();
}

/**
 * The APNs environment of this build's tokens: `aps-environment` is `development` for local Xcode builds and
 * `production` for EAS builds (app.config.ts), and APNs calls the first `sandbox`.
 */
export function pushEnvironment(apsEnvironment: unknown): PushEnvironment {
  return apsEnvironment === "development" ? "sandbox" : "production";
}

export function deviceRegistration(input: {
  publicKey: string;
  pushToken: string;
  voipToken?: string | null;
  criticalAlerts?: boolean;
  platform: "ios" | "android";
  apsEnvironment: unknown;
}): DeviceRegistration {
  return {
    id: deviceId(input.publicKey),
    platform: input.platform,
    environment: input.platform === "ios" ? pushEnvironment(input.apsEnvironment) : "production",
    pushToken: input.pushToken,
    voipToken: input.voipToken ?? null,
    publicKey: input.publicKey,
    ...(input.platform === "ios" && input.criticalAlerts === true
      ? { criticalAlerts: true as const }
      : {}),
  };
}

/** Whether this phone gets pages, as the account section says it. */
export type Paging =
  /** Asking for permission, a token or the key, or waiting for the shard. */
  | "pending"
  /** Registered on the workspace's shard. */
  | "on"
  /** Notifications are not allowed. */
  | "off"
  /** No device key or push token on this build (an Android build without Firebase, RFC 0006). */
  | "unsupported"
  /**
   * The instance pages through another relay, so only through its own app build (RFC 0015 section 5): this app is
   * never paged by it and registers nothing there.
   */
  | "foreign"
  /** Another member's device has this id: they never signed out on this phone (RFC 0006 "A handed-over phone"). */
  | "taken"
  /**
   * The member has the most devices the workspace allows (`limit_reached`): only an instance from before a new device
   * replaced the least recently registered one answers it. Signing out on a phone they no longer use frees a place.
   */
  | "limit"
  | "failed";

/** What a `device.register` code that is not `ok` (nor `conflict`) means for this phone. */
function refused(code: string | undefined): Paging {
  if (code === "forbidden") return "taken";
  if (code === "limit_reached") return "limit";
  return "failed";
}

/** Whether this phone gets pages, per workspace id: every workspace it was opened in for the member. */
export type Registrations = Record<string, Paging>;

/**
 * `POST /devices/register`'s answer (apps/api src/device-route.ts): per workspace, `ok` or why not. `status` 0 is no
 * answer (offline); 404 an instance from before the route.
 */
export type RegisterAnswer =
  | { ok: true; workspaces: Record<string, string> }
  | { ok: false; status: number };

/** What registering needs from the phone and the sync client; injected so the flow is tested in Node. */
export type DeviceDeps = {
  platform: "ios" | "android";
  apsEnvironment: unknown;
  /** The device key's public half; null where the build cannot be paged (Android without Firebase). */
  publicKey: (() => Promise<string>) | null;
  /** Asks for notification permission once; true when granted. */
  permission: () => Promise<boolean>;
  pushToken: () => Promise<string>;
  /**
   * The token pages ring as calls through (RFC 0010): PushKit's on iOS, the FCM token again on Android (a call is a
   * data message the app rings for); null without one. Absent where the app cannot ring (no call module): the phone
   * then never gets a call, only alerts.
   */
  voipToken?: () => Promise<string | null>;
  /**
   * iOS, in a build with the Critical Alerts entitlement (`BRIGADE_CRITICAL_ALERTS=1`): whether the member allows
   * them, asked after `permission`. Absent otherwise: the phone gets time-sensitive pages, as every phone does.
   */
  criticalAlerts?: () => Promise<boolean>;
  /**
   * The instance this phone registers with (`https://brigade.example.com`) and where to keep it for the Notification
   * Service Extension (the App Group): it posts delivery receipts to that origin only, whatever URL a page names
   * (RFC 0006 "Delivery receipts"). Absent where there is no extension.
   */
  receiptOrigin?: { origin: string; keep: (origin: string) => void };
  /**
   * `POST /devices/register` with the registration and the workspaces to register in, with the member's session.
   * Absent: only the open workspace registers, over `mutate`.
   */
  registerAll?: (args: RegistrationArgs, workspaces: string[]) => Promise<RegisterAnswer>;
  /**
   * The registration this instance gets (src/lib/relay.ts `withHandle`): with a relay handle, the raw tokens (no relay,
   * or the relay did not answer), or `foreign` (the instance pages through its own app build). Absent: the raw tokens.
   */
  handles?: (args: DeviceRegistration) => Promise<RegistrationArgs | "foreign">;
  /** Forgets the kept handle: the instance refused it (`HANDLE_REFUSALS`). */
  dropHandle?: () => Promise<void>;
  /** Runs a mutation on the open workspace's shard. */
  mutate: (
    name: "device.register" | "device.unregister",
    args: object,
  ) => Promise<{ ok: true } | { ok: false; error: { code: string; message: string } }>;
};

/**
 * Registers this phone for pages on the signed-in member's workspace, after sign-in (RFC 0006 "Device
 * registration"). Its id comes from its key, so registering again with nothing changed is a no-op (`conflict`).
 */
export async function registerPhone(
  deps: DeviceDeps,
  /** Asked right before `device.register` goes out; false sends nothing (the member is signing out). */
  proceed: () => boolean = () => true,
): Promise<Paging> {
  try {
    const steps = await registration(deps);
    if (typeof steps === "string") return steps;
    return await registerHere(deps, steps, proceed);
  } catch {
    return "failed";
  }
}

/**
 * What to send, newest first, or why there is nothing to send. Each next step is for an instance that refused the one
 * before (`invalid_args`, or a handle refusal): the raw tokens instead of a handle, then without the keys an older
 * instance does not know (`criticalAlerts`, `envelope`), so the phone is paged rather than not at all. Throws when
 * the key or a token fails.
 */
async function registration(
  deps: DeviceDeps,
): Promise<RegistrationArgs[] | "unsupported" | "off" | "foreign"> {
  if (!deps.publicKey) return "unsupported";
  const publicKey = await deps.publicKey();
  if (!(await deps.permission())) return "off";
  // Asked for together: PushKit may take its time (or never answer), and the alert token must not wait for it.
  // A VoIP token that is not there by the time the alert token is gets registered when it arrives (`onVoipToken`).
  const voip = callToken(deps);
  const pushToken = await deps.pushToken();
  const base = deviceRegistration({
    publicKey,
    pushToken,
    // Android's call token is its FCM token, fetched like the push token: waited for, since nothing registers it
    // when it comes later (iOS's `onVoipToken`).
    voipToken:
      deps.platform === "android"
        ? await voip
        : await Promise.race([voip, later(VOIP_GRACE_MS, null)]),
    criticalAlerts: await allowsCritical(deps),
    platform: deps.platform,
    apsEnvironment: deps.apsEnvironment,
  });
  // A relay that cannot be asked never stops the phone from registering its tokens.
  const sent = deps.handles ? await deps.handles(base).catch(() => base) : base;
  if (sent === "foreign") return "foreign";
  const { criticalAlerts: _, envelope: __, ...legacy } = base;
  const steps: RegistrationArgs[] = [sent];
  if (hasHandle(sent)) steps.push({ ...base, envelope: 2 });
  steps.push(legacy);
  return steps.filter((step, index) => steps.findIndex((other) => sameArgs(other, step)) === index);
}

function sameArgs(a: RegistrationArgs, b: RegistrationArgs): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Whether `code` refuses `args` in a way an older form of it may pass (`registration`'s steps). */
function refusesForm(args: RegistrationArgs, code: string | undefined): boolean {
  if (code === undefined) return false;
  return code === "invalid_args" || (hasHandle(args) && HANDLE_REFUSALS.has(code));
}

/** A refused handle is forgotten, so the next registration asks the relay for a new one. */
async function dropRefusedHandle(deps: DeviceDeps, args: RegistrationArgs): Promise<void> {
  if (hasHandle(args)) await deps.dropHandle?.().catch(() => {});
}

/**
 * Registers this phone in every workspace in `workspaces` (each one the member opened on it; `active`, the open one,
 * among them) with one `POST /devices/register` (RFC 0006 "Device registration"), so a new push or VoIP token, a
 * reinstall or Critical Alerts turned on reaches all of them, not only the one open: a workspace left with a dead
 * token pages nobody on this phone (`no_devices`). Answers per workspace; a workspace the member is no longer in
 * (`not_a_member`, which the API answers only once D1 confirmed it) is left out (the caller forgets it), and one it
 * could not check (`unavailable`) is `failed`, tried again. An instance from before the route (404) registers only `active`, over its socket.
 */
export async function registerEverywhere(
  deps: DeviceDeps,
  workspaces: readonly string[],
  active: string,
  proceed: () => boolean = () => true,
  /** Told the workspaces the member is no longer in (left, removed), so the phone stops listing them. */
  gone: (ids: string[]) => void = () => {},
): Promise<Registrations> {
  const all = [...new Set([active, ...workspaces])];
  const every = (paging: Paging): Registrations =>
    Object.fromEntries(all.map((id) => [id, paging]));
  try {
    const steps = await registration(deps);
    if (typeof steps === "string") return every(steps);
    if (!deps.registerAll) return { [active]: await registerHere(deps, steps, proceed) };
    let answer: RegisterAnswer = { ok: false, status: 0 };
    // As over the socket: an older instance refuses keys it does not know, and an instance may refuse a handle.
    for (const [index, args] of steps.entries()) {
      if (!proceed()) return every("pending");
      answer = await deps.registerAll(args, all);
      if (!answer.ok) {
        if (answer.status === 404) return { [active]: await registerHere(deps, steps, proceed) };
        return every("failed");
      }
      const codes = Object.values(answer.workspaces);
      if (index === steps.length - 1 || !codes.some((code) => refusesForm(args, code))) break;
      await dropRefusedHandle(deps, args);
    }
    if (!answer.ok) return every("failed");
    const registered: Registrations = {};
    const left: string[] = [];
    for (const id of all) {
      const code = answer.workspaces[id];
      if (code === "not_a_member" && id !== active) {
        left.push(id);
        continue;
      }
      registered[id] = code === "ok" ? "on" : refused(code);
    }
    if (Object.values(registered).includes("on")) keepReceiptOrigin(deps);
    if (left.length > 0) gone(left);
    return registered;
  } catch {
    return every("failed");
  }
}

/** `device.register` on the open workspace's socket, each of `steps` in turn while the shard refuses its form. */
async function registerHere(
  deps: DeviceDeps,
  steps: RegistrationArgs[],
  proceed: () => boolean,
): Promise<Paging> {
  try {
    let result: Awaited<ReturnType<DeviceDeps["mutate"]>> = {
      ok: false,
      error: { code: "internal", message: "Nothing to send" },
    };
    // An instance from before Critical Alerts (or envelopes, or handles) refuses the unknown key: register without it,
    // so the phone is still paged rather than not at all.
    for (const [index, args] of steps.entries()) {
      if (!proceed()) return "pending";
      result = await deps.mutate("device.register", args);
      if (result.ok || index === steps.length - 1 || !refusesForm(args, result.error.code)) break;
      await dropRefusedHandle(deps, args);
    }
    // `conflict`: registered already with these values.
    if (result.ok || result.error.code === "conflict") {
      keepReceiptOrigin(deps);
      return "on";
    }
    return refused(result.error.code);
  } catch {
    return "failed";
  }
}

/** Whether any workspace's registration is left undone (src/lib/paging.ts `nextTry` says when it is tried again). */
export function registrationsLeft(registrations: Registrations): boolean {
  return Object.values(registrations).some(
    (paging) => paging === "taken" || paging === "limit" || paging === "failed",
  );
}

/** How long registering waits for PushKit after the alert token is in hand. */
export const VOIP_GRACE_MS = 500;

function later<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/** The call token to register, never in registration's way: without it the phone gets alerts and no calls. */
async function callToken(deps: DeviceDeps): Promise<string | null> {
  if (!deps.voipToken) return null;
  try {
    return (await deps.voipToken()) || null;
  } catch {
    return null;
  }
}

/** Never in registration's way: a phone that cannot say gets time-sensitive pages. */
async function allowsCritical(deps: DeviceDeps): Promise<boolean> {
  if (deps.platform !== "ios" || !deps.criticalAlerts) return false;
  try {
    return (await deps.criticalAlerts()) === true;
  } catch {
    return false;
  }
}

/**
 * The instance's origin (scheme, host, port) from any of its URLs; undefined unless http(s). The extension compares
 * a receipt URL's origin with it.
 */
export function instanceOrigin(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

/** Never in registration's way: without it the extension only sends no receipts. */
function keepReceiptOrigin(deps: DeviceDeps): void {
  const origin = deps.receiptOrigin && instanceOrigin(deps.receiptOrigin.origin);
  if (!origin) return;
  try {
    deps.receiptOrigin!.keep(origin);
  } catch {
    // An app binary from before receipts has no such call.
  }
}

/**
 * Unregisters this phone before sign-out, so it stops paging the member and the next one to sign in on it can
 * register it. Best effort: never throws, and gives up after `timeoutMs`, or as soon as `giveUp` resolves (the
 * socket was refused), so signing out offline still works (the device then stays registered until its token
 * expires or someone signs out on it online).
 */
export async function unregisterPhone(
  deps: Pick<DeviceDeps, "publicKey" | "mutate">,
  timeoutMs = 5_000,
  giveUp?: Promise<unknown>,
): Promise<boolean> {
  if (!deps.publicKey) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const attempt = (async () => {
    try {
      const id = deviceId(await deps.publicKey!());
      const result = await deps.mutate("device.unregister", { id });
      // `not_found`: it was never registered here, or already gone.
      return result.ok || result.error.code === "not_found";
    } catch {
      return false;
    }
  })();
  try {
    const refused = giveUp?.then(() => false as const) ?? timeout;
    return await Promise.race([attempt, timeout, refused]);
  } finally {
    clearTimeout(timer);
  }
}

function fromBase64url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
