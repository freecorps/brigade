// `POST /devices/register` (RFC 0006 "Device registration"): the mobile app registers its phone for pages in every
// workspace it was opened in on the phone with one request, whichever it has open. Without it a phone kept only the
// registration of the workspace it had open up to date: a new push token (or a reinstall) reached that one, and every
// other workspace kept paging a dead token (APNs `BadDeviceToken`, the device dropped, `no_devices`).

import { isRole, type Actor, type Role } from "@freecorps/brigade-schema";
import { countRequest, WORKSPACE_LIMIT, type Auth } from "./auth.ts";
import { json, readJson } from "./member-route.ts";
import { ORGANIZATION_ID, type DeviceRegisterResult } from "./workspace.ts";

export const DEVICES_REGISTER_PATH = "/devices/register";

/** Registrations one user may send a minute: the app sends one per launch, foreground or token change. */
export const DEVICE_REGISTER_LIMIT = { window: 60, max: 30 };

/**
 * Per workspace: `ok` (registered, or already up to date), a `device.register` code (`forbidden`: another member's
 * device has this id and its member's session still exists, `invalid_args`, `internal`),
 * `not_a_member` (the member left or was removed: the app forgets the workspace) or `unavailable` (the shard or D1
 * could not be reached: tried again later).
 */
export type DeviceRegistrationAnswer = Record<
  string,
  "ok" | Extract<DeviceRegisterResult, { ok: false }>["code"] | "unavailable"
>;

/**
 * `POST /devices/register` `{ device, workspaces }`: `device` is `device.register`'s args, `workspaces` the ids the
 * phone is registered in for the signed-in member (at most `WORKSPACE_LIMIT`). The Worker checks the origin, the
 * session and the member's role in each workspace in D1 (one query), then each shard runs `device.register` as that
 * member, with its RBAC and its event through the outbox (`WorkspaceDO.registerDevice`), all at once. Answers 200
 * with `{ workspaces: DeviceRegistrationAnswer }`; 400 `invalid_args` for a body that is not that; 401 without a
 * session; 429 past `DEVICE_REGISTER_LIMIT`; 503 when D1 fails before any shard is asked.
 */
export async function registerDevices(
  request: Request,
  env: Env,
  lazyAuth: () => Auth,
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  }
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return json({ error: "forbidden_origin" }, 403);
  }
  const body = await readJson(request, 8192);
  const device: unknown =
    typeof body === "object" && body !== null ? Reflect.get(body, "device") : undefined;
  const listed: unknown =
    typeof body === "object" && body !== null ? Reflect.get(body, "workspaces") : undefined;
  if (
    typeof device !== "object" ||
    device === null ||
    Array.isArray(device) ||
    !Array.isArray(listed) ||
    listed.length === 0 ||
    listed.length > WORKSPACE_LIMIT ||
    !listed.every((id): id is string => typeof id === "string" && ORGANIZATION_ID.test(id))
  ) {
    return json({ error: "invalid_args" }, 400);
  }
  const workspaces = [...new Set(listed)];

  let memberships: Map<string, { role: Role; resetAt: number | null }>;
  let userId: string;
  let sessionId: string;
  try {
    const session = await lazyAuth().api.getSession({ headers: request.headers });
    if (!session) return json({ error: "unauthenticated" }, 401);
    userId = session.user.id;
    sessionId = session.session.id;
    const { window, max } = DEVICE_REGISTER_LIMIT;
    if ((await countRequest(env.DB, `devices:${userId}`, window, Date.now())) > max) {
      return json({ error: "rate_limited" }, 429, { "Retry-After": String(window) });
    }
    const { results } = await env.DB.prepare(
      `select m."organizationId" as id, m.role, u."passwordResetAt" as "resetAt" from member m
       left join "user" u on u.id = m."userId" where m."userId" = ?`,
    )
      .bind(userId)
      .all<{ id: string; role: string; resetAt: number | null }>();
    memberships = new Map(
      results.flatMap((row) =>
        isRole(row.role) ? [[row.id, { role: row.role, resetAt: row.resetAt }] as const] : [],
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify({ message: "session or member lookup failed", error: String(error) }),
    );
    return json({ error: "unavailable" }, 503);
  }

  const answers: DeviceRegistrationAnswer = {};
  await Promise.all(
    workspaces.map(async (workspaceId) => {
      const member = memberships.get(workspaceId);
      // An outsider never wakes (or creates) a shard.
      if (!member) {
        answers[workspaceId] = "not_a_member";
        return;
      }
      const actor: Actor = { kind: "user", id: userId, role: member.role };
      try {
        const result = await env.WORKSPACE.getByName(workspaceId).registerDevice(
          workspaceId,
          actor,
          device as Record<string, unknown>,
          member.resetAt ?? undefined,
          sessionId,
        );
        // `conflict`: registered already with these values.
        answers[workspaceId] = result.ok || result.code === "conflict" ? "ok" : result.code;
      } catch (error) {
        console.error(
          JSON.stringify({
            message: "WorkspaceDO.registerDevice failed",
            workspace: workspaceId,
            error: String(error),
          }),
        );
        answers[workspaceId] = "unavailable";
      }
    }),
  );
  // Visible in `wrangler tail`: why a phone is not paged somewhere. Never the device's tokens or key.
  for (const [workspaceId, code] of Object.entries(answers)) {
    // `not_a_member`: a workspace the phone still lists after the member left it, routine (the app forgets it).
    if (code === "ok" || code === "not_a_member") continue;
    console.warn(
      JSON.stringify({ message: "device registration refused", workspace: workspaceId, code }),
    );
  }
  return json({ workspaces: answers }, 200, { "Cache-Control": "no-store" });
}
