import { m, type Locale } from "@freecorps/brigade-i18n";
import { queryErrorReason } from "@freecorps/brigade-i18n/incident";
import {
  fromNow,
  handoffTime,
  memberLabel,
  offsetLabel,
  scheduleRefusal,
  viewerTime,
  zoneLabel,
} from "@freecorps/brigade-i18n/oncall";
import { can, type OverrideRow, type ScheduleRow } from "@freecorps/brigade-schema";
import type { MutationOutcome } from "@freecorps/brigade-sync";
import { useMutation, useQuery, useSyncClient } from "@freecorps/brigade-sync/react";
import { fontWeight, spacing } from "@freecorps/brigade-ui";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import { Badge } from "@/components/badge";
import { useChoiceSheet } from "@/components/choice-sheet";
import type { Glyph } from "@/components/glyphs";
import { Notice } from "@/components/incident-parts";
import { useOnCall } from "@/components/oncall";
import { Row, Section } from "@/components/section";
import { useMember } from "@/components/session";
import { ThemedText } from "@/components/themed-text";
import { useLocale } from "@/hooks/use-locale";
import { useScreenPadding } from "@/hooks/use-screen-padding";
import { useTheme } from "@/hooks/use-theme";
import { COVER_HOURS, coverArgs, type Shift } from "@/lib/oncall";

const GAP_GLYPH: Glyph = {
  ios: "exclamationmark.triangle.fill",
  android: "warning",
  web: "warning",
};

const mine = (part: string, inputs: { name?: string; time?: string } = {}) =>
  m.oncall_mine({ part, name: "", time: "", ...inputs });

/**
 * The member's on call (RFC 0003 "Schedules"): whether they are on call now and until when, their next shifts and
 * overrides, and who every schedule has now, each time in the schedule's zone and, when it reads differently, the
 * phone's. Responders add an override for themselves (covering from now) and remove their own, as on the dashboard;
 * schedules and rotations are edited there.
 */
