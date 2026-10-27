// JSON Schema (draft 2020-12, the dialect of OpenAPI 3.1) from the `v.*` validators, so a published schema is made
// from the same validator the server runs and cannot drift from it; and a checker for the subset this file writes
// and the API reference uses, for tests that hold real answers to what the reference says.

import { idPattern } from "./id.ts";
import { shapeOf, type Validator } from "./validate.ts";

export type JsonSchema = { [keyword: string]: unknown };

/**
 * The JSON Schema of what `validator` accepts. Throws for a validator not made by `v.*` (a hand-written one has no
 * shape to read): describe it by hand where it is published instead.
 *
 * Close, not exact: the validators also refuse invisible or control characters, trim strings before counting (so a
 * padded string past `maxLength` may still pass) and count UTF-16 code units where JSON Schema counts code points.
 */
export function toJsonSchema(validator: Validator<unknown>): JsonSchema {
  const shape = shapeOf(validator);
  if (shape === undefined) throw new TypeError("Not a v.* validator: it has no JSON Schema");
  switch (shape.kind) {
    case "string":
      return {
        type: "string",
        ...(shape.min > 0 ? { minLength: shape.min } : {}),
        // The raw input may be longer: it is trimmed before `max` is checked.
        maxLength: shape.max,
      };
    case "picklist":
      return { type: "string", enum: [...shape.values] };
    case "literal":
      return { const: shape.value };
    case "id":
      return { type: "string", pattern: idPattern(shape.prefix) };
    case "integer":
      return { type: "integer", minimum: shape.min, maximum: shape.max };
    case "boolean":
      return { type: "boolean" };
    case "nullable":
      return { anyOf: [toJsonSchema(shape.inner), { type: "null" }] };
    case "optional":
    case "omittable":
      // Only a property can be left out: `object` leaves it out of `required`.
      return toJsonSchema(shape.inner);
    case "array":
      return {
        type: "array",
        items: toJsonSchema(shape.item),
        ...(shape.min > 0 ? { minItems: shape.min } : {}),
        maxItems: shape.max,
        ...(shape.unique ? { uniqueItems: true } : {}),
      };
    case "object": {
      const keys = Object.keys(shape.shape);
      return {
        type: "object",
        properties: Object.fromEntries(keys.map((key) => [key, toJsonSchema(shape.shape[key]!)])),
        required: keys.filter((key) => {
          const kind = shapeOf(shape.shape[key]!)?.kind;
          return kind !== "optional" && kind !== "omittable";
        }),
        ...(shape.open ? {} : { additionalProperties: false }),
      };
    }
  }
}

/**
 * Where `value` breaks `schema` (empty when it does not), for the keywords `toJsonSchema` writes plus `const`, `$ref`
 * (resolved in `root`, `#/…` only) and `additionalProperties` as a schema. Annotations (`description`, `format`, …)
 * are not checked. Throws on any other keyword, so a schema this cannot check never passes by accident.
 */
export function checkJsonSchema(
  schema: JsonSchema,
  value: unknown,
  root: JsonSchema = schema,
  path = "",
): string[] {
  const at = path || "(root)";
  const issues: string[] = [];
  for (const keyword of Object.keys(schema)) {
    if (!KEYWORDS.has(keyword)) throw new TypeError(`Unsupported JSON Schema keyword: ${keyword}`);
  }
  if (typeof schema.$ref === "string") {
    issues.push(...checkJsonSchema(resolve(root, schema.$ref), value, root, path));
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((type) => typeOf(value, type))) {
      return [...issues, `${at}: expected ${types.join(" or ")}`];
    }
  }
  if ("const" in schema && !same(schema.const, value)) issues.push(`${at}: expected the constant`);
  if (Array.isArray(schema.enum) && !schema.enum.some((one) => same(one, value))) {
    issues.push(`${at}: expected one of ${schema.enum.map(String).join(", ")}`);
  }
  if (Array.isArray(schema.anyOf)) {
    const options = schema.anyOf as JsonSchema[];
    if (!options.some((one) => checkJsonSchema(one, value, root, path).length === 0)) {
      issues.push(`${at}: matches none of anyOf`);
    }
  }
  if (typeof value === "string") {
    // JSON Schema counts code points, not UTF-16 code units.
    let length = 0;
    for (const _ of value) length++;
    if (typeof schema.minLength === "number" && length < schema.minLength) {
      issues.push(`${at}: shorter than ${schema.minLength}`);
    }
    if (typeof schema.maxLength === "number" && length > schema.maxLength) {
      issues.push(`${at}: longer than ${schema.maxLength}`);
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
      issues.push(`${at}: does not match ${schema.pattern}`);
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      issues.push(`${at}: below ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      issues.push(`${at}: above ${schema.maximum}`);
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      issues.push(`${at}: fewer than ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      issues.push(`${at}: more than ${schema.maxItems} items`);
    }
    if (schema.uniqueItems === true) {
      const seen = value.map((item) => JSON.stringify(item));
      if (new Set(seen).size !== seen.length) issues.push(`${at}: items repeat`);
    }
    if (typeof schema.items === "object" && schema.items !== null) {
      value.forEach((item, index) => {
        issues.push(
          ...checkJsonSchema(schema.items as JsonSchema, item, root, `${path}[${index}]`),
        );
      });
    }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const key of (schema.required ?? []) as string[]) {
      if (!Object.prototype.hasOwnProperty.call(object, key)) issues.push(`${at}: missing ${key}`);
    }
    for (const [key, item] of Object.entries(object)) {
      const where = path ? `${path}.${key}` : key;
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        issues.push(...checkJsonSchema(properties[key]!, item, root, where));
      } else if (schema.additionalProperties === false) {
        issues.push(`${where}: not allowed`);
      } else if (typeof schema.additionalProperties === "object") {
        issues.push(
          ...checkJsonSchema(schema.additionalProperties as JsonSchema, item, root, where),
        );
      }
    }
  }
  return issues;
}

const KEYWORDS = new Set([
  "$ref",
  "type",
  "const",
  "enum",
  "anyOf",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "items",
  "minItems",
  "maxItems",
  "uniqueItems",
  "properties",
  "required",
  "additionalProperties",
  // Annotations: never checked.
  "title",
  "description",
  "format",
  "examples",
]);

function typeOf(value: unknown, type: string): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return typeof value === "string";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      throw new TypeError(`Unknown JSON Schema type: ${type}`);
  }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function resolve(root: JsonSchema, ref: string): JsonSchema {
  if (!ref.startsWith("#/")) throw new TypeError(`Only local $ref is supported: ${ref}`);
  let node: unknown = root;
  for (const part of ref.slice(2).split("/")) {
    node =
      typeof node === "object" && node !== null
        ? (node as Record<string, unknown>)[part.replaceAll("~1", "/").replaceAll("~0", "~")]
        : undefined;
  }
  if (typeof node !== "object" || node === null) throw new TypeError(`Unresolved $ref: ${ref}`);
  return node as JsonSchema;
}
