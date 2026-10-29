import { describe, expect, test } from "vite-plus/test";
import { CASE_FOLD_RUNS, CASE_FOLD_UNICODE } from "../src/case-fold.ts";
import {
  compilePattern,
  matchPattern,
  MAX_PATTERN_PROGRAM,
  MONITOR_PATTERN_MAX,
  PATTERN_STEPS_PER_CHAR,
  PATTERN_TOO_SLOW,
  patternProblem,
  type PatternOutcome,
} from "../src/index.ts";
import { caseFoldGroups, encode } from "../scripts/case-fold.ts";

/** Whether `pattern` matches `text` (or `too_slow`); throws if it does not compile. */
function matches(pattern: string, text: string): PatternOutcome {
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
    // However many digits: read to the closing brace, never cut off as a literal.
    ["a{1000}", "Repeat counts go up to 100"],
    ["a{12345678901234567890}", "Repeat counts go up to 100"],
    ["a{0000000000000000000001}", "Repeat counts go up to 100"],
    ["a{1,99999999999999999999}", "Repeat counts go up to 100"],
    ["(){3}", "Nothing to repeat"],
    ["(?:)*", "Nothing to repeat"],
    ["(?:a{0})+", "Nothing to repeat"],
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

  test("a pattern that could cost more than PATTERN_STEPS_PER_CHAR per character is refused when saved", () => {
    // 241 instructions, under the program cap, but 140 classes, 101 of them where a match can start: 482 steps.
    expect(patternProblem("(?:[^<]?){100}a{40}")).toBe(PATTERN_TOO_SLOW);
    expect(PATTERN_TOO_SLOW).toMatch(/too long on a large page/);
    const fits = compilePattern("(?:[^<]?){100}a{20}");
    expect(fits.ok && fits.pattern.cost).toBe(442);
    // A plain literal as long as a pattern may be costs about twice its length.
    expect(patternProblem("a".repeat(MONITOR_PATTERN_MAX))).toBeNull();
  });

  // Nested repeats multiply: expanded one copy at a time, `{100}` five deep is 10^10 copies. Each is sized before
  // anything is built, and an empty group (which builds nothing, so no program cap would ever stop it) is refused.
  test.each([
    "(?:(?:(?:(?:(?:(){100}){100}){100}){100}){100})",
    "(?:(?:(?:(?:(?:a{0}){100}){100}){100}){100})",
    "((((((((((a{100}){100}){100}){100}){100}){100}){100}){100}){100}){100})",
    "(((((((|){100}){100}){100}){100}){100}){100})",
    "(?:(?:(?:(?:(?:a?){100}){100}){100}){100}){100}",
    `${"(?:".repeat(20)}a${"){100}".repeat(20)}`,
  ])("%j is refused at once", (pattern) => {
    const started = performance.now();
    expect(patternProblem(pattern)).not.toBeNull();
    // Backtracking would take seconds or never end; 100 ms leaves room for a loaded CI runner (10 ms did not).
    expect(performance.now() - started).toBeLessThan(100);
  });
});

