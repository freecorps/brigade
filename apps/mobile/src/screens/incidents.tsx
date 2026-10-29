import { FieldGroup, ListItem, RNHostView, Text } from "@expo/ui";
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
  SEVERITIES,
  type IncidentRow,
  type IncidentStatus,
  type Severity,
} from "@freecorps/brigade-schema";
import {
  nextFailed,
  nextStatuses,
  pickTarget,
  syncView,
  type MutationOutcome,
  type SyncView,
} from "@freecorps/brigade-sync";
import { useConnectionState, useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { router } from "expo-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccessibilityInfo, View } from "react-native";
import { PagingNotice } from "@/components/account";
import { useChoiceSheet } from "@/components/choice-sheet";
import { ConnectionStatus, StatePanel, useNow } from "@/components/incident-parts";
import { NativeSeverityBadge, NativeStatusBadge } from "@/components/native-badge";
import { withRowMenu } from "@/components/row-menu";
import { DeclareButton } from "@/components/declare-button";
import { useMember } from "@/components/session";
import { ThemedText } from "@/components/themed-text";
import { useLocale } from "@/hooks/use-locale";
import { NativeHost } from "@/components/native-host";
import { useTheme } from "@/hooks/use-theme";
import { onDeclare } from "@/lib/declares";
import { restoredTarget } from "@/lib/pending";
import { currentSync } from "@/lib/sync-client";

/**
 * The Incidents tab: the workspace's active incidents, live from its shard, in the system's grouped list. A row opens
 * its incident; a long press (a context menu on iOS, a dropdown on Android) changes its status or severity, for those
 * who may. Declaring is the header's + (a form sheet, `src/screens/declare.tsx`). Changes show at once and settle
 * when the shard confirms them; a refused one rolls back and leaves a message.
 */
export function Incidents() {
  // A refused list is asked for again only by a new subscriber: "Reload" remounts the list.
  const [attempt, setAttempt] = useState(0);
  return <IncidentList key={attempt} onReload={() => setAttempt((n) => n + 1)} />;
}

function IncidentList({ onReload }: { onReload: () => void }) {
  const colors = useTheme();
  const { locale } = useLocale();
  const { role } = useMember();
  const editable = can(role, "incident:update");
  const { rows, status, error } = useQuery("incidents.active", {});
  const connection = useConnectionState();
  const [failed, setFailed] = useState(false);
  const latched = nextFailed(failed, status, connection);
  if (latched !== failed) setFailed(latched);
  const view = syncView(status, connection, latched);

  const setStatus = useMutation("incident.setStatus");
  const setSeverity = useMutation("incident.setSeverity");
  const { choose, sheet } = useChoiceSheet();

  // The latest rows, for picks made from a sheet opened on an older list. Updated after each commit, before a
  // sheet's callback can run, since a ref must not be written during render.
  const latest = useRef(rows);
  useLayoutEffect(() => {
    latest.current = rows;
  }, [rows]);
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

  // A declare sent from the sheet is followed here, where its refusal can be read.
  useEffect(
    () =>
      onDeclare(({ incidentId, title, outcome }) =>
        trackRef.current(outcome, { kind: "declare", incidentId, number: null, title }),
      ),
    [],
  );

  const now = useNow(20_000);
  /** The row whose menu is open (Android; iOS's context menu keeps its own). */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const listed = new Set(rows.map((row) => row.id));
  const dismiss = (key: string) =>
    setRefusals((current) => current.filter((refusal) => refusal.key !== key));
  const unlisted = refusals.filter((refusal) => !listed.has(refusal.incidentId));
  const sev1 = rows.filter((row) => row.severity === "sev1").length;
  const summary =
    status === "ready"
      ? [
          m.incidents_active_count({ count: rows.length }),
          ...(sev1 > 0 ? [m.incidents_sev1_count({ count: sev1 })] : []),
        ].join(" · ")
      : undefined;

  const open = (row: IncidentRow) => {
    if (row.number === null) return;
    router.push({ pathname: "/incidents/[number]", params: { number: String(row.number) } });
  };

  return (
    <View style={{ flex: 1 }}>
      <PagingNotice />
      <NativeHost style={{ flex: 1 }}>
        <FieldGroup>
          <FieldGroup.Section>
            <FieldGroup.SectionHeader>
              <RNHostView matchContents>
                <Header view={view} summary={summary} />
              </RNHostView>
            </FieldGroup.SectionHeader>
            {rows.map((row) =>
              withRowMenu(
                <ListItem
                  key={row.id}
                  onPress={() => open(row)}
                  leading={<NativeSeverityBadge severity={row.severity} compact />}
                  trailing={<NativeStatusBadge status={row.status} />}
                  supportingText={[
                    formatIncidentNumber(row.number) ??
                      (view === "live"
                        ? m.incident_unnumbered_saving()
                        : m.incident_unnumbered_not_sent()),
                    m.incident_declared({ time: formatAge(row.declaredAt, now, locale) }),
                    ...(busy.has(row.id)
                      ? [view === "live" ? m.incident_change_saving() : m.incident_change_queued()]
                      : []),
                  ].join(" · ")}
                >
                  <Text numberOfLines={2}>{row.title}</Text>
                </ListItem>,
                editable
                  ? [
                      {
                        label: m.incident_status_label(),
                        disabled: nextStatuses(row.status).length === 0,
                        onPress: () => changeStatus(row),
                      },
                      { label: m.incident_severity_label(), onPress: () => changeSeverity(row) },
                    ]
                  : [],
                {
                  open: menuFor === row.id,
                  setOpen: (open) => setMenuFor(open ? row.id : null),
                },
              ),
            )}
            {rows.length === 0 && status === "ready" ? (
              <ListItem supportingText={m.incidents_all_clear_hint()}>
                <Text>{m.incidents_all_clear()}</Text>
              </ListItem>
            ) : null}
          </FieldGroup.Section>
          {refusals.length > 0 ? (
            <FieldGroup.Section>
              {[...refusals.filter((refusal) => listed.has(refusal.incidentId)), ...unlisted].map(
                (refusal) => (
                  <ListItem
                    key={refusal.key}
                    onPress={() => dismiss(refusal.key)}
                    trailing={<Text textStyle={{ color: colors.primary }}>{m.dismiss()}</Text>}
                  >
                    <Text textStyle={{ color: colors.destructive }}>
                      {noticeText(refusal, listed.has(refusal.incidentId) ? "row" : "card")}
                    </Text>
                  </ListItem>
                ),
              )}
            </FieldGroup.Section>
          ) : null}
        </FieldGroup>
      </NativeHost>
      {can(role, "incident:declare") ? <DeclareButton /> : null}
      <StatePanel view={view} errorCode={error?.code} onReload={onReload} />
      {sheet}
    </View>
  );
}

/** Over the list: whether it is live, and how many are open. */
function Header({ view, summary }: { view: SyncView; summary: string | undefined }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
      <ConnectionStatus view={view} />
      {summary ? (
        <ThemedText variant="caption" style={{ fontVariant: ["tabular-nums"] }}>
          {summary}
        </ThemedText>
      ) : null}
    </View>
  );
}
