import { useLocalSearchParams } from "expo-router";
import { parseIncidentNumber } from "@/screens/incident";
import { UpdateSheet } from "@/screens/update";

/** `/incidents/12/update` writes an update; `?entry=<id>` edits that one. A repeated param is no update. */
export default function UpdateRoute() {
  const { number, entry } = useLocalSearchParams<{ number: string; entry?: string }>();
  return (
    <UpdateSheet
      number={parseIncidentNumber(String(number ?? ""))}
      entryId={typeof entry === "string" && entry !== "" ? entry : undefined}
    />
  );
}
