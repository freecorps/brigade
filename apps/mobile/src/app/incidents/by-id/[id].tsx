import { useQuery } from "@freecorps/brigade-sync/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

/**
 * An incident by its id, as a page's notification names it (src/hooks/use-page-taps.ts): replaced by the incident's
 * own screen (by number) once the workspace has it, or the incident list when it does not.
 */
export default function IncidentByIdRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { rows, status } = useQuery("incident.byId", { id: String(id ?? "") });
  const row = rows[0];
  useEffect(() => {
    if (row?.number != null) router.replace(`/incidents/${row.number}`);
    else if (status === "ready" || status === "error") router.replace("/");
  }, [row?.number, status, router]);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );
}
