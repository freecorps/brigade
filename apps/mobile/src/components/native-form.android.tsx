import {
  Button,
  Column,
  OutlinedTextField,
  Text,
  TextButton,
  useNativeState,
  type TextFieldRef,
} from "@expo/ui/jetpack-compose";
import {
  fillMaxWidth,
  paddingAll,
  semantics,
  verticalScroll,
} from "@expo/ui/jetpack-compose/modifiers";
import { useRef } from "react";
import type { NativeField, NativeFormProps } from "@/components/native-form";
import { NativeHost } from "@/components/native-host";
import { useTheme } from "@/hooks/use-theme";

export type { NativeField, NativeFormProps } from "@/components/native-form";

/** Android's keyboard for each React Native keyboard type the forms use. */
const KEYBOARDS = { "email-address": "email", "number-pad": "number", default: "text" } as const;

/**
 * A form as Material draws one: the intro, outlined fields with their label, and error or hint as supporting text,
 * a full-width button and text buttons for the links. Return moves to the next field, and on the last one submits.
 */
export function NativeForm({ intro, fields, problem, submit, links = [] }: NativeFormProps) {
  const colors = useTheme();
  const refs = useRef<(TextFieldRef | null)[]>([]);
  return (
    <NativeHost style={{ flex: 1 }}>
      <Column
        verticalArrangement={{ spacedBy: 16 }}
        modifiers={[fillMaxWidth(), paddingAll(24), verticalScroll()]}
      >
        {intro ? <Text style={{ typography: "bodyLarge" }}>{intro}</Text> : null}
        {fields.map((field, index) => (
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
                : void refs.current[index + 1]?.focus()
            }
          />
        ))}
        {problem ? (
          <Text color={colors.destructive} style={{ typography: "bodyMedium" }}>
            {problem}
          </Text>
        ) : null}
        {submit ? (
          <Button
            onClick={submit.busy ? undefined : submit.onPress}
            enabled={!submit.busy}
            modifiers={[fillMaxWidth()]}
          >
            <Text>{submit.label}</Text>
          </Button>
        ) : null}
        {links.map((link) => (
          <Column key={link.label} modifiers={[fillMaxWidth()]}>
            {link.note ? <Text style={{ typography: "bodyMedium" }}>{link.note}</Text> : null}
            <TextButton onClick={link.onPress}>
              <Text color={link.destructive ? colors.destructive : undefined}>{link.label}</Text>
            </TextButton>
          </Column>
        ))}
      </Column>
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
  inputRef: (input: TextFieldRef | null) => void;
  onNext: () => void;
}) {
  const value = useNativeState("");
  const keyboard = field.secure
    ? "password"
    : (KEYBOARDS[field.keyboardType as keyof typeof KEYBOARDS] ?? "text");
  return (
    <OutlinedTextField
      ref={inputRef}
      value={value}
      onValueChange={field.onChange}
      singleLine
      maxLength={field.maxLength}
      isError={field.error !== undefined}
      visualTransformation={field.secure ? "password" : "none"}
      keyboardOptions={{
        keyboardType: keyboard,
        capitalization: field.autoCapitalize ?? "sentences",
        autoCorrectEnabled: field.autoCapitalize !== "none" && !field.secure,
        imeAction: last ? "go" : "next",
      }}
      keyboardActions={last ? { onGo: onNext } : { onNext }}
      // What a password manager fills in, as `@expo/ui`'s own TextInput tells Android's autofill.
      modifiers={[
        fillMaxWidth(),
        ...(field.autoComplete ? [semantics({ contentType: field.autoComplete })] : []),
      ]}
    >
      <OutlinedTextField.Label>
        <Text>{field.label}</Text>
      </OutlinedTextField.Label>
      {field.placeholder ? (
        <OutlinedTextField.Placeholder>
          <Text>{field.placeholder}</Text>
        </OutlinedTextField.Placeholder>
      ) : null}
      {field.error || field.hint ? (
        <OutlinedTextField.SupportingText>
          <Text>{field.error ?? field.hint ?? ""}</Text>
        </OutlinedTextField.SupportingText>
      ) : null}
    </OutlinedTextField>
  );
}
