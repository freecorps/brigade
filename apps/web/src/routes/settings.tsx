import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/app-shell";
import { WorkspaceEmailCard } from "@/components/email-cards";
import { ExportCard } from "@/components/export-card";
import { IncidentSettingsCard } from "@/components/incident-settings-card";
import { LegendCard } from "@/components/legend-card";
import { StackCard } from "@/components/stack-card";
import { WorkspaceLanguageCard } from "@/components/workspace-language-card";
import { usePreferences } from "@/components/preferences";
import { RequireWorkspace } from "@/components/session";
import { sectionLabel } from "@/lib/navigation";
import { usePageTitle } from "@/lib/page-title";

/** The workspace's own settings: incident types and fields, email, language, exports, and the stack check: `/settings`. */
export const Route = createFileRoute("/settings")({
  component: SectionRoute,
  staticData: { section: "settings" },
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
  usePageTitle(sectionLabel("settings"));
  return (
    <Page>
      <IncidentSettingsCard />
      <WorkspaceEmailCard />
      <WorkspaceLanguageCard />
      <ExportCard />
      <StackCard />
      <LegendCard />
    </Page>
  );
}
