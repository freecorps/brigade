import { m } from "@freecorps/brigade-i18n";
import { fontFamily, fontSize, spacing } from "@freecorps/brigade-ui";
import * as Notifications from "expo-notifications";
import { useEffect, useState } from "react";
import { Platform, ScrollView, Text } from "react-native";
import { Row, Section } from "@/components/section";
import { ThemedText } from "@/components/themed-text";
import { useScreenPadding } from "@/hooks/use-screen-padding";
import { useTheme } from "@/hooks/use-theme";
import { BrigadePush } from "../../modules/brigade-push";

type Field = "permission" | "deviceToken" | "publicKey";
type PushInfo = Partial<Record<Field, string>>;

/**
 * Each value on its own, so one that fails or hangs does not hide the others: the device key (created on first
 * read), the notification permission, then the APNs device token.
 */
function loadPushInfo(set: (field: Field, value: string) => void): void {
  const load = (field: Field, read: () => Promise<string>) =>
    read().then(
      (value) => set(field, value),
      (error: unknown) => set(field, m.push_error({ error: String(error) })),
    );
  const keys = BrigadePush;
  if (!keys) return;
  void load("publicKey", () => keys.getPublicKey());
  void load("permission", async () => {
    const { status } = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    // The token does not need the permission, but asking first matches what the app will do.
    void load("deviceToken", async () =>
      String((await Notifications.getDevicePushTokenAsync()).data),
    );
    return status;
  });
}

export function PushDiagnostics() {
  const colors = useTheme();
  const padding = useScreenPadding();
  const [info, setInfo] = useState<PushInfo>({});

  useEffect(() => {
    // Show pushes in the foreground too: the screen stays open while a test push is sent.
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    let live = true;
    loadPushInfo((field, value) => {
      // Development only: lets a script read the values from the Metro log.
      console.log(`[brigade-push] ${JSON.stringify({ [field]: value })}`);
      if (live) setInfo((info) => ({ ...info, [field]: value }));
    });
    return () => {
      live = false;
      Notifications.setNotificationHandler(null);
    };
  }, []);

  const mono = {
    fontFamily: Platform.select(fontFamily.native.mono),
    fontSize: fontSize.xs.size,
    lineHeight: fontSize.xs.lineHeight,
    color: colors.mutedForeground,
  };
  const rows: [string, string | undefined][] = [
    [m.push_permission(), info.permission],
    [m.push_device_token(), info.deviceToken],
    [m.push_public_key(), info.publicKey],
  ];

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[padding, { gap: spacing[6] }]}
    >
      {BrigadePush ? null : <ThemedText>{m.push_unavailable()}</ThemedText>}
      <Section title={m.push_title()} inset={false}>
        {rows.map(([label, value], index) => (
          <Row key={label} first={index === 0}>
            <ThemedText>{label}</ThemedText>
            <Text selectable style={mono}>
              {value ?? m.push_waiting()}
            </Text>
          </Row>
        ))}
      </Section>
    </ScrollView>
  );
}
