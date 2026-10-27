import { describe, expect, test } from "vite-plus/test";
import {
  compilePattern,
  matchPattern,
  MAX_PATTERN_PROGRAM,
  MONITOR_PATTERN_MAX,
  patternProblem,
} from "../src/index.ts";

/** Whether `pattern` matches `text`; throws if it does not compile. */
function matches(pattern: string, text: string): boolean {
  const compiled = compilePattern(pattern);
  if (!compiled.ok) throw new Error(`${pattern}: ${compiled.reason}`);
  return matchPattern(compiled.pattern, text);
}

/** The body size the probe reads at most (`MAX_BODY_BYTES` in apps/api). */
const BODY = 64 * 1024;

describe("what a pattern matches", () => {
  test("literals, anywhere in the body, case-sensitive unless (?i)", () => {
    expect(matches("ok", "status: ok")).toBe(true);
    expect(matches("OK", "status: ok")).toBe(false);
    expect(matches("(?i)OK", "status: ok")).toBe(true);
    expect(matches("(?i)status", "STATUS")).toBe(true);
    // Non-ASCII letters fold too.
    expect(matches("(?i)ÉTAT", "état: ok")).toBe(true);
  });

  test("anchors are the start and end of the body read", () => {
    expect(matches("^ok$", "ok")).toBe(true);
    expect(matches("^ok$", "ok\n")).toBe(false);
    expect(matches("^ok", "not ok")).toBe(false);
    expect(matches("ok$", "not ok")).toBe(true);
  });

  test("classes, escapes and the dot", () => {
    expect(matches("\\d+ms", "took 42ms")).toBe(true);
    expect(matches("\\d+ms", "took ms")).toBe(false);
    expect(matches("[a-c]x", "bx")).toBe(true);
    expect(matches("[^a-c]x", "ax")).toBe(false);
    expect(matches("[^a-c]x", "dx")).toBe(true);
    expect(matches("[\\d_]+", "_")).toBe(true);
    expect(matches("a.c", "a\nc")).toBe(false);
    expect(matches("a.c", "abc")).toBe(true);
    expect(matches("\\w\\s\\W", "a !")).toBe(true);
    expect(matches("\\.", "a")).toBe(false);
    expect(matches("\\.", ".")).toBe(true);
    // `]` first in a class is a literal.
    expect(matches("[]a]", "]")).toBe(true);
    // A `{` that is no repeat is a literal, so JSON reads as written.
    expect(matches('{"ok":true}', 'x{"ok":true}')).toBe(true);
  });

  test("groups, alternation and repeats", () => {
    expect(matches('"status":\\s*"(up|ok)"', '{"status": "ok"}')).toBe(true);
    expect(matches('"status":\\s*"(up|ok)"', '{"status": "down"}')).toBe(false);
    expect(matches("a{2,3}b", "xaab")).toBe(true);
    expect(matches("^a{2,3}b", "ab")).toBe(false);
    expect(matches("^a{2}$", "aa")).toBe(true);
    expect(matches("^a{2,}$", "aaaaa")).toBe(true);
    expect(matches("^(?:ab)+$", "ababab")).toBe(true);
    expect(matches("^(?:ab)+$", "ababa")).toBe(false);
    expect(matches("colou?r", "color")).toBe(true);
    // A lazy quantifier matches the same bodies.
    expect(matches("a+?b", "aaab")).toBe(true);
    // Empty alternatives and empty loops terminate.
    expect(matches("a|", "zzz")).toBe(true);
    expect(matches("^(a*)*$", "aaa")).toBe(true);
    expect(matches("^(a*)*b$", "aaa")).toBe(false);
  });

  test("astral characters are one character", () => {
    expect(matches("^.$", "🚒")).toBe(true);
    expect(matches("[🚒]", "fire 🚒")).toBe(true);
  });
});

describe("what a pattern may not be", () => {
  test.each([
    ["", "Expected a pattern"],
    ["(?i)", "Expected a pattern"],
    ["(a)\\1", "Backreferences are not supported"],
    ["a(?=b)", "Lookahead is not supported"],
    ["a(?!b)", "Lookahead is not supported"],
    ["(?<=a)b", "Lookbehind is not supported"],
    ["(?<!a)b", "Lookbehind is not supported"],
    ["(?<name>a)", "Named groups are not supported"],
    ["\\bword", "Word boundaries are not supported"],
    ["a(?i)b", "(?i) goes at the very start"],
    ["\\p{L}", "\\p is not supported"],
    ["*a", "Nothing to repeat"],
    ["a**", "Nothing to repeat"],
    ["^*", "Nothing to repeat"],
    ["{2}", "Nothing to repeat"],
    ["a{101}", "Repeat counts go up to 100"],
    ["a{3,2}", "Repeat counts out of order"],
    ["[z-a]", "Range out of order"],
    ["[a", "Unclosed ["],
    ["(a", "Unclosed ("],
    ["a)", "Unmatched )"],
    ["a\\", "Pattern ends with \\"],
  ])("%j is refused: %s", (pattern, reason) => {
    expect(patternProblem(pattern)).toBe(reason);
  });

  test("at most MONITOR_PATTERN_MAX characters", () => {
    expect(patternProblem("a".repeat(MONITOR_PATTERN_MAX))).toBeNull();
    expect(patternProblem("a".repeat(MONITOR_PATTERN_MAX + 1))).toMatch(/at most/);
  });

  test("repeats count after they are expanded: the program stays small", () => {
    // 100 copies of a three-instruction group is past the cap, though the pattern is short.
    expect(patternProblem("(a|b){100}")).toMatch(/too complex/);
    expect(patternProblem("(?:a?){60}b")).toBeNull();
    const compiled = compilePattern("(?:a?){60}b");
    expect(compiled.ok && compiled.pattern.program.length).toBeLessThanOrEqual(MAX_PATTERN_PROGRAM);
  });
});

describe("catastrophic backtracking cannot happen", () => {
  // Each of these takes exponential (or high polynomial) time in a backtracking engine on these bodies, which a
  // probe could not interrupt. Here every one finishes in time proportional to the body.
  const cases: [string, string, boolean][] = [
    ["(a+)+$", `${"a".repeat(BODY - 1)}!`, false],
    ["(a|a)*b", "a".repeat(BODY), false],
    ["(a|aa)+$", `${"a".repeat(BODY - 1)}!`, false],
    ["(.*a){20}", "a".repeat(BODY), true],
    ["^(\\w+\\s?)*$", `${"word ".repeat(BODY / 5 - 1)}!`, false],
    ["(?i)(x+x+)+y", "X".repeat(BODY), false],
    ["(?:a?){60}a{60}", "a".repeat(BODY), true],
    ["(?:a?){60}b", "a".repeat(BODY), false],
  ];

  test.each(cases)("%j on a 64 KiB body", (pattern, body, expected) => {
    const started = performance.now();
    expect(matches(pattern, body)).toBe(expected);
    // Generous for slow CI machines; a backtracking engine takes far longer than this on any of them.
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("the work grows linearly with the body, not faster", () => {
    const compiled = compilePattern("(?:a?){60}b");
    if (!compiled.ok) throw new Error(compiled.reason);
    const time = (length: number) => {
      const body = "a".repeat(length);
      const started = performance.now();
      for (let i = 0; i < 3; i++) matchPattern(compiled.pattern, body);
      return performance.now() - started;
    };
    time(4096); // warm up
    const small = time(8192);
    const large = time(65_536);
    // Eight times the body: about eight times the work. Quadratic would be 64 times.
    expect(large / Math.max(small, 0.5)).toBeLessThan(32);
  });
});
