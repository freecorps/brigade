import { fontFamily, fontSize, fontWeight } from "@freecorps/brigade-ui";
import { Platform, Text, type TextProps } from "react-native";
import { useTheme } from "@/hooks/use-theme";

// The app's text ramp, built only from packages/ui's type tokens.
const variants = {
  body: { size: fontSize.base, weight: fontWeight.regular, muted: false },
  label: { size: fontSize.sm, weight: fontWeight.medium, muted: true },
  caption: { size: fontSize.sm, weight: fontWeight.regular, muted: true },
  heading: { size: fontSize.lg, weight: fontWeight.semibold, muted: false },
} as const;

export type TextVariant = keyof typeof variants;

export function ThemedText({
  variant = "body",
  style,
  ...props
}: TextProps & { variant?: TextVariant }) {
  const colors = useTheme();
  const { size, weight, muted } = variants[variant];
  return (
    <Text
      style={[
        {
          color: muted ? colors.mutedForeground : colors.foreground,
          fontFamily: Platform.select(fontFamily.native.sans),
          fontSize: size.size,
          lineHeight: size.lineHeight,
          fontWeight: weight,
        },
        style,
      ]}
      {...props}
    />
  );
}
