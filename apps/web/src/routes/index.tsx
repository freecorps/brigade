import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/app-shell";
import { OpenFollowUpsCard } from "@/components/follow-ups-card";
import { IncidentsCard } from "@/components/incidents-card";
import { CoverStrip, OnCallNowCard } from "@/components/oncall-cover";
import { AlertsDay, MonitorsGlance, PulseStrip } from "@/components/overview-pulse";
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
 * three figures (open incidents, monitors up, follow-ups), then the open incidents beside who is on call for them, the
 * monitors' recent checks and the day's alerts, the next 24 hours of cover, and the follow-ups left from past
 * incidents. Everything else has its own section in the sidebar.
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
      {/* The three figures first: what is open, what is up, what is left to do. */}
      <PulseStrip />
      {/* Incidents take the width; on call sits beside them from `lg`, under them on smaller screens. */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <IncidentsCard />
        <OnCallNowCard />
      </div>
      {/* The monitors' recent checks beside the day's alerts; each shows only once it has something to show. */}
      <div className="grid items-start gap-6 xl:has-[>:nth-child(2)]:grid-cols-[minmax(0,1fr)_24rem]">
        <MonitorsGlance />
        <AlertsDay />
      </div>
      <CoverStrip />
      <OpenFollowUpsCard />
    </Page>
  );
}
