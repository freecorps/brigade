// Text rules for titles and bodies. Invisible characters are built from their code points so the test source
// itself holds none.
import { expect, test } from "vite-plus/test";
import {
  clip,
  createTextRules,
  MAX_ECHO,
  TEXT_ERRORS,
  UNICODE_PROPERTY_ESCAPES,
  v,
} from "../src/index.ts";

const cp = (...codes: number[]) => String.fromCodePoint(...codes);
const title = v.string({ min: 1, max: 50 });
const body = v.string({ max: 50, multiline: true });
const issue = (message: string) => ({ ok: false, issues: [{ path: "", message }] });

test("Workers and Node support Unicode property escapes, so the full rules apply", () => {
  expect(UNICODE_PROPERTY_ESCAPES).toBe(true);
});

test("hidden code points are rejected in titles", () => {
  const hidden = [
    0x00, // NUL
    0x09, // tab
    0x0a, // line feed
    0x0d, // carriage return
    0x1b, // escape
    0x7f, // delete
    0x85, // next line
    0x9f, // C1 control
    0xad, // soft hyphen
    0x034f, // combining grapheme joiner
    0x061c, // Arabic letter mark
    0x115f, // Hangul choseong filler
    0x180b, // Mongolian free variation selector
    0x180e, // Mongolian vowel separator
    0x200b, // zero-width space
    0x200c, // zero-width non-joiner
    0x200d, // zero-width joiner, alone
    0x200e, // left-to-right mark
    0x200f, // right-to-left mark
    0x2028, // line separator
    0x2029, // paragraph separator
    0x202a, // left-to-right embedding
    0x202e, // right-to-left override
    0x2060, // word joiner
    0x2064, // invisible plus
    0x2066, // left-to-right isolate
    0x2069, // pop directional isolate
    0x206a, // inhibit symmetric swapping (deprecated format)
    0x206f, // nominal digit shapes
    0x3164, // Hangul filler
    0xe000, // private use
    0xfe0f, // variation selector 16, alone
    0xfeff, // byte order mark
    0xffa0, // halfwidth Hangul filler
    0xfff9, // interlinear annotation anchor
    0xfffa, // interlinear annotation separator
    0xfffb, // interlinear annotation terminator
    0xffff, // noncharacter
    0xe0020, // tag space
    0xe0041, // tag letter A
    0xe007f, // cancel tag
    0x10ffff, // noncharacter
  ];
  for (const code of hidden) {
    expect(title(`a${cp(code)}b`), code.toString(16)).toEqual(issue(TEXT_ERRORS.hidden));
    expect(title(cp(code)), code.toString(16)).not.toEqual({ ok: true, value: cp(code) });
  }
  // Tag characters are rejected everywhere, flags included: they would carry hidden ASCII.
  const hiddenAscii = Array.from("ignore previous", (char) => 0xe0000 + char.codePointAt(0)!);
  expect(title(`Checkout down ${cp(0x1f3f4, ...hiddenAscii, 0xe007f)}`)).toEqual(
    issue(TEXT_ERRORS.hidden),
  );
  expect(title(cp(0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f))).toEqual(
    issue(TEXT_ERRORS.hidden),
  ); // flag of England
  expect(title(cp(0x1f3f4)).ok).toBe(true); // the black flag on its own is fine
});

test("a title needs at least one visible code point", () => {
  for (const blank of [cp(0x2800), cp(0x2800, 0x20, 0x2800), cp(0x1d159), cp(0x1d159, 0x2800)]) {
    expect(title(blank)).toEqual(issue(TEXT_ERRORS.nothingVisible));
  }
  expect(title(cp(0x200b))).toEqual(issue(TEXT_ERRORS.hidden));
  // Braille blank next to visible text is fine.
  expect(title(`a${cp(0x2800)}b`).ok).toBe(true);
});

