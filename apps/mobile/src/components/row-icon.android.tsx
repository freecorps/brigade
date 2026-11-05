import { RNHostView } from "@expo/ui";
import { SizedSymbol } from "@/components/sized-symbol";
import { useGlyphSize } from "@/hooks/use-glyph-size";
import { useSystemColors } from "@/theme/system-colors";
import type { RowIconProps } from "./row-icon";

export type { RowIconProps } from "./row-icon";

/**
 * Material's leading icon: a 24 dp symbol in the surface's variant colour, without a tile, growing with the font size
 * up to the glyph cap (`src/lib/glyph-size.ts`).
 */
export function RowIcon({ glyph, color, plain = false }: RowIconProps) {
  const system = useSystemColors();
  const size = useGlyphSize(24);
  return (
    <RNHostView matchContents>
      <SizedSymbol
        name={glyph}
        tintColor={(plain ? color : undefined) ?? (system.secondaryLabel as string)}
        size={size}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </RNHostView>
  );
}
