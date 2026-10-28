import { createFileRoute } from "@tanstack/react-router";
import { parseServiceId, ServicePage } from "@/components/service-detail";
import { RequireWorkspace } from "@/components/session";

/** One service of the catalog, by its id: `/services/svc_…`. */
export const Route = createFileRoute("/services/$id")({
  component: ServiceRoute,
  staticData: { section: "services", heading: "page" },
});

function ServiceRoute() {
  const { id } = Route.useParams();
  return (
    <RequireWorkspace>
      <ServicePage id={parseServiceId(id)} />
    </RequireWorkspace>
  );
}
