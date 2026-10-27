// Role definitions (RFC 0003 "Role definitions"): who defines them, the built-ins (renamed, removed, restored, never
// the commander), the cap, types listing roles, assigning by role id, and what readers list.
import { describe, expect, test } from "vite-plus/test";
import {
  createMemoryStore,
  incidentRoleList,
  MAX_INCIDENT_ROLES,
  missingRoles,
  mutations,
  roleDefinitions,
  runMutation,
  type BrigadeTables,
  type MutationContext,
  type MutationStore,
  type Role,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 27, 12, 0, 0);
const ROL = "rol_01JB0000000000000000000001";
const ROL2 = "rol_01JB0000000000000000000002";
const TYP = "typ_01JB0000000000000000000001";
const INC = "inc_01JB0000000000000000000001";

const ctx = (id: string, role: Role, now = T): MutationContext => ({
  actor: { kind: "user", id, role },
  now,
  server: true,
});
const owner = ctx("usr_ana", "owner");
const responder = ctx("usr_caio", "responder");

function shard() {
  const store = createMemoryStore<BrigadeTables>();
  for (const [id, role] of [
    ["usr_ana", "owner"],
    ["usr_caio", "responder"],
    ["usr_duda", "viewer"],
  ] as const) {
    store.insert("members", { id, name: id.slice(4), role, updatedAt: 0 });
  }
  return store;
}

const run = (store: MutationStore, name: string, args: unknown, context = owner) =>
  runMutation(mutations, name, args, store, context);

const scribe = (patch: Record<string, unknown> = {}) => ({
  id: ROL,
  name: "Scribe",
  description: "Keeps the timeline.",
  checklist: ["Write an update every 30 minutes", "Note every decision"],
  ...patch,
});

const type = (patch: Record<string, unknown> = {}) => ({
  id: TYP,
  name: "Payments outage",
  description: "",
  defaultSeverity: null,
  escalationPolicyId: null,
  requiredFields: [],
  ...patch,
});

const declare = (store: MutationStore, args: Record<string, unknown> = {}) =>
  run(store, "incident.declare", { id: INC, title: "Card payments fail", ...args }, responder);

const assign = (store: MutationStore, role: string, userId: string | null) =>
  run(store, "incident.assignRole", { id: INC, role, userId }, responder);

