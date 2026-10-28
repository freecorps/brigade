import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/app-shell";
import { ServicesCard } from "@/components/services-card";
import { usePreferences } from "@/components/preferences";
import { RequireWorkspace } from "@/components/session";
import { sectionLabel } from "@/lib/navigation";
import { usePageTitle } from "@/lib/page-title";

/** The service catalog: `/services`; each one opens at `/services/<id>`. */
export const Route = createFileRoute("/services/")({
  component: SectionRoute,
  staticData: { section: "services" },
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
  usePageTitle(sectionLabel("services"));
  return (
    <Page>
      <ServicesCard />
    </Page>
  );
}
