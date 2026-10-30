import { m } from "@freecorps/brigade-i18n";
import { Stack } from "expo-router";

/** Post an update, as the header's compose button: opens the update sheet. */
export function UpdateButton({ onPress }: { onPress: () => void }) {
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button
        icon="square.and.pencil"
        accessibilityLabel={m.incident_page({ part: "update_label" })}
        onPress={onPress}
      />
    </Stack.Toolbar>
  );
}
