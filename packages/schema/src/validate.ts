// Hand-written argument validators (RFC 0004 "Shared core"). Each validator returns a new value, so a mutation
// never sees (or mutates) the caller's object, and reports issues instead of throwing.

import { isId } from "./id.ts";
import { clip, TEXT_ERRORS, textRules, trimSpace } from "./text.ts";

export type Issue = { path: string; message: string };
export type Validated<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };
export type Validator<T> = (input: unknown, path?: string) => Validated<T>;
export type Infer<V> = V extends Validator<infer T> ? T : never;

/** At most this many issues are reported, so a hostile payload cannot make a huge error. */
export const MAX_ISSUES = 10;

const valid = <T>(value: T): Validated<T> => ({ ok: true, value });
const invalid = (path: string, message: string): Validated<never> => ({
  ok: false,
  issues: [{ path, message }],
});

/**
 * A string, trimmed, with a length between `min` and `max` after trimming. Input longer than twice `max` (plus
 * some room for padding) is rejected before any other work. Then the text rules (`text.ts`): no unpaired
 * surrogates, controls, format or unassigned code points, default-ignorables or line/paragraph separators (emoji
 * sequences excepted), tabs and newlines only in multi-line text, and at least one visible code point. `min` is
 * checked after all that, so invisible padding cannot satisfy it.
 */
function string(options: { min?: number; max: number; multiline?: boolean }): Validator<string> {
  const min = options.min ?? 0;
  const raw = options.max * 2 + 64;
  const multiline = options.multiline ?? false;
  return (input, path = "") => {
    if (typeof input !== "string") return invalid(path, "Expected a string");
    if (input.length > raw) return invalid(path, `Expected at most ${options.max} characters`);
    const problem = textRules.problem(input, multiline);
    if (problem) return invalid(path, problem);
    const value = trimSpace(input);
    if (value.length > 0 && !textRules.hasVisible(value)) {
      return invalid(path, TEXT_ERRORS.nothingVisible);
    }
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

/** A safe integer between `min` and `max`, inclusive. */
function integer(options: { min: number; max: number }): Validator<number> {
  return (input, path = "") =>
    typeof input === "number" &&
    Number.isSafeInteger(input) &&
    input >= options.min &&
    input <= options.max
      ? valid(input)
      : invalid(path, `Expected a whole number from ${options.min} to ${options.max}`);
}

function boolean(): Validator<boolean> {
  return (input, path = "") =>
    typeof input === "boolean" ? valid(input) : invalid(path, "Expected true or false");
}

/** `null`, or what `inner` accepts. The key itself is still required. */
function nullable<T>(inner: Validator<T>): Validator<T | null> {
  return (input, path = "") => (input === null ? valid(null) : inner(input, path));
}

/**
 * An array of `min` to `max` items, each checked by `item`; with `unique`, no item twice. Longer input is refused
 * before any item is read.
 */
function array<T>(
  item: Validator<T>,
  options: { min?: number; max: number; unique?: boolean },
): Validator<T[]> {
  const min = options.min ?? 0;
  return (input, path = "") => {
    if (!Array.isArray(input)) return invalid(path, "Expected a list");
    if (input.length < min || input.length > options.max) {
      return invalid(path, `Expected ${min} to ${options.max} items`);
    }
    const issues: Issue[] = [];
    const value: T[] = [];
    for (let index = 0; index < input.length && issues.length < MAX_ISSUES; index++) {
      const result = item(input[index], clip(`${path}[${index}]`));
      if (!result.ok) issues.push(...result.issues);
      else if (options.unique && value.includes(result.value)) {
        issues.push({ path: clip(`${path}[${index}]`), message: "Listed twice" });
      } else value.push(result.value);
    }
    return issues.length ? { ok: false, issues: issues.slice(0, MAX_ISSUES) } : valid(value);
  };
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

export const v = { string, picklist, id, object, integer, boolean, nullable, array };