describe("defining roles", () => {
  test("owners and admins define roles; responders and viewers only read", () => {
    for (const role of ["responder", "viewer"] as const) {
      const store = shard();
      const as = ctx("usr_caio", role);
      for (const [name, args] of [
        ["incidentRole.create", scribe()],
        ["incidentRole.update", scribe({ id: "commander" })],
        ["incidentRole.delete", { id: "operations" }],
        ["incidentRole.restore", { id: "operations" }],
      ] as const) {
        const result = run(store, name, args, as);
        expect(!result.ok && result.error.code, `${role} ${name}`).toBe("forbidden");
      }
    }
    const store = shard();
    expect(run(store, "incidentRole.create", scribe(), ctx("usr_bia", "admin"))).toEqual({
      ok: true,
      events: [
        {
          type: "incident_role.created",
          subject: ROL,
          data: { id: ROL, name: "Scribe", checklist: 2 },
        },
      ],
    });
    expect(store.get("incident_roles", ROL)).toMatchObject({
      name: "Scribe",
      checklist: ["Write an update every 30 minutes", "Note every decision"],
      createdBy: "usr_bia",
    });
  });

  test("a checklist lists each responsibility once, in its size limits", () => {
    const store = shard();
    const twice = run(store, "incidentRole.create", scribe({ checklist: ["Notes", "notes"] }));
    expect(!twice.ok && twice.error.issues).toEqual([
      { path: "checklist[1]", message: "Listed twice" },
    ]);
    const many = Array.from({ length: 21 }, (_, index) => `Item ${index}`);
    expect(run(store, "incidentRole.create", scribe({ checklist: many })).ok).toBe(false);
    expect(run(store, "incidentRole.create", scribe({ checklist: ["x".repeat(201)] })).ok).toBe(
      false,
    );
    expect(run(store, "incidentRole.create", scribe({ checklist: ["a\nb"] })).ok).toBe(false);
  });

  test("at most MAX_INCIDENT_ROLES roles, the built-ins counted", () => {
    const store = shard();
    const ids = Array.from(
      { length: MAX_INCIDENT_ROLES - 3 },
      (_, index) => `rol_01JB00000000000000000001${String(index).padStart(2, "0")}`,
    );
    for (const id of ids) {
      expect(run(store, "incidentRole.create", scribe({ id, name: id }))).toMatchObject({
        ok: true,
      });
    }
    const over = run(store, "incidentRole.create", scribe());
    expect(!over.ok && over.error.code).toBe("limit_reached");
    // Renaming a built-in writes its row but is no new role.
    expect(run(store, "incidentRole.update", scribe({ id: "operations", name: "Ops" })).ok).toBe(
      true,
    );
    expect(roleDefinitions(store.scan("incident_roles"))).toHaveLength(MAX_INCIDENT_ROLES);
  });

  test("a deleted role's id is never taken again", () => {
    const store = shard();
    run(store, "incidentRole.create", scribe());
    expect(run(store, "incidentRole.delete", { id: ROL })).toMatchObject({
      ok: true,
      events: [
        { type: "incident_role.deleted", data: { id: ROL, name: "Scribe", builtin: false } },
      ],
    });
    const again = run(store, "incidentRole.create", scribe());
    expect(!again.ok && again.error.code).toBe("conflict");
    const missing = run(store, "incidentRole.update", scribe());
    expect(!missing.ok && missing.error.code).toBe("not_found");
  });

  test("built-ins are renamed and described in place; an empty name gives back their own", () => {
    const store = shard();
    expect(
      run(store, "incidentRole.update", {
        id: "commander",
        name: "Incident lead",
        description: "Runs the response.",
        checklist: ["Set the severity"],
      }),
    ).toEqual({
      ok: true,
      events: [
        {
          type: "incident_role.updated",
          subject: "commander",
          data: { id: "commander", name: "Incident lead", checklist: 1 },
        },
      ],
    });
    expect(roleDefinitions(store.scan("incident_roles"))[0]).toEqual({
      id: "commander",
      builtin: "commander",
      name: "Incident lead",
      description: "Runs the response.",
      checklist: ["Set the severity"],
      removed: false,
    });
    const same = run(store, "incidentRole.update", {
      id: "commander",
      name: "Incident lead",
      description: "Runs the response.",
      checklist: ["Set the severity"],
    });
    expect(!same.ok && same.error.code).toBe("conflict");
    run(store, "incidentRole.update", {
      id: "commander",
      name: "",
      description: "",
      checklist: [],
    });
    expect(roleDefinitions(store.scan("incident_roles"))[0]?.name).toBeNull();
    // Only built-ins go without a name; anything else is no role id.
    const unnamed = run(store, "incidentRole.create", scribe({ name: "" }));
    expect(unnamed.ok).toBe(false);
    run(store, "incidentRole.create", scribe());
    const blank = run(store, "incidentRole.update", scribe({ name: "" }));
    expect(!blank.ok && blank.error.issues).toEqual([{ path: "name", message: "Enter a name" }]);
    const bogus = run(store, "incidentRole.update", scribe({ id: "chef" }));
    expect(!bogus.ok && bogus.error.code).toBe("not_found");
  });

  test("the commander can never be removed: pages go to them first", () => {
    const store = shard();
    const result = run(store, "incidentRole.delete", { id: "commander" });
    expect(!result.ok && result.error).toMatchObject({
      code: "invalid_args",
      issues: [{ path: "id", message: "The commander role cannot be removed" }],
    });
    expect(store.scan("incident_roles")).toEqual([]);
    const restore = run(store, "incidentRole.restore", { id: "commander" });
    expect(restore.ok).toBe(false);
  });

  test("other built-ins are taken out and restored as they were", () => {
    const store = shard();
    run(store, "incidentRole.update", {
      id: "communications",
      name: "Comms",
      description: "",
      checklist: ["Post to the status page"],
    });
    expect(run(store, "incidentRole.delete", { id: "communications" })).toMatchObject({
      ok: true,
      events: [{ data: { id: "communications", name: "Comms", builtin: true } }],
    });
    expect(run(store, "incidentRole.delete", { id: "operations" }).ok).toBe(true);
    const twice = run(store, "incidentRole.delete", { id: "operations" });
    expect(!twice.ok && twice.error.code).toBe("not_found");
    expect(
      roleDefinitions(store.scan("incident_roles")).map((role) => [role.id, role.removed]),
    ).toEqual([
      ["commander", false],
      ["communications", true],
      ["operations", true],
    ]);
    expect(run(store, "incidentRole.restore", { id: "communications" })).toMatchObject({
      ok: true,
      events: [{ type: "incident_role.restored", data: { name: "Comms", checklist: 1 } }],
    });
    expect(roleDefinitions(store.scan("incident_roles"))[1]).toMatchObject({
      name: "Comms",
      checklist: ["Post to the status page"],
      removed: false,
    });
    const again = run(store, "incidentRole.restore", { id: "communications" });
    expect(!again.ok && again.error.code).toBe("conflict");
  });
});

