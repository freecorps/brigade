import { m } from "@freecorps/brigade-i18n";
import { incidentStatusLabels, severityLabels } from "@freecorps/brigade-i18n/labels";
import {
  formatIncidentNumber,
  INCIDENT_TITLE_MAX,
  lookup,
  mutations,
  SEVERITIES,
  type IncidentRow,
  type IncidentStatus,
  type Severity,
} from "@freecorps/brigade-schema";
import { nextFailed, syncView, type MutationOutcome, type SyncView } from "@freecorps/brigade-sync";
import {
  useConnectionState,
  useMutation,
  useQuery,
  useSyncClient,
} from "@freecorps/brigade-sync/react";
import { fontFamily, fontSize, radius, spacing } from "@freecorps/brigade-ui";
import { Link } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Badge } from "@/components/badge";
import { useChoiceSheet } from "@/components/choice-sheet";
import { SEV1_GLYPH, STATUS_GLYPHS, type Glyph } from "@/components/glyphs";
import { Row, Section } from "@/components/section";
import { ThemedText } from "@/components/themed-text";
import { useLocale } from "@/hooks/use-locale";
import { useScreenPadding } from "@/hooks/use-screen-padding";
import { useTheme } from "@/hooks/use-theme";
import {
  formatAge,
  nextStatuses,
  refusalFor,
  refusalText,
  pickTarget,
  severityName,
  titleToRestore,
  type Refusal,
  type Target,
} from "@/lib/incidents";

const declareMutation = lookup(mutations, "incident.declare")!;
const CHANGE_GLYPH: Glyph = {
  ios: "chevron.up.chevron.down",
  android: "unfold_more",
  web: "unfold_more",
};

/**
 * The workspace's active incidents, live from its shard, with declare and per-row status and severity changes.
 * Changes show at once and settle when the shard confirms them; a refused one rolls back and leaves a message.
 */
export function Incidents() {
  // A refused list is asked for again only by a new subscriber: "Reload" remounts the list.
  const [attempt, setAttempt] = useState(0);
  return <IncidentList key={attempt} onReload={() => setAttempt((n) => n + 1)} />;
}

