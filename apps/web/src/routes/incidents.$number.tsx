import { createFileRoute } from "@tanstack/react-router";
import { IncidentPage, parseIncidentNumber } from "@/components/incident-detail";
import { RequireWorkspace } from "@/components/session";

/** One incident, by its number in the workspace: `/incidents/12` is INC-12. */
export const Route = createFileRoute("/incidents/$number")({
  component: IncidentRoute,
  // `?why=<member id>`: why that member was or was not paged (RFC 0006 "Delivery receipts").
  validateSearch: (search: Record<string, unknown>): { why?: string } =>
    typeof search.why === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(search.why)
      ? { why: search.why }
      : {},
});

function IncidentRoute() {
  const { number } = Route.useParams();
  const { why } = Route.useSearch();
  return (
    <RequireWorkspace>
      <IncidentPage number={parseIncidentNumber(number)} why={why} />
    </RequireWorkspace>
  );
}
