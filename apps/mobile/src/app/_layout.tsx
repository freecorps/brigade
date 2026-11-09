import { getLocale, m, setLocale } from "@freecorps/brigade-i18n";
import { fontWeight } from "@freecorps/brigade-ui";
import { useCalendars, useLocales } from "expo-localization";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect, useMemo } from "react";
import { Session, useSessionView } from "@/components/session";
import { useAnsweredCallScreen, useIncomingCalls } from "@/hooks/use-incoming-calls";
import { usePageActions } from "@/hooks/use-page-actions";
import { usePageTaps } from "@/hooks/use-page-taps";
import { LocaleContext } from "@/hooks/use-locale";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useTheme } from "@/hooks/use-theme";
import { pickLocale } from "@/lib/locale";
import { useSystemColors } from "@/theme/system-colors";

// An incident opened from a page or a link lands above the tabs, so Back goes to the list rather than out of the app.
export const unstable_settings = { anchor: "(tabs)" };

// The launch screen stays up while the session is first read (LaunchSplash), so a signed-in cold start goes straight
// to the tabs instead of passing through sign-in's loading state.
void SplashScreen.preventAutoHideAsync().catch(() => {});
/** At most this long: a read that hangs shows sign-in's own loading state rather than a frozen launch screen. */
const SPLASH_HOLD_MS = 3000;

/**
 * A form sheet with its grabber; on Android with Material's rounded top corners (28 dp), which the system's sheet
 * otherwise draws square.
 */
const SHEET = {
  presentation: "formSheet",
  sheetGrabberVisible: true,
  ...(process.env.EXPO_OS === "android" ? { sheetCornerRadius: 28 } : {}),
} as const;

const ios = process.env.EXPO_OS === "ios";

export default function RootLayout() {
  const colors = useTheme();
  const system = useSystemColors();
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
          <>
            <LaunchSplash />
            <PageTaps />
            <AnsweredCall />
            <Stack
              key={locale}
              screenOptions={{
                // iOS: the system's own bar, which follows light and dark, and the theme's foreground for the title. A
                // UIKit semantic colour passed here is resolved once, so the header stayed light in dark mode; the
                // title, left without a colour, would take the tint.
                ...(ios ? {} : { headerStyle: { backgroundColor: system.ground as string } }),
                headerTitleStyle: {
                  color: ios ? colors.foreground : (system.label as string),
                  fontWeight: fontWeight.semibold,
                },
                headerTintColor: system.tint as string,
                headerShadowVisible: false,
                contentStyle: { backgroundColor: system.ground },
                // Reduced motion: no sliding, a short fade instead (packages/ui, Motion).
                animation: reducedMotion ? "fade" : "default",
              }}
            >
              {/* The member's workspace: only with a session, an active workspace and its socket. Each guard names
                where a screen it hides goes. Left out, Expo Router picks the first screen not hidden in its own sort
                (groups and index, then the shortest name): signed out that was `scan`, so a cold start, signed out
                until the session was read, opened the scanner and stayed there (RFC 0015, section 5). */}
              <Stack.Protected guard={signedIn} redirectTo="/sign-in">
                {/* The sections, in the system tab bar; each tab draws its own header. */}
                <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "" }} />
                <Stack.Screen name="incidents/[number]/index" options={{ title: "" }} />
                <Stack.Screen name="incidents/[number]/why" options={{ title: "" }} />
                <Stack.Screen
                  name="incidents/[number]/update"
                  options={{
                    title: m.incident_page({ part: "update_label" }),
                    ...SHEET,
                    sheetAllowedDetents: [0.6, 1],
                  }}
                />
                <Stack.Screen name="incidents/by-id/[id]" options={{ title: "" }} />
                <Stack.Screen name="incidents/past" options={{ title: m.incidents_past_title() }} />
                <Stack.Screen name="push" options={{ title: m.push_title() }} />
                <Stack.Screen name="call-test" options={{ title: m.call_test_title() }} />
                <Stack.Screen
                  name="call"
                  // The call ends with Hang up, not a swipe back.
                  options={{
                    title: m.call_title(),
                    gestureEnabled: false,
                    headerBackVisible: false,
                  }}
                />
                <Stack.Screen
                  name="declare"
                  options={{
                    title: m.declare_heading(),
                    ...SHEET,
                    sheetAllowedDetents: [0.75, 1],
                  }}
                />
                <Stack.Screen name="legend" options={{ title: m.legend_title() }} />
                <Stack.Screen name="intl" options={{ title: m.intl_title() }} />
                <Stack.Screen
                  name="new-workspace"
                  options={{
                    title: m.account_flow({ part: "new_title", name: "" }),
                    ...SHEET,
                    sheetAllowedDetents: [0.6, 1],
                  }}
                />
              </Stack.Protected>
              {/* Signing in, and every state before a member is ready (loading, no workspace, offline), and signing
                up; once the member is ready, the tabs. */}
              <Stack.Protected guard={!signedIn} redirectTo="/">
                {/* No header: the form heads itself with the app's icon and its title (NativeForm's `brand`), and
                  has nothing to go back to. */}
                <Stack.Screen
                  name="sign-in"
                  options={{ title: m.auth_sign_in_title(), headerShown: false }}
                />
                <Stack.Screen name="sign-up" options={{ title: m.auth_sign_up_title() }} />
              </Stack.Protected>
              {/* Instances (RFC 0015): open signed in or not, from the sign-in screen, the account section or a
                dashboard link (`brigade://connect`), and kept open while the instance shown changes under them. Never
                where a guard sends a screen: both guards above name theirs. */}
              <Stack.Screen
                name="add-instance"
                options={{
                  title: m.mobile_instances({ part: "add_title", host: "", name: "" }),
                  ...SHEET,
                  sheetAllowedDetents: [0.75, 1],
                }}
              />
              <Stack.Screen
                name="connect"
                options={{
                  title: m.mobile_instances({ part: "add_title", host: "", name: "" }),
                  ...SHEET,
                  sheetAllowedDetents: [0.75, 1],
                }}
              />
              <Stack.Screen
                name="scan"
                options={{
                  title: m.mobile_instances({ part: "scan", host: "", name: "" }),
                  presentation: "fullScreenModal",
                  headerShown: true,
                }}
              />
              <Stack.Screen
                name="instance/[id]"
                options={{ title: "", ...SHEET, sheetAllowedDetents: [0.75, 1] }}
              />
            </Stack>
          </>
        )}
      </Session>
    </LocaleContext>
  );
}

/** Hides the launch screen once the session is first known, or after SPLASH_HOLD_MS; later reads leave it hidden. */
function LaunchSplash() {
  const loading = useSessionView().kind === "loading";
  useEffect(() => {
    if (!loading) {
      SplashScreen.hide();
      return;
    }
    const timer = setTimeout(() => SplashScreen.hide(), SPLASH_HOLD_MS);
    return () => clearTimeout(timer);
  }, [loading]);
  return null;
}

/** Under the session, which it reads: a tapped page opens its incident in its workspace (Android). */
function PageTaps() {
  usePageTaps();
  return null;
}

/**
 * Above the session, so a call answered while it is read or switched is still heard, and once only: the call's
 * native events reach the call session.
 */
function IncomingCalls() {
  useIncomingCalls();
  return null;
}

/** Under the session, which it reads: an answered call opens its screen once a member is ready (a cold start). */
function AnsweredCall() {
  useAnsweredCallScreen();
  return null;
}
