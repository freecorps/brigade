import { Redirect } from "expo-router";
import { PushDiagnostics } from "@/screens/push-diagnostics";

// A development aid for spike S1 (docs/spikes/s1-apns-encryption.md): the APNs device token and the device public
// key a test push needs. Release builds do not show it.
export default function PushRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <PushDiagnostics />;
}
