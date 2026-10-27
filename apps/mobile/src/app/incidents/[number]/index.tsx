import { useLocalSearchParams } from "expo-router";
import { IncidentScreen, parseIncidentNumber } from "@/screens/incident";

export default function IncidentRoute() {
  const { number } = useLocalSearchParams<{ number: string }>();
  return <IncidentScreen number={parseIncidentNumber(String(number ?? ""))} />;
}
