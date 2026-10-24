// Hand-written argument validators (RFC 0004 "Shared core"). Each validator returns a new value, so a mutation
// never sees (or mutates) the caller's object, and reports issues instead of throwing.

import { isId } from "./id.ts";

export type Issue = { path: string; message: string };
export type Validated<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };
export type Validator<T> = (input: unknown, path?: string) => Validated<T>;
export type Infer<V> = V extends Validator<infer T> ? T : never;

const valid = <T>(value: T): Validated<T> => ({ ok: true, value });
const invalid = (path: string, message: string): Validated<never> => ({
  ok: false,
  issues: [{ path, message }],
});

/** A string, trimmed, with a length between `min` and `max` after trimming. */
function string(options: { min?: number; max: number }): Validator<string> {
  const min = options.min ?? 0;
  return (input, path = "") => {
    if (typeof input !== "string") return invalid(path, "Expected a string");
    const value = input.trim();
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

/** A plain object with exactly these keys; unknown keys are rejected. */
function object<const S extends Record<string, Validator<unknown>>>(
  shape: S,
): Validator<{ [K in keyof S]: Infer<S[K]> }> {
  return (input, path = "") => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return invalid(path, "Expected an object");
    }
    const record = input as Record<string, unknown>;
    const at = (key: string) => (path ? `${path}.${key}` : key);
    const issues: Issue[] = [];
    const value: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      if (!Object.prototype.hasOwnProperty.call(shape, key)) {
        issues.push({ path: at(key), message: "Unknown key" });
      }
    }
    for (const key of Object.keys(shape)) {
      const result = shape[key](record[key], at(key));
      if (result.ok) value[key] = result.value;
      else issues.push(...result.issues);
    }
    return issues.length ? { ok: false, issues } : valid(value as { [K in keyof S]: Infer<S[K]> });
  };
}

export const v = { string, picklist, id, object };
