import { createFileRoute } from "@tanstack/react-router";
import { IncidentPage, parseIncidentNumber } from "@/components/incident-detail";
import { RequireWorkspace } from "@/components/session";

/** One incident, by its number in the workspace: `/incidents/12` is INC-12. */
export const Route = createFileRoute("/incidents/$number")({ component: IncidentRoute });

function IncidentRoute() {
  const { number } = Route.useParams();
  return (
    <RequireWorkspace>
      <IncidentPage number={parseIncidentNumber(number)} />
    </RequireWorkspace>
  );
}
