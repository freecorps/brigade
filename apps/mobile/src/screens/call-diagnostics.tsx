import { m } from "@freecorps/brigade-i18n";
import { fontFamily, fontSize, radius, spacing } from "@freecorps/brigade-ui";
import { formatIncidentNumber } from "@freecorps/brigade-schema";
import { useQuery } from "@freecorps/brigade-sync/react";
import * as Notifications from "expo-notifications";
import { useEffect, useState } from "react";
import { AppState, Platform, Pressable, ScrollView, Text } from "react-native";
import { Row, Section } from "@/components/section";
import { ThemedText } from "@/components/themed-text";
import { useScreenPadding } from "@/hooks/use-screen-padding";
import { useTheme } from "@/hooks/use-theme";
import { BrigadeCall, type RingStatus } from "../../modules/brigade-call";

const RING_DELAY_MS = 10_000;

const ROUTE_TEXT = {
  ring: m.call_route_ring,
  notify: m.call_route_notify,
  blocked: m.call_route_blocked,
} as const;

export function CallDiagnostics() {
  const colors = useTheme();
  const padding = useScreenPadding();
  const { rows } = useQuery("incidents.active", {});
  const incident = rows.find((row) => row.acknowledgedAt == null) ?? rows[0];
  const [status, setStatus] = useState<RingStatus | null>(null);
  const [voipToken, setVoipToken] = useState<string | null>(null);
  const [ringing, setRinging] = useState(false);

  useEffect(() => {
    const module = BrigadeCall;
    if (!module) return;
    const refresh = () => setStatus(module.getRingStatus());
    void Notifications.requestPermissionsAsync().finally(refresh);
    module
      .getVoipToken()
      .then((token) => {
        setVoipToken(token);
        // Development only: lets a script read the token from the Metro log.
        if (__DEV__ && token) console.log(`[brigade-call] ${JSON.stringify({ voipToken: token })}`);
      })
      .catch(() => setVoipToken(null));
    // Back from the settings screen.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => subscription.remove();
  }, []);

  if (!BrigadeCall) {
    return (
      <ScrollView contentContainerStyle={padding}>
        <ThemedText>{m.push_unavailable()}</ThemedText>
      </ScrollView>
    );
  }
  const module = BrigadeCall;

  const ring = () => {
    if (!incident) return;
    const label = formatIncidentNumber(incident.number) ?? incident.title;
    module.simulateIncomingCall(
      `${incident.severity.toUpperCase()} · ${incident.title}`,
      label,
      incident.id,
      RING_DELAY_MS,
    );
    setRinging(true);
  };

  const mono = {
    fontFamily: Platform.select(fontFamily.native.mono),
    fontSize: fontSize.xs.size,
    lineHeight: fontSize.xs.lineHeight,
    color: colors.mutedForeground,
  };
  const button = ({ pressed }: { pressed: boolean }) => ({
    minHeight: spacing[12],
    justifyContent: "center" as const,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderCurve: "continuous" as const,
    backgroundColor: colors.primary,
    opacity: !incident ? 0.4 : pressed ? 0.8 : 1,
  });

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[padding, { gap: spacing[6] }]}
    >
      <Section title={m.call_test_title()} inset={false}>
        <Row first>
          <ThemedText variant="label">{m.call_route()}</ThemedText>
          <ThemedText>{status ? ROUTE_TEXT[status.route]() : m.push_waiting()}</ThemedText>
        </Row>
        {Platform.OS === "ios" ? (
          <Row>
            <ThemedText variant="label">{m.call_voip_token()}</ThemedText>
            <Text selectable style={mono}>
              {voipToken ?? m.push_waiting()}
            </Text>
          </Row>
        ) : null}
        <Row>
          <ThemedText variant="caption">
            {incident
              ? m.call_test_for({
                  incident: formatIncidentNumber(incident.number) ?? incident.title,
                })
              : m.call_test_no_incident()}
          </ThemedText>
        </Row>
      </Section>
      <Pressable accessibilityRole="button" disabled={!incident} onPress={ring} style={button}>
        <ThemedText style={{ color: colors.primaryForeground }}>{m.call_test_ring()}</ThemedText>
      </Pressable>
      {ringing ? (
        <ThemedText accessibilityLiveRegion="polite">{m.call_test_ringing()}</ThemedText>
      ) : null}
      {Platform.OS === "android" && status && status.fullScreenAllowed === false ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => module.openFullScreenIntentSettings()}
          style={({ pressed }) => ({ ...button({ pressed }), opacity: pressed ? 0.8 : 1 })}
        >
          <ThemedText style={{ color: colors.primaryForeground }}>
            {m.call_allow_full_screen()}
          </ThemedText>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
