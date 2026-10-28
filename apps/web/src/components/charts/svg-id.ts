import { useId } from "react";

/**
 * A per-instance id that is safe in an SVG `id` and a `url(#…)` reference: React's `useId()` holds characters (`:`,
 * `«»`) that some browsers fail to resolve there.
 */
export function useSvgId(): string {
  return useId().replace(/[^a-zA-Z0-9_-]/g, "");
}
