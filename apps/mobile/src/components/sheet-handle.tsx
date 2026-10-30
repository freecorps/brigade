import { Box } from "@expo/ui/jetpack-compose";
import {
  align,
  background,
  clip,
  fillMaxWidth,
  Shapes,
  size,
} from "@expo/ui/jetpack-compose/modifiers";
import { useSystemColors } from "@/theme/system-colors";

/**
 * Material's drag handle (32 × 4 dp, the surface's variant colour at 40 %) at the top of an Android form sheet: the
 * screen's sheet draws none (its grabber is iOS's), though the choice sheets have one. Decorative: Back closes the
 * sheet. Android only; a Compose view, for a Compose form's first child.
 */
export function SheetHandle() {
  const system = useSystemColors();
  return (
    <Box modifiers={[fillMaxWidth()]}>
      <Box
        modifiers={[
          align("topCenter"),
          size(32, 4),
          clip(Shapes.RoundedCorner(2)),
          background(withAlpha(system.secondaryLabel as string, 0.4)),
        ]}
      />
    </Box>
  );
}

/** `#rrggbb` at `alpha`, as `#rrggbbaa` (React Native's order, which it converts for Android). */
function withAlpha(color: string, alpha: number): string {
  const hex = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return color.startsWith("#") && color.length === 7 ? `${color}${hex}` : color;
}
