import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/app-shell";
import { MonitorsCard } from "@/components/monitors-card";
import { usePreferences } from "@/components/preferences";
import { RequireWorkspace } from "@/components/session";
import { sectionLabel } from "@/lib/navigation";
import { usePageTitle } from "@/lib/page-title";

/** The workspace's uptime monitors: `/monitors`. */
export const Route = createFileRoute("/monitors")({
  component: SectionRoute,
  staticData: { section: "monitors" },
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
  usePageTitle(sectionLabel("monitors"));
  return (
    <Page>
      <MonitorsCard />
    </Page>
  );
}
