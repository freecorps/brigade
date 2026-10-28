import { m } from "@freecorps/brigade-i18n";
import { createRootRoute, Outlet, useMatches, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { PlainFrame } from "@/components/app-shell";
import { usePreferences } from "@/components/preferences";

export const Route = createRootRoute({ component: RootLayout });

function RootLayout() {
  // Read only to re-render on a locale change, which rewords the skip link.
  usePreferences();
  // Dashboard sections frame themselves (RequireWorkspace: the app shell once there is a workspace, the plain header
  // until then); every other page gets the plain header here.
  const dashboard = useMatches({ select: (matches) => matches.some((m) => m.staticData.section) });
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
    const main = document.getElementById("main");
    // On wide screens the dashboard's sheet scrolls, not the window: a new screen starts at its top. A link to a
    // part of the page (`/on-call#schedule-…`) is left to the router, which scrolls to it.
    if (!window.location.hash) main?.scrollTo({ top: 0 });
    if (acted.current) main?.focus({ preventScroll: true });
  }, [pathname]);
  return (
    <>
      <a
        href="#main"
        className="sr-only rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:ring-3 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
      >
        {m.skip_to_content()}
      </a>
      {/* Not keyed on the locale: a remount would drop live state (refused-change notices, the declare
          text, changes in flight). Every message is worded at render, and a locale change re-renders every
          `usePreferences` reader and what it renders; each route component reads it for that reason. */}
      {dashboard ? (
        <Outlet />
      ) : (
        <PlainFrame>
          <Outlet />
        </PlainFrame>
      )}
    </>
  );
}
