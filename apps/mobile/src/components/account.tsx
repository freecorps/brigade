import { m } from "@freecorps/brigade-i18n";
import {
  CALL_CHOICES,
  callChoiceOf,
  emailSettings,
  memberEmailOf,
  type CallChoice,
  type MemberEmail,
} from "@freecorps/brigade-schema";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { radius, spacing } from "@freecorps/brigade-ui";
import { useEffect, useState } from "react";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { useChoiceSheet } from "@/components/choice-sheet";
import { Row, Section } from "@/components/section";
import { useMember } from "@/components/session";
import { ThemedText } from "@/components/themed-text";
import { useLocale } from "@/hooks/use-locale";
import { useTheme } from "@/hooks/use-theme";
import { authClient } from "@/lib/auth-client";
import type { Paging } from "@/lib/device";
import { caughtUp } from "@/lib/picked";
import { CHECK_GLYPH } from "@/components/glyphs";

const PAGING: Record<Paging, Parameters<typeof m.mobile_session>[0]["part"]> = {
  pending: "pages_pending",
  on: "pages_on",
  off: "pages_off",
  unsupported: "pages_unsupported",
  taken: "pages_taken",
  failed: "pages_failed",
};

/** Whether this phone gets a workspace's pages, under its name; undefined: it was never opened on the phone. */
function workspacePaging(paging: Paging | undefined): string {
  if (paging === undefined) return m.account_flow({ part: "paging_not_opened", name: "" });
  if (paging === "on") return m.account_flow({ part: "paged_here", name: "" });
  return pagingText(paging);
}

/** Whether this phone gets pages, in words. */
export function pagingText(paging: Paging): string {
  return m.mobile_session({ part: PAGING[paging] });
}

/**
 * Whether the phone not paging is something the member should act on or know: `unsupported` is how every Android
 * phone is until FCM (RFC 0006), not a fault, so it is muted and gets no notice.
 */
function pagingProblem(paging: Paging): boolean {
  return paging === "off" || paging === "taken" || paging === "failed";
}

/**
 * The first workspace this phone should page the member for and does not: the open one first, then the others it
 * was opened in. Undefined when none.
 */
function pagingTrouble(
  member: Pick<ReturnType<typeof useMember>, "paging" | "pagedWorkspaces" | "workspaceId">,
): { paging: Paging; name?: string } | undefined {
  if (pagingProblem(member.paging)) return { paging: member.paging };
  const other = member.pagedWorkspaces.find(
    (workspace) => workspace.id !== member.workspaceId && pagingProblem(workspace.paging),
  );
  return other ? { paging: other.paging, name: other.name ?? "" } : undefined;
}

/**
 * At the top of the incident list when this phone does not page the member and they should know, in the open
 * workspace or another it was opened in: notifications off (with a way to Settings), the phone still another
 * member's, or registering failed. The app keeps trying the last two on its own (src/lib/paging.ts); Try again does
 * it now.
 */
