import { BottomSheet, ListItem, Text as UniversalText } from "@expo/ui";
import { Column, Text } from "@expo/ui/jetpack-compose";
import { fillMaxWidth, padding, verticalScroll } from "@expo/ui/jetpack-compose/modifiers";
import { useEffect, useState } from "react";
import type { Request } from "@/components/choice-sheet";
import { NativeHost } from "@/components/native-host";
import { useSystemColors } from "@/theme/system-colors";

/** Rows on the sheet's own surface, not on a card of their own. */
const CLEAR = { containerColor: "transparent" };

/**
 * A choice as Material's modal bottom sheet: the title as the sheet's title (not a row of its own), then one row per
 * choice, scrolling when there are more than fit (every member, for a role). Back, a swipe down or a tap on the scrim
 * cancels. The last request stays drawn while the sheet slides away.
 */
export function ChoiceDialog({
  request,
  onClose,
}: {
  request: Request | null;
  onClose: () => void;
}) {
  const system = useSystemColors();
  const [shown, setShown] = useState(request);
  useEffect(() => {
    if (request) setShown(request);
  }, [request]);
  if (!shown) return null;
  return (
    <NativeHost matchContents style={{ position: "absolute" }}>
      <BottomSheet isPresented={request !== null} onDismiss={onClose} showDragIndicator>
        <Column modifiers={[fillMaxWidth(), verticalScroll(), padding(0, 0, 0, 16)]}>
          <Text
            color={system.secondaryLabel as string}
            style={{ typography: "titleMedium" }}
            modifiers={[padding(16, 0, 16, 8)]}
          >
            {shown.title}
          </Text>
          {shown.choices.map((choice) => (
            <ListItem
              key={String(choice.value)}
              colors={CLEAR}
              onPress={() => {
                onClose();
                shown.pick(choice.value);
              }}
            >
              <UniversalText>{choice.label}</UniversalText>
            </ListItem>
          ))}
        </Column>
      </BottomSheet>
    </NativeHost>
  );
}
