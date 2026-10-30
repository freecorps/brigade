import { Button, Column, OutlinedTextField, Text, useNativeState } from "@expo/ui/jetpack-compose";
import { fillMaxWidth, paddingAll, verticalScroll } from "@expo/ui/jetpack-compose/modifiers";
import type { UpdateFormProps } from "@/components/update-form";
import { NativeHost } from "@/components/native-host";
import { SheetHandle } from "@/components/sheet-handle";

export type { UpdateFormProps } from "@/components/update-form";

/** An update as Material writes one: a headline, an outlined multi-line field with its note, a full-width button. */
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
  const body = useNativeState(initial);
  return (
    <NativeHost style={{ flex: 1 }}>
      <Column
        verticalArrangement={{ spacedBy: 20 }}
        modifiers={[fillMaxWidth(), paddingAll(24), verticalScroll()]}
      >
        <SheetHandle />
        <Text style={{ typography: "headlineSmall" }}>{title}</Text>
        <OutlinedTextField
          value={body}
          onValueChange={onChange}
          autoFocus
          minLines={5}
          maxLines={12}
          isError={problem !== null}
          keyboardOptions={{ capitalization: "sentences" }}
          modifiers={[fillMaxWidth()]}
        >
          <OutlinedTextField.Placeholder>
            <Text>{placeholder}</Text>
          </OutlinedTextField.Placeholder>
          <OutlinedTextField.SupportingText>
            <Text>{problem ?? note}</Text>
          </OutlinedTextField.SupportingText>
        </OutlinedTextField>
        <Button onClick={onSubmit} modifiers={[fillMaxWidth()]}>
          <Text>{submit}</Text>
        </Button>
      </Column>
    </NativeHost>
  );
}
