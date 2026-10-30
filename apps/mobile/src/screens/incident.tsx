import { Column, FieldGroup, RNHostView, Text } from "@expo/ui";
import { ListItem } from "@/components/list-item";
import { m } from "@freecorps/brigade-i18n";
import {
  entryTime,
  formatAge,
  itemText,
  mutationErrorReason,
  noticeFor,
  noticeText,
  pagesFailedNames,
  people,
  personName,
  queryErrorReason,
  roleLabel,
  severityName,
  type Notice as Refusal,
  type NoticeTarget,
} from "@freecorps/brigade-i18n/incident";
import { incidentStatusLabels } from "@freecorps/brigade-i18n/labels";
import { memberName } from "@freecorps/brigade-i18n/why-paged";
import {
  can,
  formatIncidentNumber,
  PAGE_AGAIN_CONFLICTS,
  roleDefinitions,
  SEVERITIES,
  UPDATE_REMOVED,
  type IncidentRow,
  type RoleDefinition,
} from "@freecorps/brigade-schema";
import {
  adjustBusy,
  assignable,
  bodyParts,
  nextFailed,
  nextStatuses,
  pageAgainEntries,
  syncView,
  timelineItems,
  updateActions,
  type MutationOutcome,
  type SyncView,
  type TimelineItem,
} from "@freecorps/brigade-sync";
import { useConnectionState, useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { spacing } from "@freecorps/brigade-ui";
import * as Haptics from "expo-haptics";
import { router, Stack } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, Linking, View } from "react-native";
import { useChoiceSheet } from "@/components/choice-sheet";
import { detailsSection, useIncidentDetails } from "@/components/incident-details";
import { Avatar } from "@/components/avatar";
import { FooterText } from "@/components/footer-text";
import type { Glyph } from "@/components/glyphs";
import { StatePanel, useNow } from "@/components/incident-parts";
import { useListEnd } from "@/components/list-end";
import { ListStatus } from "@/components/list-status";
import { RowIcon } from "@/components/row-icon";
import { UpdateButton } from "@/components/update-button";
import { NativeSeverityBadge, NativeStatusBadge } from "@/components/native-badge";
import { NativeHost } from "@/components/native-host";
import { pagingSection, usePagingData } from "@/components/paging";
import { withRowMenu, type RowAction } from "@/components/row-menu";
import { RowText } from "@/components/row-text";
import { useMember } from "@/components/session";
import { ThemedText } from "@/components/themed-text";
import { useLocale } from "@/hooks/use-locale";
import { useTheme } from "@/hooks/use-theme";
import { restoredTarget } from "@/lib/pending";
import { currentSync } from "@/lib/sync-client";
import { onUpdate } from "@/lib/updates";
import { canPageAgain } from "@/lib/why";
import { useSystemColors } from "@/theme/system-colors";

const MAX_NOTICES = 5;

