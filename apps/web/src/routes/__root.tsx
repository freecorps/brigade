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
      {/* Keyed on the locale so every message re-renders in the new language (packages/i18n README).
          The header stays mounted, so focus returns to the language menu after a switch. */}
      <main id="main" key={locale} tabIndex={-1} className="outline-none">
        <Outlet />
      </main>
    </>
  );
}
