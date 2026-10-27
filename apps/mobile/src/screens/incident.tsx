import { formatNumber, m } from "@freecorps/brigade-i18n";
import {
  entryTime,
  formatAge,
  itemText,
  noticeFor,
  noticeText,
  pagesFailedNames,
  people,
  personName,
  queryErrorReason,
  severityName,
  type Notice as Refusal,
  type NoticeTarget,
  type People,
} from "@freecorps/brigade-i18n/incident";
import { incidentStatusLabels } from "@freecorps/brigade-i18n/labels";
import {
  can,
  formatIncidentNumber,
  INCIDENT_ROLES,
  SEVERITIES,
  UPDATE_BODY_MAX,
  type IncidentRole,
  type IncidentRow,
  type TimelineRow,
} from "@freecorps/brigade-schema";
import {
  adjustBusy,
  assignable,
  bodyParts,
  checkUpdate,
  nextFailed,
  nextStatuses,
  syncView,
  timelineItems,
  UPDATE_COUNT_FROM,
  updateLength,
  type MutationOutcome,
  type SyncView,
  type TimelineItem,
  type UpdateProblem,
} from "@freecorps/brigade-sync";
import { useConnectionState, useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { fontSize, radius, spacing } from "@freecorps/brigade-ui";
import { Stack } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { SymbolView } from "expo-symbols";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useGlyphSize } from "@/components/badge";
import { useChoiceSheet } from "@/components/choice-sheet";
import { IncidentDetails } from "@/components/incident-details";
import { STATUS_GLYPHS, type Glyph } from "@/components/glyphs";
import {
  Choice,
  ConnectionStatus,
  Notice,
  SeverityBadge,
  StatePanel,
  StatusBadge,
  useNow,
} from "@/components/incident-parts";
import { Row, Section } from "@/components/section";
import { useMember } from "@/components/session";
import { ThemedText } from "@/components/themed-text";
import { useLocale } from "@/hooks/use-locale";
import { useScreenPadding } from "@/hooks/use-screen-padding";
import { useTheme } from "@/hooks/use-theme";
import { restoredTarget } from "@/lib/pending";
import { currentSync } from "@/lib/sync-client";

const MAX_NOTICES = 5;
/** Lines of an update shown before Show more. */
const UPDATE_LINES = 12;

