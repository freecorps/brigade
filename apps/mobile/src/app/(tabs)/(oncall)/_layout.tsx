import { m } from "@freecorps/brigade-i18n";
import { TabStack } from "@/components/tab-stack";

/** The On-call tab: who is on call, the member's shifts and overrides. */
export default function Layout() {
  return <TabStack name="oncall" title={m.oncall_title()} />;
}
