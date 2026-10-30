import { FieldGroup, RNHostView, TextInput, useNativeState, type TextInputRef } from "@expo/ui";
import { Button, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityAddTraits,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  multilineTextAlignment,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import { useRef } from "react";
import { BrandMark } from "@/components/brand-mark";
import { NativeHost } from "@/components/native-host";
import { SubmitButton } from "@/components/submit-button";
import { useTheme } from "@/hooks/use-theme";
import type { NativeField, NativeFormProps } from "./native-form";

export type { NativeField, NativeFormProps } from "./native-form";

const secondary = foregroundStyle({ type: "hierarchical", style: "secondary" });

/**
 * A form as iOS draws a sign-in: the fields together in a section of a SwiftUI `Form` (a field with its own `section`
 * starts another), what the form is for above them and what is wrong under each group, then one large full-width
 * button and the links as tinted rows. With `brand`, the app's icon and the title head the form. Return moves to the
 * next field, and on the last one submits.
 */
export function NativeForm({ brand, intro, fields, problem, submit, links = [] }: NativeFormProps) {
  const colors = useTheme();
  const refs = useRef<(TextInputRef | null)[]>([]);
  const heading = brand ? (
    <BrandHeading title={brand} intro={intro} />
  ) : intro ? (
    <Text modifiers={[font({ textStyle: "subheadline" }), secondary]}>{intro}</Text>
  ) : null;
  const groups = fields.reduce<
    { title?: string; fields: { field: NativeField; index: number }[] }[]
  >((all, field, index) => {
    const last = all.at(-1);
    if (last && !field.section) last.fields.push({ field, index });
    else all.push({ title: field.section, fields: [{ field, index }] });
    return all;
  }, []);
  return (
    <NativeHost style={{ flex: 1 }}>
      <FieldGroup>
        {groups.length > 0 ? (
          groups.map((group, number) => (
            <FieldGroup.Section key={group.fields[0]!.field.key}>
              {number === 0 && heading ? (
                <FieldGroup.SectionHeader>{heading}</FieldGroup.SectionHeader>
              ) : group.title ? (
                <FieldGroup.SectionHeader>
                  <Text>{group.title}</Text>
                </FieldGroup.SectionHeader>
              ) : null}
              {group.fields.map(({ field, index }) => (
                <FormField
                  key={field.key}
                  field={field}
                  last={index === fields.length - 1}
                  inputRef={(input) => {
                    refs.current[index] = input;
                  }}
                  onNext={() =>
                    index === fields.length - 1
                      ? submit?.onPress()
                      : refs.current[index + 1]?.focus()
                  }
                />
              ))}
              {notes(
                group.fields.map(({ field }) => field),
                colors.destructive,
              )}
            </FieldGroup.Section>
          ))
        ) : brand ? (
          // Nothing to fill in (loading, offline): the heading and the message are the screen.
          <FieldGroup.Section>
            <FieldGroup.SectionHeader>{heading}</FieldGroup.SectionHeader>
          </FieldGroup.Section>
        ) : intro ? (
          <FieldGroup.Section>
            <Text modifiers={[secondary]}>{intro}</Text>
          </FieldGroup.Section>
        ) : null}
        {submit ? (
          <FieldGroup.Section>
            <SubmitButton label={submit.label} busy={submit.busy} onPress={submit.onPress} />
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

/**
 * The app's icon over the screen's title and what the form is for, centred, as iOS heads a sign-in. The title is the
 * screen's heading for VoiceOver, since the screen has no header.
 */
function BrandHeading({ title, intro }: { title: string; intro?: string }) {
  // Explicit colours: a section header dims its text, which would grey out the screen's title.
  const colors = useTheme();
  return (
    <VStack spacing={12} modifiers={[frame({ maxWidth: Infinity }), padding({ bottom: 12 })]}>
      <RNHostView matchContents>
        <BrandMark />
      </RNHostView>
      <Text
        modifiers={[
          font({ textStyle: "title2", weight: "bold" }),
          foregroundStyle(colors.foreground),
          multilineTextAlignment("center"),
          // A section header keeps its text to one line; a long title (pt-BR's) wraps instead.
          fixedSize({ horizontal: false, vertical: true }),
          accessibilityAddTraits(["isHeader"]),
        ]}
      >
        {title}
      </Text>
      {intro ? (
        <Text
          modifiers={[
            font({ textStyle: "subheadline" }),
            foregroundStyle(colors.mutedForeground),
            multilineTextAlignment("center"),
            fixedSize({ horizontal: false, vertical: true }),
          ]}
        >
          {intro}
        </Text>
      ) : null}
    </VStack>
  );
}

/**
 * Under a group of fields: each one's error, or else its hint or example, in the order of the fields. An element, not
 * a component: `FieldGroup` takes any child but its own footer for a row.
 */
function notes(fields: NativeField[], destructive: string) {
  const lines = fields.flatMap((field) =>
    field.error
      ? [{ key: field.key, text: field.error, error: true }]
      : (field.hint ?? field.placeholder)
        ? [{ key: field.key, text: (field.hint ?? field.placeholder)!, error: false }]
        : [],
  );
  if (lines.length === 0) return null;
  return (
    <FieldGroup.SectionFooter>
      <VStack alignment="leading" spacing={4}>
        {lines.map((note) => (
          <Text key={note.key} modifiers={note.error ? [foregroundStyle(destructive)] : undefined}>
            {note.text}
          </Text>
        ))}
      </VStack>
    </FieldGroup.SectionFooter>
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