/** `/incidents/12` → 12; anything else (zero, signs, leading zeros, too long) is no incident. */
export function parseIncidentNumber(raw: string): number | null {
  if (!/^[1-9][0-9]{0,15}$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

/**
 * One incident by its number, as the dashboard's incident page (RFC 0003): severity and status (changed from here
 * too), its roles, written updates and the timeline, newest first. Live from the workspace shard; every change
 * shows at once and settles when the shard confirms it.
 */
export function IncidentScreen({ number }: { number: number | null }) {
  // A refused incident is asked for again only by a new subscriber: "Reload" remounts it.
  const [attempt, setAttempt] = useState(0);
  return number === null ? (
    <Problem text={m.incident_page({ part: "not_found" })} />
  ) : (
    <ByNumber key={attempt} number={number} onReload={() => setAttempt((n) => n + 1)} />
  );
}

function ByNumber({ number, onReload }: { number: number; onReload: () => void }) {
  const { rows, status, error } = useQuery("incident.byNumber", { number });
  const connection = useConnectionState();
  const [failed, setFailed] = useState(false);
  const latched = nextFailed(failed, status, connection);
  if (latched !== failed) setFailed(latched);
  const view = syncView(status, connection, latched);
  const row = rows[0];
  if (row) {
    return (
      <Incident
        row={row}
        view={view}
        state={
          <StatePanel view={view} errorCode={error?.code} onReload={onReload} subject="incident" />
        }
      />
    );
  }
  if (status === "error") {
    return (
      <Problem
        title={m.incident_page({ part: "load_failed_title" })}
        text={queryErrorReason(error?.code)}
      />
    );
  }
  if (status === "ready") return <Problem text={m.incident_page({ part: "not_found" })} />;
  return <Loading />;
}

/** Scrolls the page so all of a view is above the keyboard, once the keyboard is up. */
const RevealContext = createContext<(node: ComponentRef<typeof View> | null) => void>(() => {});

/** Space kept between what is revealed and the keyboard. */
const REVEAL_MARGIN = spacing[3];

/**
 * The incident's scrolling page. The keyboard never covers the update box or Post: iOS insets the scroll view by
 * the keyboard; Android draws edge to edge (the window no longer resizes for it), so the page shrinks above it.
 * Either way only the focused field is scrolled into view, so the form asks for all of itself (`RevealContext`).
 */
function Screen({ title, children }: { title: string; children: ReactNode }) {
  const colors = useTheme();
  const padding = useScreenPadding();
  const header = useHeaderHeight();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const offset = useRef(0);
  // Keyboard listeners and scrolls still waiting: leaving the page drops them.
  const pending = useRef(new Set<() => void>());
  const reveal = useCallback((node: ComponentRef<typeof View> | null) => {
    const scrollTo = () => {
      const page = scroll.current;
      const keyboard = Keyboard.metrics();
      if (!node || !page || !keyboard) return;
      page.getNativeScrollRef()?.measureInWindow((_x, top, _width, height) => {
        // The visible part of the page ends at the keyboard, or above it where the page shrank (Android).
        const bottom = Math.min(keyboard.screenY, top + height);
        node.measureInWindow((_nx, nodeTop, _nwidth, nodeHeight) => {
          const below = nodeTop + nodeHeight + REVEAL_MARGIN - bottom;
          if (below > 0) page.scrollTo({ y: offset.current + below, animated: true });
        });
      });
    };
    // After the keyboard is up and the page has been laid out above it.
    const settle = () => {
      const timer = setTimeout(() => {
        pending.current.delete(cancel);
        scrollTo();
      }, 50);
      const cancel = () => clearTimeout(timer);
      pending.current.add(cancel);
    };
    if (Keyboard.isVisible()) return settle();
    const stop = () => {
      shown.remove();
      clearTimeout(expiry);
      pending.current.delete(stop);
    };
    const shown = Keyboard.addListener("keyboardDidShow", () => {
      stop();
      settle();
    });
    const expiry = setTimeout(stop, 1_000);
    pending.current.add(stop);
  }, []);
  useEffect(() => {
    const waiting = pending.current;
    return () => {
      for (const cancel of waiting) cancel();
      waiting.clear();
    };
  }, []);
  const page = (
    <ScrollView
      ref={scroll}
      onScroll={(event) => {
        offset.current = event.nativeEvent.contentOffset.y;
      }}
      scrollEventThrottle={16}
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[padding, { gap: spacing[6] }]}
    >
      <Stack.Screen options={{ title }} />
      <RevealContext value={reveal}>{children}</RevealContext>
    </ScrollView>
  );
  if (process.env.EXPO_OS !== "android") return page;
  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={header}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      {page}
    </KeyboardAvoidingView>
  );
}

function Loading() {
  const colors = useTheme();
  return (
    <Screen title={m.incident_page({ part: "*" })}>
      <View accessibilityRole="progressbar" style={{ flexDirection: "row", gap: spacing[3] }}>
        <ActivityIndicator color={colors.mutedForeground} />
        <ThemedText variant="caption">{m.incident_page({ part: "loading" })}</ThemedText>
      </View>
    </Screen>
  );
}

function Problem({
  title = m.incident_page({ part: "not_found_title" }),
  text,
}: {
  title?: string;
  text: string;
}) {
  return (
    <Screen title={title}>
      <ThemedText selectable>{text}</ThemedText>
    </Screen>
  );
}

/** Busy keys: `status`, `severity`, `update`, `role/<role>`. */
type Busy = ReadonlyMap<string, number>;

