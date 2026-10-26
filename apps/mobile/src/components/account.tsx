import { m } from "@freecorps/brigade-i18n";
import { spacing } from "@freecorps/brigade-ui";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
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

/** Who is signed in, in which workspace, whether this phone is paged, and Sign out. */
export function Account() {
  const member = useMember();
  const colors = useTheme();
  const [leaving, setLeaving] = useState(false);
  const paging = pagingText(member.paging);
  const pagingBad = member.paging !== "on" && member.paging !== "pending";

  // Signing out stops this phone's pages, so it asks first, with the consequence in the question.
  const confirm = () =>
    Alert.alert(
      m.mobile_session({ part: "sign_out_title" }),
      m.mobile_session({ part: "sign_out_body" }),
      [
        { text: m.mobile_session({ part: "cancel" }), style: "cancel" },
        {
          text: m.sign_out(),
          style: "destructive",
          onPress: () => {
            setLeaving(true);
            void member.signOut().finally(() => setLeaving(false));
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
          style={pagingBad ? { color: colors.destructive } : undefined}
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
