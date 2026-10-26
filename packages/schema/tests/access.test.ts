import { expect, test } from "vite-plus/test";
import {
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
    "members:manage": true,
    "monitor:read": true,
    "monitor:manage": true,
    "device:register": true,
    "schedule:read": true,
    "schedule:manage": true,
    "schedule:override": true,
  },
  admin: {
    "incident:read": true,
    "incident:declare": true,
    "incident:update": true,
    "incident:ack": true,
    "workspace:create": false,
    "workspace:read": true,
    "members:manage": true,
    "monitor:read": true,
    "monitor:manage": true,
    "device:register": true,
    "schedule:read": true,
    "schedule:manage": true,
    "schedule:override": true,
  },
  responder: {
    "incident:read": true,
    "incident:declare": true,
    "incident:update": true,
    "incident:ack": true,
    "workspace:create": false,
    "workspace:read": true,
    "members:manage": false,
    "monitor:read": true,
    "monitor:manage": false,
    "device:register": true,
    "schedule:read": true,
    "schedule:manage": false,
    "schedule:override": true,
  },
  viewer: {
    "incident:read": true,
    "incident:declare": false,
    "incident:update": false,
    "incident:ack": false,
    "workspace:create": false,
    "workspace:read": true,
    "members:manage": false,
    "monitor:read": true,
    "monitor:manage": false,
    "device:register": true,
    "schedule:read": true,
    "schedule:manage": false,
    "schedule:override": false,
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
    "members:manage",
    "monitor:read",
    "monitor:manage",
    "device:register",
    "schedule:read",
    "schedule:manage",
    "schedule:override",
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
