import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { connectParams, takeScanned } from "@/lib/connect-link";
import { Connect } from "@/screens/connect";

/** `brigade://connect?server=…[&code=…]`: the dashboard's link or QR, from the system camera or the in-app scanner. */
export default function ConnectRoute() {
  const { server, code } = useLocalSearchParams();
  const link = connectParams(server, code);
  const key = link ? `${link.server} ${link.code ?? ""}` : "none";
  // Keyed: another link opened over this one starts its own check.
  return <ConnectOnce key={key} link={link} />;
}

function ConnectOnce({ link }: { link: ReturnType<typeof connectParams> }) {
  // Read once per link: the scanner's mark is spent on it.
  const [trusted] = useState(() => takeScanned(link));
  return <Connect link={link} trusted={trusted} />;
}
