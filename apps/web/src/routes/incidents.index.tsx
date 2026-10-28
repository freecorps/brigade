import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/app-shell";
import { IncidentsCard } from "@/components/incidents-card";
import { usePreferences } from "@/components/preferences";
import { RequireWorkspace } from "@/components/session";
import { sectionLabel } from "@/lib/navigation";
import { usePageTitle } from "@/lib/page-title";

/** The workspace's open incidents, with declare: `/incidents`. */
export const Route = createFileRoute("/incidents/")({
  component: SectionRoute,
  staticData: { section: "incidents" },
});

function SectionRoute() {
  return (
    <RequireWorkspace>
      <Section />
    </RequireWorkspace>
  );
}

function Section() {
  // Read so a language switch rewords the page in place (the router memoizes route components).
  usePreferences();
  usePageTitle(sectionLabel("incidents"));
  return (
    <Page>
      <IncidentsCard />
    </Page>
  );
}
