import { useWindowDimensions } from "react-native";
import { glyphSize } from "@/lib/glyph-size";

/**
 * A glyph's size for text of `size`, following the system text size (Dynamic Type, Android's font size) up to
 * `glyphSize`'s cap. Draw the symbol with `SizedSymbol`, which holds it to this size on Android too (there the system
 * would scale the symbol's font glyph again, uncapped). Pass `max` (`Infinity`) for a length that has to keep up with
 * the text itself.
 */
export function useGlyphSize(size: number, max?: number): number {
  const { fontScale } = useWindowDimensions();
  return glyphSize(size, fontScale, max);
}