function IncidentList({ onReload }: { onReload: () => void }) {
  const colors = useTheme();
  const padding = useScreenPadding();
  const { locale } = useLocale();
  const client = useSyncClient();
  const { rows, status, error } = useQuery("incidents.active", {});
  const connection = useConnectionState();
  const [failed, setFailed] = useState(false);
  const latched = nextFailed(failed, status, connection);
  if (latched !== failed) setFailed(latched);
  const view = syncView(status, connection, latched);

  const declare = useMutation("incident.declare");
  const setStatus = useMutation("incident.setStatus");
  const setSeverity = useMutation("incident.setSeverity");
  const { choose, sheet } = useChoiceSheet();

  // The latest rows, for picks made from a sheet opened on an older list. Updated after each commit, before a
  // sheet's callback can run, since a ref must not be written during render.
  const latest = useRef(rows);
  useLayoutEffect(() => {
    latest.current = rows;
  }, [rows]);
  const [title, setTitle] = useState("");
  const [refusals, setRefusals] = useState<Refusal[]>([]);
  // In-flight changes per incident, so the row can say "Saving…" until the shard answers.
  const [busy, setBusy] = useState<ReadonlyMap<string, number>>(new Map());
  const nextKey = useRef(0);
  const track = (outcome: Promise<MutationOutcome>, target: Target) => {
    const bump = (by: number) =>
      setBusy((current) => {
        const next = new Map(current);
        const count = (next.get(target.incidentId) ?? 0) + by;
        if (count > 0) next.set(target.incidentId, count);
        else next.delete(target.incidentId);
        return next;
      });
    bump(1);
    void outcome.then((result) => {
      bump(-1);
      const refusal = refusalFor(result, target, `r${nextKey.current++}`);
      if (!refusal) return;
      setRefusals((current) => [...current, refusal].slice(-5));
      // VoiceOver has no live regions (accessibilityLiveRegion is Android's), so say it once.
      if (process.env.EXPO_OS === "ios") {
        AccessibilityInfo.announceForAccessibility(refusalText(refusal, "list"));
      }
      // A title the shard refused comes back to the field, unless something new was typed.
      setTitle((field) => titleToRestore(refusal, field) ?? field);
    });
  };

  const [severity, setSeverityChoice] = useState<Severity>("sev3");
  const [invalid, setInvalid] = useState<"empty" | "invalid" | null>(null);
  const onDeclare = () => {
    const id = client.newId("inc");
    const checked = declareMutation.args({ id, title, severity });
    if (!checked.ok) return setInvalid(title.trim() === "" ? "empty" : "invalid");
    const args = checked.value as { id: string; title: string; severity: Severity };
    setInvalid(null);
    setTitle("");
    // Back to the default each time, so a SEV1 chosen once cannot page people again by accident.
    setSeverityChoice("sev3");
    track(declare(args), { kind: "declare", incidentId: id, title: args.title });
  };

  // A sheet stays open while the list moves: each pick is checked against the latest rows before it is sent.
  const pickStatus = (id: string, to: IncidentStatus) => {
    const current = pickTarget(latest.current, id, { kind: "status", to });
    if (!current) return;
    const { number, title: subject } = current;
    track(setStatus({ id, status: to }), {
      kind: "status",
      incidentId: id,
      number,
      title: subject,
      to,
    });
  };
  const pickSeverity = (id: string, to: Severity) => {
    const current = pickTarget(latest.current, id, { kind: "severity", to });
    if (!current) return;
    const { number, title: subject } = current;
    track(setSeverity({ id, severity: to }), {
      kind: "severity",
      incidentId: id,
      number,
      title: subject,
      to,
    });
  };
  const changeStatus = (row: IncidentRow) =>
    choose(
      m.incident_status_label(),
      nextStatuses(row.status).map((to) => ({ value: to, label: incidentStatusLabels[to]() })),
      (to) => pickStatus(row.id, to),
    );
  const changeSeverity = (row: IncidentRow) =>
    choose(
      m.incident_severity_label(),
      SEVERITIES.filter((to) => to !== row.severity).map((to) => ({
        value: to,
        label: severityName(to),
      })),
      (to) => pickSeverity(row.id, to),
    );

  const now = useNow(20_000);
  const listed = new Set(rows.map((row) => row.id));
  const dismiss = (key: string) =>
    setRefusals((current) => current.filter((refusal) => refusal.key !== key));
  const unlisted = refusals.filter((refusal) => !listed.has(refusal.incidentId));
  const sev1 = rows.filter((row) => row.severity === "sev1").length;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[padding, { gap: spacing[6] }]}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing[3] }}>
        <ConnectionStatus view={view} />
        {status === "ready" ? (
          <ThemedText variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
            {m.incidents_active_count({ count: rows.length })}
            {sev1 > 0 ? ` · ${m.incidents_sev1_count({ count: sev1 })}` : ""}
          </ThemedText>
        ) : null}
      </View>

      <Section title={m.declare_heading()}>
        <View style={{ gap: spacing[3] }}>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={m.declare_title_placeholder()}
            placeholderTextColor={colors.mutedForeground}
            accessibilityLabel={m.declare_title_label()}
            maxLength={INCIDENT_TITLE_MAX}
            returnKeyType="done"
            onSubmitEditing={onDeclare}
            style={{
              minHeight: spacing[12],
              paddingHorizontal: spacing[3],
              borderRadius: radius.md,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: invalid ? colors.destructive : colors.input,
              color: colors.foreground,
              fontSize: fontSize.base.size,
            }}
          />
          {invalid ? (
            <ThemedText selectable style={{ color: colors.destructive }}>
              {invalid === "empty" ? m.declare_title_empty() : m.declare_title_invalid()}
            </ThemedText>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing[3] }}>
            <Choice
              label={m.declare_severity_label()}
              value={severityName(severity)}
              onPress={() =>
                choose(
                  m.declare_severity_label(),
                  SEVERITIES.map((to) => ({ value: to, label: severityName(to) })),
                  setSeverityChoice,
                )
              }
            >
              <SeverityBadge severity={severity} />
            </Choice>
            <Pressable
              accessibilityRole="button"
              onPress={onDeclare}
              style={({ pressed }) => ({
                minHeight: spacing[12],
                justifyContent: "center",
                paddingHorizontal: spacing[4],
                borderRadius: radius.md,
                borderCurve: "continuous",
                backgroundColor: colors.primary,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <ThemedText style={{ color: colors.primaryForeground }}>
                {m.declare_submit_severity({ severity: severity.toUpperCase() })}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </Section>

      {rows.length > 0 ? (
        <Section title={m.incidents_title()} inset={false}>
          {rows.map((row, index) => (
            <Row key={row.id} first={index === 0}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: spacing[2] }}>
                <ThemedText variant="label" style={{ fontVariant: ["tabular-nums"] }}>
                  {formatIncidentNumber(row.number) ??
                    (view === "live"
                      ? m.incident_unnumbered_saving()
                      : m.incident_unnumbered_not_sent())}
                </ThemedText>
                <ThemedText variant="caption">
                  {m.incident_declared({ time: formatAge(row.declaredAt, now, locale) })}
                </ThemedText>
                {busy.has(row.id) ? (
                  <ThemedText variant="caption" style={{ color: colors.primary }}>
                    {view === "live" ? m.incident_change_saving() : m.incident_change_queued()}
                  </ThemedText>
                ) : null}
              </View>
              <ThemedText selectable>{row.title}</ThemedText>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: spacing[2],
                  paddingTop: spacing[1],
                }}
              >
                <Choice
                  label={m.incident_severity_label()}
                  value={severityName(row.severity)}
                  onPress={() => changeSeverity(row)}
                >
                  <SeverityBadge severity={row.severity} />
                </Choice>
                <Choice
                  label={m.incident_status_label()}
                  value={incidentStatusLabels[row.status]()}
                  disabled={nextStatuses(row.status).length === 0}
                  onPress={() => changeStatus(row)}
                >
                  <Badge
                    colors={colors.status[row.status]}
                    icon={STATUS_GLYPHS[row.status]}
                    label={incidentStatusLabels[row.status]()}
                  />
                </Choice>
              </View>
              {refusals
                .filter((refusal) => refusal.incidentId === row.id)
                .map((refusal) => (
                  <Notice key={refusal.key} onDismiss={() => dismiss(refusal.key)}>
                    {refusalText(refusal, "row")}
                  </Notice>
                ))}
            </Row>
          ))}
        </Section>
      ) : status === "ready" ? (
        <Section title={m.incidents_title()}>
          <ThemedText>{m.incidents_all_clear()}</ThemedText>
        </Section>
      ) : null}

      {unlisted.map((refusal) => (
        <Notice key={refusal.key} onDismiss={() => dismiss(refusal.key)}>
          {refusalText(refusal, "list")}
        </Notice>
      ))}
      <StatePanel view={view} errorCode={error?.code} onReload={onReload} />

      <Link href="/legend" asChild>
        <Pressable accessibilityRole="link">
          {/* Sized inside: Link's `asChild` drops a style function on the Pressable. 48pt tall to tap. */}
          {({ pressed }) => (
            <View style={{ minHeight: spacing[12], justifyContent: "center" }}>
              <ThemedText style={{ color: colors.primary, opacity: pressed ? 0.6 : 1 }}>
                {m.legend_title()}
              </ThemedText>
            </View>
          )}
        </Pressable>
      </Link>
      {sheet}
    </ScrollView>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const colors = useTheme();
  return (
    <Badge
      colors={colors.severity[severity]}
      code={severity.toUpperCase()}
      icon={severity === "sev1" ? SEV1_GLYPH : undefined}
      label={severityLabels[severity]()}
    />
  );
}

