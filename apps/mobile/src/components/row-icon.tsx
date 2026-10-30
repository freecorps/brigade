import type { Glyph } from "@/components/glyphs";

export type RowIconProps = {
  glyph: Glyph;
  /** The tile's colour on iOS; with `plain`, the glyph's on both (Android's are otherwise monochrome, as Material's). */
  color?: string;
  /** The glyph alone, without iOS's tile: a list's marks (the timeline) rather than a settings row's. */
  plain?: boolean;
};

/**
 * A row's leading glyph, as each system draws a settings row: a white symbol on a coloured rounded tile on iOS
 * (`row-icon.ios.tsx`), a plain Material Symbol on Android (`row-icon.android.tsx`). The web preview draws none.
 */
export function RowIcon(props: RowIconProps) {
  void props;
  return null;
}
