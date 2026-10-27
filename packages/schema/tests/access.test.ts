import { expect, test } from "vite-plus/test";
import {
  allows,
  can,
  isRole,
  PERMISSIONS,
  ROLES,
  roles,
  statement,
  type Permission,
  type Role,
} from "../src/index.ts";

// The intended table, written out so a change to `roles` has to change this test too.
const expected: Record<Role, Record<Permission, boolean>> = {
  owner: {
    "incident:read": true,
    "incident:declare": true,
    "incident:update": true,
    "incident:ack": true,
    "workspace:create": true,
    "workspace:read": true,
    "workspace:manage": true,
    "members:manage": true,
    "monitor:read": true,
    "monitor:manage": true,
    "device:register": true,
    "schedule:read": true,
    "schedule:manage": true,
    "schedule:override": true,
    "escalation:read": true,
    "escalation:manage": true,
    "status:read": true,
    "status:manage": true,
    "status:publish": true,
    "webhook:manage": true,
    "catalog:read": true,
    "catalog:manage": true,
    "data:export": true,
    "alert:read": true,
    "alert:manage": true,
    "token:manage": true,
  },
  admin: {
    "incident:read": true,
    "incident:declare": true,
    "incident:update": true,
    "incident:ack": true,
    "workspace:create": false,
    "workspace:read": true,
    "workspace:manage": true,
    "members:manage": true,
    "monitor:read": true,
    "monitor:manage": true,
    "device:register": true,
    "schedule:read": true,
    "schedule:manage": true,
    "schedule:override": true,
    "escalation:read": true,
    "escalation:manage": true,
    "status:read": true,
    "status:manage": true,
    "status:publish": true,
    "webhook:manage": true,
    "catalog:read": true,
    "catalog:manage": true,
    "data:export": true,
    "alert:read": true,
    "alert:manage": true,
    "token:manage": true,
  },
  responder: {
    "incident:read": true,
    "incident:declare": true,
    "incident:update": true,
    "incident:ack": true,
    "workspace:create": false,
    "workspace:read": true,
    "workspace:manage": false,
    "members:manage": false,
    "monitor:read": true,
    "monitor:manage": false,
    "device:register": true,
    "schedule:read": true,
    "schedule:manage": false,
    "schedule:override": true,
    "escalation:read": true,
    "escalation:manage": false,
    "status:read": true,
    "status:manage": false,
    "status:publish": true,
    "webhook:manage": false,
    "catalog:read": true,
    "catalog:manage": false,
    "data:export": false,
    "alert:read": true,
    "alert:manage": false,
    "token:manage": false,
  },
  viewer: {
    "incident:read": true,
    "incident:declare": false,
    "incident:update": false,
    "incident:ack": false,
    "workspace:create": false,
    "workspace:read": true,
    "workspace:manage": false,
    "members:manage": false,
    "monitor:read": true,
    "monitor:manage": false,
    "device:register": true,
    "schedule:read": true,
    "schedule:manage": false,
    "schedule:override": false,
    "escalation:read": true,
    "escalation:manage": false,
    "status:read": true,
    "status:manage": false,
    "status:publish": false,
    "webhook:manage": false,
    "catalog:read": true,
    "catalog:manage": false,
    "data:export": false,
    "alert:read": true,
    "alert:manage": false,
    "token:manage": false,
  },
};

test("every permission comes from the statement", () => {
  expect(PERMISSIONS).toEqual([
    "incident:read",
    "incident:declare",
    "incident:update",
    "incident:ack",
    "workspace:create",
    "workspace:read",
    "workspace:manage",
    "members:manage",
    "monitor:read",
    "monitor:manage",
    "device:register",
    "schedule:read",
    "schedule:manage",
    "schedule:override",
    "escalation:read",
    "escalation:manage",
    "status:read",
    "status:manage",
    "status:publish",
    "webhook:manage",
    "catalog:read",
    "catalog:manage",
    "data:export",
    "alert:read",
    "alert:manage",
    "token:manage",
  ]);
});

for (const role of ROLES) {
  for (const permission of PERMISSIONS) {
    test(`${role} ${expected[role][permission] ? "can" : "cannot"} ${permission}`, () => {
      expect(can(role, permission)).toBe(expected[role][permission]);
    });
  }
}

test("roles only grant actions the statement declares", () => {
  for (const grants of Object.values(roles)) {
    for (const [resource, actions] of Object.entries(grants)) {
      const declared: readonly string[] = statement[resource as keyof typeof statement];
      for (const action of actions) expect(declared).toContain(action);
    }
  }
});

test("unknown roles and permissions grant nothing", () => {
  expect(isRole("owner")).toBe(true);
  expect(isRole("root")).toBe(false);
  expect(can("viewer", "incident:delete" as Permission)).toBe(false);
  expect(can("owner", "billing:read" as Permission)).toBe(false);
});

test("a token may use a permission only when its creator's role and its scopes both grant it (RFC 0014)", () => {
  const token = {
    kind: "token",
    role: "admin",
    scopes: ["monitor:manage", "incident:ack"],
  } as const;
  expect(allows(token, "monitor:manage")).toBe(true);
  // Granted by the role, not by the scopes.
  expect(allows(token, "incident:update")).toBe(false);
  // Its creator demoted: the scope stays, the role no longer grants it.
  expect(allows({ ...token, role: "responder" }, "monitor:manage")).toBe(false);
  expect(allows({ ...token, role: "responder" }, "incident:ack")).toBe(true);
  // A token without scopes can do nothing; a member is held to the role alone.
  expect(allows({ kind: "token", role: "owner" }, "incident:read")).toBe(false);
  expect(allows({ kind: "user", role: "admin" }, "incident:update")).toBe(true);
});
