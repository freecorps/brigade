import {
  Button,
  FieldGroup,
  ListItem,
  Text,
  TextInput,
  useNativeState,
  type TextInputRef,
} from "@expo/ui";
import { useRef } from "react";
import type { KeyboardTypeOptions, TextInputProps } from "react-native";
import { NativeHost } from "@/components/native-host";
import { useTheme } from "@/hooks/use-theme";

export type NativeField = {
  key: string;
  label: string;
  placeholder?: string;
  /** Why it cannot go yet, under the field. */
  error?: string;
  /** Under the field when there is no error. */
  hint?: string;
  secure?: boolean;
  /** What a password manager fills in (`textContentType` on iOS, `contentType` on Android). */
  autoComplete?: NonNullable<TextInputProps["autoComplete"]>;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words";
  maxLength?: number;
  onChange: (text: string) => void;
};

export type NativeFormProps = {
  /** What the form is for, above it. */
  intro?: string;
  fields: NativeField[];
  /** Why the last try failed. */
  problem?: string | null;
  submit?: { label: string; busy?: boolean; onPress: () => void };
  /** Links under the form (Forgot your password?, Create an account). */
  links?: { label: string; note?: string; destructive?: boolean; onPress: () => void }[];
};

/**
 * A form in `@expo/ui`'s universal grouped list, where neither platform's own form applies (`.ios` and `.android`
 * draw those): one section per field with its error or hint under it, the button in its own section and the links
 * as rows. Return moves to the next field, and on the last one submits.
 */
export function NativeForm({ intro, fields, problem, submit, links = [] }: NativeFormProps) {
  const colors = useTheme();
  const refs = useRef<(TextInputRef | null)[]>([]);
  return (
    <NativeHost style={{ flex: 1 }}>
      <FieldGroup>
        {intro ? (
          <FieldGroup.Section>
            <ListItem>
              <Text>{intro}</Text>
            </ListItem>
          </FieldGroup.Section>
        ) : null}
        {fields.map((field, index) => (
          <FieldGroup.Section key={field.key} title={field.label}>
            <FormField
              field={field}
              last={index === fields.length - 1}
              inputRef={(input) => {
                refs.current[index] = input;
              }}
              onNext={() =>
                index === fields.length - 1 ? submit?.onPress() : refs.current[index + 1]?.focus()
              }
            />
            {field.error || field.hint ? (
              <FieldGroup.SectionFooter>
                <Text textStyle={field.error ? { color: colors.destructive } : undefined}>
                  {field.error ?? field.hint ?? ""}
                </Text>
              </FieldGroup.SectionFooter>
            ) : null}
          </FieldGroup.Section>
        ))}
        {submit ? (
          <FieldGroup.Section>
            <Button label={submit.label} onPress={submit.busy ? undefined : submit.onPress} />
            {problem ? (
              <FieldGroup.SectionFooter>
                <Text textStyle={{ color: colors.destructive }}>{problem}</Text>
              </FieldGroup.SectionFooter>
            ) : null}
          </FieldGroup.Section>
        ) : null}
        {links.length > 0 ? (
          <FieldGroup.Section>
            {links.map((link) => (
              <ListItem key={link.label} onPress={link.onPress} supportingText={link.note}>
                <Text textStyle={{ color: link.destructive ? colors.destructive : colors.primary }}>
                  {link.label}
                </Text>
              </ListItem>
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
      placeholder={field.placeholder ?? field.label}
      secureTextEntry={field.secure}
      autoComplete={field.autoComplete}
      keyboardType={field.keyboardType}
      autoCapitalize={field.autoCapitalize}
      autoCorrect={field.autoCapitalize === "none" ? false : undefined}
      maxLength={field.maxLength}
      returnKeyType={last ? "go" : "next"}
      onSubmitEditing={onNext}
    />
  );
}
