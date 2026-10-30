import type { SyncView } from "@freecorps/brigade-sync";
import { HStack, Image, Text } from "@expo/ui/swift-ui";
import {
  accessibilityElement,
  foregroundStyle,
  monospacedDigit,
} from "@expo/ui/swift-ui/modifiers";
import type { ComponentProps } from "react";
import { useConnection } from "@/components/incident-parts";

/**
 * Over a list, in its section header: whether it is live, and a summary such as how many are open. Written in the
 * header's own font and colour, as every other section header, with only the glyph tinted (and the word, when sync
 * has failed); VoiceOver reads it as one line.
 */
export function ListStatus({ view, summary }: { view: SyncView; summary: string | undefined }) {
  const { text, glyph, tone, color } = useConnection(view);
  const symbol = (typeof glyph === "object" ? glyph.ios : glyph) as ComponentProps<
    typeof Image
  >["systemName"];
  return (
    <HStack spacing={6} modifiers={[accessibilityElement("combine")]}>
      <Image systemName={symbol ?? "circle.fill"} size={symbol ? 12 : 8} color={color} />
      <Text modifiers={tone === "bad" ? [foregroundStyle(color)] : undefined}>{text}</Text>
      {summary ? <Text modifiers={[monospacedDigit()]}>{`· ${summary}`}</Text> : null}
    </HStack>
  );
}