/** `/incidents/12` → 12; anything else (zero, signs, leading zeros, too long) is no incident. */
export function parseIncidentNumber(raw: string): number | null {
  if (!/^[1-9][0-9]{0,15}$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

/**
 * One incident by its number, as the dashboard's incident page (RFC 0003), in the system's grouped list: its title,
 * severity and status (changed from here too), roles, details, who was paged and the timeline, newest first. Live
 * from the workspace shard; every change shows at once and settles when the shard confirms it. Updates are written
 * and edited in a form sheet (`/incidents/<number>/update`).
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

/** A page that is not the incident: a title and what to say, on the screen's ground. */
function Message({ title, children }: { title: string; children: ReactNode }) {
  const system = useSystemColors();
  return (
    <View
      style={{
        flex: 1,
        gap: spacing[3],
        padding: spacing[6],
        backgroundColor: system.ground,
      }}
    >
      <Stack.Screen options={{ title }} />
      {children}
    </View>
  );
}

function Loading() {
  const colors = useTheme();
  return (
    <Message title={m.incident_page({ part: "*" })}>
      <View accessibilityRole="progressbar" style={{ flexDirection: "row", gap: spacing[3] }}>
        <ActivityIndicator color={colors.mutedForeground} />
        <ThemedText variant="caption">{m.incident_page({ part: "loading" })}</ThemedText>
      </View>
    </Message>
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
    <Message title={title}>
      <ThemedText selectable>{text}</ThemedText>
    </Message>
  );
}

/** Busy keys: `status`, `severity`, `update`, `role/<role>`. */
type Busy = ReadonlyMap<string, number>;

function Incident({ row, view, state }: { row: IncidentRow; view: SyncView; state: ReactNode }) {
  const colors = useTheme();
  const { locale, timeZone } = useLocale();
  const member = useMember();
  const online = view === "live";
  const editable = can(member.role, "incident:update");
  const members = useQuery("members.all", {});
  const who = people(member.userId, members.rows);
  // Built-ins under the workspace's names (RFC 0003 "Role definitions"); its own roles show read-only while held.
  const roleRows = useQuery("incidentRoles.all", {});
  const held = (role: RoleDefinition) => row.roles?.[role.id] !== undefined;
  const roles = roleDefinitions(roleRows.rows).filter((role) =>
    role.builtin && !role.removed ? true : held(role),
  );
  const { choose, sheet } = useChoiceSheet();

  const setStatus = useMutation("incident.setStatus");
  const setSeverity = useMutation("incident.setSeverity");
  const assignRole = useMutation("incident.assignRole");
  const deleteUpdate = useMutation("incident.deleteUpdate");
  const pageAgain = useMutation("incident.pageAgain");

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
        <ListItem
          key={notice.key}
          onPress={() => dismiss(notice.key)}
          trailing={<RowText color={colors.primary}>{m.dismiss()}</RowText>}
        >
          <Text textStyle={{ color: colors.destructive }}>{noticeText(notice, "row")}</Text>
        </ListItem>
      ));
  /** What an update's edit, removal or page again said back: a row on the timeline until dismissed. */
  const [said, setSaid] = useState<{ key: string; text: string }[]>([]);
  const say = (text: string) => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    setSaid((current) => [...current, { key: `s${nextKey.current++}`, text }].slice(-MAX_NOTICES));
    if (process.env.EXPO_OS === "ios") AccessibilityInfo.announceForAccessibility(text);
  };

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
  const changeRole = (role: RoleDefinition, holder: string | null) => {
    // The holder stays listed even if the shard no longer counts them as assignable (a viewer now).
    const options = assignable(members.rows);
    const listed =
      holder === null || options.some((option) => option.id === holder)
        ? options
        : [...options, { id: holder, name: null, role: "viewer" as const, updatedAt: 0 }];
    choose(
      roleLabel(role.id, role.name),
      [
        ...(holder === null ? [] : [{ value: "", label: m.incident_page({ part: "unassign" }) }]),
        // A removed role can only be taken away: the shard refuses giving it to anyone.
        ...(role.removed ? [] : listed)
          .filter((option) => option.id !== holder)
          .map((option) => ({ value: option.id, label: personName(option.id, who) })),
      ],
      (value: string) =>
        void track(
          assignRole({ id: row.id, role: role.id, userId: value === "" ? null : value }),
          { ...base, kind: "role", role: role.id, roleName: role.name },
          `role/${role.id}`,
        ),
    );
  };

  // An update posted or edited from the sheet is followed here, where its refusal can be read.
  const trackRef = useRef(track);
  useLayoutEffect(() => {
    trackRef.current = track;
  });
  useEffect(
    () =>
      onUpdate((sent) => {
        if (sent.incidentId !== row.id) return;
        if (sent.kind === "post") {
          void trackRef.current(sent.outcome, { ...latestBase.current, kind: "update" }, "update");
          return;
        }
        void sent.outcome.then((outcome) => {
          if (outcome.ok) return;
          // An edit's `conflict` is the same text, or an update removed meanwhile (`UPDATE_REMOVED`).
          sayRef.current(
            outcome.error.code === "conflict"
              ? updateSay(outcome.error.message === UPDATE_REMOVED ? "gone" : "unchanged")
              : updateSay("edit_failed", mutationErrorReason(outcome.error.code)),
          );
        });
      }),
    [row.id],
  );
  const sayRef = useRef(say);
  useLayoutEffect(() => {
    sayRef.current = say;
  });

  const removeUpdate = (entryId: string) =>
    Alert.alert(updateSay("remove_title"), updateSay("remove_body"), [
      { text: updateSay("cancel"), style: "cancel" },
      {
        text: updateSay("remove_confirm"),
        style: "destructive",
        onPress: () =>
          void deleteUpdate({ id: row.id, entryId }).then((outcome) => {
            if (outcome.ok) {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
                () => {},
              );
              return;
            }
            say(
              outcome.error.code === "conflict"
                ? updateSay("gone")
                : updateSay("remove_failed", mutationErrorReason(outcome.error.code)),
            );
          }),
      },
    ]);
  // It pages people, so the phone asks first (a stray tap in a pocket is likelier than a stray click).
  const [paging, setPaging] = useState(false);
  const confirmPageAgain = (entries: string[]) =>
    Alert.alert(againSay("confirm_title"), againSay("confirm_body"), [
      { text: m.declare_cancel(), style: "cancel" },
      {
        text: againSay("action"),
        onPress: () => {
          setPaging(true);
          void pageAgain({ id: row.id, entries }).then((outcome) => {
            setPaging(false);
            if (outcome.ok) {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
                () => {},
              );
              AccessibilityInfo.announceForAccessibility(againSay("done"));
              return;
            }
            const conflict =
              outcome.error.code === "conflict" ? CONFLICT_PARTS[outcome.error.message] : undefined;
            say(
              conflict !== undefined
                ? m.incident_page_again({ part: conflict, reason: "" })
                : m.incident_page_again({
                    part: "failed",
                    reason: mutationErrorReason(outcome.error.code),
                  }),
            );
          });
        },
      },
    ]);

  const now = useNow(20_000);
  const listEnd = useListEnd(editable ? FAB_ROOM : 0);
  const pagingData = usePagingData(row, now);
  const details = useIncidentDetails(row);
  const [allPaged, setAllPaged] = useState(false);
  const timeline = useQuery("incident.timeline", { id: row.id });
  /** Which timeline rows are open: a long update's whole text, a failed page's names. */
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  /** The timeline row whose menu is open (Android; iOS's context menu keeps its own). */
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const number = formatIncidentNumber(row.number) ?? "";
  const saving = busy.has("status") || busy.has("severity");
  const writeUpdate = (entryId?: string) =>
    row.number !== null &&
    router.push({
      pathname: "/incidents/[number]/update",
      params: { number: String(row.number), ...(entryId ? { entry: entryId } : {}) },
    });

  const entries = [...timeline.rows].reverse();
  // Pages one run could not send for the same reason are one line (a SEV1 can fail for most of the workspace).
  const items = timelineItems(entries);
  // Unconfirmed changes are re-applied after the shard's rows, so the member's unsent updates are the newest ones.
  const unsent = busy.get("update") ?? 0;
  const waiting = new Set<string>();
  if (timeline.pending) {
    for (const entry of entries) {
      if (waiting.size >= unsent) break;
      if (entry.kind === "update" && entry.actor === who.self) waiting.add(entry.id);
    }
  }
  const mayPageAgain = canPageAgain(member.role, row);

  const timelineRow = (item: TimelineItem) => {
    const entry = item.kind === "entry" ? item.entry : item.entries[0];
    const key = item.kind === "entry" ? entry.id : item.key;
    const failed =
      entry.kind === "page_failed" ||
      entry.kind === "email_failed" ||
      entry.kind === "slack_failed";
    const body =
      entry.kind === "update" && !entry.removed
        ? entry.body
        : entry.kind === "status_published" || entry.kind === "status_corrected"
          ? entry.body
          : null;
    const expanded = open.has(key);
    const names =
      item.kind === "pages_failed" && expanded
        ? pagesFailedNames(item, who, locale).map(({ name }) => name)
        : [];
    const time = waiting.has(entry.id)
      ? m.mobile_session({ part: online ? "update_sending" : "update_waiting" })
      : [
          entryTime(entry.at, now, locale, timeZone),
          ...(entry.kind === "update" && entry.edited && !entry.removed
            ? [m.incident_update_change({ part: "edited", time: "", reason: "" })]
            : []),
        ].join(" · ");
    const actions: RowAction[] = [];
    const allowed = waiting.has(entry.id)
      ? { edit: false, remove: false }
      : updateActions(entry, who.self, member.role);
    if (allowed.edit)
      actions.push({ label: updateSay("edit"), onPress: () => writeUpdate(entry.id) });
    if (allowed.remove) {
      actions.push({
        label: updateSay("remove"),
        destructive: true,
        onPress: () => removeUpdate(entry.id),
      });
    }
    for (const part of body ? bodyParts(body) : []) {
      if ("url" in part) {
        actions.push({
          label: m.incident_open_link({ host: hostOf(part.url) }),
          onPress: () => void Linking.openURL(part.url).catch(() => {}),
        });
      }
    }
    const again = mayPageAgain ? pageAgainEntries(item, timeline.rows) : [];
    if (again.length > 0) {
      actions.push({
        label: againSay(paging ? "pending" : "action"),
        disabled: paging,
        onPress: () => confirmPageAgain(again),
      });
    }
    const longBody = body !== null && (body.length > LONG_UPDATE || body.split("\n").length > 6);
    const tappable = item.kind === "pages_failed" || longBody;
    return withRowMenu(
      <ListItem
        key={key}
        onPress={tappable ? () => toggle(key) : undefined}
        leading={
          <RowIcon
            plain
            glyph={timelineGlyph(entry.kind)}
            color={failed ? colors.destructive : undefined}
          />
        }
        supportingText={[
          ...(body ? [expanded || !longBody ? body : clip(body)] : []),
          ...names,
          ...(tappable
            ? [
                m.incident_page({
                  part:
                    item.kind === "pages_failed"
                      ? expanded
                        ? "hide_names"
                        : "show_names"
                      : expanded
                        ? "show_less"
                        : "show_more",
                }),
              ]
            : []),
          time,
        ].join("\n")}
      >
        <Text textStyle={failed ? { color: colors.destructive } : undefined}>
          {itemText(item, who)}
        </Text>
      </ListItem>,
      actions,
      { open: menuFor === key, setOpen: (shown) => setMenuFor(shown ? key : null) },
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: number }} />
      <NativeHost style={{ flex: 1 }}>
        <FieldGroup>
          <FieldGroup.Section>
            <FieldGroup.SectionHeader>
              <Column spacing={spacing[1]} alignment="start">
                <ListStatus view={view} summary={undefined} />
                {view === "live" || view === "connecting" ? null : (
                  <RNHostView matchContents>
                    <View>{state}</View>
                  </RNHostView>
                )}
              </Column>
            </FieldGroup.SectionHeader>
            <ListItem
              supportingText={[
                m.incident_declared({ time: formatAge(row.declaredAt, now, locale) }),
                ...(saving
                  ? [online ? m.incident_change_saving() : m.incident_change_queued()]
                  : []),
              ].join(" · ")}
            >
              <Text textStyle={{ fontSize: 20, fontWeight: "600" }}>{row.title}</Text>
            </ListItem>
            <ListItem
              onPress={editable ? changeSeverity : undefined}
              trailing={<NativeSeverityBadge severity={row.severity} />}
            >
              <Text>{m.incident_severity_label()}</Text>
            </ListItem>
            <ListItem
              onPress={editable && nextStatuses(row.status).length > 0 ? changeStatus : undefined}
              trailing={<NativeStatusBadge status={row.status} />}
            >
              <Text>{m.incident_status_label()}</Text>
            </ListItem>
            {noticesFor(["status", "severity"])}
            {editable ? null : (
              <FieldGroup.SectionFooter>
                <FooterText>{m.incident_page({ part: "read_only" })}</FooterText>
              </FieldGroup.SectionFooter>
            )}
          </FieldGroup.Section>

          {/* Roles before the timeline: short, and what a responder looks for first. */}
          <FieldGroup.Section title={m.incident_page({ part: "roles" })}>
            {roles.map((role) => {
              const holder = row.roles?.[role.id] ?? null;
              // The workspace's own roles are given on the dashboard for now. A removed built-in someone still
              // holds stays editable, so it can be cleared here too.
              const changeable =
                editable && role.builtin !== null && (!role.removed || holder !== null);
              const name =
                holder === null ? m.incident_page({ part: "nobody" }) : personName(holder, who);
              return (
                <ListItem
                  key={role.id}
                  onPress={changeable ? () => changeRole(role, holder) : undefined}
                  leading={<Avatar name={holder === null ? null : memberName(holder, who)} />}
                  supportingText={
                    busy.has(`role/${role.id}`)
                      ? `${name} · ${online ? m.incident_change_saving() : m.incident_change_queued()}`
                      : name
                  }
                >
                  <Text>{roleLabel(role.id, role.name)}</Text>
                </ListItem>
              );
            })}
            {noticesFor(["role"])}
            {members.status === "ready" && assignable(members.rows).length <= 1 ? (
              <FieldGroup.SectionFooter>
                <FooterText>{m.incident_page({ part: "no_members" })}</FooterText>
              </FieldGroup.SectionFooter>
            ) : null}
          </FieldGroup.Section>

          {details ? detailsSection(details) : null}

          {pagingData.errorCode !== undefined ? (
            <FieldGroup.Section key="paging-error">
              <ListItem>
                <Text>{queryErrorReason(pagingData.errorCode)}</Text>
              </ListItem>
            </FieldGroup.Section>
          ) : pagingData.data && row.number !== null ? (
            pagingSection({
              data: pagingData.data,
              number: row.number,
              who,
              all: allPaged,
              onAll: () => setAllPaged((all) => !all),
              tint: colors.primary,
            })
          ) : null}

          <FieldGroup.Section title={m.incident_page({ part: "timeline" })}>
            {noticesFor(["update"])}
            {said.map((one) => (
              <ListItem
                key={one.key}
                onPress={() =>
                  setSaid((current) => current.filter((other) => other.key !== one.key))
                }
                trailing={<RowText color={colors.primary}>{m.dismiss()}</RowText>}
              >
                <Text textStyle={{ color: colors.destructive }}>{one.text}</Text>
              </ListItem>
            ))}
            {items.map(timelineRow)}
            {items.length === 0 && timeline.status === "ready" ? (
              <ListItem>
                <Text>{m.incident_page({ part: "timeline_empty" })}</Text>
              </ListItem>
            ) : null}
          </FieldGroup.Section>
          {listEnd}
        </FieldGroup>
      </NativeHost>
      <UpdateButton enabled={editable && row.number !== null} onPress={() => writeUpdate()} />
      {sheet}
    </View>
  );
}

