// Hand-written argument validators (RFC 0004 "Shared core"). Each validator returns a new value, so a mutation
// never sees (or mutates) the caller's object, and reports issues instead of throwing.

import { isId } from "./id.ts";

export type Issue = { path: string; message: string };
export type Validated<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };
export type Validator<T> = (input: unknown, path?: string) => Validated<T>;
export type Infer<V> = V extends Validator<infer T> ? T : never;

/** At most this many issues are reported, so a hostile payload cannot make a huge error. */
export const MAX_ISSUES = 10;
/** Names and paths echoed back in errors are cut to this many characters. */
export const MAX_ECHO = 64;

/** `value` cut to `MAX_ECHO` characters, for echoing client input in error messages and paths. */
export function clip(value: string): string {
  return value.length > MAX_ECHO ? `${value.slice(0, MAX_ECHO - 1)}…` : value;
}

const valid = <T>(value: T): Validated<T> => ({ ok: true, value });
const invalid = (path: string, message: string): Validated<never> => ({
  ok: false,
  issues: [{ path, message }],
});

// Trimmed explicitly instead of with String#trim, whose whitespace set depends on the engine's Unicode version.
// Regexes are built from escaped strings so the source holds no raw control or separator characters.
const SPACE =
  "\\t\\n\\v\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF";
const EDGE_SPACE = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, "g");
// Line/paragraph separators, and bidi embeddings, overrides and isolates (which can make text read
// differently from what it holds).
const SEPARATORS_AND_BIDI = "\\u2028\\u2029\\u202A-\\u202E\\u2066-\\u2069";
// C0 and C1 controls (NUL, newlines and tabs included) and DEL.
const FORBIDDEN = new RegExp(`[\\u0000-\\u001F\\u007F-\\u009F${SEPARATORS_AND_BIDI}]`);
// The same, but newlines and tabs are allowed in multi-line text.
const FORBIDDEN_MULTILINE = new RegExp(
  `[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F${SEPARATORS_AND_BIDI}]`,
);

/**
 * A string, trimmed, with a length between `min` and `max` after trimming. Single-line by default: control
 * characters, newlines, U+2028/2029 and bidi overrides/isolates are rejected. Input longer than twice `max`
 * (plus some room for padding) is rejected before any other work.
 */
function string(options: { min?: number; max: number; multiline?: boolean }): Validator<string> {
  const min = options.min ?? 0;
  const raw = options.max * 2 + 64;
  const forbidden = options.multiline ? FORBIDDEN_MULTILINE : FORBIDDEN;
  return (input, path = "") => {
    if (typeof input !== "string") return invalid(path, "Expected a string");
    if (input.length > raw) return invalid(path, `Expected at most ${options.max} characters`);
    if (forbidden.test(input)) return invalid(path, "Contains control or bidi characters");
    const value = input.replace(EDGE_SPACE, "");
    if (value.length < min) return invalid(path, `Expected at least ${min} characters`);
    if (value.length > options.max) {
      return invalid(path, `Expected at most ${options.max} characters`);
    }
    return valid(value);
  };
}

/** One of a fixed list of strings. */
function picklist<const T extends string>(values: readonly T[]): Validator<T> {
  return (input, path = "") =>
    (values as readonly unknown[]).includes(input)
      ? valid(input as T)
      : invalid(path, `Expected one of ${values.join(", ")}`);
}

/** A prefixed ULID made by `newId(prefix, …)`. */
function id(prefix: string): Validator<string> {
  return (input, path = "") =>
    isId(prefix, input) ? valid(input) : invalid(path, `Expected a ${prefix}_ id`);
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  if (typeof input !== "object" || input === null) return false;
  const proto: unknown = Object.getPrototypeOf(input);
  return proto === Object.prototype || proto === null;
}

/** A plain object (no arrays, class instances or exotic prototypes) with exactly these keys. */
function object<const S extends Record<string, Validator<unknown>>>(
  shape: S,
): Validator<{ [K in keyof S]: Infer<S[K]> }> {
  return (input, path = "") => {
    if (!isPlainObject(input)) return invalid(path, "Expected an object");
    const at = (key: string) => clip(path ? `${path}.${key}` : key);
    const issues: Issue[] = [];
    const value: Record<string, unknown> = {};
    for (const key of Object.keys(input)) {
      if (issues.length >= MAX_ISSUES) break;
      if (!Object.prototype.hasOwnProperty.call(shape, key)) {
        issues.push({ path: at(key), message: "Unknown key" });
      }
    }
    for (const key of Object.keys(shape)) {
      const result = shape[key](input[key], at(key));
      if (result.ok) value[key] = result.value;
      else issues.push(...result.issues);
    }
    return issues.length
      ? { ok: false, issues: issues.slice(0, MAX_ISSUES) }
      : valid(value as { [K in keyof S]: Infer<S[K]> });
  };
}

export const v = { string, picklist, id, object };
