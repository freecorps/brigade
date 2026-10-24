import { expect, test } from "vite-plus/test";
import { idTime, isId, newId } from "../src/index.ts";

const zeros = (n: number) => new Uint8Array(n);
const ones = (n: number) => new Uint8Array(n).fill(255);
const T = Date.UTC(2026, 9, 24, 12, 0, 0);

test("ids are a prefix and a 26-character Crockford ULID", () => {
  const id = newId("inc", T, zeros);
  expect(id).toMatch(/^inc_[0-9A-HJKMNP-TV-Z]{26}$/);
  expect(id.slice(14)).toBe("0000000000000000");
  expect(newId("inc", T, ones).slice(14)).toBe("ZZZZZZZZZZZZZZZZ");
  expect(isId("inc", id)).toBe(true);
});

test("the same time and randomness give the same id", () => {
  const random = (n: number) => Uint8Array.from({ length: n }, (_, i) => i * 37);
  expect(newId("inc", T, random)).toBe(newId("inc", T, random));
});

test("the time is encoded and decodes back", () => {
  expect(newId("inc", 0, zeros)).toBe("inc_00000000000000000000000000");
  expect(newId("inc", 2 ** 48 - 1, zeros).slice(4, 14)).toBe("7ZZZZZZZZZ");
  expect(idTime(newId("inc", T, ones))).toBe(T);
});

test("ids from later milliseconds sort after earlier ones", () => {
  const times = [0, 1, 31, 32, 1_000, T - 1, T, T + 1, 2 ** 48 - 1];
  const ids = times.map((time, i) => newId("inc", time, i % 2 ? ones : zeros));
  expect([...ids].sort()).toEqual(ids);
});

test("randomness bits map to digits most significant first", () => {
  // 0x08 0x42 0x10 0x84 0x21 = 00001 00001 00001 … → every digit is 1.
  const pattern = (n: number) =>
    Uint8Array.from({ length: n }, (_, i) => [0x08, 0x42, 0x10, 0x84, 0x21][i % 5]);
  expect(newId("inc", T, pattern).slice(14)).toBe("1111111111111111");
});

test("isId rejects other prefixes and malformed values", () => {
  const id = newId("inc", T, zeros);
  expect(isId("svc", id)).toBe(false);
  for (const value of [
    undefined,
    null,
    42,
    "",
    "inc_",
    id.toLowerCase(),
    `${id}0`,
    id.slice(0, -1),
    `inc_8${id.slice(5)}`, // overflows 48 bits
    `inc_${id.slice(4, -1)}U`, // U is not Crockford
    ` ${id}`,
    `xinc_${id.slice(4)}`,
  ]) {
    expect(isId("inc", value), String(value)).toBe(false);
  }
});

test("bad prefixes, times and randomness are programming errors", () => {
  expect(() => newId("INC", T, zeros)).toThrow(RangeError);
  expect(() => newId("in.c", T, zeros)).toThrow(RangeError);
  expect(() => isId(".*", "x")).toThrow(RangeError);
  expect(() => newId("inc", -1, zeros)).toThrow(RangeError);
  expect(() => newId("inc", 1.5, zeros)).toThrow(RangeError);
  expect(() => newId("inc", 2 ** 48, zeros)).toThrow(RangeError);
  expect(() => newId("inc", T, () => new Uint8Array(9))).toThrow(RangeError);
});
