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
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useChoiceSheet } from "@/components/choice-sheet";
import { useMember } from "@/components/session";
import { ThemedText } from "@/components/themed-text";
import { useLocale } from "@/hooks/use-locale";
import { useTheme } from "@/hooks/use-theme";
import { authClient } from "@/lib/auth-client";
import type { Paging } from "@/lib/device";
import { caughtUp } from "@/lib/picked";

const PAGING: Record<Paging, Parameters<typeof m.mobile_session>[0]["part"]> = {
  pending: "pages_pending",
  on: "pages_on",
  off: "pages_off",
  unsupported: "pages_unsupported",
  taken: "pages_taken",
  limit: "pages_limit",
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
 * Whether the phone not paging is something the member should act on or know: `unsupported` is an Android build made
 * without Firebase (RFC 0006), not something the member can fix, so it is muted and gets no notice.
 */
function pagingProblem(paging: Paging): boolean {
  return paging === "off" || paging === "taken" || paging === "limit" || paging === "failed";
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
 * member's, too many phones registered (an older instance), or registering failed. The app keeps trying the phone
 * still another member's and a failure on its own (src/lib/paging.ts); Try again does any of the three now.
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
 * The member's workspaces (Better Auth's organization list), the active one first known even offline, each with
 * whether this phone gets its pages. `pick` makes another active: the session moves to it, the incident list,
 * on-call and the widget follow, and the phone registers there too while staying registered in the others, so it
 * keeps getting their pages (RFC 0006 "Device registration"). Changes not sent yet still go out from the workspace
 * they were made in (src/lib/drain.ts).
 */
export function useWorkspaces() {
  const member = useMember();
  const current = member.workspaceId;
  const list = authClient.useListOrganizations();
  const [switching, setSwitching] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // The active one is always shown, even before (or without) the list, or with a list read before it existed:
  // offline, it is all the app knows.
  const workspaces = list.data?.some((workspace) => workspace.id === current)
    ? list.data
    : [{ id: current, name: member.workspaceName }, ...(list.data ?? [])];
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
  return {
    rows: workspaces.map((workspace) => {
      const paging = member.pagedWorkspaces.find((one) => one.id === workspace.id)?.paging;
      return {
        id: workspace.id,
        name: workspace.name,
        active: workspace.id === current,
        switching: switching === workspace.id,
        paging:
          switching === workspace.id
            ? m.account_flow({ part: "switching", name: "" })
            : workspacePaging(paging),
        problem: paging !== undefined && pagingProblem(paging),
      };
    }),
    pick: (id: string) => void pick(id),
    failed,
  };
}

/**
 * Which pages ring the member's iPhones as a call (RFC 0010), in the open workspace, picked from a sheet and saved
 * at once (`member.setCalls`; offline, when the phone is next online). The notification comes either way.
 */
export function useCalls() {
  const { userId } = useMember();
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
  return {
    ready: settings.status === "ready",
    value:
      settings.status === "ready"
        ? label(current)
        : m.call_settings({ part: settings.status === "error" ? "load_failed" : "loading" }),
    hint: m.call_settings({ part: `${current}_hint` }),
    failed,
    pick,
    sheet,
  };
}

/**
 * The member's own email choices in the open workspace (`member.setEmail`, RFC 0005 "Email", RFC 0013 "Reminders"),
 * each saved as soon as it is switched (offline, when the phone is next online). The owners' "a page reached nobody"
 * email is not among them: it is the fallback when paging fails, which the note under them says. Also keeps the
 * time zone reminders follow on the phone's (`member.setTimeZone`).
 */
export function useEmailChoices() {
  const { userId } = useMember();
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
      // Only this save's own pick goes back: a newer switch keeps showing.
      setPicked((current) => (current === next ? null : current));
      if (outcome.error.code !== "conflict") setFailed(true);
    });
  };
  return {
    ready,
    rows: [
      {
        key: "missedPages" as const,
        label: text("missed"),
        hint: [
          text("missed_hint"),
          ...(emailSettings(workspace.rows[0]).unpaged ? [] : [text("missed_workspace_off")]),
        ].join(" "),
        on: shown.missedPages,
      },
      {
        key: "followUpReminders" as const,
        label: text("reminders"),
        hint: text("reminders_hint"),
        on: shown.followUpReminders,
      },
    ],
    flip,
    note: text("owners_note"),
    problem: settings.status === "error" ? text("load_failed") : failed ? text("failed") : null,
  };
}

/**
 * Sign out, asking first with the consequence in the question; a phone that is not paging them only loses the
 * incidents. Still setting up counts as paging: it may be registered already.
 */
export function useSignOut() {
  const member = useMember();
  const [leaving, setLeaving] = useState(false);
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
  return {
    label: leaving ? m.mobile_session({ part: "signing_out" }) : m.sign_out(),
    leaving,
    confirm,
  };
}

/** Whether this phone gets the open workspace's pages, in words, and whether that needs the member. */
export function usePhonePaging() {
  const member = useMember();
  const trouble = pagingTrouble(member);
  const [retrying, setRetrying] = useState(false);
  return {
    text: pagingText(member.paging),
    problem: pagingProblem(member.paging),
    muted: member.paging === "unsupported",
    /**
     * What the member can do about it: open the system settings, or try registering again now. `where` names the
     * workspace when the trouble is in another one this phone was opened in, as the incident list's notice does.
     */
    where:
      trouble?.name !== undefined
        ? m.account_flow({ part: "pages_notice_in", name: trouble.name })
        : undefined,
    fix: !trouble
      ? null
      : trouble.paging === "off"
        ? {
            label: m.mobile_session({ part: "open_settings" }),
            busy: false,
            run: () => void Linking.openSettings(),
          }
        : {
            label: m.mobile_session({ part: "try_again" }),
            busy: retrying,
            run: () => {
              if (retrying) return;
              setRetrying(true);
              void member.retryPaging().finally(() => setRetrying(false));
            },
          },
  };
}
