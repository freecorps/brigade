import { formatDateTime, m } from "@freecorps/brigade-i18n";
import {
  entryTime,
  formatAge,
  people,
  queryErrorReason,
  type People,
} from "@freecorps/brigade-i18n/incident";
import {
  callChoiceText,
  callLabel,
  deliveryError,
  deviceLabel,
  emailText,
  memberName,
  memberText,
  missText,
  pageGroups,
  pageLabel,
  ruleText,
  sameOutcomeText,
  stageText,
  stageTimes,
  targetedText,
  verdictText,
  verdictTone,
  whyText,
} from "@freecorps/brigade-i18n/why-paged";
import { formatIncidentNumber, type IncidentRow } from "@freecorps/brigade-schema";
import { whyPaged, type WhyDelivery, type WhyPage } from "@freecorps/brigade-sync";
import { useQuery } from "@freecorps/brigade-sync/react";
import { fontSize, radius, spacing } from "@freecorps/brigade-ui";
import { Stack, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useGlyphSize } from "@/components/badge";
import { useChoiceSheet } from "@/components/choice-sheet";
import type { Glyph } from "@/components/glyphs";
import { useNow } from "@/components/incident-parts";
import { CALL_GLYPH, usePagingData, useTone, VERDICT_GLYPHS } from "@/components/paging";
import { useMember } from "@/components/session";
import { ThemedText } from "@/components/themed-text";
import { useLocale } from "@/hooks/use-locale";
import { useScreenPadding } from "@/hooks/use-screen-padding";
import { useTheme } from "@/hooks/use-theme";
import { useSystemColors } from "@/theme/system-colors";
import { memberChoices } from "@/lib/why";

/** Phones on one page past which each shows only its furthest stage: a team with many phones stays readable. */
const COMPACT_DEVICES = 3;
/** How wide the explanation reads on a tablet: a line of text, not the whole screen. */
const READABLE_WIDTH = 720;

const GLYPHS = {
  member: { ios: "person", android: "person", web: "person" },
  step: {
    ios: "smallcircle.filled.circle",
    android: "radio_button_checked",
    web: "radio_button_checked",
  },
  phone: { ios: "iphone", android: "smartphone", web: "smartphone" },
  email: { ios: "envelope", android: "mail", web: "mail" },
  acked: { ios: "bell.slash", android: "notifications_off", web: "notifications_off" },
  change: { ios: "chevron.up.chevron.down", android: "unfold_more", web: "unfold_more" },
} satisfies Record<string, Glyph>;

/**
 * "Why wasn't I paged?" for one incident and one member (the signed-in one unless `member` names another), step by
 * step, as the dashboard's `?why=<member>` (RFC 0006 "Delivery receipts"): can they be paged at all, which rule paged,
 * each page (were they on it, and if not why; each phone's stages with times and errors, and the calls apart), the
 * phones they have now, the email about a missed page, and the acknowledgement that stopped it.
 */
export function WhyPagedScreen({
  number,
  member,
}: {
  number: number | null;
  member: string | null;
}) {
  const self = useMember();
  if (number === null) return <Message text={m.incident_page({ part: "not_found" })} />;
  return <ByNumber number={number} userId={member ?? self.userId} />;
}

function ByNumber({ number, userId }: { number: number; userId: string }) {
  const { rows, status, error } = useQuery("incident.byNumber", { number });
  const row = rows[0];
  if (row) return <Explanation row={row} userId={userId} />;
  if (status === "error") return <Message text={queryErrorReason(error?.code)} />;
  if (status === "ready") return <Message text={m.incident_page({ part: "not_found" })} />;
  return <Loading />;
}

function Screen({ title, children }: { title: string; children: ReactNode }) {
  const system = useSystemColors();
  const padding = useScreenPadding();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: system.ground }}
      contentContainerStyle={padding}
    >
      <Stack.Screen options={{ title }} />
      <View
        style={{ width: "100%", maxWidth: READABLE_WIDTH, alignSelf: "center", gap: spacing[6] }}
      >
        {children}
      </View>
    </ScrollView>
  );
}

function Loading() {
  const colors = useTheme();
  return (
    <Screen title={whyText("title")}>
      <View accessibilityRole="progressbar" style={{ flexDirection: "row", gap: spacing[3] }}>
        <ActivityIndicator color={colors.mutedForeground} />
        <ThemedText variant="caption">{whyText("loading")}</ThemedText>
      </View>
    </Screen>
  );
}

function Message({ text }: { text: string }) {
  return (
    <Screen title={whyText("title")}>
      <ThemedText selectable>{text}</ThemedText>
    </Screen>
  );
}

