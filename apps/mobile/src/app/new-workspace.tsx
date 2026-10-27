import { m } from "@freecorps/brigade-i18n";
import { spacing } from "@freecorps/brigade-ui";
import { router } from "expo-router";
import { ScrollView } from "react-native";
import { NewWorkspaceForm } from "@/components/new-workspace";
import { ThemedText } from "@/components/themed-text";
import { useScreenPadding } from "@/hooks/use-screen-padding";
import { useTheme } from "@/hooks/use-theme";

/** New workspace, from the account section: created, made active, and the sheet closes on it. */
export default function NewWorkspaceRoute() {
  const colors = useTheme();
  const padding = useScreenPadding();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[padding, { gap: spacing[5] }]}
    >
      <ThemedText>{m.account_flow({ part: "new_description", name: "" })}</ThemedText>
      <NewWorkspaceForm onDone={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
    </ScrollView>
  );
}
