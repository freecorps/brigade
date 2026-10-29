import { useLocalSearchParams } from "expo-router";
import { parseIncidentNumber } from "@/screens/incident";
import { UpdateSheet } from "@/screens/update";

/** `/incidents/12/update` writes an update; `?entry=<id>` edits that one. */
export default function UpdateRoute() {
  const { number, entry } = useLocalSearchParams<{ number: string; entry?: string }>();
  return <UpdateSheet number={parseIncidentNumber(number ?? "")} entryId={entry} />;
}
