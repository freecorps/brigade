import { m } from "@freecorps/brigade-i18n";
import { radius, spacing } from "@freecorps/brigade-ui";
import { useState, type ReactNode } from "react";
import { ActionSheetIOS, Modal, Pressable, StyleSheet, useColorScheme, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";

export type Choice<T> = { value: T; label: string };

type Request = { title: string; choices: Choice<unknown>[]; pick: (value: unknown) => void };

/**
 * Pick one of a few values. iOS shows the system action sheet; Android a plain dialog with one row per choice,
 * since React Native has no native list dialog there. Render `sheet` once in the screen.
 */
export function useChoiceSheet(): {
  choose: <T>(title: string, choices: Choice<T>[], pick: (value: T) => void) => void;
  sheet: ReactNode;
} {
  const scheme = useColorScheme();
  const [request, setRequest] = useState<Request | null>(null);
  const choose = <T,>(title: string, choices: Choice<T>[], pick: (value: T) => void) => {
    if (process.env.EXPO_OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          options: [...choices.map((choice) => choice.label), m.declare_cancel()],
          cancelButtonIndex: choices.length,
          userInterfaceStyle: scheme === "dark" ? "dark" : "light",
        },
        (index) => {
          const choice = choices[index];
          if (choice) pick(choice.value);
        },
      );
      return;
    }
    setRequest({ title, choices, pick: pick as (value: unknown) => void });
  };
  const sheet = request ? (
    <ChoiceDialog request={request} onClose={() => setRequest(null)} />
  ) : null;
  return { choose, sheet };
}

function ChoiceDialog({ request, onClose }: { request: Request; onClose: () => void }) {
  const colors = useTheme();
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={m.declare_cancel()}
        onPress={onClose}
        style={{
          flex: 1,
          justifyContent: "center",
          padding: spacing[6],
          backgroundColor: "rgba(0, 0, 0, 0.4)",
        }}
      >
        <View
          // Taps inside the dialog stay in it.
          onStartShouldSetResponder={() => true}
          style={{
            backgroundColor: colors.card,
            borderRadius: radius.xl,
            borderCurve: "continuous",
            paddingVertical: spacing[2],
          }}
        >
          <ThemedText
            variant="label"
            accessibilityRole="header"
            style={{ paddingHorizontal: spacing[6], paddingVertical: spacing[3] }}
          >
            {request.title}
          </ThemedText>
          {request.choices.map((choice) => (
            <Pressable
              key={String(choice.value)}
              accessibilityRole="button"
              onPress={() => {
                onClose();
                request.pick(choice.value);
              }}
              style={({ pressed }) => ({
                minHeight: spacing[12],
                justifyContent: "center",
                paddingHorizontal: spacing[6],
                backgroundColor: pressed ? colors.accent : "transparent",
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: colors.border,
              })}
            >
              <ThemedText>{choice.label}</ThemedText>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}
