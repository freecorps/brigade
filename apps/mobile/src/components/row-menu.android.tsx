import { DropdownMenu, DropdownMenuItem, Text } from "@expo/ui/jetpack-compose";
import { combinedClickable } from "@expo/ui/jetpack-compose/modifiers";
import type { ModifierConfig } from "@expo/ui/jetpack-compose/modifiers";
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { Appearance } from "react-native";
import { themeFor } from "@/lib/theme";
import type { MenuState, RowAction } from "./row-menu";

export type { MenuState, RowAction } from "./row-menu";

type Row = { onPress?: () => void; trailing?: ReactNode; modifiers?: ModifierConfig[] };

/**
 * The row's actions as Material's dropdown menu on a long press, anchored at the row's trailing content. The tap
 * and the long press share one `combinedClickable`, so the ripple covers both.
 */
export function withRowMenu<P extends Row>(
  row: ReactElement<P>,
  actions: RowAction[],
  menu: MenuState,
) {
  if (actions.length === 0) return row;
  // A function, not a component, so no hook: the theme for the scheme now (the list re-renders when it flips).
  const destructive = themeFor(Appearance.getColorScheme()).destructive;
  const { onPress, trailing, modifiers = [] } = row.props;
  return cloneElement(row, {
    onPress: undefined,
    modifiers: [
      combinedClickable({ onClick: onPress, onLongClick: () => menu.setOpen(true) }),
      ...modifiers,
    ],
    trailing: (
      <DropdownMenu expanded={menu.open} onDismissRequest={() => menu.setOpen(false)}>
        <DropdownMenu.Trigger>{trailing}</DropdownMenu.Trigger>
        <DropdownMenu.Items>
          {actions.map((action, index) => (
            <DropdownMenuItem
              // Two links to one host read the same: the position tells them apart.
              key={index}
              enabled={!action.disabled}
              onClick={() => {
                menu.setOpen(false);
                action.onPress();
              }}
            >
              <DropdownMenuItem.Text>
                <Text color={action.destructive ? destructive : undefined}>{action.label}</Text>
              </DropdownMenuItem.Text>
            </DropdownMenuItem>
          ))}
        </DropdownMenu.Items>
      </DropdownMenu>
    ),
  } as Partial<P>);
}
