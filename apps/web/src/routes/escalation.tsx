import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/app-shell";
import { EscalationCard } from "@/components/escalation-card";
import { usePreferences } from "@/components/preferences";
import { RequireWorkspace } from "@/components/session";
import { sectionLabel } from "@/lib/navigation";
import { usePageTitle } from "@/lib/page-title";

/** Escalation policies, who is paged and in what order: `/escalation`. */
export const Route = createFileRoute("/escalation")({
  component: SectionRoute,
  staticData: { section: "escalation" },
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
  usePageTitle(sectionLabel("escalation"));
  return (
    <Page>
      <EscalationCard />
    </Page>
  );
}
