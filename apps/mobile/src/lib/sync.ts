// Which Brigade the app talks to, and as whom it runs optimistic mutations. Pure, so it is tested in Node;
// src/lib/auth-client.ts and src/components/session.tsx build the clients from it with the native pieces.
import { isRole, type Actor, type Role } from "@freecorps/brigade-schema";

/** The dashboard's dev server (`vp run dev`), which forwards `/api/auth/*` and `/api/sync/<workspace>` to the API. */
export const DEV_SERVER_PORT = 5173;

/**
 * The machine running the dev servers, from Expo's `hostUri` (`<host>:8081`, the Metro server the app loaded
 * its bundle from). Start Metro with `--localhost` for the iOS Simulator and an Android emulator with
 * `adb reverse`; in LAN mode the dashboard's server must listen on the LAN too.
 */
export function devHost(hostUri: string | null | undefined): string | undefined {
  if (!hostUri) return undefined;
  const authority = hostUri.replace(/^[a-z]+:\/\//i, "").split("/")[0] ?? "";
  // `[::1]:8081` keeps its brackets; `host:8081` drops the port.
  const host = authority.startsWith("[")
    ? authority.slice(0, authority.indexOf("]") + 1)
    : authority.split(":")[0];
  return host || undefined;
}

/** Where the app signs in (Better Auth's base URL) and where a workspace's socket is. */
export type Server = { auth: string; sync: (workspaceId: string) => string };

/**
 * The Brigade the app talks to: the dashboard's origin, which serves `/api/auth` and `/api/sync` (apps/web/worker).
 * `override` (EXPO_PUBLIC_BRIGADE_URL) is that origin, such as `https://brigade.example.com`; without it,
 * development builds (`dev`, the app's `__DEV__`) use the dev server on the Metro host. A release build never does,
 * even with a `hostUri`: with no override it has no server, and sign-in says so.
 */
export function brigadeServer({
  override,
  hostUri,
  dev,
}: {
  override?: string;
  hostUri?: string | null;
  dev: boolean;
}): Server | undefined {
  const origin = serverOrigin(override, dev ? devHost(hostUri) : undefined);
  if (!origin) return undefined;
  const socket = origin.replace(/^http/, "ws");
  return {
    auth: `${origin}/api/auth`,
    sync: (workspaceId) => `${socket}/api/sync/${encodeURIComponent(workspaceId)}`,
  };
}

function serverOrigin(override: string | undefined, host: string | undefined): string | undefined {
  const value = override?.trim();
  if (value) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return undefined;
    }
    // Only the origin: a path would put the API somewhere the dashboard does not serve it.
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
  }
  return host ? `http://${host}:${DEV_SERVER_PORT}` : undefined;
}

/**
 * The actor optimistic mutations run as: the signed-in member, with their role in the workspace. The shard takes
 * the actor from the authenticated socket; a role the app does not know reads as `viewer`, so the app never shows
 * a change the shard would refuse.
 */
export function memberActor(userId: string, role: unknown): Actor {
  return { kind: "user", id: userId, role: isRole(role) ? role : "viewer" };
}

/** The member's workspace as last read, so the app opens signed in without the network (secure storage). */
export type KnownWorkspace = { userId: string; workspaceId: string; name: string; role: Role };

export const WORKSPACE_KEY = "brigade_workspace";

/** The stored workspace, if it is this member's in this workspace; anything else is nothing. */
export function knownWorkspace(
  raw: string | null,
  userId: string,
  workspaceId: string,
): KnownWorkspace | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const known = value as Record<string, unknown>;
    if (known.userId !== userId || known.workspaceId !== workspaceId) return null;
    if (typeof known.name !== "string" || !isRole(known.role)) return null;
    return { userId, workspaceId, name: known.name, role: known.role };
  } catch {
    return null;
  }
}
