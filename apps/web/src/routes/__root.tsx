import { m } from "@freecorps/brigade-i18n";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { usePreferences } from "@/components/preferences";
import { SiteHeader } from "@/components/site-header";

export const Route = createRootRoute({ component: RootLayout });

function RootLayout() {
  const { locale } = usePreferences();
  return (
    <>
      <a
        href="#main"
        className="sr-only rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:ring-3 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
      >
        {m.skip_to_content()}
      </a>
      <SiteHeader />
      {/* Not keyed on the locale: a remount would drop live state (refused-change notices, the declare
          text, changes in flight). Every message is worded at render, and a locale change re-renders every
          `usePreferences` reader and what it renders; each route component reads it for that reason. */}
      <main id="main" data-locale={locale} tabIndex={-1} className="outline-none">
        <Outlet />
      </main>
    </>
  );
}
