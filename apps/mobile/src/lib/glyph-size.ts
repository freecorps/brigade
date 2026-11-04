/**
 * How far a glyph grows with the system text size. Text in the app follows Dynamic Type all the way (about 3.1× body
 * at AX5); a glyph next to it grows with it up to 2×, about the first accessibility size (AX1: body 33 pt for 17 pt),
 * and stops there. Past that, the text carries the meaning and the glyph is a marker beside it: a glyph three times
 * its size would crowd out the very text it marks in a row, a badge or a settings tile (issue #20).
 */
export const MAX_GLYPH_SCALE = 2;

/**
 * A glyph's size, in points, beside text of base size `size` at the system's `fontScale`: never smaller than at the
 * default text size (a smaller text setting keeps glyphs legible), and at most `max` times it.
 */
export function glyphSize(size: number, fontScale: number, max: number = MAX_GLYPH_SCALE): number {
  const scale = Number.isFinite(fontScale) ? fontScale : 1;
  const cap = Number.isNaN(max) ? MAX_GLYPH_SCALE : Math.max(1, max);
  return Math.round(size * Math.min(cap, Math.max(1, scale)));
}
