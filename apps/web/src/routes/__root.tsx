import { m } from "@freecorps/brigade-i18n";
import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { usePreferences } from "@/components/preferences";
import { SiteHeader } from "@/components/site-header";

export const Route = createRootRoute({ component: RootLayout });

function RootLayout() {
  // Read only to re-render on a locale change, which rewords the skip link.
  usePreferences();
  const main = useRef<HTMLElement>(null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const shown = useRef(pathname);
  // Whether the user has done anything yet: a redirect on first load (signed out at `/` → `/sign-in`) changes the
  // path too, and must not move focus past the skip link.
  const acted = useRef(false);
  useEffect(() => {
    const act = () => {
      acted.current = true;
    };
    window.addEventListener("pointerdown", act, { once: true, capture: true });
    window.addEventListener("keydown", act, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", act, { capture: true });
      window.removeEventListener("keydown", act, { capture: true });
    };
  }, []);
  useEffect(() => {
    // After a client-side navigation, start from the new screen, as a page load would: focus lands on <main>
    // (screen readers read on from there, with the new tab title), not on the link or button that left the last one.
    if (shown.current === pathname) return;
    shown.current = pathname;
    if (acted.current) main.current?.focus({ preventScroll: true });
  }, [pathname]);
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
      <main ref={main} id="main" tabIndex={-1} className="outline-none">
        <Outlet />
      </main>
    </>
  );
}
