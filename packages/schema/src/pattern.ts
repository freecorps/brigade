// The regular expressions an HTTP check may look for in a response body (RFC 0007 "Check types"). Not JavaScript's
// `RegExp`: its backtracking engine takes exponential time on patterns like `(a+)+$`, and a Worker has no way to stop a
// running match, so one monitor could hold its probe's CPU. Instead a restricted syntax is compiled to a small program
// and run as a Pike VM (Thompson's construction, every thread in lockstep): the work is at most the program's length
// for each character of the body, never more, whatever the pattern or the body. The pattern is capped at
// `MONITOR_PATTERN_MAX` characters and the program at `MAX_PATTERN_PROGRAM` instructions (counted after repeats are
// expanded), and the probe reads at most 64 KiB of a body, so one match is bounded.
//
// Supported: literals; `.` (any character but a line break); `\d \D \w \W \s \S`; escaped punctuation (`\.`, `\(`, …);
// `\n \r \t \f \v`; classes `[a-z_]` and `[^…]` (with the escapes above); `^` and `$` (start and end of the body);
// groups `( )` and `(?: )`, which only group; `|`; `* + ?`, `{n}`, `{n,}` and `{n,m}` (n and m at most 100; a lazy
// `?` after one is accepted and changes nothing, since only whether it matches counts); and `(?i)` at the very start,
// for a match that ignores case. Refused, with a reason: backreferences, lookahead and lookbehind, named groups, word
// boundaries and other escapes. A `{` that does not start a repeat is a literal, as in JavaScript.

/** The longest pattern a monitor may have, in UTF-16 code units (as the keyword). */
export const MONITOR_PATTERN_MAX = 200;
/** At most this many instructions once repeats are expanded: the work per body character. */
export const MAX_PATTERN_PROGRAM = 256;
/** The largest count in `{n,m}`. */
export const MAX_PATTERN_REPEAT = 100;

/** Inclusive code point ranges; `negate` matches everything outside them. */
type CharSet = { ranges: [number, number][]; negate: boolean };

type Node =
  | { kind: "set"; items: CharSet[]; negate: boolean }
  | { kind: "cat"; items: Node[] }
  | { kind: "alt"; options: Node[] }
  | { kind: "repeat"; node: Node; min: number; max: number }
  | { kind: "start" }
  | { kind: "end" };

type Instruction =
  | { op: "set"; items: CharSet[]; negate: boolean; ascii: Uint8Array }
  | { op: "split"; x: number; y: number }
  | { op: "jump"; to: number }
  | { op: "start" }
  | { op: "end" }
  | { op: "match" };

/** A compiled pattern: run it with `matchPattern`. */
export type Pattern = { program: Instruction[]; ignoreCase: boolean };

