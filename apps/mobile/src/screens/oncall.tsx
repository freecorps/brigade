import { m } from "@freecorps/brigade-i18n";
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
import { FieldGroup, Text } from "@expo/ui";
import { ListItem } from "@/components/list-item";
import { useState } from "react";
import { Alert, View } from "react-native";
import { useChoiceSheet } from "@/components/choice-sheet";
import { EmptyRow } from "@/components/empty-row";
import type { Glyph } from "@/components/glyphs";
import { NativeHost } from "@/components/native-host";
import { RowText } from "@/components/row-text";
import { useOnCall } from "@/components/oncall";
import { useMember } from "@/components/session";
import { useLocale } from "@/hooks/use-locale";
import { useTheme } from "@/hooks/use-theme";
import { useOtherWorkspaces } from "@/components/widget";
import { COVER_HOURS, coverArgs, queriesStatus, statusTime, type Shift } from "@/lib/oncall";

/** No schedules yet: a calendar with a clock. */
const NO_SCHEDULES_GLYPH: Glyph = {
  ios: "calendar.badge.clock",
  android: "calendar_clock",
  web: "calendar_clock",
};

/** `oncall_mine` with only the inputs the variant uses. */
const mine = (
  part:
    | "on_call"
    | "off_call"
    | "you_name"
    | "next"
    | "next_none"
    | "overrides"
    | "remove_mine"
    | "on_dashboard"
    | "workspace"
    | "elsewhere"
    | "elsewhere_open",
  inputs: { name?: string; time?: string } = {},
) => m.oncall_mine({ part, name: "", time: "", ...inputs });

/**
 * The member's on call (RFC 0003 "Schedules"): in which workspace, whether they are on call now and until when, their
 * next shifts and overrides, and who every schedule has now, each time in the schedule's zone and, when it reads
 * differently, the phone's. Responders add an override for themselves (covering from now) and remove their own, as on
 * the dashboard; schedules and rotations are edited there. On call in another workspace this phone pages them for (as
 * last seen there, src/lib/phone-workspaces.ts) is said too, since this screen is only the open one's.
 */
