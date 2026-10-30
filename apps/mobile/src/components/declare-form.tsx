import { Button, FieldGroup, Picker, Text, TextInput, useNativeState } from "@expo/ui";
import { m } from "@freecorps/brigade-i18n";
import { severityName } from "@freecorps/brigade-i18n/incident";
import { INCIDENT_TITLE_MAX, SEVERITIES, type Severity } from "@freecorps/brigade-schema";
import { NativeHost } from "@/components/native-host";
import { useTheme } from "@/hooks/use-theme";

export type DeclareFormProps = {
  severity: Severity;
  onSeverity: (severity: Severity) => void;
  typeId: string;
  onType: (typeId: string) => void;
  types: readonly { id: string; name: string }[];
  /** "" for the usual policy. */
  policyId: string;
  onPolicy: (policyId: string) => void;
  policies: readonly { id: string; name: string }[];
  /** Why the title cannot go yet. */
  invalid: "empty" | "invalid" | null;
  onTitle: (title: string) => void;
  onDeclare: () => void;
};

/** The declare form as iOS's own: a SwiftUI `Form` with a text field and menu pickers (the web preview too). */
export function DeclareForm({
  severity,
  onSeverity,
  typeId,
  onType,
  types,
  policyId,
  onPolicy,
  policies,
  invalid,
  onTitle,
  onDeclare,
}: DeclareFormProps) {
  const colors = useTheme();
  const field = useNativeState("");
  return (
    <NativeHost style={{ flex: 1 }}>
      <FieldGroup>
        <FieldGroup.Section title={m.declare_title_label()}>
          <TextInput
            value={field}
            onChangeText={onTitle}
            placeholder={m.declare_title_placeholder()}
            maxLength={INCIDENT_TITLE_MAX}
            autoFocus
            autoCapitalize="sentences"
            returnKeyType="done"
            onSubmitEditing={onDeclare}
          />
          {/* Why the title cannot go yet, under the field. */}
          {invalid ? (
            <FieldGroup.SectionFooter>
              <Text textStyle={{ color: colors.destructive }}>
                {invalid === "empty" ? m.declare_title_empty() : m.declare_title_invalid()}
              </Text>
            </FieldGroup.SectionFooter>
          ) : null}
        </FieldGroup.Section>
        {types.length > 0 ? (
          <FieldGroup.Section title={m.catalog_text({ text: "type_label", name: "", reason: "" })}>
            <Picker selectedValue={typeId} onValueChange={onType}>
              <Picker.Item
                label={m.catalog_text({ text: "no_type", name: "", reason: "" })}
                value=""
              />
              {types.map((one) => (
                <Picker.Item key={one.id} label={one.name} value={one.id} />
              ))}
            </Picker>
          </FieldGroup.Section>
        ) : null}
        <FieldGroup.Section title={m.declare_severity_label()}>
          <Picker selectedValue={severity} onValueChange={onSeverity}>
            {SEVERITIES.map((one) => (
              <Picker.Item key={one} label={severityName(one)} value={one} />
            ))}
          </Picker>
        </FieldGroup.Section>
        {policies.length > 0 ? (
          <FieldGroup.Section title={m.declare_policy_label()}>
            <Picker selectedValue={policyId} onValueChange={onPolicy}>
              <Picker.Item label={m.declare_policy_usual()} value="" />
              {policies.map((one) => (
                <Picker.Item key={one.id} label={one.name} value={one.id} />
              ))}
            </Picker>
          </FieldGroup.Section>
        ) : null}
        <FieldGroup.Section>
          <Button
            label={m.declare_submit_severity({ severity: severity.toUpperCase() })}
            onPress={onDeclare}
          />
        </FieldGroup.Section>
      </FieldGroup>
    </NativeHost>
  );
}
