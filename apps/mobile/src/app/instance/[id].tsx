import { useLocalSearchParams } from "expo-router";
import { InstanceDetails } from "@/screens/instance-details";

export default function InstanceRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <InstanceDetails id={typeof id === "string" ? id : ""} />;
}