describe("types listing roles", () => {
  test("a type lists live roles and requires some of them", () => {
    const store = shard();
    run(store, "incidentRole.create", scribe());
    expect(
      run(store, "incidentType.create", type({ roles: [ROL, "commander"], requiredRoles: [ROL] })),
    ).toMatchObject({
      ok: true,
      events: [{ data: { roles: 2, requiredRoles: 1 } }],
    });
    expect(store.get("incident_types", TYP)).toMatchObject({
      roles: [ROL, "commander"],
      requiredRoles: [ROL],
    });
    const bad = run(
      store,
      "incidentType.update",
      type({ roles: [ROL2, "chef"], requiredRoles: ["operations"] }),
    );
    expect(!bad.ok && bad.error.issues).toEqual([
      { path: "roles[0]", message: "Role not found" },
      { path: "roles[1]", message: "Role not found" },
      { path: "requiredRoles[0]", message: "Not one of the type's roles" },
    ]);
    run(store, "incidentRole.delete", { id: "operations" });
    const removed = run(store, "incidentType.update", type({ roles: ["operations"] }));
    expect(!removed.ok && removed.error.issues).toEqual([
      { path: "roles[0]", message: "Role not found" },
    ]);
  });

  test("a client from before role definitions leaves a type's roles as they were", () => {
    const store = shard();
    run(store, "incidentRole.create", scribe());
    run(store, "incidentType.create", type({ roles: [ROL], requiredRoles: [ROL] }));
    expect(run(store, "incidentType.update", type({ name: "Card outage" })).ok).toBe(true);
    expect(store.get("incident_types", TYP)).toMatchObject({
      name: "Card outage",
      roles: [ROL],
      requiredRoles: [ROL],
    });
    // And a type it creates lists none.
    const other = "typ_01JB0000000000000000000002";
    run(store, "incidentType.create", type({ id: other }));
    expect(store.get("incident_types", other)).toMatchObject({ roles: [], requiredRoles: [] });
  });

  test("deleting or removing a role takes it out of every type", () => {
    const store = shard();
    run(store, "incidentRole.create", scribe());
    run(
      store,
      "incidentType.create",
      type({ roles: [ROL, "operations"], requiredRoles: [ROL, "operations"] }),
    );
    expect(run(store, "incidentRole.delete", { id: ROL })).toMatchObject({
      ok: true,
      events: [
        { type: "incident_role.deleted" },
        { type: "incident_type.updated", data: { reason: "role_deleted", ref: ROL, roles: 1 } },
      ],
    });
    run(store, "incidentRole.delete", { id: "operations" });
    expect(store.get("incident_types", TYP)).toMatchObject({ roles: [], requiredRoles: [] });
  });
});

