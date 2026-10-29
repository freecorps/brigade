import { m } from "@freecorps/brigade-i18n";
import {
  formatAge,
  noticeFor,
  noticeText,
  severityName,
  type Notice as Refusal,
  type NoticeTarget,
} from "@freecorps/brigade-i18n/incident";
import { incidentStatusLabels } from "@freecorps/brigade-i18n/labels";
import {
  can,
  formatIncidentNumber,
  INCIDENT_TITLE_MAX,
  SEVERITIES,
  type IncidentRow,
  type IncidentStatus,
  type Severity,
} from "@freecorps/brigade-schema";
import {
  checkDeclare,
  nextFailed,
  nextStatuses,
  pickTarget,
  syncView,
  type MutationOutcome,
} from "@freecorps/brigade-sync";
import {
  useConnectionState,
  useMutation,
  useQuery,
  useSyncClient,
} from "@freecorps/brigade-sync/react";
import { fontSize, radius, spacing } from "@freecorps/brigade-ui";
import { Link } from "expo-router";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Pressable, ScrollView, TextInput, View } from "react-native";
import { PagingNotice } from "@/components/account";
import {
  Choice,
  ConnectionStatus,
  Notice,
  SeverityBadge,
  StatePanel,
  StatusBadge,
  useNow,
} from "@/components/incident-parts";
import { useChoiceSheet } from "@/components/choice-sheet";
import { OnCallStatus } from "@/components/oncall";
import { Row, Section } from "@/components/section";
import { ThemedText } from "@/components/themed-text";
import { useLocale } from "@/hooks/use-locale";
import { useScreenPadding } from "@/hooks/use-screen-padding";
import { useTheme } from "@/hooks/use-theme";
import { useMember } from "@/components/session";
import { titleToRestore } from "@/lib/incidents";
import { restoredTarget } from "@/lib/pending";
import { currentSync } from "@/lib/sync-client";

