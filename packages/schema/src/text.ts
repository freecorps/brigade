// Rules for user-written text (RFC 0004 "Validation"): which code points a title or a body may hold, how it is
// trimmed, and how client input is echoed back in errors. Everything walks the string once, in linear time.

/**
 * Builds a Unicode property regex at runtime, so an engine without property escapes (Hermes before mid-2024, or
 * one built without them) fails here, not when parsing the module. `undefined` then selects the fallback rules.
 */
function propertyRegex(source: string): RegExp | undefined {
  try {
    return new RegExp(source, "u");
  } catch {
    return undefined;
  }
}

type Properties = { hidden: RegExp; visible: RegExp; pictographic: RegExp };

function detectProperties(): Properties | undefined {
  const hidden = propertyRegex(
    "^[\\p{Cc}\\p{Cf}\\p{Cs}\\p{Co}\\p{Cn}\\p{Default_Ignorable_Code_Point}\\p{Zl}\\p{Zp}]$",
  );
  const visible = propertyRegex("^[\\p{L}\\p{N}\\p{S}\\p{P}]$");
  const pictographic = propertyRegex("^\\p{Extended_Pictographic}$");
  return hidden && visible && pictographic ? { hidden, visible, pictographic } : undefined;
}

// Trimmed explicitly instead of with String#trim, whose whitespace set depends on the engine's Unicode version.
const SPACE = new Set([
  0x09, // tab
  0x0a, // line feed
  0x0b, // vertical tab
  0x0c, // form feed
  0x0d, // carriage return
  0x20,
  0xa0,
  0x1680,
  0x2000,
  0x2001,
  0x2002,
  0x2003,
  0x2004,
  0x2005,
  0x2006,
  0x2007,
  0x2008,
  0x2009,
  0x200a,
  0x2028,
  0x2029,
  0x202f,
  0x205f,
  0x3000,
  0xfeff,
]);

// Look blank but count as letters or symbols (Braille blank is a symbol; Hangul fillers are letters that some
// engines' tables do not mark ignorable). They may appear, but never make a string visible on their own.
const BLANK = new Set([0x2800, 0x115f, 0x1160, 0x3164, 0xffa0]);

const ZWJ = 0x200d;
const BLACK_FLAG = 0x1f3f4;
const CANCEL_TAG = 0xe007f;
const isSurrogate = (cp: number) => cp >= 0xd800 && cp <= 0xdfff;
// Variation selectors: the emoji/text ones (VS1-VS16) and the ideographic ones (VS17-VS256, used for CJK
// glyph variants).
const isEmojiSelector = (cp: number) => cp >= 0xfe00 && cp <= 0xfe0f;
const isIdeographicSelector = (cp: number) => cp >= 0xe0100 && cp <= 0xe01ef;
const isVariationSelector = (cp: number) => isEmojiSelector(cp) || isIdeographicSelector(cp);
// Keycap bases (digits, # and *), which take VS16 before the combining keycap.
const isKeycapBase = (cp: number) => (cp >= 0x30 && cp <= 0x39) || cp === 0x23 || cp === 0x2a;
const isTag = (cp: number) => cp >= 0xe0020 && cp <= 0xe007e;
const isSkinTone = (cp: number) => cp >= 0x1f3fb && cp <= 0x1f3ff;

// Without property escapes the client only rejects what is surely wrong (controls, separators, bidi
// overrides/isolates) and lets the server, whose engine has them, decide the rest: validation on clients is
// only optimistic.
const fallbackHidden = (cp: number) =>
  cp <= 0x1f ||
  (cp >= 0x7f && cp <= 0x9f) ||
  cp === 0x2028 ||
  cp === 0x2029 ||
  (cp >= 0x202a && cp <= 0x202e) ||
  (cp >= 0x2066 && cp <= 0x2069);

/** The messages of the text rules' issues. */
export const TEXT_ERRORS = {
  surrogate: "Contains an unpaired surrogate",
  hidden: "Contains control, invisible or bidi characters",
  nothingVisible: "Has no visible characters",
} as const;
const SURROGATE = TEXT_ERRORS.surrogate;
const HIDDEN = TEXT_ERRORS.hidden;

export type TextRules = {
  /** Whether the engine supports Unicode property escapes; false means the lenient fallback is in use. */
  readonly full: boolean;
  /** Why `input` is not acceptable text, or undefined. Multi-line text may also hold `\n` and `\t`. */
  problem(input: string, multiline: boolean): string | undefined;
  /** Whether `input` has at least one visible code point (a letter, number, symbol or punctuation). */
  hasVisible(input: string): boolean;
  /** `value` for an error message: hidden code points become U+FFFD, cut to `MAX_ECHO` (never mid-pair). */
  clip(value: unknown): string;
};