/** A badge that opens a choice: one button, read as "Status: Investigating". */
function Choice({
  label,
  value,
  disabled = false,
  onPress,
  children,
}: {
  label: string;
  /** The current value, spoken after the label. */
  value: string;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const colors = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      accessibilityHint={disabled ? undefined : m.mobile_change_hint()}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      // The badge is short; the hit area is at least 44 points tall.
      hitSlop={spacing[2]}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing[1],
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {children}
      {disabled ? null : (
        <SymbolView
          name={CHANGE_GLYPH}
          tintColor={colors.mutedForeground}
          size={fontSize.sm.size}
        />
      )}
    </Pressable>
  );
}

function Notice({ children, onDismiss }: { children: string; onDismiss: () => void }) {
  const colors = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing[2],
        padding: spacing[3],
        borderRadius: radius.md,
        borderCurve: "continuous",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.destructive,
      }}
    >
      <ThemedText selectable style={{ flex: 1, color: colors.destructive }}>
        {children}
      </ThemedText>
      <Pressable accessibilityRole="button" onPress={onDismiss} hitSlop={spacing[3]}>
        <ThemedText style={{ color: colors.primary }}>{m.dismiss()}</ThemedText>
      </Pressable>
    </View>
  );
}

const CONNECTION: Record<
  SyncView,
  { text: () => string; glyph?: Glyph; tone: "ok" | "muted" | "bad" }
