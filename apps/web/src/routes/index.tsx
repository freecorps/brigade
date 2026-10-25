import { m } from "@freecorps/brigade-i18n";
import { createFileRoute } from "@tanstack/react-router";
import { IncidentsCard } from "@/components/incidents-card";
import { LegendCard } from "@/components/legend-card";
import { MonitorsCard } from "@/components/monitors-card";
import { usePreferences } from "@/components/preferences";
import { RequireWorkspace } from "@/components/session";
import { StackCard } from "@/components/stack-card";
import { usePageTitle } from "@/lib/page-title";

export const Route = createFileRoute("/")({ component: Dashboard });

/** Signed-in members only: the gate sends everyone else to sign in (or to create their workspace). */
function Dashboard() {
  return (
    <RequireWorkspace>
      <Overview />
    </RequireWorkspace>
  );
}

function Overview() {
  // Read so a language switch re-renders the page (and its cards) in place: the router memoizes route
  // components, and the root no longer remounts them on a locale change.
  usePreferences();
  usePageTitle(m.overview_title());
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{m.overview_title()}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{m.overview_description()}</p>
      </div>
      <IncidentsCard />
      <MonitorsCard />
      <StackCard />
      <LegendCard />
    </div>
  );
}
