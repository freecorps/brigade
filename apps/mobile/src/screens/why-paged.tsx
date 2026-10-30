import { Column, FieldGroup, Text } from "@expo/ui";
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
import { spacing } from "@freecorps/brigade-ui";
import { Stack, useRouter } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo } from "react-native";
import { Avatar } from "@/components/avatar";
import { useChoiceSheet } from "@/components/choice-sheet";
import { FooterText } from "@/components/footer-text";
import type { Glyph } from "@/components/glyphs";
import { useNow } from "@/components/incident-parts";
import { useListEnd } from "@/components/list-end";
import { ListItem } from "@/components/list-item";
import { NativeHost } from "@/components/native-host";
import { CALL_GLYPH, usePagingData, useTone, VERDICT_GLYPHS } from "@/components/paging";
import { RowIcon } from "@/components/row-icon";
import { useMember } from "@/components/session";
import { useLocale } from "@/hooks/use-locale";
import { useTheme } from "@/hooks/use-theme";
import { memberChoices } from "@/lib/why";

/** Phones on one page past which each shows only its furthest stage: a team with many phones stays readable. */
const COMPACT_DEVICES = 3;

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
  miss: { ios: "exclamationmark.circle", android: "error", web: "error" },
} satisfies Record<string, Glyph>;

/**
 * "Why wasn't I paged?" for one incident and one member (the signed-in one unless `member` names another), step by
 * step, as the dashboard's `?why=<member>` (RFC 0006 "Delivery receipts"), in the system's grouped list: who and the
 * verdict first; can they be paged at all and which rule paged; each page in its own section (were they on it, and
 * if not why; each phone's stages with times and errors, and the calls apart); the phones they have now; then the
 * calls, the email about a missed page, and the acknowledgement that stopped it.
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
  return <Message text={whyText("loading")} />;
}

/** The screen's title and its grouped list; `children` are its sections. */
function Screen({ title, children }: { title: string; children: ReactNode }) {
  const listEnd = useListEnd();
  return (
    <>
      <Stack.Screen options={{ title }} />
      <NativeHost style={{ flex: 1 }}>
        <FieldGroup>
          {children}
          {listEnd}
        </FieldGroup>
      </NativeHost>
    </>
  );
}

/** Loading, or why there is nothing to explain: the screen's one row. */
function Message({ text }: { text: string }) {
  return (
    <Screen title={whyText("title")}>
      <FieldGroup.Section>
        <ListItem>
          <Text>{text}</Text>
        </ListItem>
      </FieldGroup.Section>
    </Screen>
  );
}

