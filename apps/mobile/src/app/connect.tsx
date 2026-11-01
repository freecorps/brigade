import { useLocalSearchParams } from "expo-router";
import { connectParams } from "@/lib/connect-link";
import { Connect } from "@/screens/connect";

/** `brigade://connect?server=…[&code=…]`: the dashboard's link or QR, from the system camera or the in-app scanner. */
export default function ConnectRoute() {
  const { server, code } = useLocalSearchParams();
  const link = connectParams(server, code);
  // Keyed: another link opened over this one starts its own check.
  return <Connect key={link ? `${link.server} ${link.code ?? ""}` : "none"} link={link} />;
}
