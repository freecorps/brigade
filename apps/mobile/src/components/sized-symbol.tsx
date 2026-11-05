import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { Platform, useWindowDimensions } from "react-native";

/**
 * A symbol drawn at exactly `size` points, whatever the system text size. On Android expo-symbols draws the symbol
 * as a font glyph in a `size` frame, and the system font scale enlarges that glyph again (past its frame, and past
 * the cap `useGlyphSize` already applied). Dividing the scale back out keeps the frame and the glyph at `size`. On
 * iOS `SymbolView` is native and `size` is already exact.
 */
export function SizedSymbol({ size, style, ...props }: SymbolViewProps & { size: number }) {
  const { fontScale } = useWindowDimensions();
  if (Platform.OS !== "android" || !(fontScale > 0)) {
    return <SymbolView {...props} size={size} style={style} />;
  }
  return (
    <SymbolView {...props} size={size / fontScale} style={[{ width: size, height: size }, style]} />
  );
}