> = {
  live: { text: m.sync_live, tone: "ok" },
  connecting: { text: m.sync_connecting, tone: "muted" },
  reconnecting: {
    text: m.sync_reconnecting,
    glyph: { ios: "arrow.clockwise", android: "sync", web: "sync" },
    tone: "muted",
  },
  unavailable: {
    text: m.sync_unavailable,
    glyph: { ios: "exclamationmark.circle", android: "error", web: "error" },
    tone: "bad",
  },
  refused: {
    text: m.sync_refused,
    glyph: { ios: "exclamationmark.circle", android: "error", web: "error" },
    tone: "bad",
  },
};

/** Calm by design: a word and a small glyph, never a banner, since a reconnect usually fixes itself. */
function ConnectionStatus({ view }: { view: SyncView }) {
  const colors = useTheme();
  const { text, glyph, tone } = CONNECTION[view];
  const color =
    tone === "ok" ? colors.primary : tone === "bad" ? colors.destructive : colors.mutedForeground;
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      style={{ flexDirection: "row", alignItems: "center", gap: spacing[2] }}
    >
      {glyph ? (
        <SymbolView name={glyph} tintColor={color} size={fontSize.sm.size} />
      ) : (
        <View
          style={{
            width: spacing[2],
            height: spacing[2],
            borderRadius: spacing[1],
            backgroundColor: color,
          }}
        />
      )}
      <ThemedText variant="label" style={{ color: tone === "ok" ? colors.foreground : color }}>
        {text()}
      </ThemedText>
    </View>
  );
}

/** Below the list: why it is stale or missing, and what happens next. */
function StatePanel({
  view,
  errorCode,
  onReload,
}: {
  view: SyncView;
  errorCode: string | undefined;
  onReload: () => void;
}) {
  const colors = useTheme();
  if (view === "reconnecting") {
    return <ThemedText variant="caption">{m.sync_reconnecting_hint()}</ThemedText>;
  }
  if (view !== "unavailable" && view !== "refused") return null;
  return (
    <View style={{ gap: spacing[2] }}>
      {view === "refused" ? (
        <>
          <ThemedText selectable>
            {m.sync_refused_hint({
              reason:
                errorCode === "forbidden" ? m.sync_error_read_forbidden() : m.sync_error_internal(),
            })}
          </ThemedText>
          <Pressable accessibilityRole="button" onPress={onReload} hitSlop={spacing[3]}>
            <ThemedText style={{ color: colors.primary }}>{m.reload()}</ThemedText>
          </Pressable>
        </>
      ) : __DEV__ ? (
        <>
          <ThemedText selectable>{m.sync_unavailable_hint()}</ThemedText>
          <ThemedText selectable style={{ fontFamily: Platform.select(fontFamily.native.mono) }}>
            vp run dev
          </ThemedText>
          <ThemedText variant="caption">{m.mobile_sync_retrying()}</ThemedText>
        </>
      ) : (
        <>
          <ThemedText selectable>{m.mobile_sync_offline_hint()}</ThemedText>
          <ThemedText variant="caption">{m.mobile_sync_retrying()}</ThemedText>
        </>
      )}
    </View>
  );
}

/** Epoch ms, refreshed every `ms`, so relative times move on their own. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
