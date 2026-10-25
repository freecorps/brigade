import { Redirect } from "expo-router";
import { CallDiagnostics } from "@/screens/call-diagnostics";

// A development aid for spike S6 (docs/spikes/s6-voip-call-screen.md): how a page would reach this phone, and a
// test call through the same native path a push takes. Release builds do not show it.
export default function CallTestRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <CallDiagnostics />;
}
