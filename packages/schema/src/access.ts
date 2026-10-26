// The access-control table (RFC 0003). It has the shape Better Auth's `createAccessControl(statement)` and
// `ac.newRole(grants)` take, so the API, the sync engine and the UI can later share it through Better Auth
// without changing `can()` call sites.

export const ROLES = ["owner", "admin", "responder", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** Every resource and the actions on it. */
export const statement = {
  incident: ["read", "declare", "update", "ack"],
  // `read`: who is in the workspace (the shard's member list, RFC 0003); `create` only provisions a shard.
  workspace: ["create", "read"],
  // `manage`: change another member's role or remove them (RFC 0003 "Members"). Not `member`: that is Better Auth's
  // own resource, which `apps/api/src/auth.ts` merges with this table.
  members: ["manage"],
  monitor: ["read", "manage"],
  // `register`: a member's own devices for paging (RFC 0006); every role, so anyone can be reached.
  device: ["register"],
} as const;

type Statement = typeof statement;
type Resource = keyof Statement;
export type Permission = {
  [R in Resource]: `${R}:${Statement[R][number]}`;
}[Resource];

type Grants = { readonly [R in Resource]?: readonly Statement[R][number][] };

/** What each role may do. New resources get a row here together with the mutations that need them. */
export const roles = {
  owner: {
    incident: ["read", "declare", "update", "ack"],
    workspace: ["create", "read"],
    members: ["manage"],
    monitor: ["read", "manage"],
    device: ["register"],
  },
  admin: {
    incident: ["read", "declare", "update", "ack"],
    workspace: ["read"],
    members: ["manage"],
    monitor: ["read", "manage"],
    device: ["register"],
  },
  // Responders see what monitors say (they run the incidents monitors open) but do not change what is watched.
  responder: {
    incident: ["read", "declare", "update", "ack"],
    workspace: ["read"],
    monitor: ["read"],
    device: ["register"],
  },
  viewer: {
    incident: ["read"],
    workspace: ["read"],
    monitor: ["read"],
    device: ["register"],
  },
} as const satisfies Record<Role, Grants>;

export const PERMISSIONS: readonly Permission[] = (Object.keys(statement) as Resource[]).flatMap(
  (resource) => statement[resource].map((action) => `${resource}:${action}` as Permission),
);

export function isRole(value: unknown): value is Role {
  return (ROLES as readonly unknown[]).includes(value);
}

export function can(role: Role, permission: Permission): boolean {
  const [resource, action] = permission.split(":") as [Resource, string];
  const grants: Grants = roles[role];
  return (grants[resource] as readonly string[] | undefined)?.includes(action) ?? false;
}
