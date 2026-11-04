import { describe, expect, test } from "vite-plus/test";
import { glyphSize, MAX_GLYPH_SCALE } from "./glyph-size.ts";

describe("glyphSize", () => {
  test("the base size at the default text size", () => {
    expect(glyphSize(14, 1)).toBe(14);
  });

  test("grows with the text size", () => {
    expect(glyphSize(14, 1.5)).toBe(21);
    expect(glyphSize(17, 1.235)).toBe(21);
  });

  test("stops at the cap at the largest accessibility sizes", () => {
    expect(MAX_GLYPH_SCALE).toBe(2);
    expect(glyphSize(14, 2)).toBe(28);
    expect(glyphSize(14, 3.12)).toBe(28);
    expect(glyphSize(14, 100)).toBe(28);
  });

  test("never shrinks below the base size", () => {
    expect(glyphSize(14, 0.82)).toBe(14);
    expect(glyphSize(14, 0)).toBe(14);
    expect(glyphSize(14, Number.NaN)).toBe(14);
  });

  test("takes another cap, or none, for what tracks the text itself", () => {
    expect(glyphSize(72, 3, 1.5)).toBe(108);
    expect(glyphSize(72, 3, Infinity)).toBe(216);
  });
});