describe("catastrophic backtracking cannot happen", () => {
  // Each of these takes exponential (or high polynomial) time in a backtracking engine on these bodies, which a
  // probe could not interrupt. Here every one finishes in time proportional to the body.
  const cases: [string, string, PatternOutcome][] = [
    ["(a+)+$", `${"a".repeat(BODY - 1)}!`, false],
    ["(a|a)*b", "a".repeat(BODY), false],
    ["(a|aa)+$", `${"a".repeat(BODY - 1)}!`, false],
    ["(.*a){20}", "a".repeat(BODY), true],
    ["^(\\w+\\s?)*$", `${"word ".repeat(BODY / 5 - 1)}!`, false],
    ["(?i)(x+x+)+y", "X".repeat(BODY), false],
    ["(?:a?){60}a{60}", "a".repeat(BODY), true],
    // About two hundred threads alive at every character, and still within the cost it was saved with.
    ["(?:a?){60}b", "a".repeat(BODY), false],
  ];

  test.each(cases)("%j on a 64 KiB body", (pattern, body, expected) => {
    const started = performance.now();
    expect(matches(pattern, body)).toBe(expected);
    // Generous for slow CI machines; a backtracking engine takes far longer than this on any of them.
    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("a match past its steps gives up as too_slow: the safety net, which a saved pattern never reaches", () => {
    const compiled = compilePattern("(?:a?){60}b");
    if (!compiled.ok) throw new Error(compiled.reason);
    expect(matchPattern(compiled.pattern, "a".repeat(BODY), 8)).toBe("too_slow");
    expect(matchPattern(compiled.pattern, "a".repeat(BODY))).toBe(false);
  });

  test("the work grows linearly with the body, not faster", () => {
    const compiled = compilePattern("(?:a?){20}b");
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

describe("the work per character is bounded, whatever the text", () => {
  // Non-ASCII text takes the slow path of every class (a binary search). These keep the most threads alive the cost
  // cap allows.
  const text = "éжω字Çß🚒Ж".repeat(BODY / 8);
  const worst = [
    "(?i)(?:[à-ÿ0-9\\s\\w]?){100}x",
    "(?:[\\s\\S]?){100}x",
    "(?i)(?:[^a-zé]?){100}x",
    // As costly as a pattern may be.
    "(?:[^<]?){100}a{20}",
    "(?i)(.*é){20}x",
    "(?i)(?:.?){80}(?:[^\\d]?){20}x",
    "(?i)(?:ж|Ж|é|É|ω|Ω|字|ç|Ç|a|b|c|d|e|f|g|h|i|j|k|l|m|n|o|p|q|r|s|t|u){2}x",
    "(?i)[éжω字ç]+x",
    '(?i)"status":\\s*"(up|ok)"',
  ];

  test.each(worst)("%j on 64 KiB of non-ASCII text finishes in well under a second", (pattern) => {
    const compiled = compilePattern(pattern);
    if (!compiled.ok) throw new Error(compiled.reason);
    let best = Number.POSITIVE_INFINITY;
    // The best of three: one slow run on a busy CI machine is the machine, not the match.
    for (let i = 0; i < 3; i++) {
      const started = performance.now();
      expect(matchPattern(compiled.pattern, text)).not.toBe(true);
      best = Math.min(best, performance.now() - started);
    }
    // Locally about 100 ms at most; the bound leaves room for a slow CI machine while still catching the seconds the
    // backtracking-shaped inputs took before (the cost is what bounds the work, not this clock).
    expect(best).toBeLessThan(1500);
  });

  test("an ordinary pattern never runs out of steps", () => {
    const body = `${'{"service":"checkout","checks":[{"db":"up"},{"queue":"up"}],"note":"ça va"},'.repeat(800)}{"status": "ok"}`;
    for (const pattern of [
      '"status":\\s*"(up|ok)"',
      "(?i)(error|fail(ed|ure)?|down|unavailable|timeout|degraded)",
      "(?i)not ok",
      // Twenty words: the threads a match starts with are walked once, not at every character.
      "(?i)(error|fail|failed|down|unavailable|timeout|degraded|outage|panic|fatal|crash|refused|denied|broken|invalid|unhealthy|critical|exception|halted|stopped)",
      '"queue":"(up|ok)".*"status"',
      "^\\{.*\\}$",
    ]) {
      const compiled = compilePattern(pattern);
      if (!compiled.ok) throw new Error(compiled.reason);
      expect(matchPattern(compiled.pattern, body)).not.toBe("too_slow");
    }
  });

  // Each a few hundred steps per character at most: these used to run out of a fixed 64-step budget on long bodies,
  // and every check then failed. Now the cost is known when they are saved, and they run to the end of any body.
  const ordinary = [
    ["[^<>]{0,60}down", "the database is down"],
    ["[^<]{0,100}error", "<p>an error occurred"],
    ["(?i)[a-z ]{0,50}(error|fail)", "Checkout: Payment FAILED"],
    ["(\\w+\\s){0,20}outage", "there is a partial outage"],
    ['[^"]{0,80}"status":"down"', '{"region":"weur","status":"down"}'],
  ] as const;
  const prose =
    "All systems operational. Every service answered within its usual time today, and nothing is degraded. ";
  const bodies = {
    prose: prose.repeat(Math.ceil(60_000 / prose.length)).slice(0, 60_000),
    json: `[${'{"id":1234,"name":"checkout","status":"up","latency":42},'.repeat(1050)}{}]`.slice(
      0,
      60_000,
    ),
    html: '<li><a href="/checkout">Checkout</a> <span class="ok">Operational</span></li>\n'
      .repeat(800)
      .slice(0, 60_000),
  };

  test.each(ordinary)(
    "%j saves, and matches or rules out on 60 KB of prose, JSON and HTML",
    (pattern, hit) => {
      expect(patternProblem(pattern)).toBeNull();
      const compiled = compilePattern(pattern);
      if (!compiled.ok) throw new Error(compiled.reason);
      expect(compiled.pattern.cost).toBeLessThanOrEqual(PATTERN_STEPS_PER_CHAR);
      for (const body of Object.values(bodies)) {
        expect(body.length).toBeGreaterThanOrEqual(59_000);
        expect(matchPattern(compiled.pattern, body)).toBe(false);
        // At the very end, so the whole body is walked first.
        expect(matchPattern(compiled.pattern, `${body}${hit}`)).toBe(true);
        expect(
          new RegExp(pattern.replace(/^\(\?i\)/, ""), pattern.startsWith("(?i)") ? "iu" : "u").test(
            `${body}${hit}`,
          ),
        ).toBe(true);
      }
    },
  );
});

describe("ignoring case", () => {
  test("a negated class matches only when no case of the character is in it", () => {
    expect(matches("(?i)[^a]", "A")).toBe(false);
    expect(matches("(?i)[^A]", "a")).toBe(false);
    expect(matches("(?i)[^a-z]", "Q")).toBe(false);
    expect(matches("(?i)[^é]", "É")).toBe(false);
    expect(matches("(?i)[^ж]", "Ж")).toBe(false);
    expect(matches("(?i)[^a]", "b")).toBe(true);
    expect(matches("(?i)^[^\\d]$", "x")).toBe(true);
    // `[^\D]` is the digits, ignoring case or not.
    expect(matches("(?i)^[^\\D]$", "x")).toBe(false);
    expect(matches("(?i)^[^\\D]$", "7")).toBe(true);
  });

  test("final sigma in the text reaches sigma through its upper case", () => {
    expect(matches("(?i)σ", "ς")).toBe(true);
    expect(matches("(?i)Σ", "ς")).toBe(true);
  });

  // Each pair is compared by its simple case folding on both sides, as `RegExp` with `iu` does: before, only the
  // body's character had its cases tried, so these disagreed one way or the other.
  test.each([
    ["ς", "σ"],
    ["ς", "Σ"],
    ["σ", "ς"],
    ["µ", "μ"],
    ["μ", "µ"],
    ["ϐ", "β"],
    ["β", "ϐ"],
    ["ϑ", "θ"],
    ["ϴ", "ϑ"],
    ["θ", "ϴ"],
    ["ǅ", "ǆ"],
    ["Ǆ", "ǅ"],
    ["ι", "ι"],
    ["ẞ", "ß"],
    ["ß", "ẞ"],
    ["ſ", "s"],
    ["S", "ſ"],
    ["i", "ı"],
    ["ı", "I"],
    ["İ", "i"],
    ["K", "k"],
    ["k", "K"],
    ["Ω", "Ω"],
    ["ΐ", "ΐ"],
  ])("(?i)%s against %s agrees with RegExp iu", (pattern, body) => {
    const expected = new RegExp(pattern, "iu").test(body);
    expect(matches(`(?i)${pattern}`, body)).toBe(expected);
    expect(matches(`(?i)[${pattern}]`, body)).toBe(expected);
    expect(matches(`(?i)[^${pattern}]`, body)).toBe(!expected);
  });

  test("\\w and \\W ignoring case take the Kelvin sign and the long s as JavaScript does", () => {
    for (const char of ["K", "ſ"]) {
      for (const pattern of ["\\w", "\\W", "[\\w]", "[^\\w]", "[\\W]", "[^\\W]"]) {
        expect(matches(`(?i)^${pattern}$`, char)).toBe(new RegExp(`^${pattern}$`, "iu").test(char));
        expect(matches(`^${pattern}$`, char)).toBe(new RegExp(`^${pattern}$`, "u").test(char));
      }
    }
  });

  test.skipIf(process.versions.unicode !== CASE_FOLD_UNICODE)(
    "the committed table is what this engine's RegExp derives",
    () => {
      expect(encode(caseFoldGroups()).join(",")).toBe(CASE_FOLD_RUNS);
    },
  );
});

// The engine against JavaScript's own, over the syntax both accept and text that includes the characters whose case
// folding is easy to get wrong (final sigma, micro, sharp s, long s, dotless i, the Kelvin sign). Seeded, so a
// failure reproduces.
describe("the same answers as RegExp", () => {
  /** Mulberry32: a small seeded generator, so every run tries the same cases. */
  function generator(seed: number) {
    let state = seed >>> 0;
    const next = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (n: number) => Math.floor(next() * n);
    const pick = <T>(items: readonly T[]): T => items[int(items.length)]!;
    return { next, int, pick };
  }

  const LETTERS = [
    "a",
    "b",
    "c",
    "A",
    "B",
    "x",
    "X",
    "0",
    "1",
    "9",
    "_",
    " ",
    "-",
    "é",
    "É",
    "ж",
    "Ж",
    "ω",
    "Ω",
    "ç",
    "字",
    "ß",
    "ς",
    "σ",
    "Σ",
    "µ",
    "μ",
    "ẞ",
    "ſ",
    "ı",
    "K",
    "ϑ",
    "s",
    "i",
    "k",
    "🚒",
  ];
  const TEXT = [...LETTERS, ".", "(", ")", "\n", "\t", "!"];
  /** Characters JavaScript's `u` mode needs escaped outside a class. */
  const SYNTAX = new Set([
    "^",
    "$",
    "\\",
    ".",
    "*",
    "+",
    "?",
    "(",
    ")",
    "[",
    "]",
    "{",
    "}",
    "|",
    "/",
  ]);
  const literal = (char: string) => (SYNTAX.has(char) ? `\\${char}` : char);
  const inClass = (char: string) => ("\\]^-[".includes(char) ? `\\${char}` : char);

  function pattern(random: ReturnType<typeof generator>, depth: number): string {
    const parts: string[] = [];
    const length = 1 + random.int(3);
    for (let i = 0; i < length; i++) parts.push(piece(random, depth));
    const sequence = parts.join("");
    return depth < 2 && random.next() < 0.2
      ? `${sequence}|${pattern(random, depth + 1)}`
      : sequence;
  }

  function piece(random: ReturnType<typeof generator>, depth: number): string {
    const roll = random.next();
    if (roll < 0.05) return random.pick(["^", "$"]);
    const atom = (() => {
      const kind = random.next();
      if (kind < 0.4) return literal(random.pick(TEXT));
      if (kind < 0.5) return ".";
      if (kind < 0.6) return random.pick(["\\d", "\\D", "\\w", "\\W", "\\s", "\\S", "\\n", "\\t"]);
      if (kind < 0.8) {
        const items: string[] = [];
        for (let i = 1 + random.int(3); i > 0; i--) {
          const item = random.next();
          if (item < 0.25) items.push(random.pick(["a-c", "A-C", "0-5", "à-é", "α-ω", "а-я"]));
          else if (item < 0.35) items.push(random.pick(["\\d", "\\w", "\\s", "\\D", "\\W", "\\S"]));
          else items.push(inClass(random.pick(TEXT)));
        }
        return `[${random.next() < 0.3 ? "^" : ""}${items.join("")}]`;
      }
      if (depth < 2) return `(${random.next() < 0.5 ? "?:" : ""}${pattern(random, depth + 1)})`;
      return literal(random.pick(LETTERS));
    })();
    const quantifier = random.next();
    if (quantifier < 0.55) return atom;
    const lazy = random.next() < 0.2 ? "?" : "";
    const low = random.int(3);
    return (
      atom +
      random.pick(["*", "+", "?", `{${low}}`, `{${low},}`, `{${low},${low + random.int(3)}}`]) +
      lazy
    );
  }

  function text(random: ReturnType<typeof generator>): string {
    let out = "";
    for (let i = random.int(10); i > 0; i--) out += random.pick(TEXT);
    return out;
  }

  test("thousands of seeded cases agree", () => {
    const random = generator(0x5eed);
    let compared = 0;
    for (let i = 0; i < 1500; i++) {
      const ignoreCase = random.next() < 0.35;
      const source = pattern(random, 0);
      const compiled = compilePattern(ignoreCase ? `(?i)${source}` : source);
      // Only what JavaScript would also run: an empty repeat or a program past the cap is ours to refuse.
      if (!compiled.ok) continue;
      const expected = new RegExp(source, ignoreCase ? "iu" : "u");
      for (let j = 0; j < 3; j++) {
        const body = text(random);
        const got = matchPattern(compiled.pattern, body);
        if (got !== expected.test(body)) {
          throw new Error(
            `${ignoreCase ? "(?i)" : ""}${source} on ${JSON.stringify(body)}: got ${got}`,
          );
        }
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(3000);
  });
});
