import { useLocalSearchParams } from "expo-router";
import { parseIncidentNumber } from "@/screens/incident";
import { WhyPagedScreen } from "@/screens/why-paged";

/** `/incidents/12/why?member=<member id>`: the dashboard's `/incidents/12?why=<member id>` (RFC 0006). */
export default function WhyPagedRoute() {
  const { number, member } = useLocalSearchParams<{ number: string; member?: string }>();
  return (
    <WhyPagedScreen
      number={parseIncidentNumber(String(number ?? ""))}
      member={typeof member === "string" && member !== "" ? member : null}
    />
  );
}
