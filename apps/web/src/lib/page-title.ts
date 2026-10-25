// The tab title per screen ("Sign in · Brigade"), so a screen reader announces where a navigation landed and the
// tab says which screen it holds. Worded at render, so a language switch retitles the tab too.
import { m } from "@freecorps/brigade-i18n";
import { useEffect } from "react";

/** "Sign in · Brigade"; just "Brigade" without a page. */
export function pageTitle(page?: string): string {
  return page ? m.page_title({ page }) : m.app_name();
}

export function usePageTitle(page?: string): void {
  const title = pageTitle(page);
  useEffect(() => {
    document.title = title;
  }, [title]);
}
