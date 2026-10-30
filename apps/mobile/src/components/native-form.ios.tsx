import { FieldGroup, TextInput, useNativeState, type TextInputRef } from "@expo/ui";
import { Button, Text, VStack } from "@expo/ui/swift-ui";
import {
  buttonStyle,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  listRowBackground,
  listRowInsets,
} from "@expo/ui/swift-ui/modifiers";
import { useRef } from "react";
import { NativeHost } from "@/components/native-host";
import { useTheme } from "@/hooks/use-theme";
import type { NativeField, NativeFormProps } from "./native-form";

export type { NativeField, NativeFormProps } from "./native-form";

const secondary = foregroundStyle({ type: "hierarchical", style: "secondary" });

/**
 * A form as iOS draws a sign-in: the fields together in one section of a SwiftUI `Form`, what the form is for above
 * them and what is wrong under them, then one large full-width button and the links as tinted rows. Return moves to
 * the next field, and on the last one submits.
 */
export function NativeForm({ intro, fields, problem, submit, links = [] }: NativeFormProps) {
  const colors = useTheme();
  const refs = useRef<(TextInputRef | null)[]>([]);
  const notes = fields.flatMap((field) =>
    field.error
      ? [{ key: field.key, text: field.error, error: true }]
      : (field.hint ?? field.placeholder)
        ? [{ key: field.key, text: (field.hint ?? field.placeholder)!, error: false }]
        : [],
  );
  return (
    <NativeHost style={{ flex: 1 }}>
      <FieldGroup>
        {fields.length > 0 ? (
          <FieldGroup.Section>
            {intro ? (
              <FieldGroup.SectionHeader>
                <Text modifiers={[font({ textStyle: "subheadline" }), secondary]}>{intro}</Text>
              </FieldGroup.SectionHeader>
            ) : null}
            {fields.map((field, index) => (
              <FormField
                key={field.key}
                field={field}
                last={index === fields.length - 1}
                inputRef={(input) => {
                  refs.current[index] = input;
                }}
                onNext={() =>
                  index === fields.length - 1 ? submit?.onPress() : refs.current[index + 1]?.focus()
                }
              />
            ))}
            {notes.length > 0 ? (
              <FieldGroup.SectionFooter>
                <VStack alignment="leading" spacing={4}>
                  {notes.map((note) => (
                    <Text
                      key={note.key}
                      modifiers={note.error ? [foregroundStyle(colors.destructive)] : undefined}
                    >
                      {note.text}
                    </Text>
                  ))}
                </VStack>
              </FieldGroup.SectionFooter>
            ) : null}
          </FieldGroup.Section>
        ) : intro ? (
          // Nothing to fill in (loading, offline): the message is the screen.
          <FieldGroup.Section>
            <Text modifiers={[secondary]}>{intro}</Text>
          </FieldGroup.Section>
        ) : null}
        {submit ? (
          <FieldGroup.Section>
            <Button
              onPress={submit.onPress}
              modifiers={[
                buttonStyle("borderedProminent"),
                controlSize("large"),
                disabled(submit.busy ?? false),
                listRowBackground("clear"),
                listRowInsets({ top: 0, leading: 0, bottom: 0, trailing: 0 }),
              ]}
            >
              <Text modifiers={[font({ weight: "semibold" }), frame({ maxWidth: Infinity })]}>
                {submit.label}
              </Text>
            </Button>
            {problem ? (
              <FieldGroup.SectionFooter>
                <Text modifiers={[foregroundStyle(colors.destructive)]}>{problem}</Text>
              </FieldGroup.SectionFooter>
            ) : null}
          </FieldGroup.Section>
        ) : null}
        {links.length > 0 ? (
          <FieldGroup.Section>
            {links.map((link) => (
              <Button
                key={link.label}
                onPress={link.onPress}
                role={link.destructive ? "destructive" : "default"}
              >
                <VStack alignment="leading" spacing={2}>
                  {link.note ? (
                    <Text
                      modifiers={[
                        font({ textStyle: "footnote" }),
                        foregroundStyle(colors.mutedForeground),
                      ]}
                    >
                      {link.note}
                    </Text>
                  ) : null}
                  <Text>{link.label}</Text>
                </VStack>
              </Button>
            ))}
          </FieldGroup.Section>
        ) : null}
      </FieldGroup>
    </NativeHost>
  );
}

function FormField({
  field,
  last,
  inputRef,
  onNext,
}: {
  field: NativeField;
  last: boolean;
  inputRef: (input: TextInputRef | null) => void;
  onNext: () => void;
}) {
  const value = useNativeState("");
  return (
    <TextInput
      ref={inputRef}
      value={value}
      onChangeText={field.onChange}
      // The label is the placeholder (the rows share a section); a placeholder that is an example goes under them.
      placeholder={field.label}
      secureTextEntry={field.secure}
      autoComplete={field.autoComplete}
      keyboardType={field.keyboardType}
      autoCapitalize={field.autoCapitalize}
      autoCorrect={field.secure || field.autoCapitalize === "none" ? false : undefined}
      maxLength={field.maxLength}
      returnKeyType={last ? "go" : "next"}
      onSubmitEditing={onNext}
    />
  );
}
