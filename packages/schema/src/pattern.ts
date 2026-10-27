// The regular expressions an HTTP check may look for in a response body (RFC 0007 "Check types"). Not JavaScript's
// `RegExp`: its backtracking engine takes exponential time on patterns like `(a+)+$`, and a Worker has no way to stop a
// running match, so one monitor could hold its probe's CPU. Instead a restricted syntax is compiled to a small program
// and run as a Pike VM (Thompson's construction, every thread in lockstep): the work is at most the program's length
// for each character of the body, never more, whatever the pattern or the body. The pattern is capped at
// `MONITOR_PATTERN_MAX` characters and the program at `MAX_PATTERN_PROGRAM` instructions (counted after repeats are
// expanded, and before they are: a pattern too large is refused without building it), and the probe reads at most
// 64 KiB of a body. A match also stops after `PATTERN_STEPS_PER_CHAR` steps per character of the body and reports that
// it gave up, so one check's CPU is bounded by the body's length, not by the program's.
//
// Supported: literals; `.` (any character but a line break); `\d \D \w \W \s \S`; escaped punctuation (`\.`, `\(`, …);
// `\n \r \t \f \v`; classes `[a-z_]` and `[^…]` (with the escapes above); `^` and `$` (start and end of the body);
// groups `( )` and `(?: )`, which only group; `|`; `* + ?`, `{n}`, `{n,}` and `{n,m}` (n and m at most 100; a lazy
// `?` after one is accepted and changes nothing, since only whether it matches counts); and `(?i)` at the very start,
// for a match that ignores case. Refused, with a reason: backreferences, lookahead and lookbehind, named groups, word
// boundaries and other escapes, and repeating something that matches only empty text (`(){3}`). A `{` that does not
// start a repeat is a literal, as in JavaScript.

/** The longest pattern a monitor may have, in UTF-16 code units (as the keyword). */
export const MONITOR_PATTERN_MAX = 200;
/** At most this many instructions once repeats are expanded: the work per body character. */
export const MAX_PATTERN_PROGRAM = 256;
/** The largest count in `{n,m}`. */
export const MAX_PATTERN_REPEAT = 100;
/**
 * The steps a match may take per character of the body (one thread visited or tested is a step), plus one character's
 * worth for the empty body. An ordinary pattern takes a few per character; past this the match gives up as
 * `too_slow`, so the probe records a failed check with that reason instead of spending its alarm on one body.
 */
export const PATTERN_STEPS_PER_CHAR = 64;
/** Nodes the compiler may visit while expanding repeats: refused past it, whatever the program's size. */
const MAX_COMPILE_STEPS = 64 * MAX_PATTERN_PROGRAM;

/** Inclusive code point ranges; `negate` matches everything outside them. */
type CharSet = { ranges: [number, number][]; negate: boolean };

type Node =
  | { kind: "set"; items: CharSet[]; negate: boolean }
  | { kind: "cat"; items: Node[] }
  | { kind: "alt"; options: Node[] }
  | { kind: "repeat"; node: Node; min: number; max: number }
  | { kind: "start" }
  | { kind: "end" };

/**
 * A class compiled for matching: `ascii` says whether each ASCII character is in the class's positive set, `ranges`
 * holds that set's sorted, disjoint ranges as `[low, high, low, high, …]` for a binary search, and `negate` (`[^…]`)
 * turns the answer over afterwards, so that ignoring case can ask about every case of a character first. The copies
 * a repeat makes share one, numbered `id`, so a match asks each class about a character once.
 */
type SetInstruction = {
  op: "set";
  id: number;
  ascii: Uint8Array;
  ranges: Int32Array;
  negate: boolean;
};

type Instruction =
  | SetInstruction
  | { op: "split"; x: number; y: number }
  | { op: "jump"; to: number }
  | { op: "start" }
  | { op: "end" }
  | { op: "match" };

/** A compiled pattern: run it with `matchPattern`. */
export type Pattern = { program: Instruction[]; ignoreCase: boolean };

export type CompiledPattern = { ok: true; pattern: Pattern } | { ok: false; reason: string };

/** Whether a pattern was found, or `too_slow` when the match gave up (`PATTERN_STEPS_PER_CHAR`). */
export type PatternOutcome = boolean | "too_slow";

