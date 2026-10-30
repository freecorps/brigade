import { m } from "@freecorps/brigade-i18n";
import { useState, type ReactNode } from "react";
import { ActionSheetIOS, useColorScheme } from "react-native";
import { ChoiceDialog } from "@/components/choice-dialog";

export type Choice<T> = { value: T; label: string };

export type Request = {
  title: string;
  choices: Choice<unknown>[];
  pick: (value: unknown) => void;
};

/**
 * Pick one of a few values. iOS shows the system action sheet; Android Material's modal bottom sheet, one row per
 * choice (`choice-dialog.android.tsx`); a long list (every member, for a role) scrolls inside it. Render `sheet`
 * once in the screen.
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
  const sheet = <ChoiceDialog request={request} onClose={() => setRequest(null)} />;
  return { choose, sheet };
}
