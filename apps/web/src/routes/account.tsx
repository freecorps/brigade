import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/app-shell";
import { CallsCard } from "@/components/calls-card";
import { DevicesCard } from "@/components/devices-card";
import { EmailCard } from "@/components/email-cards";
import { usePreferences } from "@/components/preferences";
import { RequireWorkspace } from "@/components/session";
import { UseAppCard } from "@/components/use-app-card";
import { sectionLabel } from "@/lib/navigation";
import { usePageTitle } from "@/lib/page-title";

/** The signed-in member'\''s own settings in this workspace: email, which app to use, phones and calls: `/account`. */
export const Route = createFileRoute("/account")({
  component: SectionRoute,
  staticData: { section: "account" },
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
  usePageTitle(sectionLabel("account"));
  return (
    <Page>
      <EmailCard />
      <UseAppCard />
      <DevicesCard />
      <CallsCard />
    </Page>
  );
}
