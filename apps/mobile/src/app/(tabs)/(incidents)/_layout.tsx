import { m } from "@freecorps/brigade-i18n";
import { TabStack } from "@/components/tab-stack";

/** The Incidents tab: the workspace's active incidents. */
export default function Layout() {
  return <TabStack name="index" title={m.incidents_title()} />;
}
