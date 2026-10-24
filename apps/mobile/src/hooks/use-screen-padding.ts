import { spacing } from "@freecorps/brigade-ui";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Content padding for a scrolling screen. The stack header covers the top; Android draws edge to edge
 * and iOS's automatic content insets do not apply there, so the bottom adds the home-indicator inset.
 */
export function useScreenPadding() {
  const insets = useSafeAreaInsets();
  return {
    paddingTop: spacing[4],
    paddingHorizontal: spacing[4] + Math.max(insets.left, insets.right),
    paddingBottom: spacing[8] + (process.env.EXPO_OS === "ios" ? 0 : insets.bottom),
  };
}