function Explanation({ row, userId }: { row: IncidentRow; userId: string }) {
  const colors = useTheme();
  const tone = useTone();
  const router = useRouter();
  const { locale } = useLocale();
  const self = useMember();
  const now = useNow(20_000);
  const verdictGlyph = useGlyphSize(fontSize.base.size);
  const { data, errorCode } = usePagingData(row, now);
  const { choose, sheet } = useChoiceSheet();
  const [allPages, setAllPages] = useState(false);
  if (errorCode !== undefined) return <Message text={queryErrorReason(errorCode)} />;
  if (!data) return <Loading />;

  const who = people(self.userId, data.members);
  const why = whyPaged({ ...data, userId });
  const name = memberName(userId, who);
  const groups = pageGroups(why.pages);
  const grouped = groups.length < why.pages.length;
  const pages = allPages ? why.pages.map((page) => ({ page, earlier: 0 })) : groups;
  const title = userId === self.userId ? whyText("why_title_you") : whyText("why_title", { name });
  const pick = () =>
    choose(
      whyText("pick_member"),
      memberChoices(data, userId, who, locale)
        .filter((option) => option.id !== userId)
        .map((option) => ({ value: option.id, label: option.name })),
      (member: string) => router.setParams({ member }),
    );

  return (
    <Screen title={title}>
      <View style={{ gap: spacing[3] }}>
        <ThemedText variant="caption" selectable>
          {`${formatIncidentNumber(row.number) ?? ""} ${row.title}`}
        </ThemedText>
        {/* Like the dashboard's member select: one button, read as "Member: Bia". */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${whyText("pick_member")}, ${name}`}
          accessibilityHint={m.mobile_change_hint()}
          onPress={pick}
          hitSlop={{ top: spacing[2], bottom: spacing[2] }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            alignSelf: "flex-start",
            gap: spacing[1],
            minHeight: spacing[12],
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <ThemedText variant="label">{whyText("pick_member")}</ThemedText>
          <ThemedText style={{ flexShrink: 1, color: colors.primary }}>{name}</ThemedText>
          <SymbolView name={GLYPHS.change} tintColor={colors.primary} size={verdictGlyph} />
        </Pressable>
        <View
          accessible
          accessibilityLiveRegion="polite"
          style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing[2] }}
        >
          <View style={{ paddingTop: spacing[0.5] }}>
            <SymbolView
              name={VERDICT_GLYPHS[why.verdict]}
              tintColor={tone(verdictTone(why.verdict))}
              size={verdictGlyph}
            />
          </View>
          <ThemedText
            selectable
            style={{ flex: 1, fontWeight: "600", color: tone(verdictTone(why.verdict)) }}
          >
            {verdictText(why, name)}
          </ThemedText>
        </View>
      </View>

      <View style={{ gap: spacing[5] }}>
        <Step glyph={GLYPHS.member}>{memberText(why.member.status, name)}</Step>
        <Step glyph={GLYPHS.step}>{ruleText(why.rule)}</Step>
        {pages.map(({ page, earlier }, index) => (
          <PageStep
            key={page.step ?? `interim-${index}`}
            page={page}
            earlier={earlier}
            name={name}
            who={who}
            now={now}
          />
        ))}
        {grouped ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: allPages }}
            onPress={() => setAllPages((current) => !current)}
            style={({ pressed }) => ({
              minHeight: spacing[12],
              justifyContent: "center",
              alignSelf: "flex-start",
              marginLeft: verdictGlyph + spacing[3],
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <ThemedText style={{ color: colors.primary }}>
              {allPages
                ? m.incident_page({ part: "show_less" })
                : whyText("pages_show_all", { detail: String(why.pages.length) })}
            </ThemedText>
          </Pressable>
        ) : null}
        <Step glyph={GLYPHS.phone} title={whyText("devices_title")}>
          {why.devices.length === 0 ? (
            whyText("devices_none")
          ) : (
            <View style={{ gap: spacing[2] }}>
              {why.devices.map((device) => (
                <View key={device.id}>
                  <ThemedText>{deviceLabel(device)}</ThemedText>
                  <ThemedText variant="caption">
                    {whyText("seen", { time: formatAge(device.lastSeenAt, now, locale) })}
                    {device.voip ? ` · ${whyText("calls")}` : ""}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}
        </Step>
        <Step glyph={CALL_GLYPH}>{callChoiceText(why.calls, name)}</Step>
        {why.email ? <Step glyph={GLYPHS.email}>{emailText(why.email, name)}</Step> : null}
        {why.acknowledged ? (
          <Step glyph={GLYPHS.acked}>
            {whyText("acknowledged", {
              name: memberName(why.acknowledged.by, who),
              time: formatAge(why.acknowledged.at, now, locale),
            })}
          </Step>
        ) : null}
      </View>
      <ThemedText variant="caption">{whyText("privacy")}</ThemedText>
      {sheet}
    </Screen>
  );
}

/** One line of the explanation: a glyph, an optional title, and its text (or what is given). */
function Step({ glyph, title, children }: { glyph: Glyph; title?: string; children: ReactNode }) {
  const colors = useTheme();
  const size = useGlyphSize(fontSize.base.size);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing[3] }}>
      <View style={{ paddingTop: spacing[0.5] }}>
        <SymbolView name={glyph} tintColor={colors.mutedForeground} size={size} />
      </View>
      <View style={{ flex: 1, gap: spacing[2] }}>
        {title ? <ThemedText style={{ fontWeight: "600" }}>{title}</ThemedText> : null}
        {typeof children === "string" ? <ThemedText selectable>{children}</ThemedText> : children}
      </View>
    </View>
  );
}

function PageStep({
  page,
  earlier,
  name,
  who,
  now,
}: {
  page: WhyPage;
  /** Pages before this one with the same outcome, folded into it. */
  earlier: number;
  name: string;
  who: People;
  now: number;
}) {
  const tone = useTone();
  const { locale, timeZone } = useLocale();
  const compact = page.deliveries.length > COMPACT_DEVICES;
  const compactCalls = page.calls.length > COMPACT_DEVICES;
  return (
    <Step glyph={GLYPHS.step}>
      <View style={{ gap: spacing[2] }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: spacing[2] }}>
          <ThemedText style={{ fontWeight: "600" }}>{pageLabel(page)}</ThemedText>
          <ThemedText variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
            {entryTime(page.at, now, locale, timeZone)}
          </ThemedText>
        </View>
        {earlier > 0 ? <ThemedText variant="caption">{sameOutcomeText(earlier)}</ThemedText> : null}
        {targetedText(page, name, who).map((line) => (
          <ThemedText key={line} selectable>
            {line}
          </ThemedText>
        ))}
        {page.misses.map((miss) => (
          <ThemedText key={`${miss.reason}-${miss.at}`} selectable style={{ color: tone("warn") }}>
            {missText(miss.reason, name)}
          </ThemedText>
        ))}
        {page.deliveries.length > 0 ? (
          <View style={{ gap: compact ? spacing[2] : spacing[3] }}>
            {page.deliveries.map((delivery) => (
              <DeliveryItem key={delivery.row.id} delivery={delivery} compact={compact} />
            ))}
          </View>
        ) : null}
        {page.calls.length > 0 ? (
          // Calls apart from the pushes: they ring after them and never change whether the page got through.
          <View style={{ gap: spacing[2] }}>
            <ThemedText variant="caption">{whyText("call_note")}</ThemedText>
            <View style={{ gap: compactCalls ? spacing[2] : spacing[3] }}>
              {page.calls.map((delivery) => (
                <DeliveryItem key={delivery.row.id} delivery={delivery} compact={compactCalls} />
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </Step>
  );
}

/**
 * One phone's push or call on a page: each stage with its time (only the furthest when `compact`), and why it
 * stopped. A call has no delivered stage, and one never sent was held back because its push never got through.
 */
function DeliveryItem({
  delivery: { row, stage, stuck },
  compact,
}: {
  delivery: WhyDelivery;
  compact: boolean;
}) {
  const colors = useTheme();
  const tone = useTone();
  const { locale, timeZone } = useLocale();
  const call = row.kind === "call";
  const reached = stageTimes(row, stuck);
  const furthest = reached.filter((one) => one.at !== null).at(-1)!;
  const at = (value: number) => formatDateTime(value, locale, timeZone, { timeStyle: "medium" });
  const line = (label: string, value: string, color?: string, key?: string) => (
    <View
      key={key}
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
        columnGap: spacing[3],
      }}
    >
      <ThemedText style={color ? { color } : undefined}>{label}</ThemedText>
      <ThemedText style={{ fontVariant: ["tabular-nums"], ...(color ? { color } : {}) }}>
        {value}
      </ThemedText>
    </View>
  );
  return (
    <View
      style={{
        gap: compact ? spacing[0.5] : spacing[2],
        padding: compact ? spacing[2] : spacing[3],
        paddingHorizontal: spacing[3],
        borderRadius: radius.md,
        borderCurve: "continuous",
        backgroundColor: colors.muted,
      }}
    >
      <ThemedText style={{ fontWeight: "600" }}>
        {call ? callLabel(row) : deviceLabel(row)}
      </ThemedText>
      {compact
        ? // Many phones: each one's furthest stage only, still with its time.
          line(stageText(furthest.stage), at(furthest.at!))
        : reached.map(({ stage: one, at: when, stopped }) =>
            when !== null
              ? line(stageText(one), at(when), undefined, one)
              : line(
                  stageText(one),
                  whyText(stopped ? "stage_stopped" : "stage_none"),
                  stopped ? tone("warn") : colors.mutedForeground,
                  one,
                ),
          )}
      {stuck ? (
        <ThemedText selectable style={{ color: tone("warn") }}>
          {whyText(call ? "call_not_sent" : "stuck_note")}
        </ThemedText>
      ) : null}
      {deliveryError(row).map((text) => (
        <ThemedText key={text} selectable style={{ color: tone("warn") }}>
          {text}
        </ThemedText>
      ))}
      {stage === "accepted" && !compact && !call ? (
        <ThemedText variant="caption">{whyText("no_receipt")}</ThemedText>
      ) : null}
      {row.attempts > 1 ? (
        <ThemedText variant="caption">
          {whyText("attempts", { detail: String(row.attempts) })}
        </ThemedText>
      ) : null}
    </View>
  );
}
