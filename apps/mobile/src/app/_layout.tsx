import { getLocale, m, setLocale } from "@freecorps/brigade-i18n";
import { SyncProvider } from "@freecorps/brigade-sync/react";
import { fontWeight } from "@freecorps/brigade-ui";
import { useCalendars, useLocales } from "expo-localization";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useMemo } from "react";
import { useIncomingCalls } from "@/hooks/use-incoming-calls";
import { LocaleContext } from "@/hooks/use-locale";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useTheme } from "@/hooks/use-theme";
import { pickLocale } from "@/lib/locale";
import { SHARD } from "@/lib/sync";
import { syncClient } from "@/lib/sync-client";

export default function RootLayout() {
  const colors = useTheme();
  const reducedMotion = useReducedMotion();
  const languages = useLocales().map((locale) => locale.languageTag);
  const timeZone = useCalendars()[0]?.timeZone ?? "UTC";
  const locale = pickLocale(languages);

  // packages/i18n keeps the current locale in a module variable and does not re-render; set it before
  // the screens render and key the stack on it (packages/i18n/README.md, "UIs: the current locale").
  if (getLocale() !== locale) void setLocale(locale);
  const value = useMemo(() => ({ locale, timeZone }), [locale, timeZone]);

  // The root view behind screens and the keyboard, so transitions never flash the wrong ground.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background);
  }, [colors.background]);

  return (
    <SyncProvider client={syncClient} shard={SHARD}>
      <LocaleContext value={value}>
        <IncomingCalls />
        <StatusBar style="auto" />
        <Stack
          key={locale}
          screenOptions={{
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.foreground,
            headerTitleStyle: { color: colors.foreground, fontWeight: fontWeight.semibold },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.background },
            // Reduced motion: no sliding, a short fade instead (packages/ui, Motion).
            animation: reducedMotion ? "fade" : "default",
          }}
        >
          <Stack.Screen name="index" options={{ title: m.incidents_title() }} />
          <Stack.Screen name="legend" options={{ title: m.legend_title() }} />
          <Stack.Screen name="intl" options={{ title: m.intl_title() }} />
          <Stack.Screen name="push" options={{ title: m.push_title() }} />
          <Stack.Screen name="call-test" options={{ title: m.call_test_title() }} />
          <Stack.Screen
            name="call"
            // The call ends with Hang up, not a swipe back.
            options={{ title: m.call_title(), gestureEnabled: false, headerBackVisible: false }}
          />
        </Stack>
      </LocaleContext>
    </SyncProvider>
  );
}

/** Needs the router, so it renders inside the layout rather than running in it. */
function IncomingCalls() {
  useIncomingCalls();
  return null;
}