/** Characters of an update shown before Show more. */
const LONG_UPDATE = 600;

/** A long update cut at a word near `LONG_UPDATE`, with an ellipsis. */
function clip(body: string): string {
  const cut = body.slice(0, LONG_UPDATE);
  const space = cut.lastIndexOf(" ");
  return `${space > LONG_UPDATE * 0.8 ? cut.slice(0, space) : cut}…`;
}

/** A link's host, to name it in a menu ("Open status.example.com"). */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const updateSay = (part: string, reason = "") =>
  m.incident_update_change({ part, time: "", reason });
const againSay = (part: "action" | "pending" | "confirm_title" | "confirm_body" | "done") =>
  m.incident_page_again({ part, reason: "" });

/** What each of `incident.pageAgain`'s refusals says (`PAGE_AGAIN_CONFLICTS`, its error messages). */
const CONFLICT_PARTS: Partial<Record<string, "already" | "acked" | "resolved">> = {
  [PAGE_AGAIN_CONFLICTS.answered]: "already",
  [PAGE_AGAIN_CONFLICTS.acknowledged]: "acked",
  [PAGE_AGAIN_CONFLICTS.inactive]: "resolved",
};

/** Room under the list for the floating Post an update button (Android), so the newest entry scrolls clear of it. */
const FAB_ROOM = 88;