const DIGIT: [number, number][] = [[48, 57]];
const WORD: [number, number][] = [
  [48, 57],
  [65, 90],
  [95, 95],
  [97, 122],
];
/** What JavaScript's `\s` matches. */
const SPACE: [number, number][] = [
  [9, 13],
  [32, 32],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
];
/** What `.` does not match: the line terminators. */
const LINE_BREAKS: [number, number][] = [
  [10, 10],
  [13, 13],
  [0x2028, 0x2029],
];
const CLASS_ESCAPES: Record<string, CharSet> = {
  d: { ranges: DIGIT, negate: false },
  D: { ranges: DIGIT, negate: true },
  w: { ranges: WORD, negate: false },
  W: { ranges: WORD, negate: true },
  s: { ranges: SPACE, negate: false },
  S: { ranges: SPACE, negate: true },
};
const CONTROL_ESCAPES: Record<string, number> = { n: 10, r: 13, t: 9, f: 12, v: 11 };

class PatternError extends Error {}

/** Why `source` cannot be a monitor's pattern, or null if it can. */
export function patternProblem(source: string): string | null {
  const compiled = compilePattern(source);
  return compiled.ok ? null : compiled.reason;
}

/** `source` compiled, or why it cannot be. Never throws. */
export function compilePattern(source: string): CompiledPattern {
  if (source.length === 0) return { ok: false, reason: "Expected a pattern" };
  if (source.length > MONITOR_PATTERN_MAX) {
    return { ok: false, reason: `Expected at most ${MONITOR_PATTERN_MAX} characters` };
  }
  try {
    const ignoreCase = source.startsWith("(?i)");
    if (ignoreCase && source.length === 4) return { ok: false, reason: "Expected a pattern" };
    const parser = new Parser(Array.from(ignoreCase ? source.slice(4) : source));
    const node = parser.parse();
    // Sized first: `((a{100}){100}){100}` is refused here, before a single instruction is built.
    const sizes = new Map<Node, number>();
    sizeOf(node, sizes);
    const program: Instruction[] = [];
    emit(node, program, sizes, { steps: 0, sets: new Map() });
    program.push({ op: "match" });
    return { ok: true, pattern: { program, ignoreCase } };
  } catch (error) {
    if (error instanceof PatternError) return { ok: false, reason: error.message };
    throw error;
  }
}

class Parser {
  private at = 0;
  constructor(private readonly chars: string[]) {}

  parse(): Node {
    const node = this.alternation(0);
    if (this.at < this.chars.length) throw new PatternError("Unmatched )");
    return node;
  }

  private peek(offset = 0): string | undefined {
    return this.chars[this.at + offset];
  }

  private alternation(depth: number): Node {
    // Nesting is bounded by the pattern's length; this keeps the recursion shallow anyway.
    if (depth > 50) throw new PatternError("Too many nested groups");
    const options = [this.sequence(depth)];
    while (this.peek() === "|") {
      this.at++;
      options.push(this.sequence(depth));
    }
    return options.length === 1 ? options[0]! : { kind: "alt", options };
  }

  private sequence(depth: number): Node {
    const items: Node[] = [];
    while (this.at < this.chars.length && this.peek() !== "|" && this.peek() !== ")") {
      const atom = this.atom(depth);
      items.push(this.quantified(atom));
    }
    return { kind: "cat", items };
  }

  private quantified(atom: Node): Node {
    const bounds = this.quantifier();
    if (!bounds) return atom;
    if (atom.kind === "start" || atom.kind === "end") throw new PatternError("Nothing to repeat");
    // A lazy `?` changes which match is found, never whether there is one.
    if (this.peek() === "?") this.at++;
    if (this.quantifierAhead()) throw new PatternError("Nothing to repeat");
    return { kind: "repeat", node: atom, min: bounds[0], max: bounds[1] };
  }

  /** Whether a quantifier starts here (which, right after another, repeats nothing). */
  private quantifierAhead(): boolean {
    const char = this.peek();
    if (char === "*" || char === "+" || char === "?") return true;
    return char === "{" && this.braces() !== undefined;
  }

  private quantifier(): [number, number] | undefined {
    const char = this.peek();
    if (char === "*" || char === "+" || char === "?") {
      this.at++;
      return char === "*" ? [0, Infinity] : char === "+" ? [1, Infinity] : [0, 1];
    }
    if (char !== "{") return undefined;
    const braces = this.braces();
    if (!braces) return undefined;
    this.at += braces.length;
    return braces.bounds;
  }

