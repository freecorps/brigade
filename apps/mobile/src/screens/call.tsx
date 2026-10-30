import { m } from "@freecorps/brigade-i18n";
import { radius, spacing } from "@freecorps/brigade-ui";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { BackHandler, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/themed-text";
import { useScreenPadding } from "@/hooks/use-screen-padding";
import { useTheme } from "@/hooks/use-theme";
import { useSystemColors } from "@/theme/system-colors";
import { callSession } from "@/lib/call";
import { callStatus } from "@/lib/call-session";

/**
 * The answered call (spike S6): the incident being read aloud, Acknowledge (or 1 on CallKit's keypad, or on a hardware
 * keyboard on Android) and Hang up.
 */
export function CallScreen() {
  const colors = useTheme();
  const system = useSystemColors();
  const padding = useScreenPadding();
  const { bottom } = useSafeAreaInsets();
  const router = useRouter();
  const state = useSyncExternalStore(callSession.subscribe, callSession.getState);

  // A hardware keyboard's 1 acknowledges only while this screen is the one in front (CallSession.keyPressed).
  useFocusEffect(
    useCallback(() => {
      callSession.focused(true);
      return () => callSession.focused(false);
    }, []),
  );

  // On a locked Android phone this screen is shown over the keyguard: Back must not lead into the rest of the
  // app while the call lasts.
  useEffect(() => {
    if (!state || state.ended) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, [state]);

  if (!state) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: system.ground }}
        contentContainerStyle={padding}
      >
        <ThemedText>{m.call_ended()}</ThemedText>
      </ScrollView>
    );
  }

  const { call, ack, ended } = state;
  const canAck = !ended && (ack.kind === "idle" || ack.kind === "failed");
  const status = callStatus(state);

  // The incident scrolls under iOS's header (it sat behind the bar); the actions stay at the bottom, above the home
  // indicator or the navigation bar, however long the incident's title.
  return (
    <View style={{ flex: 1, backgroundColor: system.ground }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[padding, { gap: spacing[6] }]}
      >
        <View style={{ gap: spacing[2] }}>
          <ThemedText variant="label">{m.call_ringing()}</ThemedText>
          <ThemedText variant="heading" accessibilityRole="header">
            {call.title}
          </ThemedText>
          <ThemedText>{call.body}</ThemedText>
        </View>
        <ThemedText
          variant="caption"
          accessibilityLiveRegion="polite"
          style={ack.kind === "failed" ? { color: system.destructive } : undefined}
        >
          {status}
        </ThemedText>
      </ScrollView>
      <View
        style={{
          gap: spacing[3],
          paddingTop: spacing[3],
          paddingHorizontal: padding.paddingHorizontal,
          paddingBottom: spacing[4] + bottom,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canAck }}
          disabled={!canAck}
          onPress={() => void callSession.acknowledge()}
          style={({ pressed }) => ({
            minHeight: spacing[16],
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: spacing[3],
            borderRadius: radius.xl,
            borderCurve: "continuous",
            backgroundColor: colors.primary,
            opacity: !canAck ? 0.4 : pressed ? 0.8 : 1,
          })}
        >
          <ThemedText variant="heading" style={{ color: colors.primaryForeground }}>
            1
          </ThemedText>
          <ThemedText variant="heading" style={{ color: colors.primaryForeground }}>
            {m.call_ack()}
          </ThemedText>
        </Pressable>
        {process.env.EXPO_OS === "ios" && canAck ? (
          <ThemedText variant="caption" style={{ textAlign: "center" }}>
            {m.call_ack_hint()}
          </ThemedText>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => (ended ? router.back() : callSession.hangUp())}
          style={({ pressed }) => ({
            minHeight: spacing[12],
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radius.xl,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: system.destructive,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <ThemedText style={{ color: system.destructive }}>
            {ended ? m.dismiss() : m.call_hang_up()}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}
