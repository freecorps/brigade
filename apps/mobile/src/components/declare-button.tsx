import { m } from "@freecorps/brigade-i18n";
import { router, Stack } from "expo-router";

/** Declare, as the header's + (iOS, and the web preview): opens the declare sheet. */
export function DeclareButton() {
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button
        icon="plus"
        accessibilityLabel={m.declare_open()}
        onPress={() => router.push("/declare")}
      />
    </Stack.Toolbar>
  );
}