export function OnCall() {
  const colors = useTheme();
  const { locale, timeZone } = useLocale();
  const { userId, role, workspaceId, workspaceName } = useMember();
  const others = useOtherWorkspaces(userId, workspaceId);
  const client = useSyncClient();
  const picture = useOnCall();
  const { view, now } = picture;
  const members = useQuery("members.all", {});
  // Wait for the members too: until they load, everyone would read as unnamed.
  const status = queriesStatus(picture.status, members.status);
  const error = picture.error ?? members.error;
  const addOverride = useMutation("schedule.addOverride");
  const removeOverride = useMutation("schedule.removeOverride");
  const { choose, sheet } = useChoiceSheet();
  const [refusals, setRefusals] = useState<{ key: string; text: string }[]>([]);
  const canOverride = can(role, "schedule:override");

  const report = (name: string) => (outcome: MutationOutcome) => {
    if (outcome.ok) return;
    const text = m.oncall_change_failed({ name, reason: scheduleRefusal(outcome.error) });
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
    id === userId
      ? mine("you_name", { name: memberLabel(members.rows, id) })
      : memberLabel(members.rows, id);

  const loading = status !== "ready" && status !== "error";
  const onCall = view.current.length > 0;
  const elsewhere = others.flatMap((other) => {
    const shift = other.shifts.find(([start, end]) => start <= now && (end === null || now < end));
    return shift ? [{ name: other.name, until: shift[1] }] : [];
  });
  const shiftRow = (shift: Shift, current = false) => {
    const zone = shift.schedule.timeZone;
    const lines = current
      ? []
      : [
          handoffTime(shift.start, zone, locale),
          [viewerTime(shift.start, zone, timeZone, locale), fromNow(shift.start, now, locale)]
            .filter(Boolean)
            .join(" · "),
        ];
    return (
      <ListItem
        key={`${shift.schedule.id}-${shift.start}`}
        supportingText={[
          ...lines,
          ...(shift.end !== null
            ? untilLines(shift.end, shift.schedule)
            : current
              ? [m.oncall_upcoming_none()]
              : []),
        ].join("\n")}
      >
        <Text>
          {shift.override
            ? `${shift.schedule.name} · ${m.oncall_override_badge()}`
            : shift.schedule.name}
        </Text>
      </ListItem>
    );
  };
  const untilLines = (at: number, schedule: ScheduleRow) => [
    m.oncall_until({ time: handoffTime(at, schedule.timeZone, locale) }),
    [viewerTime(at, schedule.timeZone, timeZone, locale), fromNow(at, now, locale)]
      .filter(Boolean)
      .join(" · "),
  ];
  const upcoming = onCall ? view.next : view.next.slice(1);

  return (
    <View style={{ flex: 1 }}>
      <NativeHost style={{ flex: 1 }}>
        <FieldGroup>
          <FieldGroup.Section>
            <FieldGroup.SectionHeader>
              <Text>{mine("workspace", { name: workspaceName })}</Text>
            </FieldGroup.SectionHeader>
            {refusals.map((refusal) => (
              <ListItem
                key={refusal.key}
                onPress={() =>
                  setRefusals((current) => current.filter((item) => item.key !== refusal.key))
                }
                trailing={<RowText color={colors.primary}>{m.dismiss()}</RowText>}
              >
                <Text textStyle={{ color: colors.destructive }}>{refusal.text}</Text>
              </ListItem>
            ))}
            {status === "error" ? (
              <ListItem>
                <Text textStyle={{ color: colors.destructive }}>
                  {queryErrorReason(error?.code)}
                </Text>
              </ListItem>
            ) : null}
            {elsewhere.map((other) => (
              <ListItem key={other.name}>
                <Text>
                  {other.until === null
                    ? mine("elsewhere_open", { name: other.name })
                    : mine("elsewhere", {
                        name: other.name,
                        time: statusTime(other.until, now, locale, timeZone),
                      })}
                </Text>
              </ListItem>
            ))}
            {status === "ready" && view.schedules.length === 0 ? (
              <EmptyRow
                title={m.oncall_empty_title()}
                description={m.oncall_empty_hint()}
                glyph={NO_SCHEDULES_GLYPH}
              />
            ) : status === "ready" ? (
              // Whether the member is on call now, the headline of the tab.
              <ListItem
                supportingText={onCall ? undefined : view.next[0] ? undefined : mine("next_none")}
              >
                <Text
                  textStyle={{
                    fontSize: 20,
                    fontWeight: "600",
                    color: onCall ? colors.primary : undefined,
                  }}
                >
                  {onCall ? mine("on_call") : mine("off_call")}
                </Text>
              </ListItem>
            ) : null}
            {status === "ready" && onCall
              ? view.current.map((shift) => shiftRow(shift, true))
              : null}
            {status === "ready" && !onCall && view.next[0] ? shiftRow(view.next[0]) : null}
          </FieldGroup.Section>

          {status === "ready" && upcoming.length > 0 ? (
            <FieldGroup.Section title={mine("next")}>
              {upcoming.map((shift) => shiftRow(shift))}
            </FieldGroup.Section>
          ) : null}

          {status === "ready" && view.overrides.length > 0 ? (
            <FieldGroup.Section title={mine("overrides")}>
              {view.overrides.map(({ row, schedule }) => {
                const start = viewerTime(row.start, schedule.timeZone, timeZone, locale);
                const end = viewerTime(row.end, schedule.timeZone, timeZone, locale);
                return (
                  <ListItem
                    key={row.id}
                    onPress={canOverride ? () => remove(row, schedule) : undefined}
                    supportingText={[
                      `${handoffTime(row.start, schedule.timeZone, locale)} – ${handoffTime(row.end, schedule.timeZone, locale)}`,
                      ...(start && end ? [`${start} – ${end}`] : []),
                    ].join("\n")}
                    trailing={
                      canOverride ? (
                        <RowText color={colors.destructive}>
                          {m.oncall_action({ action: "remove" })}
                        </RowText>
                      ) : undefined
                    }
                  >
                    <Text>{schedule.name}</Text>
                  </ListItem>
                );
              })}
            </FieldGroup.Section>
          ) : null}

          {status === "ready" && view.schedules.length > 0 ? (
            <FieldGroup.Section title={m.oncall_heading({ heading: "now" })}>
              {view.schedules.map((item) => {
                const mayCover = canOverride && item.userId !== userId;
                return (
                  <ListItem
                    key={item.schedule.id}
                    onPress={mayCover ? () => cover(item.schedule) : undefined}
                    supportingText={[
                      [
                        item.userId === null ? m.oncall_nobody() : name(item.userId),
                        ...(item.override ? [m.oncall_override_badge()] : []),
                      ].join(" · "),
                      ...(item.until !== null ? untilLines(item.until, item.schedule) : []),
                      m.oncall_time_zone({
                        zone: zoneLabel(item.schedule.timeZone),
                        offset: offsetLabel(item.schedule.timeZone, now),
                      }),
                    ].join("\n")}
                    trailing={
                      mayCover ? (
                        <RowText color={colors.primary}>
                          {m.oncall_action({ action: "add_override" })}
                        </RowText>
                      ) : undefined
                    }
                  >
                    <Text
                      textStyle={
                        item.userId === null ? { color: colors.severity.sev3.fg } : undefined
                      }
                    >
                      {item.schedule.name}
                    </Text>
                  </ListItem>
                );
              })}
            </FieldGroup.Section>
          ) : null}

          <FieldGroup.Section>
            <FieldGroup.SectionFooter>
              <Text>{loading ? m.incident_page({ part: "loading" }) : mine("on_dashboard")}</Text>
            </FieldGroup.SectionFooter>
          </FieldGroup.Section>
        </FieldGroup>
      </NativeHost>
      {sheet}
    </View>
  );
}
