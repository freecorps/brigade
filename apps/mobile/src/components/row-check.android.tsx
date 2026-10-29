import { Icon } from "@expo/ui/jetpack-compose";
import { useSystemColors } from "@/theme/system-colors";

const CHECK = require("../../assets/icons/check.xml");

/** The selected row's check mark, a Material Symbol in the theme's primary colour. */
export function RowCheck() {
  return <Icon source={CHECK} tint={useSystemColors().tint} />;
}
