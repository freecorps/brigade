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

/**
 * `value` cut to `MAX_ECHO` characters, for echoing client input in error messages and paths. Anything but a
 * string becomes its type in angle brackets (`<null>`, `<object>`), so echoing never runs client code.
 */
export function clip(value: unknown): string {
  if (typeof value !== "string") return `<${value === null ? "null" : typeof value}>`;
  return value.length > MAX_ECHO ? `${value.slice(0, MAX_ECHO - 1)}…` : value;
}

const valid = <T>(value: T): Validated<T> => ({ ok: true, value });
const invalid = (path: string, message: string): Validated<never> => ({
  ok: false,
  issues: [{ path, message }],
});

// Strings are scanned with plain index loops over UTF-16 code units: linear time on any input, and no
// dependence on the engine's regex Unicode tables (Workers, browsers and Hermes differ).

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

// Trimmed explicitly instead of with String#trim, whose whitespace set depends on the engine's Unicode version.
const SPACE = new Set([
  ...range(0x09, 0x0d), // tab, line feed, vertical tab, form feed, carriage return
  0x20,
  0xa0,
  0x1680,
  ...range(0x2000, 0x200a),
  0x2028,
  0x2029,
  0x202f,
  0x205f,
  0x3000,
  0xfeff,
]);

// Rejected everywhere: C0 controls (except tab and line feed, allowed in multi-line text), DEL and C1 controls,
// line/paragraph separators, and bidi embeddings, overrides and isolates (which make text read differently
// from what it holds).
const CONTROL_AND_BIDI = new Set([
  ...range(0x00, 0x08),
  ...range(0x0b, 0x1f),
  ...range(0x7f, 0x9f),
  0x2028,
  0x2029,
  ...range(0x202a, 0x202e),
  ...range(0x2066, 0x2069),
]);
// Also rejected in single-line text: tab and line feed, and invisible format characters (zero-width
// space/joiners, LRM/RLM, word joiner and invisible operators, Arabic letter mark, Mongolian vowel separator,
// BOM, soft hyphen) that can make a title look empty or like another one.
const SINGLE_LINE_ONLY = new Set([
  0x09,
  0x0a,
  ...range(0x200b, 0x200f),
  ...range(0x2060, 0x2064),
  0x061c,
  0x180e,
  0xfeff,
  0xad,
]);

/** Why `input` is not acceptable text, or undefined. Unpaired surrogates are never acceptable. */
function textProblem(input: string, multiline: boolean): string | undefined {
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
      return "Contains an unpaired surrogate";
    }
    if (code >= 0xdc00 && code <= 0xdfff) return "Contains an unpaired surrogate";
    if (CONTROL_AND_BIDI.has(code) || (!multiline && SINGLE_LINE_ONLY.has(code))) {
      return "Contains control, invisible or bidi characters";
    }
  }
  return undefined;
}

/** `input` without leading and trailing `SPACE`, in linear time. */
function trimSpace(input: string): string {
  let start = 0;
  let end = input.length;
  while (start < end && SPACE.has(input.charCodeAt(start))) start++;
  while (end > start && SPACE.has(input.charCodeAt(end - 1))) end--;
  return input.slice(start, end);
}

/**
 * A string, trimmed, with a length between `min` and `max` after trimming. Input longer than twice `max` (plus
 * some room for padding) is rejected before any other work. Unpaired surrogates, control characters, U+2028/2029
 * and bidi overrides/isolates are always rejected; single-line text (the default) also rejects tabs, newlines
 * and invisible format characters. `min` is checked after all that, so invisible padding cannot satisfy it.
 */
function string(options: { min?: number; max: number; multiline?: boolean }): Validator<string> {
  const min = options.min ?? 0;
  const raw = options.max * 2 + 64;
  const multiline = options.multiline ?? false;
  return (input, path = "") => {
    if (typeof input !== "string") return invalid(path, "Expected a string");
    if (input.length > raw) return invalid(path, `Expected at most ${options.max} characters`);
    const problem = textProblem(input, multiline);
    if (problem) return invalid(path, problem);
    const value = trimSpace(input);
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
