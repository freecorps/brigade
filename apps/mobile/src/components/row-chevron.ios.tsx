import { SymbolView } from "expo-symbols";
import { PlatformColor } from "react-native";

/** The disclosure chevron of a row that opens another screen, in the system's tertiary label colour. */
export function RowChevron() {
  return (
    <SymbolView
      name="chevron.right"
      tintColor={PlatformColor("tertiaryLabel") as unknown as string}
      size={13}
      weight="semibold"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
