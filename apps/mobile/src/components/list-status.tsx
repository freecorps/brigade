import { RNHostView } from "@expo/ui";
import type { SyncView } from "@freecorps/brigade-sync";
import { View } from "react-native";
import { ConnectionStatus } from "@/components/incident-parts";
import { ThemedText } from "@/components/themed-text";

/**
 * Over a list, in its section header: whether it is live, and a summary such as how many are open. iOS writes it
 * as the system's own header (`list-status.ios.tsx`).
 */
export function ListStatus({ view, summary }: { view: SyncView; summary: string | undefined }) {
  return (
    <RNHostView matchContents>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <ConnectionStatus view={view} />
        {summary ? (
          <ThemedText variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
            {summary}
          </ThemedText>
        ) : null}
      </View>
    </RNHostView>
  );
}
