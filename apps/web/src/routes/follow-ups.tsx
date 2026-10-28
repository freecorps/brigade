import { createFileRoute } from "@tanstack/react-router";
import { OpenFollowUpsPage } from "@/components/follow-ups-card";
import { RequireWorkspace } from "@/components/session";

/** Every open follow-up in the workspace (RFC 0013): `/follow-ups`. */
export const Route = createFileRoute("/follow-ups")({
  component: FollowUpsRoute,
  staticData: { section: "follow_ups", heading: "page" },
});

function FollowUpsRoute() {
  return (
    <RequireWorkspace>
      <OpenFollowUpsPage />
    </RequireWorkspace>
  );
}
