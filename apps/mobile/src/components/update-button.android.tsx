import { ExtendedFloatingActionButton, Icon, Text } from "@expo/ui/jetpack-compose";
import { m } from "@freecorps/brigade-i18n";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeHost } from "@/components/native-host";

const EDIT = require("../../assets/icons/edit.xml");

/** Post an update, as Material's extended floating action button over the incident: opens the update sheet. */
export function UpdateButton({ enabled, onPress }: { enabled: boolean; onPress: () => void }) {
  // The incident draws under the navigation bar; the button sits above it.
  const { bottom } = useSafeAreaInsets();
  if (!enabled) return null;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", right: 16, bottom: 16 + bottom }}>
      <NativeHost matchContents>
        <ExtendedFloatingActionButton onClick={onPress}>
          <ExtendedFloatingActionButton.Icon>
            <Icon source={EDIT} />
          </ExtendedFloatingActionButton.Icon>
          <ExtendedFloatingActionButton.Text>
            <Text>{m.incident_page({ part: "update_label" })}</Text>
          </ExtendedFloatingActionButton.Text>
        </ExtendedFloatingActionButton>
      </NativeHost>
    </View>
  );
}