export function OnCall() {
  const colors = useTheme();
  const padding = useScreenPadding();
  const { locale, timeZone } = useLocale();
  const { userId, role } = useMember();
  const client = useSyncClient();
  const { view, now, status, error } = useOnCall();
  const members = useQuery("members.all", {}).rows;
  const addOverride = useMutation("schedule.addOverride");
  const removeOverride = useMutation("schedule.removeOverride");
  const { choose, sheet } = useChoiceSheet();
  const [refusals, setRefusals] = useState<{ key: string; text: string }[]>([]);
  const canOverride = can(role, "schedule:override");

  const report = (name: string) => (outcome: MutationOutcome) => {
    if (outcome.ok) return;
    const text = m.oncall_change_failed({ name, reason: scheduleRefusal(outcome.error.code) });
    setRefusals((current) =>
      [...current, { key: `${Date.now()}-${current.length}`, text }].slice(-3),
    );
  };
  const cover = (schedule: ScheduleRow) =>
    choose(
      m.oncall_action_on({ action: "add_override", name: schedule.name }),
      COVER_HOURS.map((hours) => ({ value: hours, label: m.oncall_cover({ count: hours }) })),
      (hours) => {
        const args = coverArgs(schedule.id, userId, Date.now(), hours);
        void addOverride({ id: client.newId("ovr"), ...args }).then(report(schedule.name));
      },
    );
  const remove = (row: OverrideRow, schedule: ScheduleRow) =>
    Alert.alert(mine("remove_mine", { name: schedule.name }), undefined, [
      { text: m.oncall_action({ action: "cancel" }), style: "cancel" },
      {
        text: m.oncall_action({ action: "remove" }),
        style: "destructive",
        onPress: () => void removeOverride({ id: row.id }).then(report(schedule.name)),
      },
    ]);
  const name = (id: string) =>
    id === userId ? mine("you_name", { name: memberLabel(members, id) }) : memberLabel(members, id);

  const loading = status !== "ready" && status !== "error";
  const onCall = view.current.length > 0;
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[padding, { gap: spacing[6] }]}
    >
      {refusals.map((refusal) => (
        <Notice
          key={refusal.key}
          onDismiss={() =>
            setRefusals((current) => current.filter((item) => item.key !== refusal.key))
          }
        >
          {refusal.text}
        </Notice>
      ))}
      {status === "error" ? (
        <ThemedText selectable style={{ color: colors.destructive }}>
          {queryErrorReason(error?.code)}
        </ThemedText>
      ) : null}
      {loading ? <ActivityIndicator color={colors.primary} /> : null}

      {status === "ready" && view.schedules.length === 0 ? (
        <Section title={m.oncall_title()}>
          <ThemedText>{m.oncall_empty()}</ThemedText>
        </Section>
      ) : null}

      {status === "ready" && view.schedules.length > 0 ? (
        <>
          <Section title={onCall ? mine("on_call") : mine("off_call")} inset={false}>
            {onCall ? (
              view.current.map((shift, index) => (
                <Row key={shift.schedule.id} first={index === 0}>
                  <ShiftLine
                    shift={shift}
                    now={now}
                    locale={locale}
                    viewerZone={timeZone}
                    current
                  />
                </Row>
              ))
            ) : (
              <Row first>
                {view.next[0] ? (
                  <ShiftLine shift={view.next[0]} now={now} locale={locale} viewerZone={timeZone} />
                ) : (
                  <ThemedText variant="caption">{mine("next_none")}</ThemedText>
                )}
              </Row>
            )}
          </Section>

          {/* Off call, the first of these is already above. */}
          {(onCall ? view.next : view.next.slice(1)).length > 0 ? (
            <Section title={mine("next")} inset={false}>
              {(onCall ? view.next : view.next.slice(1)).map((shift, index) => (
                <Row key={`${shift.schedule.id}-${shift.start}`} first={index === 0}>
                  <ShiftLine shift={shift} now={now} locale={locale} viewerZone={timeZone} />
                </Row>
              ))}
            </Section>
          ) : null}

          {view.overrides.length > 0 ? (
            <Section title={mine("overrides")} inset={false}>
              {view.overrides.map(({ row, schedule }, index) => {
                const start = viewerTime(row.start, schedule.timeZone, timeZone, locale);
                const end = viewerTime(row.end, schedule.timeZone, timeZone, locale);
                return (
                  <Row key={row.id} first={index === 0}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[3] }}>
                      <View style={{ flex: 1, gap: spacing[0.5] }}>
                        <ThemedText style={{ fontWeight: fontWeight.medium }}>
                          {schedule.name}
                        </ThemedText>
                        <ThemedText
                          variant="caption"
                          selectable
                          style={{ fontVariant: ["tabular-nums"] }}
                        >
                          {handoffTime(row.start, schedule.timeZone, locale)} –{" "}
                          {handoffTime(row.end, schedule.timeZone, locale)}
                        </ThemedText>
                        {start && end ? (
                          <ThemedText variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
                            {start} – {end}
                          </ThemedText>
                        ) : null}
                      </View>
                      {canOverride ? (
                        <TextButton
                          label={m.oncall_action({ action: "remove" })}
                          accessibilityLabel={m.oncall_action_on({
                            action: "remove_override",
                            // With its start, so two overrides on one schedule read apart.
                            name: `${schedule.name}, ${handoffTime(row.start, schedule.timeZone, locale)}`,
                          })}
                          destructive
                          onPress={() => remove(row, schedule)}
                        />
                      ) : null}
                    </View>
                  </Row>
                );
              })}
            </Section>
          ) : null}

          <Section title={m.oncall_heading({ heading: "now" })} inset={false}>
            {view.schedules.map((item, index) => (
              <Row key={item.schedule.id} first={index === 0}>
                <ThemedText style={{ fontWeight: fontWeight.medium }}>
                  {item.schedule.name}
                </ThemedText>
                <ThemedText variant="caption">
                  {m.oncall_time_zone({
                    zone: zoneLabel(item.schedule.timeZone),
                    offset: offsetLabel(item.schedule.timeZone, now),
                  })}
                </ThemedText>
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: spacing[2],
                    paddingTop: spacing[1],
                  }}
                >
                  {item.userId === null ? (
                    <Badge
                      colors={colors.severity.sev3}
                      icon={GAP_GLYPH}
                      label={m.oncall_nobody()}
                    />
                  ) : (
                    <ThemedText selectable style={{ flexShrink: 1 }}>
                      {name(item.userId)}
                    </ThemedText>
                  )}
                  {item.override ? (
                    <Badge
                      colors={{ bg: colors.muted, fg: colors.foreground }}
                      label={m.oncall_override_badge()}
                    />
                  ) : null}
                </View>
                {item.until !== null ? (
                  <Until
                    at={item.until}
                    schedule={item.schedule}
                    now={now}
                    locale={locale}
                    viewerZone={timeZone}
                  />
                ) : null}
                {canOverride && item.userId !== userId ? (
                  <TextButton
                    label={m.oncall_action({ action: "add_override" })}
                    accessibilityLabel={m.oncall_action_on({
                      action: "add_override",
                      name: item.schedule.name,
                    })}
                    onPress={() => cover(item.schedule)}
                  />
                ) : null}
              </Row>
            ))}
          </Section>
        </>
      ) : null}

      <ThemedText variant="caption">{mine("on_dashboard")}</ThemedText>
      {sheet}
    </ScrollView>
  );
}

