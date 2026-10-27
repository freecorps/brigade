import { getLocale, m, setLocale } from "@freecorps/brigade-i18n";
import { fontWeight } from "@freecorps/brigade-ui";
import { useCalendars, useLocales } from "expo-localization";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useMemo } from "react";
import { Session } from "@/components/session";
import { useIncomingCalls } from "@/hooks/use-incoming-calls";
import { usePageActions } from "@/hooks/use-page-actions";
import { LocaleContext } from "@/hooks/use-locale";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useTheme } from "@/hooks/use-theme";
import { pickLocale } from "@/lib/locale";

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
  // Acknowledge on a page's notification, titled in this locale.
  usePageActions(locale);

  // The root view behind screens and the keyboard, so transitions never flash the wrong ground.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background);
  }, [colors.background]);

  return (
    <LocaleContext value={value}>
      <IncomingCalls />
      <StatusBar style="auto" />
      <Session>
        {(signedIn) => (
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
            {/* The member's workspace: only with a session, an active workspace and its socket. */}
            <Stack.Protected guard={signedIn}>
              <Stack.Screen name="index" options={{ title: m.incidents_title() }} />
              <Stack.Screen name="incidents/[number]/index" options={{ title: "" }} />
              <Stack.Screen name="incidents/[number]/why" options={{ title: "" }} />
              <Stack.Screen name="oncall" options={{ title: m.oncall_title() }} />
              <Stack.Screen name="push" options={{ title: m.push_title() }} />
              <Stack.Screen name="call-test" options={{ title: m.call_test_title() }} />
              <Stack.Screen
                name="call"
                // The call ends with Hang up, not a swipe back.
                options={{ title: m.call_title(), gestureEnabled: false, headerBackVisible: false }}
              />
              <Stack.Screen name="legend" options={{ title: m.legend_title() }} />
              <Stack.Screen name="intl" options={{ title: m.intl_title() }} />
              <Stack.Screen
                name="new-workspace"
                options={{
                  title: m.account_flow({ part: "new_title", name: "" }),
                  presentation: "formSheet",
                  sheetAllowedDetents: [0.6, 1],
                  sheetGrabberVisible: true,
                }}
              />
            </Stack.Protected>
            {/* Signing in, and every state before a member is ready (loading, no workspace, offline), and signing
                up: sign-in is first, so a guarded route always lands there. */}
            <Stack.Protected guard={!signedIn}>
              <Stack.Screen name="sign-in" options={{ title: m.auth_sign_in_title() }} />
              <Stack.Screen name="sign-up" options={{ title: m.auth_sign_up_title() }} />
            </Stack.Protected>
          </Stack>
        )}
      </Session>
    </LocaleContext>
  );
}

/** Needs the router, so it renders inside the layout rather than running in it. */
function IncomingCalls() {
  useIncomingCalls();
  return null;
}
