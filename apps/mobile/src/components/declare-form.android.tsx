import {
  Button,
  Column,
  DropdownMenuItem,
  ExposedDropdownMenu,
  ExposedDropdownMenuBox,
  OutlinedTextField,
  SegmentedButton,
  SingleChoiceSegmentedButtonRow,
  Text,
  useNativeState,
} from "@expo/ui/jetpack-compose";
import {
  fillMaxWidth,
  menuAnchor,
  paddingAll,
  verticalScroll,
  weight,
} from "@expo/ui/jetpack-compose/modifiers";
import { m } from "@freecorps/brigade-i18n";
import { severityLabels } from "@freecorps/brigade-i18n/labels";
import { INCIDENT_TITLE_MAX, SEVERITIES } from "@freecorps/brigade-schema";
import { useEffect, useRef, useState } from "react";
import type { DeclareFormProps } from "@/components/declare-form";
import { NativeHost } from "@/components/native-host";
import { SheetHandle } from "@/components/sheet-handle";
import { useSystemColors } from "@/theme/system-colors";

export type { DeclareFormProps } from "@/components/declare-form";

/**
 * The declare form as Material 3's own: a headline, an outlined text field, the severity as a segmented button
 * (four short codes, the name under them), dropdown fields for the type and policy, and a full-width button.
 */
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
  const title = useNativeState("");
  const system = useSystemColors();
  return (
    <NativeHost style={{ flex: 1 }}>
      <Column
        verticalArrangement={{ spacedBy: 20 }}
        modifiers={[fillMaxWidth(), paddingAll(24), verticalScroll()]}
      >
        <SheetHandle />
        <Text style={{ typography: "headlineSmall" }}>{m.declare_heading()}</Text>
        <OutlinedTextField
          value={title}
          onValueChange={onTitle}
          autoFocus
          singleLine
          maxLength={INCIDENT_TITLE_MAX}
          isError={invalid !== null}
          keyboardOptions={{ capitalization: "sentences", imeAction: "done" }}
          keyboardActions={{ onDone: () => onDeclare() }}
          modifiers={[fillMaxWidth()]}
        >
          <OutlinedTextField.Label>
            <Text>{m.declare_title_label()}</Text>
          </OutlinedTextField.Label>
          <OutlinedTextField.Placeholder>
            <Text>{m.declare_title_placeholder()}</Text>
          </OutlinedTextField.Placeholder>
          {invalid ? (
            <OutlinedTextField.SupportingText>
              <Text>
                {invalid === "empty" ? m.declare_title_empty() : m.declare_title_invalid()}
              </Text>
            </OutlinedTextField.SupportingText>
          ) : null}
        </OutlinedTextField>

        {types.length > 0 ? (
          <MenuField
            label={m.catalog_text({ text: "type_label", name: "", reason: "" })}
            value={typeId}
            onValue={onType}
            options={[
              { value: "", label: m.catalog_text({ text: "no_type", name: "", reason: "" }) },
              ...types.map((one) => ({ value: one.id, label: one.name })),
            ]}
          />
        ) : null}

        <Column verticalArrangement={{ spacedBy: 8 }} modifiers={[fillMaxWidth()]}>
          <Text style={{ typography: "labelLarge" }}>{m.declare_severity_label()}</Text>
          <SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth()]}>
            {SEVERITIES.map((one) => (
              <SegmentedButton
                key={one}
                selected={one === severity}
                onClick={() => onSeverity(one)}
                modifiers={[weight(1)]}
              >
                <SegmentedButton.Label>
                  <Text>{one.toUpperCase()}</Text>
                </SegmentedButton.Label>
              </SegmentedButton>
            ))}
          </SingleChoiceSegmentedButtonRow>
          <Text style={{ typography: "bodyMedium" }} color={system.secondaryLabel as string}>
            {severityLabels[severity]()}
          </Text>
        </Column>

        {policies.length > 0 ? (
          <MenuField
            label={m.declare_policy_label()}
            value={policyId}
            onValue={onPolicy}
            options={[
              { value: "", label: m.declare_policy_usual() },
              ...policies.map((one) => ({ value: one.id, label: one.name })),
            ]}
          />
        ) : null}

        <Button onClick={onDeclare} modifiers={[fillMaxWidth()]}>
          <Text>{m.declare_submit_severity({ severity: severity.toUpperCase() })}</Text>
        </Button>
      </Column>
    </NativeHost>
  );
}

/** A labelled, read-only outlined field that opens Material's exposed dropdown menu. */
function MenuField({
  label,
  value,
  onValue,
  options,
}: {
  label: string;
  value: string;
  onValue: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const [expanded, setExpanded] = useState(false);
  const text = useNativeState("");
  const shown = options.find((option) => option.value === value)?.label ?? "";
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (last.current === shown) return;
    last.current = shown;
    text.value = shown;
  }, [shown, text]);
  return (
    <ExposedDropdownMenuBox expanded={expanded} onExpandedChange={setExpanded}>
      <OutlinedTextField value={text} readOnly modifiers={[menuAnchor(), fillMaxWidth()]}>
        <OutlinedTextField.Label>
          <Text>{label}</Text>
        </OutlinedTextField.Label>
      </OutlinedTextField>
      <ExposedDropdownMenu expanded={expanded} onDismissRequest={() => setExpanded(false)}>
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => {
              onValue(option.value);
              setExpanded(false);
            }}
          >
            <DropdownMenuItem.Text>
              <Text>{option.label}</Text>
            </DropdownMenuItem.Text>
          </DropdownMenuItem>
        ))}
      </ExposedDropdownMenu>
    </ExposedDropdownMenuBox>
  );
}
