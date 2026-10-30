import { ExtendedFloatingActionButton, Icon, Text } from "@expo/ui/jetpack-compose";
import { m } from "@freecorps/brigade-i18n";
import { router } from "expo-router";
import { View } from "react-native";
import { NativeHost } from "@/components/native-host";

const ADD = require("../../assets/icons/add.xml");

/** Declare, as Material's extended floating action button over the list: opens the declare sheet. */
export function DeclareButton() {
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", right: 16, bottom: 16 }}>
      <NativeHost matchContents>
        <ExtendedFloatingActionButton onClick={() => router.push("/declare")}>
          <ExtendedFloatingActionButton.Icon>
            <Icon source={ADD} />
          </ExtendedFloatingActionButton.Icon>
          <ExtendedFloatingActionButton.Text>
            <Text>{m.declare_open()}</Text>
          </ExtendedFloatingActionButton.Text>
        </ExtendedFloatingActionButton>
      </NativeHost>
    </View>
  );
}
