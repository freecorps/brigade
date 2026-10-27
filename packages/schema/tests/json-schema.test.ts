import { describe, expect, test } from "vite-plus/test";
import {
  checkJsonSchema,
  declareIncident,
  isId,
  newId,
  ROLES,
  shapeOf,
  toJsonSchema,
  v,
  workspaceName,
  type JsonSchema,
  type Validator,
} from "../src/index.ts";

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

describe("toJsonSchema", () => {
  test("each v.* validator", () => {
    expect(toJsonSchema(v.string({ min: 1, max: 80 }))).toEqual({
      type: "string",
      minLength: 1,
      maxLength: 80,
    });
    expect(toJsonSchema(v.string({ max: 5 }))).toEqual({ type: "string", maxLength: 5 });
    expect(toJsonSchema(v.picklist(ROLES))).toEqual({ type: "string", enum: [...ROLES] });
    expect(toJsonSchema(v.integer({ min: 0, max: 9 }))).toEqual({
      type: "integer",
      minimum: 0,
      maximum: 9,
    });
    expect(toJsonSchema(v.boolean())).toEqual({ type: "boolean" });
    expect(toJsonSchema(v.nullable(v.boolean()))).toEqual({
      anyOf: [{ type: "boolean" }, { type: "null" }],
    });
    expect(toJsonSchema(v.array(v.id("usr"), { min: 1, max: 3, unique: true }))).toEqual({
      type: "array",
      items: { type: "string", pattern: expect.stringMatching(/^\^usr_/) },
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
    });
    expect(
      toJsonSchema(v.object({ name: workspaceName, note: v.optional(v.string({ max: 2 })) })),
    ).toEqual({
      type: "object",
      properties: {
        name: toJsonSchema(workspaceName),
        note: { type: "string", maxLength: 2 },
      },
      required: ["name"],
      additionalProperties: false,
    });
  });

  test("an id's pattern is the one isId checks", () => {
    const { pattern } = toJsonSchema(v.id("inc")) as { pattern: string };
    const id = newId("inc", Date.now(), random);
    for (const value of [id, id.toLowerCase(), `x${id}`, newId("mon", Date.now(), random)]) {
      expect(new RegExp(pattern).test(value), value).toBe(isId("inc", value));
    }
  });

  test("a hand-written validator has no schema", () => {
    const custom: Validator<string> = (input) =>
      typeof input === "string"
        ? { ok: true, value: input }
        : { ok: false, issues: [{ path: "", message: "no" }] };
    expect(shapeOf(custom)).toBeUndefined();
    expect(() => toJsonSchema(custom)).toThrow(TypeError);
  });

  test("what a mutation's validator accepts, its schema accepts", () => {
    const schema = toJsonSchema(declareIncident.args);
    const accepted = [
      { id: newId("inc", Date.now(), random), title: "Checkout is down", severity: "sev1" },
      { id: newId("inc", Date.now(), random), title: "Ünïcödé 🚒", severity: "sev4" },
    ];
    const refused = [
      { id: "inc_nope", title: "Checkout is down", severity: "sev1" },
      { id: newId("inc", Date.now(), random), title: "", severity: "sev1" },
      { id: newId("inc", Date.now(), random), title: "x", severity: "sev9" },
      { id: newId("inc", Date.now(), random), title: "x", severity: "sev1", extra: true },
    ];
    for (const args of accepted) {
      expect(declareIncident.args(args).ok).toBe(true);
      expect(checkJsonSchema(schema, args)).toEqual([]);
    }
    for (const args of refused) {
      expect(declareIncident.args(args).ok).toBe(false);
      expect(checkJsonSchema(schema, args)).not.toEqual([]);
    }
  });
});

describe("checkJsonSchema", () => {
  const root: JsonSchema = {
    components: {
      schemas: {
        Member: {
          type: "object",
          properties: {
            id: { type: "string", pattern: "^usr_" },
            name: { type: ["string", "null"] },
            role: { type: "string", enum: ["owner", "viewer"] },
            tags: { type: "array", items: { type: "string" }, maxItems: 2, uniqueItems: true },
          },
          required: ["id", "role"],
          additionalProperties: false,
        },
      },
    },
  };
  const member = { $ref: "#/components/schemas/Member" };

  test("passes a value that fits", () => {
    expect(checkJsonSchema(member, { id: "usr_1", name: null, role: "owner" }, root)).toEqual([]);
  });

  test("names each problem by its path", () => {
    expect(
      checkJsonSchema(member, { id: "x", role: "boss", tags: ["a", "a", "b"], extra: 1 }, root),
    ).toEqual([
      "id: does not match ^usr_",
      "role: expected one of owner, viewer",
      "tags: more than 2 items",
      "tags: items repeat",
      "extra: not allowed",
    ]);
    expect(checkJsonSchema(member, { role: "owner" }, root)).toEqual(["(root): missing id"]);
    expect(checkJsonSchema({ type: "integer", minimum: 1 }, 1.5)).toEqual([
      "(root): expected integer",
    ]);
  });

  test("refuses keywords it cannot check", () => {
    expect(() => checkJsonSchema({ oneOf: [] }, 1)).toThrow("oneOf");
  });
});
