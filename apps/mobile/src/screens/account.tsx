import { FieldGroup, ListItem, Switch, Text } from "@expo/ui";
import { m } from "@freecorps/brigade-i18n";
import { router } from "expo-router";
import { View } from "react-native";
import {
  useCalls,
  useEmailChoices,
  usePhonePaging,
  useSignOut,
  useWorkspaces,
} from "@/components/account";
import { NativeHost } from "@/components/native-host";
import { RowCheck } from "@/components/row-check";
import { useMember } from "@/components/session";
import { useTheme } from "@/hooks/use-theme";

/**
 * The Account tab, as the system's settings screen (a SwiftUI `Form` on iOS, Material 3's grouped list on Android):
 * who is signed in, their workspaces (tap one to open it), whether this phone gets pages, which pages ring as calls,
 * the member's emails as switches, the legend and Sign out.
 */
export function AccountScreen() {
  const colors = useTheme();
  const member = useMember();
  const workspaces = useWorkspaces();
  const paging = usePhonePaging();
  const calls = useCalls();
  const email = useEmailChoices();
  const signOut = useSignOut();
  const say = (part: string) => m.account_flow({ part, name: "" });
  return (
    <View style={{ flex: 1 }}>
      <NativeHost style={{ flex: 1 }}>
        <FieldGroup>
          <FieldGroup.Section>
            <ListItem supportingText={member.email}>
              <Text textStyle={{ fontSize: 18, fontWeight: "600" }}>{member.name}</Text>
            </ListItem>
          </FieldGroup.Section>

          <FieldGroup.Section title={say("workspaces")}>
            {workspaces.rows.map((workspace) => (
              <ListItem
                key={workspace.id}
                onPress={workspace.active ? undefined : () => workspaces.pick(workspace.id)}
                supportingText={workspace.paging}
                trailing={workspace.active ? <RowCheck /> : undefined}
              >
                <Text numberOfLines={2}>{workspace.name}</Text>
              </ListItem>
            ))}
            <ListItem onPress={() => router.push("/new-workspace")}>
              <Text textStyle={{ color: colors.primary }}>{say("new_workspace")}</Text>
            </ListItem>
            {workspaces.failed || workspaces.rows.length > 1 ? (
              <FieldGroup.SectionFooter>
                <Text textStyle={workspaces.failed ? { color: colors.destructive } : undefined}>
                  {workspaces.failed ? say("switch_failed") : say("mobile_paging")}
                </Text>
              </FieldGroup.SectionFooter>
            ) : null}
          </FieldGroup.Section>

          <FieldGroup.Section title={m.mobile_session({ part: "pages" })}>
            <ListItem>
              <Text
                textStyle={
                  paging.problem
                    ? { color: colors.destructive }
                    : paging.muted
                      ? { color: colors.mutedForeground }
                      : undefined
                }
              >
                {paging.text}
              </Text>
            </ListItem>
            {paging.fix ? (
              <ListItem
                onPress={paging.fix.busy ? undefined : paging.fix.run}
                supportingText={paging.where}
              >
                <Text textStyle={{ color: colors.primary }}>{paging.fix.label}</Text>
              </ListItem>
            ) : null}
          </FieldGroup.Section>

          <FieldGroup.Section title={m.call_settings({ part: "title" })}>
            <ListItem onPress={calls.ready ? calls.pick : undefined} supportingText={calls.hint}>
              <Text textStyle={{ color: colors.primary }}>{calls.value}</Text>
            </ListItem>
            {calls.failed ? (
              <FieldGroup.SectionFooter>
                <Text textStyle={{ color: colors.destructive }}>
                  {m.call_settings({ part: "failed" })}
                </Text>
              </FieldGroup.SectionFooter>
            ) : null}
          </FieldGroup.Section>

          {email.rows.map((row, index) => (
            <FieldGroup.Section key={row.key}>
              <Switch
                label={row.label}
                value={row.on}
                disabled={!email.ready}
                onValueChange={(on) => email.flip(row.key, on)}
              />
              <FieldGroup.SectionFooter>
                {/* The last switch's note also says who always gets the email, and why a save failed. */}
                <Text
                  textStyle={
                    index === email.rows.length - 1 && email.problem
                      ? { color: colors.destructive }
                      : undefined
                  }
                >
                  {index === email.rows.length - 1
                    ? [row.hint, email.problem ?? email.note].join("\n\n")
                    : row.hint}
                </Text>
              </FieldGroup.SectionFooter>
            </FieldGroup.Section>
          ))}
          <FieldGroup.Section>
            <ListItem onPress={() => router.push("/legend")}>
              <Text>{m.legend_title()}</Text>
            </ListItem>
            <ListItem onPress={signOut.leaving ? undefined : signOut.confirm}>
              <Text textStyle={{ color: colors.destructive }}>{signOut.label}</Text>
            </ListItem>
          </FieldGroup.Section>
        </FieldGroup>
      </NativeHost>
      {calls.sheet}
    </View>
  );
}
