import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/app-shell";
import { MaintenanceCard } from "@/components/maintenance-card";
import { StatusDomainCard } from "@/components/status-domain-card";
import { StatusPageCard } from "@/components/status-page-card";
import { usePreferences } from "@/components/preferences";
import { RequireWorkspace } from "@/components/session";
import { sectionLabel } from "@/lib/navigation";
import { usePageTitle } from "@/lib/page-title";

/** The public status page, its custom domain and planned maintenance: `/status-page`. */
export const Route = createFileRoute("/status-page")({
  component: SectionRoute,
  staticData: { section: "status_page" },
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
  usePageTitle(sectionLabel("status_page"));
  return (
    <Page>
      <StatusPageCard />
      <StatusDomainCard />
      <MaintenanceCard />
    </Page>
  );
}
