// The role editor's checks and a type's roles (RFC 0003 "Role definitions"), as the dashboard sends them.
import type { IncidentRoleRow } from "@freecorps/brigade-schema";
import { expect, test } from "vite-plus/test";
import {
  canAddRole,
  checklistItem,
  checkRole,
  checkType,
  emptyType,
  setTypeRoleUse,
  typeRoleUse,
} from "../src/lib/catalog";

const ROL = "rol_01JB0000000000000000000001";
const role = (id: string, patch: Partial<IncidentRoleRow> = {}): IncidentRoleRow => ({
  id,
  name: "Scribe",
  description: "",
  checklist: [],
  createdAt: 0,
  createdBy: "usr_ana",
  updatedAt: 0,
  ...patch,
});

test("a role's responsibilities are trimmed, blanks left out, and each must differ", () => {
  const draft = {
    name: "  Scribe ",
    description: "",
    checklist: [checklistItem(" Notes "), checklistItem(""), checklistItem("Decisions")],
  };
  expect(checkRole(ROL, draft)).toEqual({
    ok: true,
    args: { id: ROL, name: "Scribe", description: "", checklist: ["Notes", "Decisions"] },
  });
  const twice = { ...draft, checklist: [checklistItem("Notes"), checklistItem("notes")] };
  expect(checkRole(ROL, twice)).toMatchObject({ ok: false, errors: { checklist: true } });
  const long = { ...draft, checklist: [checklistItem("x".repeat(201))] };
  expect(checkRole(ROL, long)).toMatchObject({ ok: false, errors: { checklist: true } });
});

test("only a built-in may go without a name: it reads under its own", () => {
  const blank = { name: "  ", description: "", checklist: [] };
  expect(checkRole("commander", blank)).toMatchObject({ ok: true, args: { name: "" } });
  expect(checkRole(ROL, blank)).toMatchObject({ ok: false, errors: { name: true } });
});

test("a type takes each role as not listed, to fill or required", () => {
  let draft = emptyType();
  draft = setTypeRoleUse(draft, ROL, "required");
  draft = setTypeRoleUse(draft, "operations", "listed");
  expect([draft.roles, draft.requiredRoles]).toEqual([[ROL, "operations"], [ROL]]);
  expect(typeRoleUse(draft, ROL)).toBe("required");
  draft = setTypeRoleUse(draft, ROL, "listed");
  expect([draft.roles, draft.requiredRoles]).toEqual([[ROL, "operations"], []]);
  draft = setTypeRoleUse(draft, ROL, "off");
  expect(typeRoleUse(draft, ROL)).toBe("off");
  // A role deleted or taken out while the form was open is left out rather than refused.
  const listed = setTypeRoleUse(
    setTypeRoleUse({ ...draft, name: "Outage" }, ROL, "required"),
    "communications",
    "listed",
  );
  const checked = checkType("typ_x", listed, [], [role("communications", { removed: true })]);
  expect(checked).toMatchObject({ ok: true, args: { roles: ["operations"], requiredRoles: [] } });
});

test("at most 15 roles, the built-ins counted", () => {
  const own = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      role(`rol_01JB00000000000000000000${String(index).padStart(2, "0")}`),
    );
  expect(canAddRole(own(11))).toBe(true);
  expect(canAddRole([...own(12), role("operations", { name: "Ops" })])).toBe(false);
});
