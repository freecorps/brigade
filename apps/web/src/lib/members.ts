// Member management for the dashboard (RFC 0003 "Members"): the API's `PATCH`/`DELETE /workspaces/:id/members/:userId`
// behind the web Worker's `/api`, and the choices a member is offered, from the same rules the API checks
// (`checkMemberChange` in packages/schema). Pure apart from `fetch`; tested in test/members.test.ts.
import { m } from "@freecorps/brigade-i18n";
import {
  checkMemberChange,
  isRole,
  ROLES,
  type MemberChange,
  type Role,
} from "@freecorps/brigade-schema";

/** Why a change failed: the API's `error` codes, `network` when it never answered, `internal` for anything else. */
export type MemberChangeError =
  | "forbidden"
  | "last_owner"
  | "not_found"
  | "conflict"
  | "not_applied"
  | "unavailable"
  | "network"
  | "internal";

const KNOWN: readonly MemberChangeError[] = [
  "forbidden",
  "last_owner",
  "not_found",
  "conflict",
  "not_applied",
  "unavailable",
];

/** Changes `userId`'s role, removes them, or (for one's own id) leaves the workspace. */
export async function changeMember(
  workspaceId: string,
  userId: string,
  change: MemberChange,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: MemberChangeError }> {
  let response: Response;
  try {
    response = await fetcher(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
      change.kind === "role"
        ? {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ role: change.role }),
          }
        : { method: "DELETE", headers: { Accept: "application/json" } },
    );
  } catch {
    return { ok: false, error: "network" };
  }
  if (response.ok) return { ok: true };
  const body: unknown = await response.json().catch(() => null);
  const code = typeof body === "object" && body !== null ? Reflect.get(body, "error") : undefined;
  // The Worker answers `not_a_member` when the caller was removed meanwhile.
  if (code === "not_a_member") return { ok: false, error: "forbidden" };
  return {
    ok: false,
    error: KNOWN.includes(code as MemberChangeError) ? (code as MemberChangeError) : "internal",
  };
}

export function memberChangeReason(error: MemberChangeError): string {
  return m.member_change_failed({ reason: error });
}

/** A member as the dashboard lists them (Better Auth's full organization: name and email from D1). */
export type ListedMember = { userId: string; name: string; email: string; role: Role | null };

/**
 * What `viewer` may do to `target`: the roles they can pick (the current one included, so the control shows it;
 * empty when there is nothing to pick), whether they can remove them, and whether this is their own row to leave
 * from.
 */
export function memberChoices(
  viewer: { id: string; role: Role },
  target: { id: string; role: Role | null },
  owners: number,
): { roles: Role[]; remove: boolean; leave: boolean } {
  const self = viewer.id === target.id;
  // A member without a Brigade role is refused everywhere; nothing can be checked against it.
  if (target.role === null) return { roles: [], remove: false, leave: false };
  const current = { id: target.id, role: target.role };
  const roles = ROLES.filter(
    (role) =>
      role === target.role || checkMemberChange(viewer, current, { kind: "role", role }, owners).ok,
  );
  const allowed = checkMemberChange(viewer, current, { kind: "remove" }, owners).ok;
  return { roles: roles.length > 1 ? roles : [], remove: allowed && !self, leave: allowed && self };
}

/** Owners first, then admins, responders and viewers; by name within a role, then email. */
export function sortMembers(members: readonly ListedMember[]): ListedMember[] {
  const rank = (role: Role | null) => (role === null ? ROLES.length : ROLES.indexOf(role));
  return [...members].sort(
    (a, b) =>
      rank(a.role) - rank(b.role) || a.name.localeCompare(b.name) || a.email.localeCompare(b.email),
  );
}

/** Better Auth's members (`{ userId, role, user: { name, email } }`) as the dashboard lists them. */
export function listedMembers(raw: unknown): ListedMember[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const userId: unknown = Reflect.get(entry, "userId");
    const role: unknown = Reflect.get(entry, "role");
    const user: unknown = Reflect.get(entry, "user");
    if (typeof userId !== "string") return [];
    const field = (key: string) => {
      const value: unknown =
        typeof user === "object" && user !== null ? Reflect.get(user, key) : undefined;
      return typeof value === "string" ? value : "";
    };
    return [
      {
        userId,
        name: field("name").trim(),
        email: field("email"),
        role: isRole(role) ? role : null,
      },
    ];
  });
}
