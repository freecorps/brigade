import { BottomSheet, Column, ListItem, Text } from "@expo/ui";
import { useEffect, useState } from "react";
import type { Request } from "@/components/choice-sheet";
import { NativeHost } from "@/components/native-host";

/** Rows on the sheet's own surface, not on a card of their own. */
const CLEAR = { containerColor: "transparent" };

/**
 * A choice as Material's modal bottom sheet: the title, then one row per choice. Back, a swipe down or a tap on the
 * scrim cancels. The last request stays drawn while the sheet slides away.
 */
export function ChoiceDialog({
  request,
  onClose,
}: {
  request: Request | null;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(request);
  useEffect(() => {
    if (request) setShown(request);
  }, [request]);
  if (!shown) return null;
  return (
    <NativeHost matchContents style={{ position: "absolute" }}>
      <BottomSheet isPresented={request !== null} onDismiss={onClose} showDragIndicator>
        <Column>
          <ListItem colors={CLEAR}>
            <Text textStyle={{ fontSize: 16, fontWeight: "600" }}>{shown.title}</Text>
          </ListItem>
          {shown.choices.map((choice) => (
            <ListItem
              key={String(choice.value)}
              colors={CLEAR}
              onPress={() => {
                onClose();
                shown.pick(choice.value);
              }}
            >
              <Text>{choice.label}</Text>
            </ListItem>
          ))}
        </Column>
      </BottomSheet>
    </NativeHost>
  );
}