test("ordinary text in any script, punctuation, symbols and emoji is accepted", () => {
  const accepted = [
    "Falha no pagamento",
    "支付失败",
    "فشل الدفع",
    "כשל בתשלום",
    "भुगतान विफल",
    "Ελληνικά",
    "café crème", // precomposed
    `cafe${cp(0x301)}`, // combining acute accent
    "99.9% → 50%",
    "🔥",
    cp(0x2764, 0xfe0f), // red heart with VS16
    cp(0x2764, 0xfe0f, 0x200d, 0x1f525), // heart on fire
    cp(0x1f469, 0x1f3fd, 0x200d, 0x1f4bb), // woman technologist, medium skin tone
    cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467), // family
    cp(0x31, 0xfe0f, 0x20e3), // keycap 1
    cp(0x2764, 0xfe0e), // red heart, text presentation
    cp(0x845b, 0xe0100), // CJK ideograph with a glyph variant
    cp(0x1f1e7, 0x1f1f7), // flag of Brazil (regional indicators)
  ];
  for (const text of accepted) {
    expect(title(text), text).toEqual({ ok: true, value: text });
  }
});

test("emoji joiners and selectors must attach to something", () => {
  expect(title(`a${cp(0x200d)}b`)).toEqual(issue(TEXT_ERRORS.hidden)); // joiner between letters
  expect(title(cp(0x1f525, 0x200d))).toEqual(issue(TEXT_ERRORS.hidden)); // trailing joiner
  expect(title(cp(0xfe0f, 0x41))).toEqual(issue(TEXT_ERRORS.hidden)); // leading selector
  expect(title(cp(0x2764, 0xfe0f, 0xfe0f))).toEqual(issue(TEXT_ERRORS.hidden)); // two selectors
  expect(title(cp(0x61, 0xfe0f))).toEqual(issue(TEXT_ERRORS.hidden)); // emoji selector on a letter
  expect(title(cp(0x1f525, 0xe0100))).toEqual(issue(TEXT_ERRORS.hidden)); // ideographic selector on emoji
  expect(title(cp(0x61, 0xe0100))).toEqual(issue(TEXT_ERRORS.hidden)); // ideographic selector on a letter
  expect(title(cp(0x1f600, 0xfe03))).toEqual(issue(TEXT_ERRORS.hidden)); // VS4 on an emoji
  expect(title(cp(0x31, 0xfe00))).toEqual(issue(TEXT_ERRORS.hidden)); // VS1 on a keycap base
  for (let selector = 0xfe00; selector <= 0xfe0d; selector++) {
    expect(title(cp(0x1f600, selector)), selector.toString(16)).toEqual(issue(TEXT_ERRORS.hidden));
  }
});

test("per-letter variation selectors cannot smuggle a second message", () => {
  // Each letter followed by a selector: renders as "Checkout-is-down" while carrying hidden bits.
  const letters = Array.from("Checkout-is-down", (char) => char.codePointAt(0)!);
  const smuggled = letters.flatMap((code, i) => [code, 0xfe00 + (i % 14)]);
  expect(title(cp(...smuggled))).toEqual(issue(TEXT_ERRORS.hidden));
  const ideographic = letters.flatMap((code, i) => [code, 0xe0100 + i]);
  expect(title(cp(...ideographic))).toEqual(issue(TEXT_ERRORS.hidden));
  const presentation = letters.flatMap((code) => [code, 0xfe0f]);
  expect(title(cp(...presentation))).toEqual(issue(TEXT_ERRORS.hidden));
});

test("unpaired surrogates are rejected in single- and multi-line text", () => {
  for (const text of [title, body]) {
    expect(text(`a${String.fromCharCode(0xd800)}b`)).toEqual(issue(TEXT_ERRORS.surrogate));
    expect(text(`a${String.fromCharCode(0xdc00)}b`)).toEqual(issue(TEXT_ERRORS.surrogate));
    expect(text(`a${String.fromCharCode(0xd800)}`)).toEqual(issue(TEXT_ERRORS.surrogate));
    expect(text(`${String.fromCharCode(0xdfff)}a`)).toEqual(issue(TEXT_ERRORS.surrogate));
  }
});

