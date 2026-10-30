import { RNHostView } from "@expo/ui";
import { LegendMarkView, type LegendMarkProps } from "@/components/legend-mark-view";

/** A legend row's mark at a Compose row's leading edge: the React Native mark, hosted. */
export function LegendMark(props: LegendMarkProps) {
  return (
    <RNHostView matchContents>
      <LegendMarkView {...props} />
    </RNHostView>
  );
}