function Incident({ row, view, state }: { row: IncidentRow; view: SyncView; state: ReactNode }) {
  const colors = useTheme();
  const { locale } = useLocale();
  const member = useMember();
  const online = view === "live";
  const editable = can(member.role, "incident:update");
  const members = useQuery("members.all", {});
  const who = people(member.userId, members.rows);
  const { choose, sheet } = useChoiceSheet();

  const setStatus = useMutation("incident.setStatus");
  const setSeverity = useMutation("incident.setSeverity");
  const postUpdate = useMutation("incident.postUpdate");
  const assignRole = useMutation("incident.assignRole");

  const [busy, setBusy] = useState<Busy>(new Map());
  const [notices, setNotices] = useState<Refusal[]>([]);
  const nextKey = useRef(0);
  const track = useCallback(
    (outcome: Promise<MutationOutcome>, target: NoticeTarget, key: string) => {
      setBusy((current) => adjustBusy(current, [key], 1));
      return outcome.then((result) => {
        setBusy((current) => adjustBusy(current, [key], -1));
        const notice = noticeFor(result, target, `n${nextKey.current++}`);
        if (notice) {
          setNotices((current) => [...current, notice].slice(-MAX_NOTICES));
          // VoiceOver has no live regions (accessibilityLiveRegion is Android's), so say it once.
          if (process.env.EXPO_OS === "ios") {
            AccessibilityInfo.announceForAccessibility(noticeText(notice, "row"));
          }
        }
        return notice;
      });
    },
    [],
  );
  const base = { incidentId: row.id, number: row.number, title: row.title };
  // Changes to it kept from before a restart (src/lib/pending.ts) show as not sent yet until the shard answers, and
  // a refusal (or an expiry) leaves its notice here, as a new change's would.
  const latestBase = useRef(base);
  useLayoutEffect(() => {
    latestBase.current = base;
  });
  useEffect(() => {
    const restored = currentSync()?.restored;
    if (!restored) return;
    for (const change of restored.list) {
      const target = restoredTarget(change);
      if (!target || target.incidentId !== row.id || target.notice.kind === "declare") continue;
      const { kind, to, role } = target.notice;
      void track(restored.claim(change), { ...latestBase.current, kind, to, role }, target.key);
    }
  }, [row.id, track]);
  const dismiss = (key: string) =>
    setNotices((current) => current.filter((notice) => notice.key !== key));
  const noticesFor = (kinds: Refusal["kind"][]) =>
    notices
      .filter((notice) => kinds.includes(notice.kind))
      .map((notice) => (
        <Notice key={notice.key} onDismiss={() => dismiss(notice.key)}>
          {noticeText(notice, "row")}
        </Notice>
      ));

  const changeStatus = () =>
    choose(
      m.incident_status_label(),
      nextStatuses(row.status).map((to) => ({ value: to, label: incidentStatusLabels[to]() })),
      (to) =>
        void track(
          setStatus({ id: row.id, status: to }),
          { ...base, kind: "status", to },
          "status",
        ),
    );
  const changeSeverity = () =>
    choose(
      m.incident_severity_label(),
      SEVERITIES.filter((to) => to !== row.severity).map((to) => ({
        value: to,
        label: severityName(to),
      })),
      (to) =>
        void track(
          setSeverity({ id: row.id, severity: to }),
          { ...base, kind: "severity", to },
          "severity",
        ),
    );
  const changeRole = (role: IncidentRole, holder: string | null) => {
    // The holder stays listed even if the shard no longer counts them as assignable (a viewer now).
    const options = assignable(members.rows);
    const listed =
      holder === null || options.some((option) => option.id === holder)
        ? options
        : [...options, { id: holder, name: null, role: "viewer" as const, updatedAt: 0 }];
    choose(
      m.incident_role({ role, form: "title" }),
      [
        ...(holder === null ? [] : [{ value: "", label: m.incident_page({ part: "unassign" }) }]),
        ...listed
          .filter((option) => option.id !== holder)
          .map((option) => ({ value: option.id, label: personName(option.id, who) })),
      ],
      (value: string) =>
        void track(
          assignRole({ id: row.id, role, userId: value === "" ? null : value }),
          { ...base, kind: "role", role },
          `role/${role}`,
        ),
    );
  };

  const now = useNow(20_000);
  const number = formatIncidentNumber(row.number) ?? "";
  const saving = busy.has("status") || busy.has("severity");

  return (
    <Screen title={number}>
      <View style={{ gap: spacing[3] }}>
        <ConnectionStatus view={view} />
        {state}
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: spacing[2] }}>
          <ThemedText variant="caption">
            {m.incident_declared({ time: formatAge(row.declaredAt, now, locale) })}
          </ThemedText>
          {saving ? (
            <ThemedText variant="caption" style={{ color: colors.mutedForeground }}>
              {online ? m.incident_change_saving() : m.incident_change_queued()}
            </ThemedText>
          ) : null}
        </View>
        <ThemedText variant="heading" selectable accessibilityRole="header">
          {row.title}
        </ThemedText>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing[3] }}>
          <Choice
            label={m.incident_severity_label()}
            value={severityName(row.severity)}
            disabled={!editable}
            onPress={changeSeverity}
          >
            <SeverityBadge severity={row.severity} />
          </Choice>
          <Choice
            label={m.incident_status_label()}
            value={incidentStatusLabels[row.status]()}
            disabled={!editable || nextStatuses(row.status).length === 0}
            onPress={changeStatus}
          >
            <StatusBadge status={row.status} />
          </Choice>
        </View>
        {noticesFor(["status", "severity"])}
        {editable ? null : (
          <ThemedText variant="caption">{m.incident_page({ part: "read_only" })}</ThemedText>
        )}
      </View>

      {/* Roles before the timeline: short, and what a responder looks for first. */}
      <Section title={m.incident_page({ part: "roles" })} inset={false}>
        {INCIDENT_ROLES.map((role, index) => (
          <RoleRow
            key={role}
            first={index === 0}
            role={role}
            holder={row.roles?.[role] ?? null}
            who={who}
            pending={busy.has(`role/${role}`)}
            editable={editable}
            onPress={() => changeRole(role, row.roles?.[role] ?? null)}
          />
        ))}
      </Section>
      {members.status === "ready" && assignable(members.rows).length <= 1 ? (
        <ThemedText variant="caption">{m.incident_page({ part: "no_members" })}</ThemedText>
      ) : null}
      {noticesFor(["role"])}
      <IncidentDetails row={row} />

      <View style={{ gap: spacing[3] }}>
        <ThemedText variant="label" accessibilityRole="header">
          {m.incident_page({ part: "timeline" })}
        </ThemedText>
        {editable ? (
          <UpdateForm
            incidentId={row.id}
            pending={busy.has("update") && online}
            onPost={(body) =>
              track(postUpdate({ id: row.id, body }), { ...base, kind: "update" }, "update")
            }
          />
        ) : null}
        {noticesFor(["update"])}
        <Timeline
          incidentId={row.id}
          who={who}
          now={now}
          unsent={busy.get("update") ?? 0}
          online={online}
        />
      </View>
      {sheet}
    </Screen>
  );
}