export type CompiledPattern = { ok: true; pattern: Pattern } | { ok: false; reason: string };

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
    const program: Instruction[] = [];
    emit(node, program);
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

  /** `{n}`, `{n,}` or `{n,m}` at the cursor, without moving it; undefined when `{` is a literal there. */
  private braces(): { bounds: [number, number]; length: number } | undefined {
    const rest = this.chars.slice(this.at, this.at + 16).join("");
    const found = /^\{(\d+)(,(\d*))?\}/.exec(rest);
    if (!found) return undefined;
    const min = Number(found[1]);
    const max = found[2] === undefined ? min : found[3] === "" ? Infinity : Number(found[3]);
    if (min > MAX_PATTERN_REPEAT || (max !== Infinity && max > MAX_PATTERN_REPEAT)) {
      throw new PatternError(`Repeat counts go up to ${MAX_PATTERN_REPEAT}`);
    }
    if (max < min) throw new PatternError("Repeat counts out of order");
    return { bounds: [min, max], length: found[0].length };
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

function push(program: Instruction[], instruction: Instruction): number {
  if (program.length >= MAX_PATTERN_PROGRAM) {
    throw new PatternError("Pattern is too complex: use fewer or smaller repeats");
  }
  program.push(instruction);
  return program.length - 1;
}

/** Appends `node`'s instructions; repeats are expanded (`a{2,3}` is `aaa?`), so the program is a plain NFA. */
function emit(node: Node, program: Instruction[]): void {
  switch (node.kind) {
    case "set":
      push(program, {
        op: "set",
        items: node.items,
        negate: node.negate,
        ascii: asciiTable(node.items, node.negate),
      });
      return;
    case "start":
    case "end":
      push(program, { op: node.kind });
      return;
    case "cat":
      for (const item of node.items) emit(item, program);
      return;
    case "alt": {
      const jumps: number[] = [];
      node.options.forEach((option, index) => {
        if (index < node.options.length - 1) {
          const split = push(program, { op: "split", x: 0, y: 0 });
          emit(option, program);
          jumps.push(push(program, { op: "jump", to: 0 }));
          program[split] = { op: "split", x: split + 1, y: program.length };
        } else emit(option, program);
      });
      for (const jump of jumps) program[jump] = { op: "jump", to: program.length };
      return;
    }
    case "repeat": {
      for (let i = 0; i < node.min; i++) emit(node.node, program);
      if (node.max === Infinity) {
        const split = push(program, { op: "split", x: 0, y: 0 });
        emit(node.node, program);
        push(program, { op: "jump", to: split });
        program[split] = { op: "split", x: split + 1, y: program.length };
        return;
      }
      const splits: number[] = [];
      for (let i = node.min; i < node.max; i++) {
        splits.push(push(program, { op: "split", x: 0, y: 0 }));
        emit(node.node, program);
      }
      for (const split of splits) program[split] = { op: "split", x: split + 1, y: program.length };
      return;
    }
  }
}

function inSet(set: CharSet, code: number): boolean {
  let found = false;
  for (const [low, high] of set.ranges) {
    if (code >= low && code <= high) {
      found = true;
      break;
    }
  }
  return found !== set.negate;
}

/** Whether each ASCII character is in the set: the common case, read without walking the ranges. */
function asciiTable(items: CharSet[], negate: boolean): Uint8Array {
  const table = new Uint8Array(128);
  for (let code = 0; code < 128; code++) {
    table[code] = Number(items.some((item) => inSet(item, code)) !== negate);
  }
  return table;
}

function matches(instruction: Extract<Instruction, { op: "set" }>, code: number): boolean {
  if (code < 128) return instruction.ascii[code] === 1;
  return instruction.items.some((item) => inSet(item, code)) !== instruction.negate;
}

/** Whether `instruction` takes `code` or, ignoring case, one of its other cases. */
function takes(
  instruction: Extract<Instruction, { op: "set" }>,
  code: number,
  ignoreCase: boolean,
): boolean {
  if (matches(instruction, code)) return true;
  if (!ignoreCase) return false;
  for (const other of variants(code)) if (matches(instruction, other)) return true;
  return false;
}

/** The code point's other cases: arithmetic for ASCII letters, the case mappings for the rest. */
function variants(code: number): number[] {
  if (code < 128) {
    if (code >= 65 && code <= 90) return [code + 32];
    if (code >= 97 && code <= 122) return [code - 32];
    return [];
  }
  const char = String.fromCodePoint(code);
  const out: number[] = [];
  // Only one-to-one mappings: `ß` uppercases to two characters, which one position cannot hold.
  for (const other of [char.toLowerCase(), char.toUpperCase()]) {
    if (other !== char && Array.from(other).length === 1) out.push(other.codePointAt(0)!);
  }
  return out;
}

/**
 * Whether `pattern` matches anywhere in `text`. Every possible match is followed at once, one step per character
 * (a Pike VM): each instruction is visited at most once per position, so the work is at most the program's length
 * times the text's, with no backtracking.
 */
export function matchPattern(pattern: Pattern, text: string): boolean {
  const { program, ignoreCase } = pattern;
  const seen = new Int32Array(program.length).fill(-1);
  let current: number[] = [];
  let next: number[] = [];
  let generation = 0;
  const stack: number[] = [];

  /** Adds the thread at `pc` and everything it reaches without reading; true when one of them matches. */
  const add = (list: number[], pc: number, index: number, length: number): boolean => {
    stack.push(pc);
    while (stack.length > 0) {
      const at = stack.pop()!;
      if (seen[at] === generation) continue;
      seen[at] = generation;
      const instruction = program[at]!;
      switch (instruction.op) {
        case "match":
          stack.length = 0;
          return true;
        case "jump":
          stack.push(instruction.to);
          break;
        case "split":
          // `y` first, so `x` is taken first: the order does not change whether it matches.
          stack.push(instruction.y, instruction.x);
          break;
        case "start":
          if (index === 0) stack.push(at + 1);
          break;
        case "end":
          if (index === length) stack.push(at + 1);
          break;
        case "set":
          list.push(at);
          break;
      }
    }
    return false;
  };

  const length = text.length;
  if (add(current, 0, 0, length)) return true;
  for (let index = 0; index < length;) {
    const code = text.codePointAt(index)!;
    const after = index + (code > 0xffff ? 2 : 1);
    generation++;
    next.length = 0;
    for (const pc of current) {
      const instruction = program[pc] as Extract<Instruction, { op: "set" }>;
      if (takes(instruction, code, ignoreCase) && add(next, pc + 1, after, length)) return true;
    }
    // A match may also start at the next character.
    if (add(next, 0, after, length)) return true;
    [current, next] = [next, current];
    index = after;
  }
  return false;
}
