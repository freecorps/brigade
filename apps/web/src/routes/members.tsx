import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/app-shell";
import { MembersCard } from "@/components/members-card";
import { usePreferences } from "@/components/preferences";
import { RequireWorkspace } from "@/components/session";
import { sectionLabel } from "@/lib/navigation";
import { usePageTitle } from "@/lib/page-title";

/** The workspace's members and invitations: `/members`. */
export const Route = createFileRoute("/members")({
  component: SectionRoute,
  staticData: { section: "members" },
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
  usePageTitle(sectionLabel("members"));
  return (
    <Page>
      <MembersCard />
    </Page>
  );
}
