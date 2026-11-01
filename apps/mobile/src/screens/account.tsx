import { FieldGroup, Switch, Text } from "@expo/ui";
import { ListItem } from "@/components/list-item";
import { m } from "@freecorps/brigade-i18n";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { rowPagingText, say as sayInstances, useSwitcher } from "@/components/instances";
import { openInstance } from "@/components/session";
import { MAX_INSTANCES } from "@/lib/instances";
import type { SwitcherGroup } from "@/lib/switcher";
import {
  useCalls,
  useEmailChoices,
  usePhonePaging,
  useSignOut,
  useWorkspaces,
} from "@/components/account";
import { Avatar } from "@/components/avatar";
import { FooterText } from "@/components/footer-text";
import type { Glyph } from "@/components/glyphs";
import { useListEnd } from "@/components/list-end";
import { NativeHost } from "@/components/native-host";
import { CALL_GLYPH } from "@/components/paging";
import { RowChevron } from "@/components/row-chevron";
import { RowIcon } from "@/components/row-icon";
import { RowCheck } from "@/components/row-check";
import { useMember } from "@/components/session";
import { useTheme } from "@/hooks/use-theme";
import { useSystemColors } from "@/theme/system-colors";

const WORKSPACE_GLYPH: Glyph = { ios: "person.3.fill", android: "groups", web: "groups" };
const ADD_GLYPH: Glyph = { ios: "plus.circle.fill", android: "add_circle", web: "add_circle" };
const PAGES_GLYPH: Glyph = {
  ios: "bell.badge.fill",
  android: "notifications",
  web: "notifications",
};
const FIX_GLYPHS: Record<"settings" | "retry", Glyph> = {
  settings: { ios: "gearshape", android: "settings", web: "settings" },
  retry: { ios: "arrow.clockwise", android: "refresh", web: "refresh" },
};
const ADD_INSTANCE_GLYPH: Glyph = {
  ios: "plus.rectangle.on.rectangle",
  android: "add_link",
  web: "add_link",
};
const DETAILS_GLYPH: Glyph = { ios: "server.rack", android: "dns", web: "dns" };
const SIGN_IN_GLYPH: Glyph = {
  ios: "person.crop.circle.badge.plus",
  android: "login",
  web: "login",
};

/** An instance's details sheet (its host, its relay, its paging; removing it), from its section. */
function InstanceDetailsRow({ id, host }: { id: string; host: string }) {
  const colors = useTheme();
  return (
    <ListItem
      onPress={() => router.push({ pathname: "/instance/[id]", params: { id } })}
      leading={<RowIcon glyph={DETAILS_GLYPH} color={colors.mutedForeground} />}
      supportingText={host}
      trailing={<RowChevron />}
    >
      <Text>{sayInstances("details")}</Text>
    </ListItem>
  );
}

/**
 * Another instance on this phone, in the switcher: its workspaces with their paging (tap one to open it there), or
 * "Signed out" with a way to sign in; and its details. It keeps paging this phone while another is open.
 */
function OtherInstance({ group }: { group: SwitcherGroup }) {
  const colors = useTheme();
  const [opening, setOpening] = useState<string | null>(null);
  const open = (workspaceId?: string) => {
    if (opening !== null) return;
    setOpening(workspaceId ?? "");
    void openInstance(group.instance.id, workspaceId).finally(() => setOpening(null));
  };
  return (
    <FieldGroup.Section title={group.label}>
      {group.state === "signed-in" ? (
        group.rows.map((row) => (
          <ListItem
            key={row.workspaceId}
            onPress={() => open(row.workspaceId)}
            leading={<RowIcon glyph={WORKSPACE_GLYPH} />}
            supportingText={
              opening === row.workspaceId
                ? m.account_flow({ part: "switching", name: "" })
                : rowPagingText(row)
            }
          >
            <Text numberOfLines={2}>{row.label}</Text>
          </ListItem>
        ))
      ) : (
        <ListItem
          onPress={() => open()}
          leading={<RowIcon plain glyph={SIGN_IN_GLYPH} color={colors.primary} />}
          supportingText={group.state === "signed-out" ? sayInstances("signed_out") : undefined}
        >
          <Text textStyle={{ color: colors.primary }}>
            {group.state === "signed-out" ? sayInstances("sign_in") : sayInstances("loading")}
          </Text>
        </ListItem>
      )}
      <InstanceDetailsRow id={group.instance.id} host={group.host} />
    </FieldGroup.Section>
  );
}

const LEGEND_GLYPH: Glyph = { ios: "info.circle.fill", android: "info", web: "info" };
const SIGN_OUT_GLYPH: Glyph = {
  ios: "rectangle.portrait.and.arrow.right",
  android: "logout",
  web: "logout",
};

/**
 * The Account tab, as the system's settings screen (a SwiftUI `Form` on iOS, Material 3's grouped list on Android):
 * who is signed in, their workspaces (tap one to open it), whether this phone gets pages, which pages ring as calls,
 * the member's emails as switches, the legend and Sign out.
 */