  /**
   * `{n}`, `{n,}` or `{n,m}` at the cursor, without moving it; undefined when `{` is a literal there. Read to its
   * closing `}` however long, so `a{1000000}` is a repeat (refused) and not a literal, as in JavaScript.
   */
  private braces(): { bounds: [number, number]; length: number } | undefined {
    if (this.peek() !== "{") return undefined;
    let at = this.at + 1;
    const digits = () => {
      const from = at;
      while (/^[0-9]$/.test(this.chars[at] ?? "")) at++;
      return this.chars.slice(from, at).join("");
    };
    const low = digits();
    if (low === "") return undefined;
    let high: string | undefined;
    if (this.chars[at] === ",") {
      at++;
      high = digits();
    }
    if (this.chars[at] !== "}") return undefined;
    // More than three digits is past the cap whatever they say; `Number` is never asked about a thousand of them.
    const count = (text: string) => (text.length > 3 ? Infinity : Number(text));
    const min = count(low);
    const max = high === undefined ? min : high === "" ? Infinity : count(high);
    if (min > MAX_PATTERN_REPEAT || (high !== "" && max > MAX_PATTERN_REPEAT)) {
      throw new PatternError(`Repeat counts go up to ${MAX_PATTERN_REPEAT}`);
    }
    if (max < min) throw new PatternError("Repeat counts out of order");
    return { bounds: [min, max], length: at + 1 - this.at };
  }

  private atom(depth: number): Node {
    const char = this.chars[this.at++]!;
    switch (char) {
      case "^":
        return { kind: "start" };
      case "$":
        return { kind: "end" };
      case ".":
        return { kind: "set", items: [{ ranges: LINE_BREAKS, negate: true }], negate: false };
      case "(":
        return this.group(depth);
      case "[":
        return this.charClass();
      case "\\":
        return { kind: "set", items: [this.escape(false)], negate: false };
      case "*":
      case "+":
      case "?":
        throw new PatternError("Nothing to repeat");
      case "{": {
        this.at--;
        const repeat = this.braces();
        this.at++;
        if (repeat === undefined) return literal(char);
        throw new PatternError("Nothing to repeat");
      }
      default:
        return literal(char);
    }
  }

  private group(depth: number): Node {
    if (this.peek() === "?") {
      const next = this.peek(1);
      if (next === ":") this.at += 2;
      else if (next === "=" || next === "!") {
        throw new PatternError("Lookahead is not supported");
      } else if (next === "<" && (this.peek(2) === "=" || this.peek(2) === "!")) {
        throw new PatternError("Lookbehind is not supported");
      } else if (next === "<") throw new PatternError("Named groups are not supported");
      else if (next === "i" && this.peek(2) === ")") {
        throw new PatternError("(?i) goes at the very start");
      } else throw new PatternError("Unsupported group");
    }
    const node = this.alternation(depth + 1);
    if (this.chars[this.at++] !== ")") throw new PatternError("Unclosed (");
    return node;
  }

  private charClass(): Node {
    const negate = this.peek() === "^";
    if (negate) this.at++;
    const items: CharSet[] = [];
    let first = true;
    for (;;) {
      const char = this.chars[this.at++];
      if (char === undefined) throw new PatternError("Unclosed [");
      // `]` first is a literal, as in most engines; JavaScript would read `[]` as an empty class.
      if (char === "]" && !first) break;
      first = false;
      const low = char === "\\" ? this.escape(true) : single(char.codePointAt(0)!);
      if (this.peek() === "-" && this.peek(1) !== undefined && this.peek(1) !== "]") {
        this.at++;
        const end = this.chars[this.at++]!;
        const high = end === "\\" ? this.escape(true) : single(end.codePointAt(0)!);
        const from = singleOf(low);
        const to = singleOf(high);
        if (from === undefined || to === undefined) {
          throw new PatternError("A range needs a character at each end");
        }
        if (to < from) throw new PatternError("Range out of order");
        items.push({ ranges: [[from, to]], negate: false });
      } else items.push(low);
    }
    return { kind: "set", items, negate };
  }

