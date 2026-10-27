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
};

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
  /** No device key on this platform (Android until FCM, RFC 0006). */
  | "unsupported"
  /** Another member's device has this id: they never signed out on this phone (RFC 0006 "A handed-over phone"). */
  | "taken"
  | "failed";

/** What registering needs from the phone and the sync client; injected so the flow is tested in Node. */
export type DeviceDeps = {
  platform: "ios" | "android";
  apsEnvironment: unknown;
  /** The device key's public half; null where the platform has none yet. */
  publicKey: (() => Promise<string>) | null;
  /** Asks for notification permission once; true when granted. */
  permission: () => Promise<boolean>;
  pushToken: () => Promise<string>;
  /**
   * iOS: PushKit's token, so pages can ring as calls (RFC 0010); null without one. Absent where the app cannot report a
   * VoIP push to CallKit (no call module): the phone then never gets a call, only alerts.
   */
  voipToken?: () => Promise<string | null>;
  /**
   * The instance this phone registers with (`https://brigade.example.com`) and where to keep it for the Notification
   * Service Extension (the App Group): it posts delivery receipts to that origin only, whatever URL a page names
   * (RFC 0006 "Delivery receipts"). Absent where there is no extension.
   */
  receiptOrigin?: { origin: string; keep: (origin: string) => void };
  /** Runs a mutation on the workspace's shard. */
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
  if (!deps.publicKey) return "unsupported";
  try {
    const publicKey = await deps.publicKey();
    if (!(await deps.permission())) return "off";
    // Asked for together: PushKit may take its time (or never answer), and the alert token must not wait for it.
    // A VoIP token that is not there by the time the alert token is gets registered when it arrives (`onVoipToken`).
    const voip = callToken(deps);
    const pushToken = await deps.pushToken();
    const args = deviceRegistration({
      publicKey,
      pushToken,
      voipToken: await Promise.race([voip, later(VOIP_GRACE_MS, null)]),
      platform: deps.platform,
      apsEnvironment: deps.apsEnvironment,
    });
    if (!proceed()) return "pending";
    const result = await deps.mutate("device.register", args);
    // `conflict`: registered already with these values. The member's device limit is `limit_reached`.
    if (result.ok || result.error.code === "conflict") {
      keepReceiptOrigin(deps);
      return "on";
    }
    return result.error.code === "forbidden" ? "taken" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * The VoIP token to register: iOS only (Android rings through FCM, not yet set up), and never in registration's way:
 * without it the phone gets alerts and no calls.
 */
/** How long registering waits for PushKit after the alert token is in hand. */
export const VOIP_GRACE_MS = 500;

function later<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

async function callToken(deps: DeviceDeps): Promise<string | null> {
  if (deps.platform !== "ios" || !deps.voipToken) return null;
  try {
    return (await deps.voipToken()) || null;
  } catch {
    return null;
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
