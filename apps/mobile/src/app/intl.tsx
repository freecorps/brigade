import { Redirect } from "expo-router";
import { IntlDiagnostics } from "@/screens/intl-diagnostics";

// A development aid for spike S4 (docs/spikes/s4-expo-workspace.md); release builds do not show it.
export default function IntlRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <IntlDiagnostics />;
}