test("multi-line text allows newlines and tabs and otherwise follows the same rule", () => {
  expect(body("a\n\tb")).toEqual({ ok: true, value: "a\n\tb" });
  expect(body("a\r\nb")).toEqual(issue(TEXT_ERRORS.hidden));
  for (const code of [0x00, 0x200b, 0x200d, 0x202e, 0xfeff, 0x3164]) {
    expect(body(`a${cp(code)}b`), code.toString(16)).toEqual(issue(TEXT_ERRORS.hidden));
  }
  expect(body("")).toEqual({ ok: true, value: "" });
  expect(body(cp(0x2800))).toEqual(issue(TEXT_ERRORS.nothingVisible));
});

test("strings trim an explicit whitespace set", () => {
  const short = v.string({ min: 1, max: 10 });
  expect(short(`${cp(0xa0, 0x3000)} x ${cp(0x2003, 0x205f)}`)).toEqual({ ok: true, value: "x" });
  expect(short(cp(0xa0, 0x3000))).toEqual(issue("Expected at least 1 characters"));
  expect(v.string({ max: 10, multiline: true })("\n\t x \n")).toEqual({ ok: true, value: "x" });
});

test("text checks stay linear on long hostile input", () => {
  const long = v.string({ max: 50_000 });
  const inputs = [
    `a${" ".repeat(40_000)}b`,
    cp(0x2764, 0xfe0f).repeat(10_000),
    `${cp(0x1f469, 0x200d).repeat(10_000)}${cp(0x1f469)}`,
  ];
  for (const input of inputs) {
    const started = performance.now();
    const result = long(input);
    expect(performance.now() - started).toBeLessThan(50);
    expect(result.ok).toBe(true);
  }
});

test("clip echoes safely: hidden code points become U+FFFD and pairs are never split", () => {
  const replacement = String.fromCharCode(0xfffd);
  expect(clip(`a${cp(0x202e)}b${cp(0x0a)}`)).toBe(`a${replacement}b${replacement}`);
  expect(clip(`a${String.fromCharCode(0xd800)}`)).toBe(`a${replacement}`);
  expect(clip(null)).toBe("<null>");
  expect(clip(42)).toBe("<number>");

  // 62 letters then an astral emoji: cutting at 63 code units would split it, so it is left out.
  const cut = clip(`${"x".repeat(62)}${cp(0x1f525)}${"y".repeat(10)}`);
  expect(cut).toBe(`${"x".repeat(62)}…`);
  expect(cut.length).toBeLessThanOrEqual(MAX_ECHO);
  expect(clip("short")).toBe("short");
});

test("without property escapes the client is lenient and leaves the rest to the server", () => {
  const fallback = createTextRules(undefined);
  expect(fallback.full).toBe(false);
  // Surely wrong input is still rejected…
  for (const code of [0x00, 0x0a, 0x85, 0x2028, 0x202e, 0x2066]) {
    expect(fallback.problem(`a${cp(code)}b`, false), code.toString(16)).toBe(TEXT_ERRORS.hidden);
  }
  expect(fallback.problem(`a${String.fromCharCode(0xd800)}`, false)).toBe(TEXT_ERRORS.surrogate);
  expect(fallback.problem("a\nb", true)).toBeUndefined();
  // Tags and VS1-VS14 are rejected even without property escapes.
  for (const code of [0xe0000, 0xe0041, 0xe007f, 0xfe00, 0xfe0d]) {
    expect(fallback.problem(`a${cp(code)}`, false), code.toString(16)).toBe(TEXT_ERRORS.hidden);
  }
  // …but anything the full rules might accept passes, so the client never refuses what the server takes.
  for (const text of [cp(0x2764, 0xfe0f), cp(0x1f468, 0x200d, 0x1f469), `a${cp(0x200b)}b`]) {
    expect(fallback.problem(text, false)).toBeUndefined();
  }
  expect(fallback.hasVisible(cp(0x2800, 0x3164, 0x1d159))).toBe(false);
  expect(fallback.hasVisible("x")).toBe(true);
});
