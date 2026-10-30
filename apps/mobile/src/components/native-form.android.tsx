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
  padding,
  paddingAll,
  semantics,
  verticalScroll,
} from "@expo/ui/jetpack-compose/modifiers";
import { RNHostView } from "@expo/ui";
import { useRef } from "react";
import { Text as RNText, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BrandMark } from "@/components/brand-mark";
import type { NativeField, NativeFormProps } from "@/components/native-form";
import { NativeHost } from "@/components/native-host";
import { SheetHandle } from "@/components/sheet-handle";
import { useTheme } from "@/hooks/use-theme";
import { useSystemColors } from "@/theme/system-colors";

export type { NativeField, NativeFormProps } from "@/components/native-form";

/** Android's keyboard for each React Native keyboard type the forms use. */
const KEYBOARDS = { "email-address": "email", "number-pad": "number", default: "text" } as const;

/**
 * A form as Material draws one: the intro, outlined fields with their label, and error, hint or example as supporting
 * text (a field with its own `section` gets a title above it), a full-width button and the links centred under it.
 * With `brand`, the app's icon and the title head the form, under the status bar the screen draws to; in a sheet,
 * `title` is its headline. Return moves to the next field, and on the last one submits.
 */
export function NativeForm({
  brand,
  title,
  intro,
  fields,
  problem,
  submit,
  links = [],
}: NativeFormProps) {
  const colors = useTheme();
  const system = useSystemColors();
  const { top } = useSafeAreaInsets();
  const refs = useRef<(TextFieldRef | null)[]>([]);
  return (
    <NativeHost style={{ flex: 1 }}>
      <Column
        verticalArrangement={{ spacedBy: 16 }}
        modifiers={[
          fillMaxWidth(),
          verticalScroll(),
          paddingAll(24),
          ...(brand ? [padding(0, top, 0, 0)] : []),
        ]}
      >
        {title && !brand ? <SheetHandle /> : null}
        {title && !brand ? <Text style={{ typography: "headlineSmall" }}>{title}</Text> : null}
        {brand ? (
          <RNHostView matchContents={{ vertical: true }}>
            <BrandHeading title={brand} intro={intro} />
          </RNHostView>
        ) : intro ? (
          <Text style={{ typography: "bodyLarge" }}>{intro}</Text>
        ) : null}
        {fields.map((field, index) => (
          <Column
            key={field.key}
            verticalArrangement={{ spacedBy: 8 }}
            modifiers={[fillMaxWidth()]}
          >
            {field.section ? (
              <Text color={system.secondaryLabel as string} style={{ typography: "titleSmall" }}>
                {field.section}
              </Text>
            ) : null}
            <FormField
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
          </Column>
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
          // Centred, so the note and its text button line up whatever the button's own padding.
          <Column key={link.label} horizontalAlignment="center" modifiers={[fillMaxWidth()]}>
            {link.note ? (
              <Text
                color={system.secondaryLabel as string}
                style={{ typography: "bodyMedium", textAlign: "center" }}
              >
                {link.note}
              </Text>
            ) : null}
            <TextButton onClick={link.onPress}>
              <Text color={link.destructive ? colors.destructive : undefined}>{link.label}</Text>
            </TextButton>
          </Column>
        ))}
      </Column>
    </NativeHost>
  );
}

/**
 * The app's icon over the screen's title and what the form is for, centred: a React Native view, so TalkBack hears
 * the title as the screen's heading (the screen has no top app bar).
 */
function BrandHeading({ title, intro }: { title: string; intro?: string }) {
  const system = useSystemColors();
  return (
    <View style={{ alignItems: "center", gap: 12, paddingBottom: 8 }}>
      <BrandMark />
      <RNText
        accessibilityRole="header"
        style={{ color: system.label, fontSize: 24, lineHeight: 32, textAlign: "center" }}
      >
        {title}
      </RNText>
      {intro ? (
        <RNText
          style={{
            color: system.secondaryLabel,
            fontSize: 14,
            lineHeight: 20,
            textAlign: "center",
          }}
        >
          {intro}
        </RNText>
      ) : null}
    </View>
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
      {/* The example as supporting text rather than a placeholder, which Material shows only once the field has focus. */}
      {field.error || field.hint || field.placeholder ? (
        <OutlinedTextField.SupportingText>
          <Text>{field.error ?? field.hint ?? field.placeholder ?? ""}</Text>
        </OutlinedTextField.SupportingText>
      ) : null}
    </OutlinedTextField>
  );
}
