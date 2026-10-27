// Who was paged, on the incident screen, and what the step-by-step explanation reads (RFC 0006 "Delivery
// receipts"): the same rows and the same `whyPaged` as the dashboard's paging card and `?why=<member>`.
import { m } from "@freecorps/brigade-i18n";
import type { People } from "@freecorps/brigade-i18n/incident";
import {
  callTone,
  memberName,
  shortCall,
  shortVerdict,
  verdictTone,
  whyText,
} from "@freecorps/brigade-i18n/why-paged";
import type { IncidentRow } from "@freecorps/brigade-schema";
import type { WhyCall, WhyVerdict } from "@freecorps/brigade-sync";
import { useQuery } from "@freecorps/brigade-sync/react";
import { fontSize, spacing } from "@freecorps/brigade-ui";
import { Link } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useGlyphSize } from "@/components/badge";
import type { Glyph } from "@/components/glyphs";
import { Row, Section } from "@/components/section";
import { ThemedText } from "@/components/themed-text";
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
const WHY_GLYPH: Glyph = { ios: "questionmark.circle", android: "help", web: "help" };
const OPEN_GLYPH: Glyph = { ios: "chevron.right", android: "chevron_right", web: "chevron_right" };

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
 * The incident screen's "Who was paged": the member's own paging first, then everyone who can respond (and anyone
 * else a page touched) with what paging did with them in a word, whoever needs a look first; each row opens the
 * step-by-step explanation.
 */
export function PagingSection({
  data,
  number,
  who,
}: {
  data: PagingData;
  number: number;
  who: People;
}) {
  const colors = useTheme();
  const glyph = useGlyphSize(fontSize.base.size);
  const [all, setAll] = useState(false);
  const rows = pagingList(data);
  const shown = all ? rows : rows.slice(0, LIST_LIMIT);
  return (
    <View style={{ gap: spacing[2] }}>
      <Section title={whyText("title")} inset={false}>
        <WhyRow number={number} userId={who.self} first label={whyText("why_title_you")}>
          <SymbolView name={WHY_GLYPH} tintColor={colors.primary} size={glyph} />
          <ThemedText style={{ flex: 1, color: colors.primary }}>
            {whyText("why_title_you")}
          </ThemedText>
        </WhyRow>
        {rows.length === 0 ? (
          <Row>
            <ThemedText variant="caption">{whyText("empty")}</ThemedText>
          </Row>
        ) : (
          shown.map(({ id, verdict, call }) => (
            <MemberRow key={id} number={number} id={id} verdict={verdict} call={call} who={who} />
          ))
        )}
      </Section>
      {rows.length > LIST_LIMIT ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: all }}
          onPress={() => setAll((current) => !current)}
          style={({ pressed }) => ({
            minHeight: spacing[12],
            justifyContent: "center",
            alignSelf: "flex-start",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <ThemedText style={{ color: colors.primary }}>
            {all
              ? m.incident_page({ part: "show_less" })
              : m.members_show_all({ count: rows.length })}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

/** One member: the name on its own line (a long pt-BR name never loses to the words), what paging did below it. */
function MemberRow({
  number,
  id,
  verdict,
  call,
  who,
}: {
  number: number;
  id: string;
  verdict: WhyVerdict;
  call: WhyCall | null;
  who: People;
}) {
  const tone = useTone();
  const glyph = useGlyphSize(fontSize.sm.size);
  const name = memberName(id, who);
  const words = [shortVerdict(verdict), ...(call ? [shortCall(call)] : [])].join(", ");
  return (
    <WhyRow number={number} userId={id} label={`${name}, ${words}`}>
      <View style={{ flex: 1, gap: spacing[0.5] }}>
        <ThemedText>{name}</ThemedText>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            columnGap: spacing[3],
            rowGap: spacing[0.5],
          }}
        >
          <Word glyph={VERDICT_GLYPHS[verdict]} color={tone(verdictTone(verdict))} size={glyph}>
            {shortVerdict(verdict)}
          </Word>
          {/* The calls in a word, next to what the pages did: never in its place. */}
          {call ? (
            <Word glyph={CALL_GLYPH} color={tone(callTone(call))} size={glyph}>
              {shortCall(call)}
            </Word>
          ) : null}
        </View>
      </View>
    </WhyRow>
  );
}

function Word({
  glyph,
  color,
  size,
  children,
}: {
  glyph: Glyph;
  color: string;
  size: number;
  children: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[1] }}>
      <SymbolView name={glyph} tintColor={color} size={size} />
      <ThemedText variant="caption" style={{ color }}>
        {children}
      </ThemedText>
    </View>
  );
}

/** A row that opens one member's explanation, with a chevron as list rows that push a screen have. */
function WhyRow({
  number,
  userId,
  label,
  first = false,
  children,
}: {
  number: number;
  userId: string;
  label: string;
  first?: boolean;
  children: ReactNode;
}) {
  const colors = useTheme();
  const glyph = useGlyphSize(fontSize.sm.size);
  return (
    <Link
      href={{
        pathname: "/incidents/[number]/why",
        params: { number: String(number), member: userId },
      }}
      asChild
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={label}
        accessibilityHint={whyText("open_hint")}
        style={({ pressed }) => ({ backgroundColor: pressed ? colors.accent : "transparent" })}
      >
        <Row first={first}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[2] }}>
            {children}
            <SymbolView name={OPEN_GLYPH} tintColor={colors.mutedForeground} size={glyph} />
          </View>
        </Row>
      </Pressable>
    </Link>
  );
}
