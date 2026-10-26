// The member's on-call picture, live from the shard (`schedules.all`, `overrides.all`), and the line at the top of
// the incident list that says it and opens the on-call screen.
import { m } from "@freecorps/brigade-i18n";
import { useQuery } from "@freecorps/brigade-sync/react";
import { fontSize, fontWeight, radius, spacing } from "@freecorps/brigade-ui";
import { Link } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useGlyphSize } from "@/components/badge";
import type { Glyph } from "@/components/glyphs";
import { useNow } from "@/components/incident-parts";
import { useMember } from "@/components/session";
import { ThemedText } from "@/components/themed-text";
import { useLocale } from "@/hooks/use-locale";
import { useTheme } from "@/hooks/use-theme";
import { onCallStatus, onCallView, statusTime } from "@/lib/oncall";

const ON_CALL_GLYPH: Glyph = {
  ios: "bell.badge.fill",
  android: "notifications_active",
  web: "notifications_active",
};
const OFF_CALL_GLYPH: Glyph = { ios: "calendar", android: "calendar_today", web: "calendar_today" };
const OPEN_GLYPH: Glyph = { ios: "chevron.right", android: "chevron_right", web: "chevron_right" };

/** The member's shifts, overrides and every schedule's person on call, moving on with the clock. */
export function useOnCall() {
  const { userId } = useMember();
  const schedules = useQuery("schedules.all", {});
  const overrides = useQuery("overrides.all", {});
  const now = useNow(30_000);
  const view = useMemo(
    () => onCallView(schedules.rows, overrides.rows, userId, now),
    [schedules.rows, overrides.rows, userId, now],
  );
  return { view, now, status: schedules.status, error: schedules.error };
}

/**
 * "On call until Tue, 9:00 AM" (or when the next shift is) on the viewer's clock, opening the on-call screen. Loud
 * only while the member is on call; nothing until the schedules have loaded.
 */
export function OnCallStatus() {
  const colors = useTheme();
  const { locale, timeZone } = useLocale();
  const { view, now, status } = useOnCall();
  const glyph = useGlyphSize(fontSize.base.size);
  if (status !== "ready") return null;
  const state = onCallStatus(view);
  const on = state.kind === "on";
  const time = (at: number) => statusTime(at, now, locale, timeZone);
  const label =
    state.kind === "on"
      ? state.until === null
        ? m.oncall_mine({ part: "on_call", name: "", time: "" })
        : m.oncall_mine({ part: "status_until", name: "", time: time(state.until) })
      : state.kind === "off"
        ? state.next === null
          ? m.oncall_mine({ part: "status_none", name: "", time: "" })
          : m.oncall_mine({ part: "status_next", name: "", time: time(state.next) })
        : m.oncall_title();
  const tint = on ? colors.accentForeground : colors.mutedForeground;
  return (
    <Link href="/oncall" asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityHint={m.oncall_mine({ part: "open_hint", name: "", time: "" })}
      >
        {/* Sized inside: Link's `asChild` drops a style function on the Pressable. */}
        {({ pressed }) => (
          <View
            style={{
              minHeight: spacing[12],
              flexDirection: "row",
              alignItems: "center",
              gap: spacing[3],
              paddingHorizontal: spacing[4],
              paddingVertical: spacing[3],
              borderRadius: radius.xl,
              borderCurve: "continuous",
              backgroundColor: on ? colors.accent : colors.card,
              borderWidth: on ? 0 : StyleSheet.hairlineWidth,
              borderColor: colors.border,
              opacity: pressed ? 0.7 : 1,
            }}
          >
            <SymbolView name={on ? ON_CALL_GLYPH : OFF_CALL_GLYPH} tintColor={tint} size={glyph} />
            <View style={{ flex: 1, gap: spacing[0.5] }}>
              <ThemedText
                variant={on ? "body" : "caption"}
                style={
                  on
                    ? { color: colors.accentForeground, fontWeight: fontWeight.semibold }
                    : undefined
                }
              >
                {label}
              </ThemedText>
              {on && state.schedules > 0 ? (
                <ThemedText
                  variant="caption"
                  numberOfLines={2}
                  style={{ color: colors.accentForeground }}
                >
                  {view.current.map((shift) => shift.schedule.name).join(" · ")}
                </ThemedText>
              ) : null}
            </View>
            <SymbolView name={OPEN_GLYPH} tintColor={tint} size={glyph} />
          </View>
        )}
      </Pressable>
    </Link>
  );
}
