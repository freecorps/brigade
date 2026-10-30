import { ListItem as UniversalListItem, type ListItemProps } from "@expo/ui";
import { Text } from "@expo/ui/swift-ui";
import { font, foregroundStyle } from "@expo/ui/swift-ui/modifiers";

const subtitle = [
  font({ textStyle: "subheadline" }),
  foregroundStyle({ type: "hierarchical", style: "secondary" }),
];

/**
 * `@expo/ui`'s list row, with its second line as iOS writes a subtitle: subheadline, in the secondary colour. Its own
 * reaches the device in the title's size and colour, which runs a row's two lines together.
 */
export function ListItem({ supportingText, ...props }: ListItemProps) {
  return (
    <UniversalListItem
      {...props}
      supportingText={
        typeof supportingText === "string" ? (
          <Text modifiers={subtitle}>{supportingText}</Text>
        ) : (
          supportingText
        )
      }
    />
  );
}