  /** The escape after a `\`: a class (`\d`), a control (`\n`) or escaped punctuation. */
  private escape(inClass: boolean): CharSet {
    const char = this.chars[this.at++];
    if (char === undefined) throw new PatternError("Pattern ends with \\");
    const set = CLASS_ESCAPES[char];
    if (set) return set;
    const control = CONTROL_ESCAPES[char];
    if (control !== undefined) return single(control);
    if (/^[1-9]$/.test(char)) throw new PatternError("Backreferences are not supported");
    if ((char === "b" || char === "B") && !inClass) {
      throw new PatternError("Word boundaries are not supported");
    }
    if (/^[\p{L}\p{N}]$/u.test(char)) throw new PatternError(`\\${char} is not supported`);
    return single(char.codePointAt(0)!);
  }
}

const single = (code: number): CharSet => ({ ranges: [[code, code]], negate: false });
const singleOf = (set: CharSet): number | undefined =>
  !set.negate && set.ranges.length === 1 && set.ranges[0]![0] === set.ranges[0]![1]
    ? set.ranges[0]![0]
    : undefined;
const literal = (char: string): Node => ({
  kind: "set",
  items: [single(char.codePointAt(0)!)],
  negate: false,
});

const TOO_COMPLEX = "Pattern is too complex: use fewer or smaller repeats";

/**
 * The instructions `node` expands to, stored in `sizes` for `emit`; refused as soon as any part is larger than a
 * program may be. Computed without expanding anything, so nested repeats cost their nesting, not their product.
 */
function sizeOf(node: Node, sizes: Map<Node, number>): number {
  let size: number;
  switch (node.kind) {
    case "set":
    case "start":
    case "end":
      size = 1;
      break;
    case "cat":
      size = 0;
      for (const item of node.items) size += sizeOf(item, sizes);
      break;
    case "alt":
      // A split and a jump around every option but the last.
      size = 2 * (node.options.length - 1);
      for (const option of node.options) size += sizeOf(option, sizes);
      break;
    case "repeat": {
      const inner = sizeOf(node.node, sizes);
      // `(){3}` or `(a{0})*` would loop over nothing: refused, as JavaScript would run it as nothing at all.
      if (inner === 0) throw new PatternError("Nothing to repeat");
      const optional = node.max === Infinity ? inner + 2 : (node.max - node.min) * (inner + 1);
      size = node.min * inner + optional;
      break;
    }
  }
  // One instruction is left for `match`.
  if (size >= MAX_PATTERN_PROGRAM) throw new PatternError(TOO_COMPLEX);
  sizes.set(node, size);
  return size;
}

function push(program: Instruction[], instruction: Instruction): number {
  if (program.length >= MAX_PATTERN_PROGRAM) throw new PatternError(TOO_COMPLEX);
  program.push(instruction);
  return program.length - 1;
}

/**
 * Appends `node`'s instructions; repeats are expanded (`a{2,3}` is `aaa?`), so the program is a plain NFA. `sizeOf`
 * has bounded the result already; every call is also counted in `work`, so the compiler's own time is bounded too.
 */
function emit(
  node: Node,
  program: Instruction[],
  sizes: Map<Node, number>,
  work: { steps: number; sets: Map<Node, SetInstruction> },
): void {
  if (++work.steps > MAX_COMPILE_STEPS) throw new PatternError(TOO_COMPLEX);
  // Nothing to build: an empty group, or `a{0}`.
  if (sizes.get(node) === 0) return;
  switch (node.kind) {
    case "set": {
      let set = work.sets.get(node);
      if (!set) work.sets.set(node, (set = compileSet(node.items, node.negate, work.sets.size)));
      push(program, set);
      return;
    }
    case "start":
    case "end":
      push(program, { op: node.kind });
      return;
    case "cat":
      for (const item of node.items) emit(item, program, sizes, work);
      return;
    case "alt": {
      const jumps: number[] = [];
      node.options.forEach((option, index) => {
        if (index < node.options.length - 1) {
          const split = push(program, { op: "split", x: 0, y: 0 });
          emit(option, program, sizes, work);
          jumps.push(push(program, { op: "jump", to: 0 }));
          program[split] = { op: "split", x: split + 1, y: program.length };
        } else emit(option, program, sizes, work);
      });
      for (const jump of jumps) program[jump] = { op: "jump", to: program.length };
      return;
    }
    case "repeat": {
      for (let i = 0; i < node.min; i++) emit(node.node, program, sizes, work);
      if (node.max === Infinity) {
        const split = push(program, { op: "split", x: 0, y: 0 });
        emit(node.node, program, sizes, work);
        push(program, { op: "jump", to: split });
        program[split] = { op: "split", x: split + 1, y: program.length };
        return;
      }
      const splits: number[] = [];
      for (let i = node.min; i < node.max; i++) {
        splits.push(push(program, { op: "split", x: 0, y: 0 }));
        emit(node.node, program, sizes, work);
      }
      for (const split of splits) program[split] = { op: "split", x: split + 1, y: program.length };
      return;
    }
  }
}

