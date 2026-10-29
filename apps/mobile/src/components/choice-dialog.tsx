import { m } from "@freecorps/brigade-i18n";
import { radius, spacing } from "@freecorps/brigade-ui";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import type { Request } from "@/components/choice-sheet";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";

/** The web preview's choice: a plain dialog with one row per choice and Cancel always in view. */
export function ChoiceDialog({
  request,
  onClose,
}: {
  request: Request | null;
  onClose: () => void;
}) {
  const colors = useTheme();
  const dark = useColorScheme() === "dark";
  const { height } = useWindowDimensions();
  if (!request) return null;
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "center", padding: spacing[6] }}>
        {/* The backdrop closes the dialog on touch; screen readers use the Cancel row (or Back) instead. */}
        <Pressable
          accessible={false}
          importantForAccessibility="no"
          onPress={onClose}
          // Darker in dark mode, where a light scrim barely separates the card from the page.
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: dark ? "rgba(0, 0, 0, 0.7)" : "rgba(0, 0, 0, 0.4)" },
          ]}
        />
        <View
          style={{
            maxHeight: height * 0.7,
            backgroundColor: colors.card,
            borderRadius: radius.xl,
            borderCurve: "continuous",
            borderWidth: dark ? StyleSheet.hairlineWidth : 0,
            borderColor: colors.border,
            paddingVertical: spacing[2],
            overflow: "hidden",
          }}
        >
          <ThemedText
            variant="label"
            accessibilityRole="header"
            style={{ paddingHorizontal: spacing[6], paddingVertical: spacing[3] }}
          >
            {request.title}
          </ThemedText>
          <ScrollView style={{ flexGrow: 0 }} persistentScrollbar>
            {request.choices.map((choice) => (
              <DialogRow
                key={String(choice.value)}
                label={choice.label}
                onPress={() => {
                  onClose();
                  request.pick(choice.value);
                }}
              />
            ))}
          </ScrollView>
          <DialogRow label={m.declare_cancel()} muted onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function DialogRow({
  label,
  muted = false,
  onPress,
}: {
  label: string;
  muted?: boolean;
  onPress: () => void;
}) {
  const colors = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: spacing[12],
        justifyContent: "center",
        paddingHorizontal: spacing[6],
        // A long name wraps; it keeps clear of the separators.
        paddingVertical: spacing[2],
        backgroundColor: pressed ? colors.accent : "transparent",
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
      })}
    >
      <ThemedText variant={muted ? "caption" : "body"}>{label}</ThemedText>
    </Pressable>
  );
}
