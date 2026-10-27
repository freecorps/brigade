// The checks a member's own HTTP route makes before it wakes a shard: the method, the workspace id, the origin for
// writes, the session and the member's role in D1. Used by the postmortem draft and the export routes.

import type { Actor } from "@freecorps/brigade-schema";
import { memberRole } from "./actor.ts";
import type { Auth } from "./auth.ts";
import { readBounded } from "./body.ts";
import { ORGANIZATION_ID } from "./workspace.ts";

export type MemberCheck = { ok: true; actor: Actor } | { ok: false; response: Response };

export function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

/**
 * The signed-in member of `workspaceId` making `request`, as an actor with their role in D1; or the answer to give:
 * 405, 400 for an id that is not a workspace's, 403 for another site's write, 401 without a session, 403
 * `not_a_member`, 503 when D1 fails. A made-up workspace or an outsider never wakes (or creates) a shard.
 */
export async function checkMember(
  request: Request,
  env: Omit<Env, "AI">,
  lazyAuth: () => Auth,
  workspaceId: string,
  methods: readonly string[],
): Promise<MemberCheck> {
  const refuse = (response: Response): MemberCheck => ({ ok: false, response });
  if (!methods.includes(request.method)) {
    return refuse(json({ error: "method_not_allowed" }, 405, { Allow: methods.join(", ") }));
  }
  if (!ORGANIZATION_ID.test(workspaceId))
    return refuse(json({ error: "invalid_workspace_id" }, 400));
  const origin = request.headers.get("Origin");
  if (request.method !== "GET" && origin !== null && origin !== new URL(request.url).origin) {
    return refuse(json({ error: "forbidden_origin" }, 403));
  }
  try {
    const session = await lazyAuth().api.getSession({ headers: request.headers });
    if (!session) return refuse(json({ error: "unauthenticated" }, 401));
    const role = await memberRole(env.DB, workspaceId, session.user.id);
    if (role === undefined) return refuse(json({ error: "not_a_member" }, 403));
    return { ok: true, actor: { kind: "user", id: session.user.id, role } };
  } catch (error) {
    console.error(
      JSON.stringify({ message: "session or member lookup failed", error: String(error) }),
    );
    return refuse(json({ error: "unavailable" }, 503));
  }
}

/** A small JSON body (at most `max` bytes), or undefined when it is too large or not JSON. An empty body is `{}`. */
export async function readJson(request: Request, max = 4096): Promise<unknown> {
  const text = await readBounded(request, max);
  if (text === undefined) return undefined;
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
