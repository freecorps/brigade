import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { router, Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { say } from "@/components/instances";
import { m } from "@freecorps/brigade-i18n";
import { useTheme } from "@/hooks/use-theme";
import { markScanned, parseConnectLink } from "@/lib/connect-link";

/** How long "This QR code isn't from Brigade" stays before the next code is read. */
const REFUSED_MS = 2_500;

/**
 * The in-app scanner for the dashboard's "Use the app" QR code (RFC 0015 sections 5 and 6), with expo-camera's
 * barcode scanning (QR only): a Brigade link opens the connect screen, which checks the address and asks before
 * anything is claimed; any other code says so and scanning goes on. Without the camera, the reason and a way to allow
 * it (or to Settings once the system will not ask again).
 */
export function Scan() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [refused, setRefused] = useState(false);
  const done = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const scanned = ({ data }: { data: string }) => {
    if (done.current || refused) return;
    const link = parseConnectLink(data);
    if (!link) {
      setRefused(true);
      if (process.env.EXPO_OS === "ios")
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      timer.current = setTimeout(() => setRefused(false), REFUSED_MS);
      return;
    }
    done.current = true;
    if (process.env.EXPO_OS === "ios")
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    markScanned(link);
    router.replace({
      pathname: "/connect",
      params: { server: link.server, ...(link.code ? { code: link.code } : {}) },
    });
  };

  const button = (label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.primary,
        opacity: pressed ? 0.8 : 1,
        borderRadius: 12,
        borderCurve: "continuous",
        paddingVertical: 14,
        paddingHorizontal: 20,
        alignItems: "center",
      })}
    >
      <Text style={{ color: colors.primaryForeground, fontSize: 17, fontWeight: "600" }}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <>
      <Stack.Screen options={{ title: say("scan") }} />
      {permission?.granted ? (
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={scanned}
          />
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              paddingHorizontal: 24,
              paddingTop: 16,
              paddingBottom: insets.bottom + 24,
              backgroundColor: "rgba(0, 0, 0, 0.55)",
            }}
          >
            <Text
              accessibilityLiveRegion="polite"
              style={{
                color: "#fff",
                fontSize: 17,
                textAlign: "center",
                fontWeight: refused ? "600" : "400",
              }}
            >
              {refused ? say("scan_not_brigade") : say("scan_hint")}
            </Text>
          </View>
        </View>
      ) : (
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            gap: 24,
            padding: 24,
            backgroundColor: colors.background,
          }}
        >
          <Text style={{ color: colors.foreground, fontSize: 17, textAlign: "center" }}>
            {say("camera_needed")}
          </Text>
          {permission === null
            ? null
            : permission.canAskAgain
              ? button(say("camera_allow"), () => void requestPermission())
              : button(
                  m.mobile_session({ part: "open_settings" }),
                  () => void Linking.openSettings(),
                )}
        </View>
      )}
    </>
  );
}