export function AccountScreen() {
  const colors = useTheme();
  const system = useSystemColors();
  const member = useMember();
  const workspaces = useWorkspaces();
  const paging = usePhonePaging();
  const calls = useCalls();
  const email = useEmailChoices();
  const signOut = useSignOut();
  const listEnd = useListEnd();
  const { list, groups } = useSwitcher();
  const switcher = {
    several: list.instances.length > 1,
    active: groups.find((group) => group.active),
    others: groups.filter((group) => !group.active),
    full: list.instances.length >= MAX_INSTANCES,
  };
  const say = (part: string) => m.account_flow({ part, name: "" });
  return (
    <View style={{ flex: 1 }}>
      <NativeHost style={{ flex: 1 }}>
        <FieldGroup>
          <FieldGroup.Section>
            <ListItem supportingText={member.email} leading={<Avatar name={member.name} />}>
              <Text textStyle={{ fontSize: 17, fontWeight: "600" }}>{member.name}</Text>
            </ListItem>
          </FieldGroup.Section>

          {/* The switcher (RFC 0015 section 5): the open instance's workspaces, then each other instance's, grouped
            by instance with whether this phone is paged; with several, rows read "Instance · Workspace". */}
          <FieldGroup.Section title={switcher.several ? switcher.active?.label : say("workspaces")}>
            {workspaces.rows.map((workspace) => (
              <ListItem
                key={workspace.id}
                onPress={workspace.active ? undefined : () => workspaces.pick(workspace.id)}
                leading={<RowIcon glyph={WORKSPACE_GLYPH} />}
                supportingText={
                  switcher.active?.paging
                    ? rowPagingText({ paging: switcher.active.paging })
                    : workspace.paging
                }
                trailing={workspace.active ? <RowCheck /> : undefined}
              >
                <Text numberOfLines={2}>
                  {switcher.several && switcher.active
                    ? `${switcher.active.label} · ${workspace.name}`
                    : workspace.name}
                </Text>
              </ListItem>
            ))}
            <ListItem
              onPress={() => router.push("/new-workspace")}
              leading={<RowIcon plain glyph={ADD_GLYPH} color={colors.primary} />}
            >
              <Text textStyle={{ color: colors.primary }}>{say("new_workspace")}</Text>
            </ListItem>
            {switcher.active ? (
              <InstanceDetailsRow id={switcher.active.instance.id} host={switcher.active.host} />
            ) : null}
            {workspaces.failed || workspaces.rows.length > 1 ? (
              <FieldGroup.SectionFooter>
                <FooterText tone={workspaces.failed ? "destructive" : "default"}>
                  {workspaces.failed ? say("switch_failed") : say("mobile_paging")}
                </FooterText>
              </FieldGroup.SectionFooter>
            ) : null}
          </FieldGroup.Section>
          {switcher.others.map((group) => (
            <OtherInstance key={group.instance.id} group={group} />
          ))}
          <FieldGroup.Section>
            <ListItem
              onPress={switcher.full ? undefined : () => router.push("/add-instance")}
              leading={
                <RowIcon
                  plain
                  glyph={ADD_INSTANCE_GLYPH}
                  color={switcher.full ? colors.mutedForeground : colors.primary}
                />
              }
            >
              <Text textStyle={{ color: switcher.full ? colors.mutedForeground : colors.primary }}>
                {sayInstances("add_title")}
              </Text>
            </ListItem>
            {switcher.full ? (
              <FieldGroup.SectionFooter>
                <FooterText>{m.mobile_instances_full({ max: MAX_INSTANCES })}</FooterText>
              </FieldGroup.SectionFooter>
            ) : null}
          </FieldGroup.Section>

          <FieldGroup.Section title={m.mobile_session({ part: "pages" })}>
            <ListItem leading={<RowIcon glyph={PAGES_GLYPH} color={colors.severity.sev1.bg} />}>
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
                leading={
                  <RowIcon plain glyph={FIX_GLYPHS[paging.fix.kind]} color={colors.primary} />
                }
              >
                <Text textStyle={{ color: colors.primary }}>{paging.fix.label}</Text>
              </ListItem>
            ) : null}
          </FieldGroup.Section>

          <FieldGroup.Section title={m.call_settings({ part: "title" })}>
            <ListItem
              onPress={calls.ready ? calls.pick : undefined}
              supportingText={calls.hint}
              leading={<RowIcon glyph={CALL_GLYPH} color={colors.chart2} />}
              trailing={calls.ready ? <RowChevron /> : undefined}
            >
              <Text textStyle={{ color: colors.primary }}>{calls.value}</Text>
            </ListItem>
            {calls.failed ? (
              <FieldGroup.SectionFooter>
                <FooterText tone="destructive">{m.call_settings({ part: "failed" })}</FooterText>
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
                <FooterText
                  tone={
                    index === email.rows.length - 1 && email.problem ? "destructive" : "default"
                  }
                >
                  {index === email.rows.length - 1
                    ? [row.hint, email.problem ?? email.note].join("\n\n")
                    : row.hint}
                </FooterText>
              </FieldGroup.SectionFooter>
            </FieldGroup.Section>
          ))}
          <FieldGroup.Section>
            <ListItem
              onPress={() => router.push("/legend")}
              leading={<RowIcon glyph={LEGEND_GLYPH} color={colors.chart5} />}
              trailing={<RowChevron />}
            >
              <Text>{m.legend_title()}</Text>
            </ListItem>
            <ListItem
              onPress={signOut.leaving ? undefined : signOut.confirm}
              leading={<RowIcon glyph={SIGN_OUT_GLYPH} color={system.destructive} />}
            >
              <Text textStyle={{ color: system.destructive }}>{signOut.label}</Text>
            </ListItem>
          </FieldGroup.Section>
          {listEnd}
        </FieldGroup>
      </NativeHost>
      {calls.sheet}
    </View>
  );
}
