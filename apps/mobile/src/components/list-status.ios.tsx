import type { SyncView } from "@freecorps/brigade-sync";
import { HStack, Image, Text } from "@expo/ui/swift-ui";
import {
  accessibilityElement,
  font,
  foregroundStyle,
  monospacedDigit,
} from "@expo/ui/swift-ui/modifiers";
import type { ComponentProps } from "react";
import { useConnection } from "@/components/incident-parts";

/**
 * Over a list, in its section header: whether it is live, and a summary such as how many are open. One line in the
 * footnote size of a grouped list's header, as Settings writes one, with only the glyph and the state's word tinted;
 * VoiceOver reads it as one line.
 */
export function ListStatus({ view, summary }: { view: SyncView; summary: string | undefined }) {
  const { text, glyph, color } = useConnection(view);
  const symbol = (typeof glyph === "object" ? glyph.ios : glyph) as ComponentProps<
    typeof Image
  >["systemName"];
  return (
    <HStack spacing={6} modifiers={[accessibilityElement("combine")]}>
      <Image systemName={symbol ?? "circle.fill"} size={symbol ? 12 : 7} color={color} />
      <Text
        modifiers={[font({ textStyle: "footnote", weight: "semibold" }), foregroundStyle(color)]}
      >
        {text}
      </Text>
      {summary ? (
        <Text
          modifiers={[font({ textStyle: "footnote" }), monospacedDigit()]}
        >{`· ${summary}`}</Text>
      ) : null}
    </HStack>
  );
}
