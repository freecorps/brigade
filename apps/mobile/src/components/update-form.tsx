import { FieldGroup, TextInput, useNativeState } from "@expo/ui";
import { FooterText } from "@/components/footer-text";
import { NativeHost } from "@/components/native-host";
import { SubmitButton } from "@/components/submit-button";

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
  initial,
  placeholder,
  note,
  problem,
  submit,
  onChange,
  onSubmit,
}: UpdateFormProps) {
  const body = useNativeState(initial);
  return (
    <NativeHost style={{ flex: 1 }}>
      <FieldGroup>
        {/* The sheet's own title names it (`title`, set on the screen); no section header repeats it. */}
        <FieldGroup.Section>
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
            <FooterText tone={problem ? "destructive" : "default"}>{problem ?? note}</FooterText>
          </FieldGroup.SectionFooter>
        </FieldGroup.Section>
        <FieldGroup.Section>
          <SubmitButton label={submit} onPress={onSubmit} />
        </FieldGroup.Section>
      </FieldGroup>
    </NativeHost>
  );
}
