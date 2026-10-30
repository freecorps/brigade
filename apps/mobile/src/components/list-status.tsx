import { RNHostView } from "@expo/ui";
import type { SyncView } from "@freecorps/brigade-sync";
import { fontWeight, spacing } from "@freecorps/brigade-ui";
import { SymbolView } from "expo-symbols";
import { Text, View } from "react-native";
import { useConnection } from "@/components/incident-parts";
import { useGlyphSize } from "@/components/badge";
import { useSystemColors } from "@/theme/system-colors";

/**
 * Over a list, in its section header: whether it is live, and a summary such as how many are open, as one quiet line
 * in the header's own size and colour (Material's title small), with only the dot or glyph and the state's word
 * tinted. iOS writes it as the system's own header (`list-status.ios.tsx`).
 */
export function ListStatus({ view, summary }: { view: SyncView; summary: string | undefined }) {
  const system = useSystemColors();
  const { text, glyph, color } = useConnection(view);
  const glyphSize = useGlyphSize(14);
  const type = { fontSize: 14, lineHeight: 20, letterSpacing: 0.1 };
  return (
    <RNHostView matchContents>
      <View
        accessible
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        style={{ flexDirection: "row", alignItems: "center", gap: spacing[2] }}
      >
        {glyph ? (
          <SymbolView name={glyph} tintColor={color} size={glyphSize} />
        ) : (
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
        )}
        <Text numberOfLines={1} style={{ ...type, color: system.secondaryLabel }}>
          <Text style={{ color, fontWeight: fontWeight.semibold }}>{text}</Text>
          {summary ? ` · ${summary}` : null}
        </Text>
      </View>
    </RNHostView>
  );
}