/** Names and paths echoed back in errors are cut to this many UTF-16 code units. */
export const MAX_ECHO = 64;
const REPLACEMENT = String.fromCharCode(0xfffd);

/** The text rules for an engine with (`properties`) or without (`undefined`) Unicode property escapes. */
export function createTextRules(properties: Properties | undefined): TextRules {
  const hidden = (char: string, cp: number) =>
    isSurrogate(cp) || (properties ? properties.hidden.test(char) : fallbackHidden(cp));
  const visible = (char: string, cp: number) =>
    !BLANK.has(cp) &&
    !SPACE.has(cp) &&
    (properties ? properties.visible.test(char) : !fallbackHidden(cp) && !isSurrogate(cp));
  const pictographic = (char: string) => properties?.pictographic.test(char) ?? false;

  function problem(input: string, multiline: boolean): string | undefined {
    const chars = Array.from(input); // code points; an unpaired surrogate stays a single element
    // What the previous code point lets an emoji modifier attach to.
    let after: "none" | "base" | "pictograph" = "none";
    let flagTags = false; // inside black flag + tag characters, waiting for the cancel tag
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      const cp = char.codePointAt(0)!;
      if (isSurrogate(cp)) return SURROGATE;
      if (multiline && (cp === 0x0a || cp === 0x09)) {
        if (flagTags) return HIDDEN;
        after = "none";
        continue;
      }
      if (properties) {
        // Emoji sequences are made of characters that are invisible on their own; accept them only where
        // they attach to something visible.
        const previous = i > 0 ? chars[i - 1].codePointAt(0)! : -1;
        if (isTag(cp)) {
          if (!(flagTags || previous === BLACK_FLAG)) return HIDDEN;
          flagTags = true;
          continue;
        }
        if (cp === CANCEL_TAG) {
          if (!flagTags) return HIDDEN;
          flagTags = false;
          after = "none";
          continue;
        }
        if (flagTags) return HIDDEN; // a flag tag sequence must end with the cancel tag
        if (isVariationSelector(cp)) {
          // One selector, right after what it selects: an emoji or keycap base (VS1-VS16) or a letter
          // (the ideographic ones).
          const selects = isEmojiSelector(cp)
            ? after === "pictograph" || isKeycapBase(previous)
            : after === "base";
          if (!selects || isVariationSelector(previous)) return HIDDEN;
          continue;
        }
        if (cp === ZWJ) {
          const next = chars[i + 1];
          if (after !== "pictograph" || next === undefined || !pictographic(next)) return HIDDEN;
          after = "none";
          continue;
        }
        if (isSkinTone(cp) && after === "pictograph") continue;
      }
      if (hidden(char, cp)) return HIDDEN;
      after = pictographic(char) ? "pictograph" : visible(char, cp) ? "base" : "none";
    }
    return flagTags ? HIDDEN : undefined;
  }

  function hasVisible(input: string): boolean {
    for (const char of input) {
      if (visible(char, char.codePointAt(0)!)) return true;
    }
    return false;
  }

  function clip(value: unknown): string {
    if (typeof value !== "string") return `<${value === null ? "null" : typeof value}>`;
    const fits = value.length <= MAX_ECHO;
    let out = "";
    for (const char of value) {
      const cp = char.codePointAt(0)!;
      const shown = hidden(char, cp) ? REPLACEMENT : char;
      if (!fits && out.length + shown.length > MAX_ECHO - 1) return `${out}…`;
      out += shown;
    }
    return out;
  }

  return { full: properties !== undefined, problem, hasVisible, clip };
}

/** The rules for this engine. S4 checks on device that Hermes takes the full path. */
export const textRules = createTextRules(detectProperties());

/** Whether this engine supports the Unicode property escapes the full text rules need. */
export const UNICODE_PROPERTY_ESCAPES = textRules.full;

/**
 * `value` cut to `MAX_ECHO` code units for echoing client input in error messages and paths. Hidden code points
 * become U+FFFD, a surrogate pair is never split, and anything but a string becomes its type in angle brackets
 * (`<null>`, `<object>`), so echoing never runs client code.
 */
export function clip(value: unknown): string {
  return textRules.clip(value);
}

/** `input` without leading and trailing whitespace (an explicit set), in linear time. */
export function trimSpace(input: string): string {
  let start = 0;
  let end = input.length;
  while (start < end && SPACE.has(input.charCodeAt(start))) start++;
  while (end > start && SPACE.has(input.charCodeAt(end - 1))) end--;
  return input.slice(start, end);
}
