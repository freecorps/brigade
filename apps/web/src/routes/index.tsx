import { m } from "@freecorps/brigade-i18n";
import { createFileRoute } from "@tanstack/react-router";
import { EscalationCard } from "@/components/escalation-card";
import { ExportCard } from "@/components/export-card";
import { OpenFollowUpsCard } from "@/components/follow-ups-card";
import { IncidentSettingsCard } from "@/components/incident-settings-card";
import { IncidentsCard } from "@/components/incidents-card";
import { LegendCard } from "@/components/legend-card";
import { MembersCard } from "@/components/members-card";
import { MonitorsCard } from "@/components/monitors-card";
import { OnCallCard } from "@/components/oncall-card";
import { PagingHealthNotice } from "@/components/paging-health";
import { ServicesCard } from "@/components/services-card";
import { usePreferences } from "@/components/preferences";
import { RequireWorkspace } from "@/components/session";
import { SlackCard } from "@/components/slack-card";
import { StatusPageCard } from "@/components/status-page-card";
import { StackCard } from "@/components/stack-card";
import { WebhooksCard } from "@/components/webhooks-card";
import { TakeoverNotice } from "@/components/takeover-notice";
import { VerifyNotice } from "@/components/verify-notice";
import { authClient } from "@/lib/auth";
import { ENVIRONMENT } from "@/lib/environment";
import { usePageTitle } from "@/lib/page-title";

export const Route = createFileRoute("/")({ component: Dashboard });

/** Signed-in members only: the gate sends everyone else to sign in (or to create their workspace). */
function Dashboard() {
  return (
    <RequireWorkspace>
      <Overview />
    </RequireWorkspace>
  );
}

function Overview() {
  // Read so a language switch re-renders the page (and its cards) in place: the router memoizes route
  // components, and the root no longer remounts them on a locale change.
  usePreferences();
  usePageTitle(m.overview_title());
  const session = authClient.useSession();
  const user = session.data?.user;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{m.overview_title()}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          {m.environment({ env: ENVIRONMENT, part: "overview" })}
        </p>
      </div>
      <PagingHealthNotice />
      {user ? <VerifyNotice email={user.email} verified={user.emailVerified} /> : null}
      {user ? <TakeoverNotice key={user.id} /> : null}
      <IncidentsCard />
      <OpenFollowUpsCard />
      <OnCallCard />
      <EscalationCard />
      <MonitorsCard />
      <ServicesCard />
      <IncidentSettingsCard />
      <MembersCard />
      <StatusPageCard />
      <SlackCard />
      <WebhooksCard />
      <ExportCard />
      <StackCard />
      <LegendCard />
    </div>
  );
}