/** Each timeline entry's mark, by what happened; anything else is a plain dot. */
const TIMELINE_GLYPHS: Partial<Record<string, Glyph>> = {
  declared: { ios: "flame", android: "local_fire_department", web: "local_fire_department" },
  update: { ios: "text.bubble", android: "chat_bubble", web: "chat_bubble" },
  status_changed: { ios: "arrow.triangle.2.circlepath", android: "sync", web: "sync" },
  severity_changed: { ios: "exclamationmark.triangle", android: "warning", web: "warning" },
  role_assigned: { ios: "person.badge.plus", android: "person_add", web: "person_add" },
  acknowledged: { ios: "hand.raised", android: "front_hand", web: "front_hand" },
  renamed: { ios: "pencil", android: "edit", web: "edit" },
  paged: { ios: "bell", android: "notifications", web: "notifications" },
  paged_again: { ios: "bell.badge", android: "notification_add", web: "notification_add" },
  page_failed: { ios: "bell.slash", android: "notifications_off", web: "notifications_off" },
  email_failed: { ios: "envelope.badge", android: "mail", web: "mail" },
  slack_failed: { ios: "exclamationmark.bubble", android: "sms_failed", web: "sms_failed" },
  status_published: { ios: "megaphone", android: "campaign", web: "campaign" },
  status_corrected: { ios: "megaphone", android: "campaign", web: "campaign" },
  follow_up: { ios: "checklist", android: "checklist", web: "checklist" },
  postmortem: { ios: "doc.text", android: "description", web: "description" },
};
const DEFAULT_GLYPH: Glyph = { ios: "circle.fill", android: "circle", web: "circle" };

function timelineGlyph(kind: string): Glyph {
  return TIMELINE_GLYPHS[kind] ?? DEFAULT_GLYPH;
}