export function PagingNotice() {
  const member = useMember();
  const { retryPaging } = member;
  const colors = useTheme();
  const [retrying, setRetrying] = useState(false);
  const trouble = pagingTrouble(member);
  if (!trouble) return null;
  const { paging } = trouble;
  const retry = () => {
    setRetrying(true);
    void retryPaging().finally(() => setRetrying(false));
  };
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        gap: spacing[2],
        padding: spacing[3],
        borderRadius: radius.md,
        borderCurve: "continuous",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.destructive,
      }}
    >
      <ThemedText variant="label" accessibilityRole="header" style={{ color: colors.destructive }}>
        {trouble.name !== undefined
          ? m.account_flow({ part: "pages_notice_in", name: trouble.name })
          : m.mobile_session({ part: "pages_notice_title" })}
      </ThemedText>
      <ThemedText selectable>{pagingText(paging)}</ThemedText>
      {paging === "off" ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void Linking.openSettings()}
          style={({ pressed }) => ({
            minHeight: spacing[12],
            justifyContent: "center",
            alignSelf: "flex-start",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <ThemedText style={{ color: colors.primary }}>
            {m.mobile_session({ part: "open_settings" })}
          </ThemedText>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          // Named outright and without `busy`: TalkBack otherwise reads the spinner's "busy" as the button's name.
          accessibilityLabel={m.mobile_session({ part: "try_again" })}
          accessibilityState={{ disabled: retrying }}
          disabled={retrying}
          onPress={retry}
          style={({ pressed }) => ({
            minHeight: spacing[12],
            flexDirection: "row",
            alignItems: "center",
            gap: spacing[2],
            alignSelf: "flex-start",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          {retrying ? <ActivityIndicator color={colors.primary} /> : null}
          <ThemedText style={{ color: colors.primary }}>
            {m.mobile_session({ part: "try_again" })}
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

/**
 * The member's workspaces (Better Auth's organization list), the active one checked, each with whether this phone
 * gets its pages, and New workspace. Tapping another makes it active: the session moves to it, the incident list,
 * on-call and the widget follow, and the phone registers there too while staying registered in the others, so it
 * keeps getting their pages (RFC 0006 "Device registration"). Changes not sent yet still go out from the workspace
 * they were made in (src/lib/drain.ts).
 */
function Workspaces({
  current,
  currentName,
  paged,
}: {
  current: string;
  currentName: string;
  paged: ReturnType<typeof useMember>["pagedWorkspaces"];
}) {
  const colors = useTheme();
  const list = authClient.useListOrganizations();
  const [switching, setSwitching] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // The active one is always shown, even before (or without) the list, or with a list read before it existed: offline,
  // it is all the app knows.
  const workspaces = list.data?.some((workspace) => workspace.id === current)
    ? list.data
    : [{ id: current, name: currentName }, ...(list.data ?? [])];
  const pick = async (id: string) => {
    if (id === current || switching) return;
    setSwitching(id);
    setFailed(false);
    let ok = false;
    try {
      ok = !(await authClient.organization.setActive({ organizationId: id })).error;
    } catch {
      ok = false;
    }
    setSwitching(null);
    if (!ok) {
      setFailed(true);
      const message = m.account_flow({ part: "switch_failed", name: "" });
      if (process.env.EXPO_OS === "ios") AccessibilityInfo.announceForAccessibility(message);
    }
  };
  return (
    <>
      <Row>
        <ThemedText variant="label">{m.account_flow({ part: "workspaces", name: "" })}</ThemedText>
      </Row>
      {workspaces.map((workspace) => {
        const active = workspace.id === current;
        const paging = paged.find((one) => one.id === workspace.id)?.paging;
        return (
          <Pressable
            key={workspace.id}
            accessibilityRole="button"
            accessibilityLabel={
              active
                ? `${workspace.name}, ${m.account_flow({ part: "current", name: "" })}`
                : m.account_flow({ part: "switch_to", name: workspace.name })
            }
            accessibilityState={{ selected: active, busy: switching === workspace.id }}
            disabled={active || switching !== null}
            onPress={() => void pick(workspace.id)}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Row>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[2] }}>
                <View style={{ flex: 1, gap: spacing[0.5] }}>
                  <ThemedText selectable={active} numberOfLines={2}>
                    {workspace.name}
                  </ThemedText>
                  <ThemedText
                    variant="caption"
                    style={
                      paging && pagingProblem(paging) ? { color: colors.destructive } : undefined
                    }
                  >
                    {workspacePaging(paging)}
                  </ThemedText>
                </View>
                {switching === workspace.id ? (
                  <ActivityIndicator color={colors.mutedForeground} />
                ) : active ? (
                  <SymbolView
                    name={CHECK_GLYPH}
                    tintColor={colors.primary}
                    size={20}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  />
                ) : null}
              </View>
            </Row>
          </Pressable>
        );
      })}
      {failed ? (
        <Row>
          <ThemedText
            selectable
            accessibilityLiveRegion="polite"
            style={{ color: colors.destructive }}
          >
            {m.account_flow({ part: "switch_failed", name: "" })}
          </ThemedText>
        </Row>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/new-workspace")}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Row>
          <ThemedText style={{ color: colors.primary }}>
            {m.account_flow({ part: "new_workspace", name: "" })}
          </ThemedText>
        </Row>
      </Pressable>
      {workspaces.length > 1 ? (
        <Row>
          <ThemedText variant="caption">
            {m.account_flow({ part: "mobile_paging", name: "" })}
          </ThemedText>
        </Row>
      ) : null}
    </>
  );
}

/**
 * Which pages ring the member's iPhones as a call (RFC 0010), in the open workspace, picked from a sheet and saved at
 * once (`member.setCalls`; offline, when the phone is next online). The notification comes either way.
 */
function Calls() {
  const { userId } = useMember();
  const colors = useTheme();
  const settings = useQuery("members.settings", {});
  const setCalls = useMutation("member.setCalls");
  const { choose, sheet } = useChoiceSheet();
  const [failed, setFailed] = useState(false);
  const current = callChoiceOf(settings.rows, userId);
  const label = (choice: CallChoice) => m.call_settings({ part: choice });
  const pick = () =>
    choose(
      m.call_settings({ part: "sheet_title" }),
      CALL_CHOICES.map((choice) => ({ value: choice, label: label(choice) })),
      (calls) => {
        if (calls === current) return;
        setFailed(false);
        void setCalls({ calls }).then((outcome) => {
          if (!outcome.ok && outcome.error.code !== "conflict") setFailed(true);
        });
      },
    );
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityHint={m.call_settings({ part: "description" })}
        disabled={settings.status !== "ready"}
        onPress={pick}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Row>
          <ThemedText variant="label">{m.call_settings({ part: "title" })}</ThemedText>
          <ThemedText style={{ color: colors.primary }}>
            {settings.status === "ready"
              ? label(current)
              : m.call_settings({ part: settings.status === "error" ? "load_failed" : "loading" })}
          </ThemedText>
          <ThemedText variant="caption">{m.call_settings({ part: `${current}_hint` })}</ThemedText>
          {failed ? (
            <ThemedText accessibilityLiveRegion="polite" style={{ color: colors.destructive }}>
              {m.call_settings({ part: "failed" })}
            </ThemedText>
          ) : null}
        </Row>
      </Pressable>
      {sheet}
    </>
  );
}

/**
 * The member's own email choices in the open workspace (`member.setEmail`, RFC 0005 "Email", RFC 0013 "Reminders"),
 * each saved as soon as it is switched (offline, when the phone is next online). The owners' "a page reached nobody"
 * email is not among them: it is the fallback when paging fails, which the note under them says. Also keeps the time
 * zone reminders follow on the phone's (`member.setTimeZone`).
 */
function EmailChoices() {
  const { userId } = useMember();
  const colors = useTheme();
  const { timeZone } = useLocale();
  const settings = useQuery("members.settings", {});
  const workspace = useQuery("workspace.current", {});
  const setEmail = useMutation("member.setEmail");
  const setTimeZone = useMutation("member.setTimeZone");
  const [picked, setPicked] = useState<MemberEmail | null>(null);
  const [failed, setFailed] = useState(false);
  const value = memberEmailOf(settings.rows, userId);
  const shown = picked ?? value;
  const ready = settings.status === "ready";
  const keptZone = settings.rows.find((row) => row.id === userId)?.timeZone;
  useEffect(() => {
    if (ready && timeZone && timeZone !== keptZone) void setTimeZone({ timeZone });
  }, [ready, timeZone, keptZone, setTimeZone]);
  // What was switched shows until the synced row agrees (src/lib/picked.ts), or the save fails and it goes back.
  useEffect(() => {
    if (picked !== null && caughtUp(picked, value)) setPicked(null);
  }, [picked, value]);
  const text = (part: string) => m.member_email_settings({ part });
  const flip = (key: keyof MemberEmail, on: boolean) => {
    const next = { ...shown, [key]: on };
    setPicked(next);
    setFailed(false);
    void setEmail(next).then((outcome) => {
      // A conflict is no change: the synced row already says so.
      if (outcome.ok) return;
      setPicked(null);
      if (outcome.error.code !== "conflict") setFailed(true);
    });
  };
  const rows: { key: keyof MemberEmail; note?: string }[] = [
    {
      key: "missedPages",
      ...(emailSettings(workspace.rows[0]).unpaged ? {} : { note: text("missed_workspace_off") }),
    },
    { key: "followUpReminders" },
  ];
  return (
    <>
      {rows.map(({ key, note }) => {
        const label = text(key === "missedPages" ? "missed" : "reminders");
        const hint = text(key === "missedPages" ? "missed_hint" : "reminders_hint");
        return (
          <Row key={key}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[3] }}>
              <ThemedText variant="label" style={{ flex: 1 }}>
                {label}
              </ThemedText>
              <Switch
                accessibilityLabel={label}
                accessibilityHint={hint}
                disabled={!ready}
                value={shown[key]}
                onValueChange={(on) => flip(key, on)}
              />
            </View>
            <ThemedText variant="caption">{hint}</ThemedText>
            {note ? <ThemedText variant="caption">{note}</ThemedText> : null}
          </Row>
        );
      })}
      <Row>
        <ThemedText variant="caption">{text("owners_note")}</ThemedText>
        {settings.status === "error" ? (
          <ThemedText style={{ color: colors.destructive }}>{text("load_failed")}</ThemedText>
        ) : null}
        {failed ? (
          <ThemedText accessibilityLiveRegion="polite" style={{ color: colors.destructive }}>
            {text("failed")}
          </ThemedText>
        ) : null}
      </Row>
    </>
  );
}

/** Who is signed in, in which workspace, whether this phone is paged, and Sign out. */
export function Account() {
  const member = useMember();
  const colors = useTheme();
  const [leaving, setLeaving] = useState(false);
  const paging = pagingText(member.paging);
  const pagingColor = pagingProblem(member.paging)
    ? colors.destructive
    : member.paging === "unsupported"
      ? colors.mutedForeground
      : undefined;

  // Signing out stops this phone's pages, so it asks first, with the consequence in the question; a phone that
  // is not paging them only loses the incidents. Still setting up counts as paging: it may be registered already.
  const confirm = () =>
    Alert.alert(
      m.mobile_session({ part: "sign_out_title" }),
      [
        m.mobile_session({
          part:
            member.paging === "on" || member.paging === "pending"
              ? "sign_out_body"
              : "sign_out_body_unpaged",
        }),
        // Changes made offline are kept for this member only: signing out deletes them unsent.
        member.unsent() ? m.mobile_session({ part: "sign_out_unsent" }) : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      [
        { text: m.mobile_session({ part: "cancel" }), style: "cancel" },
        {
          text: m.sign_out(),
          style: "destructive",
          onPress: () => {
            setLeaving(true);
            void member
              .signOut()
              .then((result) => {
                // Offline: the shard still pages this phone for them until the app finishes it online, or, with
                // nothing kept to finish it with, until they sign in and out again.
                if (result === "kept") {
                  Alert.alert(
                    m.mobile_session({ part: "sign_out_kept_title" }),
                    m.mobile_session({ part: "sign_out_kept_body" }),
                  );
                } else if (result === "stuck") {
                  Alert.alert(
                    m.mobile_session({ part: "sign_out_stuck_title" }),
                    m.mobile_session({ part: "sign_out_stuck_body" }),
                  );
                }
              })
              .finally(() => setLeaving(false));
          },
        },
      ],
    );

  return (
    <Section title={m.mobile_session({ part: "account" })} inset={false}>
      <Row first>
        <ThemedText selectable>{member.name}</ThemedText>
        <ThemedText selectable variant="caption">
          {member.email}
        </ThemedText>
      </Row>
      <Workspaces
        current={member.workspaceId}
        currentName={member.workspaceName}
        paged={member.pagedWorkspaces}
      />
      <Row>
        <ThemedText variant="label">{m.mobile_session({ part: "pages" })}</ThemedText>
        <ThemedText
          selectable
          accessibilityLiveRegion="polite"
          style={pagingColor ? { color: pagingColor } : undefined}
        >
          {paging}
        </ThemedText>
      </Row>
      <Calls />
      <EmailChoices />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: leaving, disabled: leaving }}
        disabled={leaving}
        onPress={confirm}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Row>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[2] }}>
            {leaving ? <ActivityIndicator color={colors.destructive} /> : null}
            <ThemedText style={{ color: colors.destructive }}>
              {leaving ? m.mobile_session({ part: "signing_out" }) : m.sign_out()}
            </ThemedText>
          </View>
        </Row>
      </Pressable>
    </Section>
  );
}
