import { m } from "@freecorps/brigade-i18n";
import { TabStack } from "@/components/tab-stack";

/** The Account tab: the member, their workspaces, this phone's pages. */
export default function Layout() {
  return <TabStack name="account" title={m.mobile_session({ part: "account" })} />;
}
