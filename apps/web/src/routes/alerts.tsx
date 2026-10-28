import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/app-shell";
import { AlertsCard } from "@/components/alerts-card";
import { usePreferences } from "@/components/preferences";
import { RequireWorkspace } from "@/components/session";
import { sectionLabel } from "@/lib/navigation";
import { usePageTitle } from "@/lib/page-title";

/** Alert sources and how their alerts become incidents: `/alerts`. */
export const Route = createFileRoute("/alerts")({
  component: SectionRoute,
  staticData: { section: "alerts" },
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
  usePageTitle(sectionLabel("alerts"));
  return (
    <Page>
      <AlertsCard />
    </Page>
  );
}
