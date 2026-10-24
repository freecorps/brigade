import { expect, test } from "vite-plus/test";
import { v } from "../src/index.ts";

test("string trims and checks length", () => {
  const title = v.string({ min: 1, max: 5 });
  expect(title("  abc ")).toEqual({ ok: true, value: "abc" });
  expect(title("   ").ok).toBe(false);
  expect(title("abcdef").ok).toBe(false);
  expect(title(3)).toEqual({ ok: false, issues: [{ path: "", message: "Expected a string" }] });
});

test("picklist accepts only its values", () => {
  const pick = v.picklist(["a", "b"]);
  expect(pick("a")).toEqual({ ok: true, value: "a" });
  expect(pick("c").ok).toBe(false);
  expect(pick(undefined).ok).toBe(false);
});

test("object returns a new object and reports every issue with its path", () => {
  const args = v.object({ name: v.string({ max: 10 }), kind: v.picklist(["x"]) });
  const input = { name: " n ", kind: "x" };
  const result = args(input);
  expect(result).toEqual({ ok: true, value: { name: "n", kind: "x" } });
  expect(result.ok && result.value).not.toBe(input);

  expect(args({ kind: "y", extra: 1 })).toEqual({
    ok: false,
    issues: [
      { path: "extra", message: "Unknown key" },
      { path: "name", message: "Expected a string" },
      { path: "kind", message: "Expected one of x" },
    ],
  });
  for (const bad of [null, [], "x", 1]) expect(args(bad).ok).toBe(false);
});

test("nested paths are dotted", () => {
  const args = v.object({ inner: v.object({ name: v.string({ max: 1 }) }) });
  expect(args({ inner: { name: "long" } })).toEqual({
    ok: false,
    issues: [{ path: "inner.name", message: "Expected at most 1 characters" }],
  });
});

test("object ignores prototype keys", () => {
  const args = v.object({});
  expect(args(JSON.parse('{"__proto__": {"x": 1}}')).ok).toBe(false);
  expect(args(Object.create({ inherited: 1 })).ok).toBe(true);
});
