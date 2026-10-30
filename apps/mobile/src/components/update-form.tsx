import { Button, FieldGroup, Text, TextInput, useNativeState } from "@expo/ui";
import { NativeHost } from "@/components/native-host";
import { useTheme } from "@/hooks/use-theme";

export type UpdateFormProps = {
  title: string;
  initial: string;
  placeholder: string;
  /** Under the field: who sees it, or the length near the limit. */
  note: string;
  /** Why the text cannot go yet. */
  problem: string | null;
  submit: string;
  onChange: (body: string) => void;
  onSubmit: () => void;
};

/** An update as iOS writes one: a SwiftUI `Form` with a growing text field, its note under it, and the button. */
export function UpdateForm({
  title,
  initial,
  placeholder,
  note,
  problem,
  submit,
  onChange,
  onSubmit,
}: UpdateFormProps) {
  const colors = useTheme();
  const body = useNativeState(initial);
  return (
    <NativeHost style={{ flex: 1 }}>
      <FieldGroup>
        <FieldGroup.Section title={title}>
          <TextInput
            value={body}
            onChangeText={onChange}
            placeholder={placeholder}
            multiline
            numberOfLines={6}
            autoFocus
            autoCapitalize="sentences"
          />
          <FieldGroup.SectionFooter>
            <Text textStyle={problem ? { color: colors.destructive } : undefined}>
              {problem ?? note}
            </Text>
          </FieldGroup.SectionFooter>
        </FieldGroup.Section>
        <FieldGroup.Section>
          <Button label={submit} onPress={onSubmit} />
        </FieldGroup.Section>
      </FieldGroup>
    </NativeHost>
  );
}