/**
 * The signed-in member's workspace: its active incidents, live from its shard, with declare and per-row status and
 * severity changes (for those who may make them), each row opening the incident. Changes show at once and settle
 * when the shard confirms them; a refused one rolls back and leaves a message. The account sits at the bottom.
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
  const { role } = useMember();
  const editable = can(role, "incident:update");
  const { rows, status, error } = useQuery("incidents.active", {});
  const policies = useQuery("escalationPolicies.all", {}).rows;
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
  /** `target` may be read when the outcome is in, for a change made before the list had its rows. */
  const track = (
    outcome: Promise<MutationOutcome>,
    target: NoticeTarget & { read?: () => NoticeTarget },
  ) => {
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
      const refusal = noticeFor(result, target.read?.() ?? target, `r${nextKey.current++}`);
      if (!refusal) return;
      setRefusals((current) => [...current, refusal].slice(-5));
      // VoiceOver has no live regions (accessibilityLiveRegion is Android's), so say it once.
      if (process.env.EXPO_OS === "ios") {
        AccessibilityInfo.announceForAccessibility(noticeText(refusal, "card"));
      }
      // A title the shard refused comes back to the field, unless something new was typed.
      setTitle((field) => titleToRestore(refusal, field) ?? field);
    });
  };

  // Changes kept from before a restart (src/lib/pending.ts) are tracked like new ones. A declare's refusal says so
  // here; another's, on its incident's screen, or here on its row when that screen is not open.
  const trackRef = useRef(track);
  useLayoutEffect(() => {
    trackRef.current = track;
  });
  useEffect(() => {
    const restored = currentSync()?.restored;
    if (!restored) return;
    for (const change of restored.list) {
      const target = restoredTarget(change);
      if (!target) continue;
      const { incidentId } = target;
      if (target.notice.kind === "declare") {
        trackRef.current(restored.claim(change), {
          kind: "declare",
          incidentId,
          number: null,
          title: target.notice.title ?? "",
        });
        continue;
      }
      const { kind, to, role } = target.notice;
      const row = () => latest.current.find((incident) => incident.id === incidentId);
      const notice = (): NoticeTarget => {
        const found = row();
        return {
          kind,
          to,
          role,
          incidentId,
          number: found?.number ?? null,
          title: found?.title ?? "",
        };
      };
      trackRef.current(
        restored.claimLeft(change, () => row() !== undefined),
        { ...notice(), read: notice },
      );
    }
  }, []);

  const [severity, setSeverityChoice] = useState<Severity>("sev3");
  /** A policy picked by hand (first in the order, RFC 0006 "Who is paged"); "" for the usual one. */
  const [policyId, setPolicyId] = useState("");
  const policy = policies.find((one) => one.id === policyId);
  const [invalid, setInvalid] = useState<"empty" | "invalid" | null>(null);
  const onDeclare = () => {
    const id = client.newId("inc");
    const checked = checkDeclare(id, title, severity);
    if (!checked.ok) return setInvalid(title.trim() === "" ? "empty" : "invalid");
    // A policy deleted meanwhile is left out by the shard: the declare still goes through.
    const args = { ...checked.args, ...(policy && { escalationPolicyId: policy.id }) };
    setInvalid(null);
    setTitle("");
    // Back to the default each time, so a SEV1 chosen once cannot page people again by accident.
    setSeverityChoice("sev3");
    setPolicyId("");
    track(declare(args), { kind: "declare", incidentId: id, number: null, title: args.title });
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
      <PagingNotice />
      <OnCallStatus />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing[3] }}>
        <ConnectionStatus view={view} />
        {status === "ready" ? (
          <ThemedText variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
            {m.incidents_active_count({ count: rows.length })}
            {sev1 > 0 ? ` · ${m.incidents_sev1_count({ count: sev1 })}` : ""}
          </ThemedText>
        ) : null}
      </View>

      {can(role, "incident:declare") ? (
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
              {policies.length > 0 ? (
                <Choice
                  label={m.declare_policy_label()}
                  value={policy?.name ?? m.declare_policy_usual()}
                  onPress={() =>
                    choose(
                      m.declare_policy_label(),
                      [
                        { value: "", label: m.declare_policy_usual() },
                        ...policies.map((one) => ({ value: one.id, label: one.name })),
                      ],
                      setPolicyId,
                    )
                  }
                >
                  <ThemedText variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {policy?.name ?? m.declare_policy_usual()}
                  </ThemedText>
                </Choice>
              ) : null}
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
      ) : null}

      {rows.length > 0 ? (
        <Section title={m.incidents_title()} inset={false}>
          {rows.map((row, index) => (
            <Row key={row.id} first={index === 0}>
              <IncidentLink row={row}>
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
                <ThemedText
                  style={{ color: row.number === null ? colors.foreground : colors.primary }}
                >
                  {row.title}
                </ThemedText>
              </IncidentLink>
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
                  disabled={!editable}
                  onPress={() => changeSeverity(row)}
                >
                  <SeverityBadge severity={row.severity} />
                </Choice>
                <Choice
                  label={m.incident_status_label()}
                  value={incidentStatusLabels[row.status]()}
                  disabled={!editable || nextStatuses(row.status).length === 0}
                  onPress={() => changeStatus(row)}
                >
                  <StatusBadge status={row.status} />
                </Choice>
              </View>
              {refusals
                .filter((refusal) => refusal.incidentId === row.id)
                .map((refusal) => (
                  <Notice key={refusal.key} onDismiss={() => dismiss(refusal.key)}>
                    {noticeText(refusal, "row")}
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
          {noticeText(refusal, "card")}
        </Notice>
      ))}
      <StatePanel view={view} errorCode={error?.code} onReload={onReload} />
      {sheet}
    </ScrollView>
  );
}

/**
 * The row's number and title open the incident. A declare the shard has not numbered yet has no page to open, so
 * it is plain text until it has.
 */
function IncidentLink({ row, children }: { row: IncidentRow; children: ReactNode }) {
  if (row.number === null) return <View style={{ gap: spacing[0.5] }}>{children}</View>;
  return (
    <Link
      href={{ pathname: "/incidents/[number]", params: { number: String(row.number) } }}
      asChild
    >
      <Pressable
        accessibilityRole="link"
        accessibilityHint={m.mobile_session({ part: "open_hint" })}
        // The title row is short; the hit area is at least 44 points tall.
        hitSlop={{ top: spacing[2], bottom: spacing[2] }}
      >
        {({ pressed }) => (
          <View style={{ gap: spacing[0.5], opacity: pressed ? 0.6 : 1 }}>{children}</View>
        )}
      </Pressable>
    </Link>
  );
}