const MAX_CODE_POINT = 0x10ffff;

/** `ranges` sorted and merged, so none overlap or touch. */
function normalize(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [low, high] of sorted) {
    const last = out.at(-1);
    if (last && low <= last[1] + 1) last[1] = Math.max(last[1], high);
    else out.push([low, high]);
  }
  return out;
}

/** Every code point outside `ranges` (sorted and merged). */
function complement(ranges: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let next = 0;
  for (const [low, high] of ranges) {
    if (low > next) out.push([next, low - 1]);
    next = high + 1;
  }
  if (next <= MAX_CODE_POINT) out.push([next, MAX_CODE_POINT]);
  return out;
}

/** The class's items merged into one positive set: a table for ASCII and sorted ranges for the rest. */
function compileSet(items: CharSet[], negate: boolean, id: number): SetInstruction {
  const positive = normalize(
    items.flatMap((item) => (item.negate ? complement(normalize(item.ranges)) : item.ranges)),
  );
  const ascii = new Uint8Array(128);
  for (const [low, high] of positive) {
    for (let code = low; code <= Math.min(high, 127); code++) ascii[code] = 1;
  }
  return { op: "set", id, ascii, ranges: Int32Array.from(positive.flat()), negate };
}

/** Whether `code` is in the instruction's positive set (before `negate`): the table, or a binary search. */
function inSet(instruction: SetInstruction, code: number): boolean {
  if (code < 128) return instruction.ascii[code] === 1;
  const { ranges } = instruction;
  let low = 0;
  let high = ranges.length / 2 - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (code < ranges[2 * middle]!) high = middle - 1;
    else if (code > ranges[2 * middle + 1]!) low = middle + 1;
    else return true;
  }
  return false;
}

/**
 * Whether `instruction` takes `code`. Ignoring case, a class takes a character when any of its cases is in the class
 * (`variants`), and `[^…]` when none of them is: as JavaScript's `i` flag does.
 */
function takes(instruction: SetInstruction, code: number, variants: readonly number[]): boolean {
  let found = inSet(instruction, code);
  for (let i = 0; !found && i < variants.length; i++) found = inSet(instruction, variants[i]!);
  return found !== instruction.negate;
}

const NO_VARIANTS: readonly number[] = [];

/**
 * The code point's other cases: arithmetic for ASCII letters, the case mappings for the rest (also the lower case of
 * the upper case, so `ς` reaches `σ`). Only one-to-one mappings: `ß` uppercases to two characters, which one
 * position cannot hold.
 */
function caseVariants(code: number): readonly number[] {
  if (code < 128) {
    if (code >= 65 && code <= 90) return [code + 32];
    if (code >= 97 && code <= 122) return [code - 32];
    return NO_VARIANTS;
  }
  const char = String.fromCodePoint(code);
  const out: number[] = [];
  const add = (other: string) => {
    if (other === char || Array.from(other).length !== 1) return;
    const point = other.codePointAt(0)!;
    if (!out.includes(point)) out.push(point);
  };
  const lower = char.toLowerCase();
  const upper = char.toUpperCase();
  add(lower);
  add(upper);
  add(upper.toLowerCase());
  add(lower.toUpperCase());
  return out.length === 0 ? NO_VARIANTS : out;
}

const OP = { set: 0, split: 1, jump: 2, start: 3, end: 4, match: 5 } as const;

/** The program as flat arrays, which the match loop reads faster than objects: built once per pattern. */
type Flat = { ops: Uint8Array; x: Int32Array; y: Int32Array; sets: (SetInstruction | undefined)[] };
const flats = new WeakMap<Pattern, Flat>();

