import { m } from "@freecorps/brigade-i18n";
import { spacing } from "@freecorps/brigade-ui";
import { Link } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { Account } from "@/components/account";
import { ThemedText } from "@/components/themed-text";
import { useScreenPadding } from "@/hooks/use-screen-padding";
import { useTheme } from "@/hooks/use-theme";

/** The Account tab: who is signed in, their workspaces, whether this phone is paged, and the legend. */
export function AccountScreen() {
  const colors = useTheme();
  const padding = useScreenPadding();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[padding, { gap: spacing[6] }]}
    >
      <Account />
      <Link href="/legend" asChild>
        <Pressable accessibilityRole="link">
          {/* Sized inside: Link's `asChild` drops a style function on the Pressable. 48pt tall to tap. */}
          {({ pressed }) => (
            <View style={{ minHeight: spacing[12], justifyContent: "center" }}>
              <ThemedText style={{ color: colors.primary, opacity: pressed ? 0.6 : 1 }}>
                {m.legend_title()}
              </ThemedText>
            </View>
          )}
        </Pressable>
      </Link>
    </ScrollView>
  );
}
