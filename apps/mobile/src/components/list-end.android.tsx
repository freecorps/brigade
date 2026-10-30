import { FieldGroup } from "@expo/ui";
import { Spacer } from "@expo/ui/jetpack-compose";
import { height } from "@expo/ui/jetpack-compose/modifiers";
import type { ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * The end of a screen's grouped list: room for the navigation bar the screen draws under, and `extra` for what floats
 * over the list's end (a floating action button), so the last row scrolls clear of both. A section of its own, since
 * `FieldGroup` takes any other child for a row.
 */
export function useListEnd(extra = 0): ReactNode {
  const { bottom } = useSafeAreaInsets();
  if (bottom + extra === 0) return null;
  return (
    <FieldGroup.Section>
      <FieldGroup.SectionFooter>
        <Spacer modifiers={[height(bottom + extra)]} />
      </FieldGroup.SectionFooter>
    </FieldGroup.Section>
  );
}
