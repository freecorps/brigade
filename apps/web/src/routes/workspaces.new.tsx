import { createFileRoute, Navigate } from "@tanstack/react-router";
import { CreateWorkspace, Loading } from "@/components/session";
import { authClient } from "@/lib/auth";

/** New workspace, from the header's switcher: the user owns it, and it becomes the active one. */
export const Route = createFileRoute("/workspaces/new")({ component: NewWorkspace });

function NewWorkspace() {
  const session = authClient.useSession();
  if (session.isPending) return <Loading />;
  if (!session.data) return <Navigate to="/sign-in" replace />;
  return <CreateWorkspace another />;
}