/** A shift of the member's: its schedule, when it starts (or, now, until when) in both clocks. */
function ShiftLine({
  shift,
  now,
  locale,
  viewerZone,
  current = false,
}: {
  shift: Shift;
  now: number;
  locale: Locale;
  viewerZone: string;
  current?: boolean;
}) {
  const colors = useTheme();
  const zone = shift.schedule.timeZone;
  const local = current ? null : viewerTime(shift.start, zone, viewerZone, locale);
  return (
    <>
      <View
        style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing[2] }}
      >
        <ThemedText style={{ fontWeight: fontWeight.medium, flexShrink: 1 }}>
          {shift.schedule.name}
        </ThemedText>
        {shift.override ? (
          <Badge
            colors={{ bg: colors.muted, fg: colors.foreground }}
            label={m.oncall_override_badge()}
          />
        ) : null}
      </View>
      {current ? null : (
        <>
          <ThemedText selectable style={{ fontVariant: ["tabular-nums"] }}>
            {handoffTime(shift.start, zone, locale)}
          </ThemedText>
          <ThemedText variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
            {local ? `${local} · ` : ""}
            {fromNow(shift.start, now, locale)}
          </ThemedText>
        </>
      )}
      {shift.end !== null ? (
        <Until
          at={shift.end}
          schedule={shift.schedule}
          now={now}
          locale={locale}
          viewerZone={viewerZone}
        />
      ) : current ? (
        <ThemedText variant="caption">{m.oncall_upcoming_none()}</ThemedText>
      ) : null}
    </>
  );
}

/** "until Mon, Nov 2, 9:00 AM GMT-3", then the phone's time when it reads differently, and how far off. */
function Until({
  at,
  schedule,
  now,
  locale,
  viewerZone,
}: {
  at: number;
  schedule: ScheduleRow;
  now: number;
  locale: Locale;
  viewerZone: string;
}) {
  const local = viewerTime(at, schedule.timeZone, viewerZone, locale);
  return (
    <View>
      <ThemedText variant="caption" selectable style={{ fontVariant: ["tabular-nums"] }}>
        {m.oncall_until({ time: handoffTime(at, schedule.timeZone, locale) })}
      </ThemedText>
      <ThemedText variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
        {local ? `${local} · ` : ""}
        {fromNow(at, now, locale)}
      </ThemedText>
    </View>
  );
}

function TextButton({
  label,
  accessibilityLabel,
  destructive = false,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  destructive?: boolean;
  onPress: () => void;
}) {
  const colors = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: spacing[12],
        justifyContent: "center",
        alignSelf: "flex-start",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <ThemedText style={{ color: destructive ? colors.destructive : colors.primary }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}
