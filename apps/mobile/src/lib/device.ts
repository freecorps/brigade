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

function fromBase64url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
