// The app's own rule for a refused declare; the rest of the incident logic is shared with the dashboard
// (`@freecorps/brigade-sync` and `@freecorps/brigade-i18n/incident`, issue #20).
import type { Notice } from "@freecorps/brigade-i18n/incident";

/**
 * The title to give back to the form after a refusal: a declare refused for its title (not the device clock),
 * and only while the field is still empty, so nothing typed since is lost.
 */
export function titleToRestore(notice: Notice, field: string): string | undefined {
  const forTitle = notice.kind === "declare" && notice.reason === "invalid_args";
  return forTitle && field === "" ? notice.title : undefined;
}
