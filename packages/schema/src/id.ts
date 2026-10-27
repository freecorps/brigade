// Prefixed ULIDs (RFC 0003 "Identifiers"): `inc_01JB…`. 10 chars of time (48-bit epoch ms) and 16 chars of
// randomness (80 bits), Crockford base32. Time and randomness are injected so callers stay deterministic.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const MAX_TIME = 2 ** 48 - 1;
const RANDOM_BYTES = 10;

/** Returns `length` random bytes, e.g. `(n) => crypto.getRandomValues(new Uint8Array(n))`. */
export type RandomBytes = (length: number) => Uint8Array;

const PREFIX = /^[a-z]{2,8}$/;
const ULID = "[0-7][0-9A-HJKMNP-TV-Z]{25}";
const ANY_ID = new RegExp(`^[a-z]{2,8}_${ULID}$`);

function checkPrefix(prefix: string): void {
  if (!PREFIX.test(prefix)) throw new RangeError(`Invalid id prefix "${prefix}"`);
}

/** New `<prefix>_<ULID>` id. Ids made in later milliseconds sort after earlier ones. */
export function newId(prefix: string, now: number, random: RandomBytes): string {
  checkPrefix(prefix);
  if (!Number.isInteger(now) || now < 0 || now > MAX_TIME) {
    throw new RangeError("Id time must be an integer epoch in milliseconds");
  }
  const bytes = random(RANDOM_BYTES);
  if (bytes.length < RANDOM_BYTES) throw new RangeError(`Need ${RANDOM_BYTES} random bytes`);

  let time = "";
  for (let rest = now, i = 0; i < 10; i++, rest = Math.floor(rest / 32)) {
    time = ALPHABET[rest % 32] + time;
  }
  // 80 bits → 16 base32 digits, most significant first.
  let randomness = "";
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < RANDOM_BYTES; i++) {
    buffer = (buffer << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      randomness += ALPHABET[(buffer >> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  return `${prefix}_${time}${randomness}`;
}

/** The pattern `isId(prefix, …)` matches, anchored: for JSON Schema and the API reference. */
export function idPattern(prefix: string): string {
  checkPrefix(prefix);
  return `^${prefix}_${ULID}$`;
}

/** True when `value` is a canonical (upper-case) `<prefix>_<ULID>` id. */
export function isId(prefix: string, value: unknown): value is string {
  return typeof value === "string" && new RegExp(idPattern(prefix)).test(value);
}

/** Epoch milliseconds encoded in a prefixed ULID. Throws `RangeError` for anything else. */
export function idTime(id: string): number {
  if (!ANY_ID.test(id)) throw new RangeError("Not a prefixed ULID");
  const start = id.indexOf("_") + 1;
  let time = 0;
  for (const char of id.slice(start, start + 10)) time = time * 32 + ALPHABET.indexOf(char);
  return time;
}
