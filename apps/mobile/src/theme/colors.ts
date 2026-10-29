import { themes } from "@freecorps/brigade-ui";
import { Color } from "expo-router";
import { Platform, type ColorValue } from "react-native";

/**
 * The system's own colours for the app's chrome and grounds: UIKit's semantic colours on iOS, Material 3's dynamic
 * colours on Android (from the wallpaper on Android 12+). They resolve on the device and follow light, dark and
 * increased contrast by themselves. Brand, severity and status colours stay packages/ui's (`useTheme`); web, which
 * only renders the app in development, gets packages/ui's light theme.
 *
 * On Android a component that renders these must call `useColorScheme()` to re-render when the scheme flips.
 */
function pick(ios: ColorValue, android: ColorValue, web: string): ColorValue {
  return Platform.select({ ios, android, default: web });
}

const web = themes.light;

export const colors = {
  /** The screen behind grouped rows (Settings-style screens). */
  groupedBackground: pick(
    Color.ios.systemGroupedBackground,
    Color.android.dynamic.surfaceContainerLow,
    web.background,
  ),
  /** A row or card on the grouped ground. */
  groupedCell: pick(
    Color.ios.secondarySystemGroupedBackground,
    Color.android.dynamic.surfaceContainer,
    web.card,
  ),
  label: pick(Color.ios.label, Color.android.dynamic.onSurface, web.foreground),
  secondaryLabel: pick(
    Color.ios.secondaryLabel,
    Color.android.dynamic.onSurfaceVariant,
    web.mutedForeground,
  ),
  separator: pick(Color.ios.separator, Color.android.dynamic.outlineVariant, web.border),
};
