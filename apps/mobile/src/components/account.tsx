import { m } from "@freecorps/brigade-i18n";
import { radius, spacing } from "@freecorps/brigade-ui";
import { useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, View } from "react-native";
import { Row, Section } from "@/components/section";
import { useMember } from "@/components/session";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import type { Paging } from "@/lib/device";

const PAGING: Record<Paging, Parameters<typeof m.mobile_session>[0]["part"]> = {
  pending: "pages_pending",
  on: "pages_on",
  off: "pages_off",
  unsupported: "pages_unsupported",
  taken: "pages_taken",
  failed: "pages_failed",
};

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
 * At the top of the incident list when this phone does not page the member and they should know: notifications
 * off (with a way to Settings), the phone still another member's, or registering failed.
 */
export function PagingNotice() {
  const { paging } = useMember();
  const colors = useTheme();
  if (!pagingProblem(paging)) return null;
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
        {m.mobile_session({ part: "pages_notice_title" })}
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
      ) : null}
    </View>
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
  // is not paging them only loses the incidents.
  const confirm = () =>
    Alert.alert(
      m.mobile_session({ part: "sign_out_title" }),
      m.mobile_session({
        part: member.paging === "on" ? "sign_out_body" : "sign_out_body_unpaged",
      }),
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
                // Offline: the shard still pages this phone for them until the app finishes it online.
                if (result === "kept") {
                  Alert.alert(
                    m.mobile_session({ part: "sign_out_kept_title" }),
                    m.mobile_session({ part: "sign_out_kept_body" }),
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
      <Row>
        <ThemedText variant="label">{m.workspace_label()}</ThemedText>
        <ThemedText selectable>{member.workspaceName}</ThemedText>
      </Row>
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
