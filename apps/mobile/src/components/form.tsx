import { m } from "@freecorps/brigade-i18n";
import { fontSize, radius, spacing } from "@freecorps/brigade-ui";
import { useState, type ComponentRef, type Ref } from "react";
import { ActivityIndicator, Pressable, TextInput, View, type TextInputProps } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";

// The form pieces the sign-in, sign-up and new-workspace forms share.

/** A labelled text field with its error under it; `secret` hides the text, with Show password beside it. */
export function Field({
  label,
  error,
  ref,
  secret = false,
  ...input
}: TextInputProps & {
  label: string;
  error?: string;
  secret?: boolean;
  ref?: Ref<ComponentRef<typeof TextInput>>;
}) {
  const colors = useTheme();
  const [shown, setShown] = useState(false);
  return (
    <View style={{ gap: spacing[2] }}>
      <ThemedText variant="label">{label}</ThemedText>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: spacing[12],
          borderRadius: radius.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: error ? colors.destructive : colors.input,
        }}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={error}
          placeholderTextColor={colors.mutedForeground}
          secureTextEntry={secret && !shown}
          style={{
            flex: 1,
            minHeight: spacing[12],
            paddingHorizontal: spacing[3],
            color: colors.foreground,
            fontSize: fontSize.base.size,
          }}
          {...input}
        />
        {secret ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setShown((value) => !value)}
            style={({ pressed }) => ({
              minHeight: spacing[12],
              justifyContent: "center",
              paddingHorizontal: spacing[3],
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <ThemedText style={{ color: colors.primary }}>
              {m.mobile_session({ part: shown ? "hide_password" : "show_password" })}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <ThemedText
          selectable
          accessibilityLiveRegion="polite"
          style={{ color: colors.destructive }}
        >
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

export function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: spacing[12],
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <ThemedText style={{ color: colors.primary }}>{label}</ThemedText>
    </Pressable>
  );
}

/** The form's main action, full width; `busy` shows a spinner and ignores presses. */
export function PrimaryButton({
  label,
  busy,
  onPress,
}: {
  label: string;
  busy: boolean;
  onPress: () => void;
}) {
  const colors = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: spacing[12],
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing[2],
        paddingHorizontal: spacing[4],
        borderRadius: radius.md,
        borderCurve: "continuous",
        backgroundColor: colors.primary,
        opacity: busy ? 0.7 : pressed ? 0.8 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={colors.primaryForeground} /> : null}
      <ThemedText style={{ color: colors.primaryForeground }}>{label}</ThemedText>
    </Pressable>
  );
}
