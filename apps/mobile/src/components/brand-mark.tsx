import { Image } from "react-native";

const ICON = require("../../assets/icon.png");
const SIZE = 64;

/**
 * The app's icon, as the home screen shows it (a rounded square), at the top of a screen that has no header: what a
 * member sees before signing in. Decorative: the title under it names the app.
 */
export function BrandMark() {
  return (
    <Image
      source={ICON}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: SIZE,
        height: SIZE,
        borderRadius: SIZE * 0.225,
        borderCurve: "continuous",
      }}
    />
  );
}
