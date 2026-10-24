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

// Invisible characters are built from their code points so the test source stays readable.
const ch = (...codes: number[]) => String.fromCharCode(...codes);

test("single-line strings reject invisible format characters", () => {
  const title = v.string({ min: 1, max: 50 });
  const invisible = [
    0x200b, // zero-width space
    0x200c, // zero-width non-joiner
    0x200d, // zero-width joiner
    0x200e, // left-to-right mark
    0x200f, // right-to-left mark
    0x2060, // word joiner
    0x2061, // function application
    0x2064, // invisible plus
    0x061c, // Arabic letter mark
    0x180e, // Mongolian vowel separator
    0xfeff, // byte order mark
    0x00ad, // soft hyphen
  ];
  for (const code of invisible) {
    expect(title(`a${ch(code)}b`), code.toString(16)).toEqual({
      ok: false,
      issues: [{ path: "", message: "Contains control, invisible or bidi characters" }],
    });
  }
  // A title made only of an invisible character does not pass `min` as an empty-looking title.
  expect(title(ch(0x200b)).ok).toBe(false);
  expect(title(` ${ch(0x200b)} `).ok).toBe(false);
});

test("strings reject unpaired surrogates but keep paired ones", () => {
  const surrogate = {
    ok: false,
    issues: [{ path: "", message: "Contains an unpaired surrogate" }],
  };
  for (const options of [{ max: 50 }, { max: 50, multiline: true }]) {
    const text = v.string(options);
    expect(text(`a${ch(0xd800)}b`)).toEqual(surrogate);
    expect(text(`a${ch(0xdc00)}b`)).toEqual(surrogate);
    expect(text(`a${ch(0xd800)}`)).toEqual(surrogate);
    expect(text(`${ch(0xdfff)}a`)).toEqual(surrogate);
    const fire = ch(0xd83d, 0xdd25);
    expect(text(`a${fire}b`)).toEqual({ ok: true, value: `a${fire}b` });
  }
});

test("multi-line strings allow newlines and tabs but nothing else", () => {
  const body = v.string({ max: 50, multiline: true });
  expect(body("a\n\tb")).toEqual({ ok: true, value: "a\n\tb" });
  expect(body("a\r\nb").ok).toBe(false);
  expect(body(`a${ch(0x00)}b`).ok).toBe(false);
  expect(body(`a${ch(0x202e)}b`).ok).toBe(false);
  // Invisible format characters are allowed in multi-line text; only the surrogate rule is shared.
  expect(body(`a${ch(0x200d)}b`).ok).toBe(true);
});

test("strings trim an explicit whitespace set", () => {
  const title = v.string({ min: 1, max: 10 });
  expect(title(`${ch(0xa0, 0x3000)} x ${ch(0x2003, 0x205f)}`)).toEqual({ ok: true, value: "x" });
  expect(title(ch(0xa0, 0x3000)).ok).toBe(false);
  const body = v.string({ max: 10, multiline: true });
  expect(body(`\n\t x ${ch(0xfeff)}\n`)).toEqual({ ok: true, value: "x" });
});

test("trimming is linear even with long interior whitespace", () => {
  const body = v.string({ max: 50_000 });
  const input = `a${" ".repeat(40_000)}b`;
  const started = performance.now();
  const result = body(input);
  const elapsed = performance.now() - started;
  expect(result).toEqual({ ok: true, value: input });
  expect(elapsed).toBeLessThan(50);
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
