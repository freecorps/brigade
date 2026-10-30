// Who was paged, on the incident screen, and what the step-by-step explanation reads (RFC 0006 "Delivery
// receipts"): the same rows and the same `whyPaged` as the dashboard's paging card and `?why=<member>`.
import { m } from "@freecorps/brigade-i18n";
import type { People } from "@freecorps/brigade-i18n/incident";
import { memberName, shortCall, shortVerdict, whyText } from "@freecorps/brigade-i18n/why-paged";
import type { IncidentRow } from "@freecorps/brigade-schema";
import type { WhyVerdict } from "@freecorps/brigade-sync";
import { useQuery } from "@freecorps/brigade-sync/react";
import { FieldGroup, Text } from "@expo/ui";
import { ListItem } from "@/components/list-item";
import { router } from "expo-router";
import type { Glyph } from "@/components/glyphs";
import { useTheme } from "@/hooks/use-theme";
import { pagingList, type PagingData } from "@/lib/why";

/** Members listed before Show all: enough for a small team, short enough to keep the timeline in reach. */
const LIST_LIMIT = 8;

export const VERDICT_GLYPHS: Record<WhyVerdict, Glyph> = {
  delivered: { ios: "checkmark.circle", android: "check_circle", web: "check_circle" },
  accepted: {
    ios: "smallcircle.filled.circle",
    android: "radio_button_checked",
    web: "radio_button_checked",
  },
  sending: { ios: "circle.dashed", android: "pending", web: "pending" },
  stuck: { ios: "slash.circle", android: "do_not_disturb_on", web: "do_not_disturb_on" },
  failed: { ios: "exclamationmark.circle", android: "error", web: "error" },
  missed: { ios: "exclamationmark.circle", android: "error", web: "error" },
  declarer: { ios: "person", android: "person", web: "person" },
  excluded: { ios: "shield", android: "shield", web: "shield" },
  not_targeted: { ios: "circle.dashed", android: "pending", web: "pending" },
  none: { ios: "circle.dashed", android: "pending", web: "pending" },
};

export const CALL_GLYPH: Glyph = { ios: "phone", android: "call", web: "call" };

/** A word's colour: good news, a warning, or neutral, as the dashboard's. */
export function useTone(): (tone: "ok" | "warn" | "neutral") => string {
  const colors = useTheme();
  return (tone) =>
    tone === "ok"
      ? colors.status.resolved.fg
      : tone === "warn"
        ? colors.severity.sev3.fg
        : colors.mutedForeground;
}

/**
 * Every query the explanation needs, for one incident. `data` only once all have loaded: empty lists while they fill
 * would read as "no phone". The members' call choices are optional, as on the dashboard.
 */
export function usePagingData(
  incident: IncidentRow,
  now: number,
): { data: PagingData | null; errorCode: string | undefined } {
  const members = useQuery("members.all", {});
  const timeline = useQuery("incident.timeline", { id: incident.id });
  const schedules = useQuery("schedules.all", {});
  const deliveries = useQuery("incident.deliveries", { id: incident.id });
  const devices = useQuery("devices.all", {});
  const settings = useQuery("members.settings", {});
  const feeds = [members, timeline, schedules, deliveries, devices];
  const failed = feeds.find((feed) => feed.status === "error");
  if (failed) return { data: null, errorCode: failed.error?.code ?? "internal" };
  if (!feeds.every((feed) => feed.status === "ready")) return { data: null, errorCode: undefined };
  return {
    data: {
      incident,
      members: members.rows,
      devices: devices.rows,
      deliveries: deliveries.rows,
      timeline: timeline.rows,
      schedules: schedules.rows,
      settings: settings.status === "ready" ? settings.rows : undefined,
      now,
    },
    errorCode: undefined,
  };
}

/**
 * The incident screen's "Who was paged" as a native grouped section: the member's own paging first, then everyone
 * who can respond (and anyone else a page touched) with what paging did with them in a word, whoever needs a look
 * first; each row opens the step-by-step explanation. `all` lists everyone past the first few.
 */
export function pagingSection({
  data,
  number,
  who,
  all,
  onAll,
  tint,
}: {
  data: PagingData;
  number: number;
  who: People;
  all: boolean;
  onAll: () => void;
  /** The colour of the member's own row, a link. */
  tint: string;
}) {
  const rows = pagingList(data);
  const shown = all ? rows : rows.slice(0, LIST_LIMIT);
  const open = (userId: string) =>
    router.push({
      pathname: "/incidents/[number]/why",
      params: { number: String(number), member: userId },
    });
  return (
    <FieldGroup.Section key="paging" title={whyText("title")}>
      <ListItem onPress={() => open(who.self)}>
        <Text textStyle={{ color: tint }}>{whyText("why_title_you")}</Text>
      </ListItem>
      {rows.length === 0 ? (
        <ListItem>
          <Text>{whyText("empty")}</Text>
        </ListItem>
      ) : (
        shown.map(({ id, verdict, call }) => (
          <ListItem
            key={id}
            onPress={() => open(id)}
            supportingText={[shortVerdict(verdict), ...(call ? [shortCall(call)] : [])].join(" · ")}
          >
            <Text>{memberName(id, who)}</Text>
          </ListItem>
        ))
      )}
      {rows.length > LIST_LIMIT ? (
        <ListItem onPress={onAll}>
          <Text textStyle={{ color: tint }}>
            {all
              ? m.incident_page({ part: "show_less" })
              : m.members_show_all({ count: rows.length })}
          </Text>
        </ListItem>
      ) : null}
    </FieldGroup.Section>
  );
}
