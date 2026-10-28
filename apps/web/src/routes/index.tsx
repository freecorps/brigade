import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/app-shell";
import { OpenFollowUpsCard } from "@/components/follow-ups-card";
import { IncidentsCard } from "@/components/incidents-card";
import { OnCallGapsNotice } from "@/components/oncall-gaps";
import { PagingHealthNotice } from "@/components/paging-health";
import { usePreferences } from "@/components/preferences";
import { RequireWorkspace } from "@/components/session";
import { TakeoverNotice } from "@/components/takeover-notice";
import { VerifyNotice } from "@/components/verify-notice";
import { authClient } from "@/lib/auth";
import { sectionLabel } from "@/lib/navigation";
import { usePageTitle } from "@/lib/page-title";

export const Route = createFileRoute("/")({
  component: Dashboard,
  staticData: { section: "overview" },
});

/** Signed-in members only: the gate sends everyone else to sign in (or to create their workspace). */
function Dashboard() {
  return (
    <RequireWorkspace>
      <Overview />
    </RequireWorkspace>
  );
}

/**
 * What needs someone now: anything wrong with paging or the member's account, schedules with nobody in a layer, the
 * open incidents and the follow-ups left from them. Everything else has its own section in the sidebar.
 */
function Overview() {
  // Read so a language switch re-renders the page (and its cards) in place: the router memoizes route
  // components, and the root no longer remounts them on a locale change.
  usePreferences();
  usePageTitle(sectionLabel("overview"));
  const session = authClient.useSession();
  const user = session.data?.user;
  return (
    <Page>
      <PagingHealthNotice />
      {user ? <VerifyNotice email={user.email} verified={user.emailVerified} /> : null}
      {user ? <TakeoverNotice key={user.id} /> : null}
      <OnCallGapsNotice />
      <IncidentsCard />
      <OpenFollowUpsCard />
    </Page>
  );
}
