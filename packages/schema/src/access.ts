// The access-control table (RFC 0003). It has the shape Better Auth's `createAccessControl(statement)` and
// `ac.newRole(grants)` take, so the API, the sync engine and the UI can later share it through Better Auth
// without changing `can()` call sites.

export const ROLES = ["owner", "admin", "responder", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** Every resource and the actions on it. */
export const statement = {
  incident: ["read", "declare", "update", "ack"],
  // `read`: who is in the workspace (the shard's member list, RFC 0003); `create` only provisions a shard;
  // `manage`: the workspace's own settings (who is emailed when paging fails, RFC 0005 "Email").
  workspace: ["create", "read", "manage"],
  // `manage`: change another member's role or remove them (RFC 0003 "Members"). Not `member`: that is Better Auth's
  // own resource, which `apps/api/src/auth.ts` merges with this table.
  members: ["manage"],
  monitor: ["read", "manage"],
  // `register`: a member's own devices for paging (RFC 0006); every role, so anyone can be reached.
  device: ["register"],
  // On-call schedules (RFC 0003 "Schedules"): `manage` creates, edits and deletes schedules and anyone's overrides;
  // `override` adds and removes overrides, only one's own without `manage`.
  schedule: ["read", "manage", "override"],
  // Escalation policies (RFC 0003 "Escalation policies"): who is paged, in which order, after how long.
  escalation: ["read", "manage"],
  // The public status page (RFC 0012): `manage` sets it up and edits its components; `publish` tells the public
  // about an incident.
  status: ["read", "manage", "publish"],
  // Outbound webhooks (RFC 0005 "Outbound webhooks"): only those who manage them see them, since a URL may carry a token.
  webhook: ["manage"],
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
    workspace: ["create", "read", "manage"],
    members: ["manage"],
    monitor: ["read", "manage"],
    device: ["register"],
    schedule: ["read", "manage", "override"],
    escalation: ["read", "manage"],
    status: ["read", "manage", "publish"],
    webhook: ["manage"],
  },
  admin: {
    incident: ["read", "declare", "update", "ack"],
    workspace: ["read", "manage"],
    members: ["manage"],
    monitor: ["read", "manage"],
    device: ["register"],
    schedule: ["read", "manage", "override"],
    escalation: ["read", "manage"],
    status: ["read", "manage", "publish"],
    webhook: ["manage"],
  },
  // Responders see what monitors say (they run the incidents monitors open) but do not change what is watched.
  responder: {
    incident: ["read", "declare", "update", "ack"],
    workspace: ["read"],
    monitor: ["read"],
    device: ["register"],
    // Responders cover for each other (their own overrides) but do not change the rotations.
    schedule: ["read", "override"],
    escalation: ["read"],
    // Responders run incidents, so they tell the public about them; what the page lists is an admin's call.
    status: ["read", "publish"],
  },
  viewer: {
    incident: ["read"],
    workspace: ["read"],
    monitor: ["read"],
    device: ["register"],
    schedule: ["read"],
    escalation: ["read"],
    status: ["read"],
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
