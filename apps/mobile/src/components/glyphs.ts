import type { IncidentStatus } from "@freecorps/brigade-schema";
import type { SymbolViewProps } from "expo-symbols";

export type Glyph = SymbolViewProps["name"];

// The same shapes as the dashboard's lucide icons (apps/web/src/components/legend-card.tsx), as SF
// Symbols on iOS and Material Symbols on Android and web, so both clients read the same.

/** SEV1 only: an octagon alert, like lucide's OctagonAlert. */
export const SEV1_GLYPH: Glyph = {
  ios: "exclamationmark.octagon.fill",
  android: "report",
  web: "report",
};

/** Each status carries its own glyph, so the name and the shape say it before the colour does. */
export const STATUS_GLYPHS: Record<IncidentStatus, Glyph> = {
  triage: { ios: "circle.dashed", android: "pending", web: "pending" },
  investigating: { ios: "magnifyingglass", android: "search", web: "search" },
  fixing: { ios: "wrench.adjustable", android: "build", web: "build" },
  monitoring: { ios: "eye", android: "visibility", web: "visibility" },
  resolved: { ios: "checkmark.circle", android: "check_circle", web: "check_circle" },
  declined: { ios: "nosign", android: "block", web: "block" },
};

/** The active choice in a list (the account section's workspaces), like lucide's Check. */
export const CHECK_GLYPH: Glyph = { ios: "checkmark", android: "check", web: "check" };
