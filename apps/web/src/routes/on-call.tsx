import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/app-shell";
import { OnCallCard } from "@/components/oncall-card";
import { OnCallGapsNotice } from "@/components/oncall-gaps";
import { usePreferences } from "@/components/preferences";
import { RequireWorkspace } from "@/components/session";
import { sectionLabel } from "@/lib/navigation";
import { usePageTitle } from "@/lib/page-title";

/** Who is on call, the schedules and their overrides, and any layer with nobody in it: `/on-call`. */
export const Route = createFileRoute("/on-call")({
  component: SectionRoute,
  staticData: { section: "on_call" },
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
  usePageTitle(sectionLabel("on_call"));
  return (
    <Page>
      <OnCallGapsNotice />
      <OnCallCard />
    </Page>
  );
}