describe("assigning roles", () => {
  test("a workspace role is assigned by its id, named in the entry and the event", () => {
    const store = shard();
    run(store, "incidentRole.create", scribe());
    declare(store);
    expect(assign(store, ROL, "usr_caio")).toEqual({
      ok: true,
      events: [
        {
          type: "incident.role_assigned",
          subject: INC,
          data: { role: "custom", roleId: ROL, roleName: "Scribe", from: null, to: "usr_caio" },
        },
      ],
    });
    expect(store.get("incidents", INC)?.roles).toEqual({ [ROL]: "usr_caio" });
    expect(store.scan("timeline").at(-1)).toMatchObject({
      kind: "role_assigned",
      role: ROL,
      roleName: "Scribe",
      from: null,
      to: "usr_caio",
    });
  });

  test("a renamed built-in keeps its id: entries carry the name, events the old role field", () => {
    const store = shard();
    run(store, "incidentRole.update", {
      id: "commander",
      name: "Lead",
      description: "",
      checklist: [],
    });
    declare(store);
    expect(assign(store, "commander", "usr_ana")).toMatchObject({
      ok: true,
      events: [{ data: { role: "commander", roleId: "commander", roleName: "Lead" } }],
    });
    expect(store.get("incidents", INC)?.roles).toEqual({ commander: "usr_ana" });
    expect(store.scan("timeline").at(-1)).toMatchObject({ role: "commander", roleName: "Lead" });
  });

  test("an unknown, deleted or removed role cannot be given, but whoever holds one can be taken off", () => {
    const store = shard();
    run(store, "incidentRole.create", scribe());
    declare(store);
    for (const role of ["chef", ROL2, "rol_nope"]) {
      const result = assign(store, role, "usr_caio");
      expect(!result.ok && result.error.code, role).toBe("invalid_args");
      expect(!result.ok && result.error.issues?.[0]?.path, role).toBe("role");
    }
    assign(store, ROL, "usr_caio");
    assign(store, "operations", "usr_ana");
    run(store, "incidentRole.delete", { id: ROL });
    run(store, "incidentRole.delete", { id: "operations" });
    expect(assign(store, "operations", "usr_caio").ok).toBe(false);
    expect(assign(store, ROL, "usr_ana").ok).toBe(false);
    expect(assign(store, ROL, null)).toMatchObject({
      ok: true,
      events: [{ data: { role: "custom", roleId: ROL, roleName: null, to: null } }],
    });
    expect(assign(store, "operations", null).ok).toBe(true);
    expect(store.get("incidents", INC)?.roles).toEqual({});
  });
});

describe("what the incident page lists", () => {
  test("every role offered without a type; with one, the commander and its roles, then whoever holds others", () => {
    const store = shard();
    run(store, "incidentRole.create", scribe());
    run(store, "incidentRole.create", scribe({ id: ROL2, name: "Liaison" }));
    run(store, "incidentRole.delete", { id: "communications" });
    declare(store);
    const ids = () =>
      incidentRoleList(
        store.get("incidents", INC)!,
        store.scan("incident_types"),
        store.scan("incident_roles"),
      ).map((role) => role.id);
    expect(ids()).toEqual(["commander", "operations", ROL, ROL2]);
    run(store, "incidentType.create", type({ roles: [ROL2], requiredRoles: [ROL2] }));
    run(store, "incident.setType", { id: INC, typeId: TYP }, responder);
    expect(ids()).toEqual(["commander", ROL2]);
    assign(store, "operations", "usr_ana");
    expect(ids()).toEqual(["commander", ROL2, "operations"]);
    const missing = () =>
      missingRoles(
        store.get("incidents", INC)!,
        store.scan("incident_types"),
        store.scan("incident_roles"),
      ).map((role) => role.id);
    expect(missing()).toEqual([ROL2]);
    assign(store, ROL2, "usr_caio");
    expect(missing()).toEqual([]);
    // A deleted role is not listed, even held: it has no name left. The type lists no role now, so every one shows.
    run(store, "incidentRole.delete", { id: ROL2 });
    expect(store.get("incidents", INC)?.roles?.[ROL2]).toBe("usr_caio");
    expect(ids()).toEqual(["commander", "operations", ROL]);
  });
});