function Explanation({ row, userId }: { row: IncidentRow; userId: string }) {
  const colors = useTheme();
  const tone = useTone();
  const router = useRouter();
  const { locale, timeZone } = useLocale();
  const self = useMember();
  const now = useNow(20_000);
  const { data, errorCode } = usePagingData(row, now);
  const { choose, sheet } = useChoiceSheet();
  const [allPages, setAllPages] = useState(false);
  const verdict = data ? whyPaged({ ...data, userId }) : null;
  const who = data ? people(self.userId, data.members) : null;
  const said = verdict && who ? verdictText(verdict, memberName(userId, who)) : null;
  // Another member picked: the screen reader hears their verdict, as the old live region said it.
  const shown = useRef(userId);
  useEffect(() => {
    if (said === null || shown.current === userId) return;
    shown.current = userId;
    AccessibilityInfo.announceForAccessibility(said);
  }, [said, userId]);
  if (errorCode !== undefined) return <Message text={queryErrorReason(errorCode)} />;
  if (!data || !verdict || !who) return <Message text={whyText("loading")} />;

  const why = verdict;
  const name = memberName(userId, who);
  const groups = pageGroups(why.pages);
  const grouped = groups.length < why.pages.length;
  const pages = allPages ? why.pages.map((page) => ({ page, earlier: 0 })) : groups;
  const title = userId === self.userId ? whyText("why_title_you") : whyText("why_title", { name });
  const verdictColor = tone(verdictTone(why.verdict));
  const others = memberChoices(data, userId, who, locale)
    .filter((option) => option.id !== userId)
    .map((option) => ({ value: option.id, label: option.name }));
  // Alone in the workspace: nobody else to pick, so the row is not a button.
  const pick =
    others.length > 0
      ? () =>
          choose(whyText("pick_member"), others, (member: string) => router.setParams({ member }))
      : undefined;
  const step = (key: string, glyph: Glyph, text: string, color?: string) => (
    <ListItem key={key} leading={<RowIcon plain glyph={glyph} color={color} />}>
      <Text textStyle={color ? { color } : undefined}>{text}</Text>
    </ListItem>
  );

  return (
    <>
      <Screen title={title}>
        <FieldGroup.Section title={`${formatIncidentNumber(row.number) ?? ""} ${row.title}`}>
          {/* Like the dashboard's member select: the member, and a tap to pick another if there is one. */}
          <ListItem
            onPress={pick}
            leading={<Avatar name={name} />}
            trailing={
              pick ? <RowIcon plain glyph={GLYPHS.change} color={colors.primary} /> : undefined
            }
            supportingText={whyText("pick_member")}
          >
            <Text>{name}</Text>
          </ListItem>
          <ListItem
            leading={<RowIcon plain glyph={VERDICT_GLYPHS[why.verdict]} color={verdictColor} />}
          >
            <Text textStyle={{ color: verdictColor, fontWeight: "600" }}>{said ?? ""}</Text>
          </ListItem>
        </FieldGroup.Section>

        <FieldGroup.Section>
          {step("member", GLYPHS.member, memberText(why.member.status, name))}
          {step("rule", GLYPHS.step, ruleText(why.rule))}
        </FieldGroup.Section>

        {pages.map(({ page, earlier }, index) =>
          pageSection({
            key: page.step === null ? `interim-${index}` : `step-${page.step}-${index}`,
            page,
            earlier,
            name,
            who,
            now,
            locale,
            timeZone,
            muted: colors.mutedForeground,
            warn: tone("warn"),
          }),
        )}
        {grouped ? (
          <FieldGroup.Section key="all-pages">
            <ListItem onPress={() => setAllPages((current) => !current)}>
              <Text textStyle={{ color: colors.primary }}>
                {allPages
                  ? m.incident_page({ part: "show_less" })
                  : whyText("pages_show_all", { detail: String(why.pages.length) })}
              </Text>
            </ListItem>
          </FieldGroup.Section>
        ) : null}

        <FieldGroup.Section title={whyText("devices_title")}>
          {why.devices.length === 0 ? (
            <ListItem>
              <Text>{whyText("devices_none")}</Text>
            </ListItem>
          ) : (
            why.devices.map((device) => (
              <ListItem
                key={device.id}
                leading={<RowIcon plain glyph={GLYPHS.phone} />}
                supportingText={[
                  whyText("seen", { time: formatAge(device.lastSeenAt, now, locale) }),
                  ...(device.voip ? [whyText("calls")] : []),
                ].join(" · ")}
              >
                <Text>{deviceLabel(device)}</Text>
              </ListItem>
            ))
          )}
        </FieldGroup.Section>

        <FieldGroup.Section>
          {step("calls", CALL_GLYPH, callChoiceText(why.calls, name))}
          {why.email ? step("email", GLYPHS.email, emailText(why.email, name)) : null}
          {why.acknowledged
            ? step(
                "acked",
                GLYPHS.acked,
                whyText("acknowledged", {
                  name: memberName(why.acknowledged.by, who),
                  time: formatAge(why.acknowledged.at, now, locale),
                }),
              )
            : null}
          <FieldGroup.SectionFooter>
            <FooterText>{whyText("privacy")}</FooterText>
          </FieldGroup.SectionFooter>
        </FieldGroup.Section>
      </Screen>
      {sheet}
    </>
  );
}

/**
 * One page as a section of its own, titled with the page and its time: were they on it (or why not), what missed
 * them, each phone's push and then the calls, apart, since they ring after the pushes. An element, not a component:
 * `FieldGroup` takes any child but its own sections for a row.
 */
