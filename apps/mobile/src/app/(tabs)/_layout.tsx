import { m } from "@freecorps/brigade-i18n";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useColorScheme } from "react-native";
import { useTheme } from "@/hooks/use-theme";

/**
 * The signed-in app's sections as the system's own tab bar: UITabBarController on iOS (liquid glass on iOS 26),
 * Material 3's navigation bar on Android. Each tab keeps its own stack; incidents, calls and sheets open above the
 * tabs from the root stack, so a page opens its incident whichever tab is showing.
 */
export default function TabsLayout() {
  // Android's Material colours resolve at render: re-render when the scheme flips.
  useColorScheme();
  const colors = useTheme();
  return (
    <NativeTabs tintColor={colors.primary}>
      <NativeTabs.Trigger name="(incidents)">
        <NativeTabs.Trigger.Label>{m.nav({ part: "incidents" })}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="flame" md="emergency" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(oncall)">
        <NativeTabs.Trigger.Label>{m.nav({ part: "on_call" })}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar.badge.clock" md="calendar_clock" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(account)">
        <NativeTabs.Trigger.Label>{m.nav({ part: "account" })}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle" md="account_circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