function flatten(pattern: Pattern): Flat {
  const known = flats.get(pattern);
  if (known) return known;
  const { program } = pattern;
  const flat: Flat = {
    ops: new Uint8Array(program.length),
    x: new Int32Array(program.length),
    y: new Int32Array(program.length),
    sets: [],
  };
  program.forEach((instruction, pc) => {
    flat.ops[pc] = OP[instruction.op];
    if (instruction.op === "split") {
      flat.x[pc] = instruction.x;
      flat.y[pc] = instruction.y;
    } else if (instruction.op === "jump") flat.x[pc] = instruction.to;
    flat.sets[pc] = instruction.op === "set" ? instruction : undefined;
  });
  flats.set(pattern, flat);
  return flat;
}

/**
 * Whether `pattern` matches anywhere in `text`. Every possible match is followed at once, one step per character
 * (a Pike VM): each instruction is visited at most once per position, so the work is at most the program's length
 * times the text's, with no backtracking. Past `PATTERN_STEPS_PER_CHAR` steps per character it stops and returns
 * `too_slow`.
 */
export function matchPattern(pattern: Pattern, text: string): PatternOutcome {
  const { ops, x, y, sets } = flatten(pattern);
  const size = ops.length;
  const seen = new Int32Array(size).fill(-1);
  // Threads waiting on a class, for this character and the next; `count` and `nextCount` say how many.
  let current = new Int32Array(size);
  let following = new Int32Array(size);
  let count = 0;
  let nextCount = 0;
  const stack = new Int32Array(size * 2 + 2);
  let generation = 0;
  const length = text.length;
  let budget = PATTERN_STEPS_PER_CHAR * (length + 1);
  const ignoreCase = pattern.ignoreCase;
  // Each class's answer for the current character, by set id: `asked` holds the character's index when known.
  const classes = 1 + sets.reduce((most, set) => Math.max(most, set?.id ?? -1), -1);
  const asked = new Int32Array(classes).fill(-1);
  const answer = new Uint8Array(classes);
  // A body repeats its characters: each one's cases are worked out once per match, not once per thread.
  const variants = new Map<number, readonly number[]>();

  /** Adds the thread at `pc` and everything it reaches without reading to `following`; true when one matches. */
  const add = (pc: number, index: number): boolean => {
    let top = 0;
    stack[top++] = pc;
    while (top > 0) {
      const at = stack[--top]!;
      if (seen[at] === generation) continue;
      seen[at] = generation;
      budget--;
      switch (ops[at]) {
        case OP.match:
          return true;
        case OP.jump:
          stack[top++] = x[at]!;
          break;
        case OP.split:
          // `y` first, so `x` is taken first: the order does not change whether it matches.
          stack[top++] = y[at]!;
          stack[top++] = x[at]!;
          break;
        case OP.start:
          if (index === 0) stack[top++] = at + 1;
          break;
        case OP.end:
          if (index === length) stack[top++] = at + 1;
          break;
        default:
          following[nextCount++] = at;
      }
    }
    return false;
  };

  if (add(0, 0)) return true;
  [current, following, count, nextCount] = [following, current, nextCount, 0];
  // A match may start at any character. Between the first and the last, where neither `^` nor `$` holds, the threads
  // it starts with are always the same: walked once here, not again at every character.
  generation++;
  const restartMatches = add(0, 1);
  const restart = following.slice(0, nextCount);
  nextCount = 0;
  for (let index = 0; index < length;) {
    const code = text.codePointAt(index)!;
    const after = index + (code > 0xffff ? 2 : 1);
    let cases = NO_VARIANTS;
    if (ignoreCase) {
      const known = variants.get(code);
      if (known) cases = known;
      else variants.set(code, (cases = caseVariants(code)));
    }
    generation++;
    for (let i = 0; i < count; i++) {
      budget--;
      const pc = current[i]!;
      const set = sets[pc]!;
      if (asked[set.id] !== index) {
        asked[set.id] = index;
        answer[set.id] = takes(set, code, cases) ? 1 : 0;
      }
      if (answer[set.id] === 1 && add(pc + 1, after)) return true;
    }
    // A match may also start at the next character.
    if (after === length) {
      if (add(0, after)) return true;
    } else {
      if (restartMatches) return true;
      for (let i = 0; i < restart.length; i++) {
        budget--;
        const pc = restart[i]!;
        if (seen[pc] === generation) continue;
        seen[pc] = generation;
        following[nextCount++] = pc;
      }
    }
    if (budget < 0) return "too_slow";
    [current, following, count, nextCount] = [following, current, nextCount, 0];
    index = after;
  }
  return false;
}
