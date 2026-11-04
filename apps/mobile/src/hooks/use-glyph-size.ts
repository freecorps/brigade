import { useWindowDimensions } from "react-native";
import { glyphSize } from "@/lib/glyph-size";

/**
 * A glyph's size for text of `size`, following the system text size (Dynamic Type, Android's font size) up to
 * `glyphSize`'s cap. Glyphs do not follow it by themselves, so next to larger text they would look small and clip in
 * their frame (Android at 130 %). Pass `max` (`Infinity`) for a length that has to keep up with the text itself.
 */
export function useGlyphSize(size: number, max?: number): number {
  const { fontScale } = useWindowDimensions();
  return glyphSize(size, fontScale, max);
}
