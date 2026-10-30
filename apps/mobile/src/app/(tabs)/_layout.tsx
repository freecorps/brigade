import { m } from "@freecorps/brigade-i18n";
import { NativeTabs } from "expo-router/native-tabs";
import { useSystemColors } from "@/theme/system-colors";

/**
 * The signed-in app's sections as the system's own tab bar: UITabBarController on iOS (liquid glass on iOS 26),
 * Material 3's navigation bar on Android. Each tab keeps its own stack; incidents, calls and sheets open above the
 * tabs from the root stack, so a page opens its incident whichever tab is showing.
 */
export default function TabsLayout() {
  const system = useSystemColors();
  return (
    <NativeTabs
      tintColor={system.tint}
      backgroundColor={system.bar}
      indicatorColor={system.indicator}
    >
      <NativeTabs.Trigger name="(incidents)">
        <NativeTabs.Trigger.Label>{m.nav({ part: "incidents" })}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="flame" md="local_fire_department" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(oncall)">
        <NativeTabs.Trigger.Label>{m.nav({ part: "on_call" })}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar.badge.clock" md="calendar_clock" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(account)">
        <NativeTabs.Trigger.Label>{m.mobile_session({ part: "account" })}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle" md="account_circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
