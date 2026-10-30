import { ExtendedFloatingActionButton, Icon, Text } from "@expo/ui/jetpack-compose";
import { m } from "@freecorps/brigade-i18n";
import { router } from "expo-router";
import { FabHost } from "@/components/fab-host";

const ADD = require("../../assets/icons/add.xml");

/**
 * Declare, as Material's extended floating action button over the list: opens the declare sheet. TalkBack reads it
 * as one named button (`FabHost`).
 */
export function DeclareButton() {
  const declare = () => router.push("/declare");
  return (
    <FabHost label={m.declare_open()} onPress={declare} style={{ right: 16, bottom: 16 }}>
      <ExtendedFloatingActionButton onClick={declare}>
        <ExtendedFloatingActionButton.Icon>
          <Icon source={ADD} />
        </ExtendedFloatingActionButton.Icon>
        <ExtendedFloatingActionButton.Text>
          <Text>{m.declare_open()}</Text>
        </ExtendedFloatingActionButton.Text>
      </ExtendedFloatingActionButton>
    </FabHost>
  );
}
