import { expect, test } from "vite-plus/test";
import { clip, MAX_ECHO, MAX_ISSUES, v } from "../src/index.ts";

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

test("openPicklist accepts its values and any other short string", () => {
  const pick = v.openPicklist(["a", "b"], { max: 3 });
  expect(pick("a")).toEqual({ ok: true, value: "a" });
  expect(pick("new")).toEqual({ ok: true, value: "new" });
  expect(pick("").ok).toBe(false);
  expect(pick("long").ok).toBe(false);
  expect(pick(1).ok).toBe(false);
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

test("object accepts only plain objects and ignores prototype keys", () => {
  const args = v.object({});
  expect(args(JSON.parse('{"__proto__": {"x": 1}}')).ok).toBe(false);
  expect(args(Object.create(null)).ok).toBe(true);
  expect(args(Object.create({ inherited: 1 })).ok).toBe(false);
  expect(args(new Date(0)).ok).toBe(false);
  expect(args(new (class Args {})()).ok).toBe(false);
});

test("single-line strings reject control, separator and bidi characters", () => {
  const title = v.string({ min: 1, max: 50 });
  const rejected = [
    "\u0000",
    "\u0007",
    "\t",
    "\n",
    "\r",
    "\u001B[31m",
    "\u007F",
    "\u0085",
    "\u009F",
    "\u2028",
    "\u2029",
    "\u202A",
    "\u202E",
    "\u2066",
    "\u2069",
  ];
  for (const char of rejected) {
    const code = char.codePointAt(0)!.toString(16);
    expect(title(`a${char}b`), code).toEqual({
      ok: false,
      issues: [{ path: "", message: "Contains control, invisible or bidi characters" }],
    });
  }
  // Ordinary non-Latin text, emoji and right-to-left scripts are fine.
  for (const text of ["Falha no pagamento", "支付失败", "فشل الدفع", "🔥 checkout"]) {
    expect(title(text)).toEqual({ ok: true, value: text });
  }
});

test("trimming is linear even with long interior whitespace", () => {
  const body = v.string({ max: 50_000 });
  const input = `a${" ".repeat(40_000)}b`;
  const started = performance.now();
  const result = body(input);
  const elapsed = performance.now() - started;
  expect(result).toEqual({ ok: true, value: input });
  // Quadratic behaviour at this size takes seconds; the limit only has to catch that.
  expect(elapsed).toBeLessThan(500);
});

test("absurdly long raw input is rejected before trimming", () => {
  const title = v.string({ min: 1, max: 10 });
  // Padding within the raw limit is trimmed away…
  expect(title(`${" ".repeat(80)}x`)).toEqual({ ok: true, value: "x" });
  // …but past it the input is rejected whatever it trims to.
  expect(title(`${" ".repeat(100)}x`)).toEqual({
    ok: false,
    issues: [{ path: "", message: "Expected at most 10 characters" }],
  });
  expect(title("x".repeat(1_000_000)).ok).toBe(false);
});

test("issues are capped and echoed paths are clipped", () => {
  const args = v.object({ name: v.string({ max: 1 }) });
  const junk = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i]));
  const result = args(junk);
  expect(!result.ok && result.issues.length).toBe(MAX_ISSUES);

  const long = "k".repeat(10_000);
  const clipped = args({ [long]: 1, name: "x" });
  expect(!clipped.ok && clipped.issues[0]!.path.length).toBe(MAX_ECHO);
  expect(clip("short")).toBe("short");
});
