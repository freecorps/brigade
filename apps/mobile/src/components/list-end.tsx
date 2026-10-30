import type { ReactNode } from "react";

/**
 * The end of a screen's grouped list. iOS insets a list above the home indicator by itself; Android draws edge to
 * edge, so its list ends with room for the navigation bar (`list-end.android.tsx`). An element, not a component:
 * `FieldGroup` takes any child but its own sections for a row.
 */
export function useListEnd(extra = 0): ReactNode {
  void extra;
  return null;
}
