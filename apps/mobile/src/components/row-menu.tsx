import type { ReactElement } from "react";

export type RowAction = {
  label: string;
  disabled?: boolean;
  /** Removes something (an update): in the system's destructive red, as each platform marks one. */
  destructive?: boolean;
  onPress: () => void;
};

/** Which row's menu is open, kept by the list: a menu is part of its row, not a component of its own. */
export type MenuState = { open: boolean; setOpen: (open: boolean) => void };

/**
 * A list row (an `@expo/ui` `ListItem` element) with its actions behind a long press. Returns the row itself, so the
 * grouped list still sees a `ListItem` and styles it as one. The web preview has no menu: the row is unchanged.
 */
export function withRowMenu<P>(row: ReactElement<P>, _actions: RowAction[], _menu: MenuState) {
  return row;
}
