import { RNHostView } from "@expo/ui";
import { SymbolView } from "expo-symbols";
import { useSystemColors } from "@/theme/system-colors";
import type { RowIconProps } from "./row-icon";

export type { RowIconProps } from "./row-icon";

/** Material's leading icon: a 24 dp symbol in the surface's variant colour, without a tile. */
export function RowIcon({ glyph, color, plain = false }: RowIconProps) {
  const system = useSystemColors();
  return (
    <RNHostView matchContents>
      <SymbolView
        name={glyph}
        tintColor={(plain ? color : undefined) ?? (system.secondaryLabel as string)}
        size={24}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </RNHostView>
  );
}