function pageSection({
  key,
  page,
  earlier,
  name,
  who,
  now,
  locale,
  timeZone,
  muted,
  warn,
}: {
  key: string;
  page: WhyPage;
  /** Pages before this one with the same outcome, folded into it. */
  earlier: number;
  name: string;
  who: People;
  now: number;
  locale: ReturnType<typeof useLocale>["locale"];
  timeZone: string;
  muted: string;
  warn: string;
}) {
  const compact = page.deliveries.length > COMPACT_DEVICES;
  const compactCalls = page.calls.length > COMPACT_DEVICES;
  const at = (value: number) => formatDateTime(value, locale, timeZone, { timeStyle: "medium" });
  return (
    <FieldGroup.Section
      key={key}
      title={`${pageLabel(page)} · ${entryTime(page.at, now, locale, timeZone)}`}
    >
      {earlier > 0 ? (
        <ListItem>
          <Text textStyle={{ color: muted }}>{sameOutcomeText(earlier)}</Text>
        </ListItem>
      ) : null}
      {targetedText(page, name, who).map((line) => (
        <ListItem key={line} leading={<RowIcon plain glyph={GLYPHS.step} />}>
          <Text>{line}</Text>
        </ListItem>
      ))}
      {page.misses.map((miss) => (
        <ListItem
          key={`${miss.reason}-${miss.at}`}
          leading={<RowIcon plain glyph={GLYPHS.miss} color={warn} />}
        >
          <Text textStyle={{ color: warn }}>{missText(miss.reason, name)}</Text>
        </ListItem>
      ))}
      {page.deliveries.map((delivery) => deliveryRow({ delivery, compact, at, muted, warn }))}
      {page.calls.map((delivery) =>
        deliveryRow({ delivery, compact: compactCalls, at, muted, warn }),
      )}
      {page.calls.length > 0 ? (
        <FieldGroup.SectionFooter>
          <FooterText>{whyText("call_note")}</FooterText>
        </FieldGroup.SectionFooter>
      ) : null}
    </FieldGroup.Section>
  );
}

/**
 * One phone's push or call on a page: each stage with its time (only the furthest when `compact`), and why it
 * stopped. A call has no delivered stage, and one never sent was held back because its push never got through. The
 * lines sit in the row's headline column: Android draws a row with a non-text supporting slot three lines tall.
 */
function deliveryRow({
  delivery: { row, stage, stuck },
  compact,
  at,
  muted,
  warn,
}: {
  delivery: WhyDelivery;
  compact: boolean;
  at: (value: number) => string;
  muted: string;
  warn: string;
}) {
  const call = row.kind === "call";
  const reached = stageTimes(row, stuck);
  const furthest = reached.filter((one) => one.at !== null).at(-1)!;
  // A stage and its time join with non-breaking spaces, so a narrow row wraps inside the stage's words instead.
  const line = (stage: string, time: string) => `${stage}\u00a0·\u00a0${time}`;
  const stages = compact
    ? // Many phones: each one's furthest stage only, still with its time.
      [{ text: line(stageText(furthest.stage), at(furthest.at!)), stopped: false }]
    : reached.map(({ stage: one, at: when, stopped }) => ({
        text: line(
          stageText(one),
          when !== null ? at(when) : whyText(stopped ? "stage_stopped" : "stage_none"),
        ),
        stopped: when === null && stopped,
      }));
  const problems = [
    ...(stuck ? [whyText(call ? "call_not_sent" : "stuck_note")] : []),
    ...deliveryError(row),
  ];
  const notes = [
    ...(stage === "accepted" && !compact && !call ? [whyText("no_receipt")] : []),
    ...(row.attempts > 1 ? [whyText("attempts", { detail: String(row.attempts) })] : []),
  ];
  return (
    <ListItem key={row.id} leading={<RowIcon plain glyph={call ? CALL_GLYPH : GLYPHS.phone} />}>
      <Column spacing={spacing[0.5]} alignment="start">
        <Text>{call ? callLabel(row) : deviceLabel(row)}</Text>
        {stages.map((line) => (
          <Text key={line.text} textStyle={{ color: line.stopped ? warn : muted, fontSize: 15 }}>
            {line.text}
          </Text>
        ))}
        {problems.map((text) => (
          <Text key={text} textStyle={{ color: warn, fontSize: 15 }}>
            {text}
          </Text>
        ))}
        {notes.map((text) => (
          <Text key={text} textStyle={{ color: muted, fontSize: 15 }}>
            {text}
          </Text>
        ))}
      </Column>
    </ListItem>
  );
}
