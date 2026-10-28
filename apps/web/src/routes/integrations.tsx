import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/app-shell";
import { ApiTokensCard } from "@/components/api-tokens-card";
import { SlackCard } from "@/components/slack-card";
import { WebhooksCard } from "@/components/webhooks-card";
import { usePreferences } from "@/components/preferences";
import { RequireWorkspace } from "@/components/session";
import { sectionLabel } from "@/lib/navigation";
import { usePageTitle } from "@/lib/page-title";

/** Slack, outgoing webhooks and API tokens: `/integrations`. */
export const Route = createFileRoute("/integrations")({
  component: SectionRoute,
  staticData: { section: "integrations" },
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
  usePageTitle(sectionLabel("integrations"));
  return (
    <Page>
      <SlackCard />
      <WebhooksCard />
      <ApiTokensCard />
    </Page>
  );
}
