import { Button, ContextMenu } from "@expo/ui/swift-ui";
import { disabled } from "@expo/ui/swift-ui/modifiers";
import type { ReactElement } from "react";
import type { MenuState, RowAction } from "./row-menu";

export type { MenuState, RowAction } from "./row-menu";

/** The row's actions as the system context menu on a long press (SwiftUI's `contextMenu`), with its preview. */
export function withRowMenu<P>(row: ReactElement<P>, actions: RowAction[], _menu: MenuState) {
  if (actions.length === 0) return row;
  return (
    <ContextMenu key={row.key}>
      <ContextMenu.Items>
        {actions.map((action, index) => (
          <Button
            // Two links to one host read the same: the position tells them apart.
            key={index}
            label={action.label}
            onPress={action.onPress}
            modifiers={action.disabled ? [disabled(true)] : undefined}
          />
        ))}
      </ContextMenu.Items>
      <ContextMenu.Trigger>{row}</ContextMenu.Trigger>
    </ContextMenu>
  );
}