const PERSON_GLYPH: Glyph = { ios: "person", android: "person", web: "person" };
const CHANGE_GLYPH: Glyph = {
  ios: "chevron.up.chevron.down",
  android: "unfold_more",
  web: "unfold_more",
};

function RoleRow({
  first,
  role,
  holder,
  who,
  pending,
  editable,
  onPress,
}: {
  first: boolean;
  role: IncidentRole;
  holder: string | null;
  who: People;
  pending: boolean;
  editable: boolean;
  onPress: () => void;
}) {
  const colors = useTheme();
  const glyph = useGlyphSize(fontSize.sm.size);
  const label = m.incident_role({ role, form: "title" });
  const name = holder === null ? m.incident_page({ part: "nobody" }) : personName(holder, who);
  const content = (
    <Row first={first}>
      <ThemedText variant="label">{label}</ThemedText>
      {/* Top-aligned, as the timeline's glyphs: a long name wraps under itself, not around the icon. */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing[2] }}>
        <View style={{ paddingTop: spacing[0.5] }}>
          <SymbolView name={PERSON_GLYPH} tintColor={colors.mutedForeground} size={glyph} />
        </View>
        <ThemedText
          style={{
            flex: 1,
            color: holder === null ? colors.mutedForeground : colors.foreground,
          }}
        >
          {name}
        </ThemedText>
        {pending ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : null}
        {/* Opens a choice, as the badges' chevron says. */}
        {editable ? (
          <SymbolView name={CHANGE_GLYPH} tintColor={colors.mutedForeground} size={glyph} />
        ) : null}
      </View>
    </Row>
  );
  if (!editable)
    return (
      <View accessible accessibilityLabel={`${label}, ${name}`}>
        {content}
      </View>
    );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${name}`}
      accessibilityHint={m.mobile_session({ part: "assign_hint" })}
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.accent : "transparent" })}
    >
      {content}
    </Pressable>
  );
}

/**
 * A text box and Post. Text the shard would refuse is caught here and stays; a refusal from the shard gives the
 * text back unless something new was typed. `pending`: a post is on its way (offline, the timeline says it waits
 * instead). Focused, the whole form scrolls above the keyboard, Post included.
 */
function UpdateForm({
  incidentId,
  pending,
  onPost,
}: {
  incidentId: string;
  pending: boolean;
  onPost: (body: string) => Promise<Refusal | undefined>;
}) {
  const colors = useTheme();
  const { locale } = useLocale();
  const [body, setBody] = useState("");
  const [invalid, setInvalid] = useState<UpdateProblem | null>(null);
  const reveal = use(RevealContext);
  const form = useRef<ComponentRef<typeof View>>(null);
  const focused = useRef(false);
  // No `maxLength`: it would cut a pasted update short without a word. The count shows near the limit instead.
  const length = updateLength(body);
  const counting = length >= UPDATE_COUNT_FROM;
  const over = length > UPDATE_BODY_MAX;

  const submit = () => {
    const checked = checkUpdate(incidentId, body);
    if (!checked.ok) return setInvalid(checked.reason);
    setInvalid(null);
    const typed = body;
    setBody("");
    void onPost(checked.args.body).then((notice) => {
      if (notice) setBody((current) => (current === "" ? typed : current));
    });
  };

  return (
    <View ref={form} style={{ gap: spacing[2] }}>
      <TextInput
        value={body}
        onFocus={() => {
          focused.current = true;
          reveal(form.current);
        }}
        onBlur={() => {
          focused.current = false;
        }}
        // A growing draft pushes Post down: keep all of the form above the keyboard while typing.
        onContentSizeChange={() => {
          if (focused.current) reveal(form.current);
        }}
        onChangeText={(text) => {
          setBody(text);
          if (invalid) setInvalid(null);
        }}
        multiline
        placeholder={m.incident_page({ part: "update_placeholder" })}
        placeholderTextColor={colors.mutedForeground}
        accessibilityLabel={m.incident_page({ part: "update_label" })}
        accessibilityHint={m.incident_page({ part: "update_hint" })}
        style={{
          minHeight: spacing[16] + spacing[8],
          maxHeight: spacing[16] * 4,
          paddingHorizontal: spacing[3],
          paddingTop: spacing[3],
          paddingBottom: spacing[3],
          borderRadius: radius.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: invalid ? colors.destructive : colors.input,
          color: colors.foreground,
          fontSize: fontSize.base.size,
          textAlignVertical: "top",
        }}
      />
      {invalid ? (
        <ThemedText
          selectable
          accessibilityLiveRegion="polite"
          style={{ color: colors.destructive }}
        >
          {invalid === "long"
            ? m.auth_error_too_long({ max: formatNumber(UPDATE_BODY_MAX, locale) })
            : m.incident_page({ part: invalid === "empty" ? "update_empty" : "update_invalid" })}
        </ThemedText>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: spacing[3],
        }}
      >
        <ThemedText
          variant="caption"
          style={{ flexShrink: 1, ...(over ? { color: colors.destructive } : {}) }}
        >
          {counting
            ? m.incident_update_length({
                count: formatNumber(length, locale),
                max: formatNumber(UPDATE_BODY_MAX, locale),
              })
            : m.incident_page({ part: "update_hint" })}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: pending }}
          onPress={submit}
          style={({ pressed }) => ({
            minHeight: spacing[12],
            flexDirection: "row",
            alignItems: "center",
            gap: spacing[2],
            paddingHorizontal: spacing[4],
            borderRadius: radius.md,
            borderCurve: "continuous",
            backgroundColor: colors.primary,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          {pending ? <ActivityIndicator color={colors.primaryForeground} /> : null}
          <ThemedText style={{ color: colors.primaryForeground }}>
            {m.incident_page({ part: "post" })}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

/** An entry of a kind a newer shard wrote that this build does not know yet (an app store build lags the server). */
const UNKNOWN_ENTRY_GLYPH: Glyph = {
  ios: "circle.dotted",
  android: "radio_button_unchecked",
  web: "radio_button_unchecked",
};

const ENTRY_GLYPHS: Record<Exclude<TimelineRow["kind"], "status_changed">, Glyph> = {
  declared: { ios: "plus.circle", android: "add_circle", web: "add_circle" },
  severity_changed: { ios: "gauge.with.dots.needle.67percent", android: "speed", web: "speed" },
  acknowledged: { ios: "bell.slash", android: "notifications_off", web: "notifications_off" },
  role_assigned: PERSON_GLYPH,
  update: { ios: "text.bubble", android: "chat", web: "chat" },
  alert_resolved: { ios: "heart.text.square", android: "monitor_heart", web: "monitor_heart" },
  page_failed: { ios: "phone.down", android: "phone_missed", web: "phone_missed" },
  email_failed: { ios: "envelope.badge", android: "unsubscribe", web: "unsubscribe" },
  slack_failed: {
    ios: "exclamationmark.bubble",
    android: "feedback",
    web: "feedback",
  },
  status_published: { ios: "globe", android: "public", web: "public" },
  status_corrected: { ios: "pencil.line", android: "edit", web: "edit" },
  escalated: { ios: "bell.and.waves.left.and.right", android: "campaign", web: "campaign" },
  escalation_exhausted: { ios: "hourglass", android: "hourglass_empty", web: "hourglass_empty" },
  type_changed: { ios: "tag", android: "label", web: "label" },
  services_changed: { ios: "square.stack.3d.up", android: "layers", web: "layers" },
  field_changed: { ios: "square.and.pencil", android: "edit_note", web: "edit_note" },
  follow_up: { ios: "checklist", android: "checklist", web: "checklist" },
  postmortem: { ios: "doc.text", android: "description", web: "description" },
};

/**
 * The incident's timeline, newest first: one line per change, and an update's text under its line. The member's
 * `unsent` newest updates are still on their way (applied here, not yet confirmed by the shard), and say so.
 */
function Timeline({
  incidentId,
  who,
  now,
  unsent,
  online,
}: {
  incidentId: string;
  who: People;
  now: number;
  unsent: number;
  online: boolean;
}) {
  const colors = useTheme();
  const glyphSize = useGlyphSize(fontSize.base.size);
  const { locale, timeZone } = useLocale();
  const { rows, status, pending } = useQuery("incident.timeline", { id: incidentId });
  if (rows.length === 0) {
    return status === "ready" ? (
      <ThemedText variant="caption">{m.incident_page({ part: "timeline_empty" })}</ThemedText>
    ) : null;
  }
  const entries = [...rows].reverse();
  // Pages one run could not send for the same reason are one line (a SEV1 can fail for most of the workspace).
  const items = timelineItems(entries);
  // Unconfirmed changes are re-applied after the shard's rows, so the member's unsent updates are the newest ones.
  const waiting = new Set<string>();
  if (pending) {
    for (const entry of entries) {
      if (waiting.size >= unsent) break;
      if (entry.kind === "update" && entry.actor === who.self) waiting.add(entry.id);
    }
  }
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: radius.xl,
        borderCurve: "continuous",
        overflow: "hidden",
      }}
    >
      {items.map((item, index) => {
        const entry = item.kind === "entry" ? item.entry : item.entries[0];
        const glyph =
          (entry.kind === "status_changed"
            ? STATUS_GLYPHS[entry.to]
            : (ENTRY_GLYPHS as Partial<Record<string, Glyph>>)[entry.kind]) ?? UNKNOWN_ENTRY_GLYPH;
        const tint =
          entry.kind === "page_failed" ||
          entry.kind === "email_failed" ||
          entry.kind === "slack_failed"
            ? colors.destructive
            : entry.kind === "update" ||
                entry.kind === "status_published" ||
                entry.kind === "status_corrected"
              ? colors.primary
              : colors.mutedForeground;
        return (
          <Row key={item.kind === "entry" ? entry.id : item.key} first={index === 0}>
            <View style={{ flexDirection: "row", gap: spacing[3] }}>
              <View style={{ paddingTop: spacing[0.5] }}>
                <SymbolView name={glyph} tintColor={tint} size={glyphSize} />
              </View>
              <View style={{ flex: 1, gap: spacing[1] }}>
                <ThemedText selectable>{itemText(item, who)}</ThemedText>
                {waiting.has(entry.id) ? (
                  <ThemedText
                    variant="caption"
                    accessibilityLiveRegion="polite"
                    style={{ color: colors.mutedForeground }}
                  >
                    {m.mobile_session({ part: online ? "update_sending" : "update_waiting" })}
                  </ThemedText>
                ) : (
                  <ThemedText variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
                    {entryTime(entry.at, now, locale, timeZone)}
                  </ThemedText>
                )}
                {entry.kind === "update" ||
                entry.kind === "status_published" ||
                entry.kind === "status_corrected" ? (
                  <UpdateBody body={entry.body} />
                ) : null}
                {item.kind === "pages_failed" ? <FailedNames item={item} who={who} /> : null}
              </View>
            </View>
          </Row>
        );
      })}
    </View>
  );
}

/** Who a group of failed pages was for, behind Show names. */
function FailedNames({
  item,
  who,
}: {
  item: Extract<TimelineItem, { kind: "pages_failed" }>;
  who: People;
}) {
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ alignItems: "flex-start" }}>
      {/* Above the list, so closing a long one leaves the button where it was tapped. */}
      <TextButton expanded={open} onPress={() => setOpen((shown) => !shown)}>
        {m.incident_page({ part: open ? "hide_names" : "show_names" })}
      </TextButton>
      {/* One text per name, spaced apart, so a name that wraps never reads as two people. */}
      {open ? (
        <View style={{ alignSelf: "stretch", gap: spacing[1] }}>
          {pagesFailedNames(item, who, locale).map(({ id, name }) => (
            <ThemedText key={id} selectable variant="caption">
              {name}
            </ThemedText>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** A link-styled button that opens or closes something, 48 dp tall however short its text. */
function TextButton({
  expanded,
  onPress,
  children,
}: {
  expanded: boolean;
  onPress: () => void;
  children: string;
}) {
  const colors = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: spacing[12],
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <ThemedText style={{ color: colors.primary }}>{children}</ThemedText>
    </Pressable>
  );
}

/**
 * An update's text, with its links tappable (opened in the browser), clamped to `UPDATE_LINES` lines with Show more
 * when it is longer, so one long update does not push the rest of the timeline away.
 */
function UpdateBody({ body }: { body: string }) {
  const colors = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [long, setLong] = useState(false);
  const parts = bodyParts(body).map((part, index) =>
    "url" in part ? (
      <Text
        key={index}
        accessibilityRole="link"
        onPress={() => void Linking.openURL(part.url).catch(() => {})}
        style={{ color: colors.primary, textDecorationLine: "underline" }}
      >
        {part.url}
      </Text>
    ) : (
      part.text
    ),
  );
  return (
    <View style={{ gap: spacing[1], alignItems: "flex-start" }}>
      <View
        style={{
          alignSelf: "stretch",
          backgroundColor: colors.muted,
          borderRadius: radius.md,
          borderCurve: "continuous",
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[2],
        }}
      >
        {/* Laid out unclamped and unseen, to count its lines: a clamped text reports at most the clamp, so a
            text of exactly UPDATE_LINES lines could not be told from a longer one. */}
        <ThemedText
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          onTextLayout={(event) => setLong(event.nativeEvent.lines.length > UPDATE_LINES)}
          style={{
            position: "absolute",
            opacity: 0,
            left: spacing[3],
            right: spacing[3],
            top: spacing[2],
          }}
        >
          {body}
        </ThemedText>
        <ThemedText selectable numberOfLines={expanded ? undefined : UPDATE_LINES}>
          {parts}
        </ThemedText>
      </View>
      {long || expanded ? (
        <TextButton expanded={expanded} onPress={() => setExpanded((open) => !open)}>
          {m.incident_page({ part: expanded ? "show_less" : "show_more" })}
        </TextButton>
      ) : null}
    </View>
  );
}
