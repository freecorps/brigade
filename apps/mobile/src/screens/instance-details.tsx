import { FieldGroup, Text } from "@expo/ui";
import { m } from "@freecorps/brigade-i18n";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { Alert, Linking } from "react-native";
import { FooterText } from "@/components/footer-text";
import type { Glyph } from "@/components/glyphs";
import { relayText, rowPagingText, say, useBoard, useSwitcher } from "@/components/instances";
import { ListItem } from "@/components/list-item";
import { NativeHost } from "@/components/native-host";
import { RowIcon } from "@/components/row-icon";
import { openInstance, removeInstance, useSessionView } from "@/components/session";
import { useTheme } from "@/hooks/use-theme";
import { useSystemColors } from "@/theme/system-colors";
import { DEFAULT_INSTANCE } from "@/lib/instances";
import { removal } from "@/lib/switcher";

const GLOBE_GLYPH: Glyph = { ios: "globe", android: "language", web: "language" };
const PAGES_GLYPH: Glyph = {
  ios: "bell.badge.fill",
  android: "notifications",
  web: "notifications",
};
const RELAY_GLYPH: Glyph = {
  ios: "antenna.radiowaves.left.and.right",
  android: "cell_tower",
  web: "cell_tower",
};
const REMOVE_GLYPH: Glyph = { ios: "trash", android: "delete", web: "delete" };
const OPEN_GLYPH: Glyph = { ios: "arrow.right.circle.fill", android: "login", web: "login" };

/**
 * An instance's details sheet (RFC 0015 section 8 "Which relay is in use"): its host in full, who is signed in there,
 * which relay pages this phone for it (Freecorps' or its own, with the relay's host) and the paging state per
 * workspace; for an instance that pages through its own app, where to get that app. Open it from here, or remove it
 * from this phone (signed out first, after a warning when the member is on call there; never the last one).
 */
export function InstanceDetails({ id }: { id: string }) {
  const colors = useTheme();
  const system = useSystemColors();
  const view = useSessionView();
  const states = useBoard();
  const { list, groups, relays } = useSwitcher();
  const [removing, setRemoving] = useState(false);
  const group = groups.find((one) => one.instance.id === id);
  if (!group) {
    return (
      <NativeHost style={{ flex: 1 }}>
        <FieldGroup>
          <FieldGroup.Section>
            <ListItem>
              <Text>{say("loading")}</Text>
            </ListItem>
          </FieldGroup.Section>
        </FieldGroup>
      </NativeHost>
    );
  }
  const relay = relays[id] ?? { kind: "unknown" as const };
  const isDefault = id === DEFAULT_INSTANCE;
  const foreign = (relay.kind === "freecorps" || relay.kind === "own") && relay.foreign;
  const app = relay.kind === "own" ? relay.app : undefined;

  const remove = () => {
    const plan = removal(list, id, states[id] ?? { kind: "unknown" }, Date.now(), say("unnamed"));
    if (plan.kind === "last") {
      Alert.alert(say("remove_title", group.host), say("remove_last"));
      return;
    }
    const body = [
      plan.signedIn ? say("remove_body", group.host) : say("remove_body_signed_out", group.host),
      plan.onCall.length > 0
        ? say("remove_on_call", group.host, plan.onCall.join(", "))
        : plan.signedIn && plan.unknown
          ? say("remove_on_call_unknown")
          : null,
    ]
      .filter(Boolean)
      .join("\n\n");
    Alert.alert(say("remove_title", group.host), body, [
      { text: m.mobile_session({ part: "cancel" }), style: "cancel" },
      {
        text: say("remove"),
        style: "destructive",
        onPress: () => {
          setRemoving(true);
          // The shown instance signs out as the member does (its shard first); any other in the background.
          const shown =
            group.active && view.kind === "ready"
              ? () => view.member.signOut()
              : group.active && view.kind === "no-workspace"
                ? view.signOut
                : undefined;
          void removeInstance(id, shown)
            .then((result) => {
              if (result === "removed") {
                if (router.canGoBack()) router.back();
                return;
              }
              Alert.alert(
                say("remove_title", group.host),
                result === "kept"
                  ? say("remove_kept", group.host)
                  : say("remove_failed", group.host),
              );
            })
            .finally(() => setRemoving(false));
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: group.label }} />
      <NativeHost style={{ flex: 1 }}>
        <FieldGroup>
          <FieldGroup.Section>
            <ListItem
              leading={<RowIcon glyph={GLOBE_GLYPH} color={colors.chart5} />}
              supportingText={
                group.account
                  ? say("signed_in_as_row", "", group.account.email)
                  : group.state === "signed-out"
                    ? say("signed_out")
                    : say("loading")
              }
            >
              <Text textStyle={{ fontWeight: "600" }}>{group.host}</Text>
            </ListItem>
            {!group.active || group.state === "signed-out" ? (
              <ListItem
                onPress={() => {
                  if (router.canDismiss()) router.dismissAll();
                  void openInstance(id);
                }}
                leading={<RowIcon plain glyph={OPEN_GLYPH} color={colors.primary} />}
              >
                <Text textStyle={{ color: colors.primary }}>
                  {group.state === "signed-out"
                    ? say("sign_in")
                    : say("open_instance", group.label)}
                </Text>
              </ListItem>
            ) : null}
          </FieldGroup.Section>

          <FieldGroup.Section title={say("relay_title")}>
            <ListItem leading={<RowIcon glyph={RELAY_GLYPH} color={colors.chart2} />}>
              <Text
                textStyle={
                  relay.kind === "none" && !isDefault ? { color: colors.destructive } : undefined
                }
              >
                {relayText(relay, isDefault)}
              </Text>
            </ListItem>
            {group.rows.map((row) => (
              <ListItem
                key={row.workspaceId}
                leading={<RowIcon glyph={PAGES_GLYPH} color={colors.severity.sev1.bg} />}
                supportingText={rowPagingText(row)}
              >
                <Text numberOfLines={2}>{row.workspaceName}</Text>
              </ListItem>
            ))}
            {foreign && app ? (
              <ListItem onPress={() => void Linking.openURL(app).catch(() => {})}>
                <Text textStyle={{ color: colors.primary }}>{say("own_app_link")}</Text>
              </ListItem>
            ) : null}
            {foreign ? (
              <FieldGroup.SectionFooter>
                <FooterText tone="destructive">{say("foreign_body")}</FooterText>
              </FieldGroup.SectionFooter>
            ) : group.paging === "no-relay" ? (
              <FieldGroup.SectionFooter>
                <FooterText>{say("no_relay_body", group.host)}</FooterText>
              </FieldGroup.SectionFooter>
            ) : null}
          </FieldGroup.Section>

          <FieldGroup.Section>
            <ListItem
              onPress={removing ? undefined : remove}
              leading={<RowIcon glyph={REMOVE_GLYPH} color={system.destructive} />}
            >
              <Text textStyle={{ color: system.destructive }}>
                {removing ? say("removing") : say("remove")}
              </Text>
            </ListItem>
            {list.instances.length <= 1 ? (
              <FieldGroup.SectionFooter>
                <FooterText>{say("remove_last")}</FooterText>
              </FieldGroup.SectionFooter>
            ) : null}
          </FieldGroup.Section>
        </FieldGroup>
      </NativeHost>
    </>
  );
}
