import { LegendMarkView, type LegendMarkProps } from "@/components/legend-mark-view";

export type { LegendMarkProps } from "@/components/legend-mark-view";

/**
 * A severity's or a status's mark at a legend row's leading edge (`LegendMarkView`). iOS hosts a row's edges as React
 * Native views by itself; Android's rows are Compose, so its version hosts the view (`legend-mark.android.tsx`).
 */
export function LegendMark(props: LegendMarkProps) {
  return <LegendMarkView {...props} />;
}
