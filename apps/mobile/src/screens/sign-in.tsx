import { m } from "@freecorps/brigade-i18n";
import {
  authErrorMessage,
  checkSignIn,
  PASSWORD_MAX,
  type FieldErrors,
  type SignInField,
} from "@freecorps/brigade-i18n/auth";
import { fontSize, radius, spacing } from "@freecorps/brigade-ui";
import { useRef, useState, type ComponentRef, type Ref } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { useSessionView } from "@/components/session";
import { ThemedText } from "@/components/themed-text";
import { useScreenPadding } from "@/hooks/use-screen-padding";
import { useTheme } from "@/hooks/use-theme";
import { authClient } from "@/lib/auth-client";

/**
 * Everything before a member is ready: the sign-in form, or why there is none yet (loading, no server, offline,
 * an account without a workspace). Accounts are created on the dashboard; the app only signs in.
 */
export function SignIn() {
  const view = useSessionView();
  const colors = useTheme();
  const padding = useScreenPadding();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[padding, { gap: spacing[6] }]}
    >
      {view.kind === "loading" || view.kind === "ready" ? (
        <View accessibilityRole="progressbar" style={{ flexDirection: "row", gap: spacing[3] }}>
          <ActivityIndicator color={colors.mutedForeground} />
          <ThemedText variant="caption">{m.session_loading()}</ThemedText>
        </View>
      ) : view.kind === "no-server" ? (
        <ThemedText selectable>{m.mobile_session({ part: "no_server" })}</ThemedText>
      ) : view.kind === "unavailable" ? (
        <View style={{ gap: spacing[3], alignItems: "flex-start" }}>
          <ThemedText selectable style={{ color: colors.destructive }}>
            {m.auth_error_network()}
          </ThemedText>
          <TextButton label={m.stack_check_again()} onPress={view.retry} />
        </View>
      ) : view.kind === "no-workspace" ? (
        <View style={{ gap: spacing[3], alignItems: "flex-start" }}>
          <ThemedText selectable>{m.mobile_session({ part: "no_workspace" })}</ThemedText>
          <TextButton label={m.sign_out()} onPress={() => void view.signOut()} />
        </View>
      ) : (
        <SignInForm />
      )}
    </ScrollView>
  );
}

function SignInForm() {
  const colors = useTheme();
  const [values, setValues] = useState<Record<SignInField, string>>({ email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors<SignInField>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const email = useRef<ComponentRef<typeof TextInput>>(null);
  const password = useRef<ComponentRef<typeof TextInput>>(null);

  const change = (field: SignInField) => (text: string) => {
    setValues((current) => ({ ...current, [field]: text }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFailure(null);
  };

  // State lags a render behind, so two quick taps would both pass a `busy` check.
  const sending = useRef(false);
  const submit = async () => {
    if (sending.current) return;
    const found = checkSignIn(values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      // To the first field to fix: TalkBack reads its label and error; VoiceOver hears the error once.
      (found.email ? email : password).current?.focus();
      const first = found.email ?? found.password;
      if (process.env.EXPO_OS === "ios" && first) AccessibilityInfo.announceForAccessibility(first);
      return;
    }
    sending.current = true;
    setBusy(true);
    setFailure(null);
    let error: Parameters<typeof authErrorMessage>[0] = null;
    try {
      ({ error } = await authClient.signIn.email({
        email: values.email.trim(),
        password: values.password,
      }));
    } catch {
      error = { status: 0 };
    }
    // On success the session takes over and the app moves to the incidents; this screen goes away.
    if (!error) return;
    const message = authErrorMessage(error, "sign-in");
    setFailure(message);
    sending.current = false;
    setBusy(false);
    // VoiceOver has no live regions (accessibilityLiveRegion is Android's), so say it once.
    if (process.env.EXPO_OS === "ios") AccessibilityInfo.announceForAccessibility(message);
  };

  return (
    <View style={{ gap: spacing[5] }}>
      <ThemedText>{m.auth_sign_in_description()}</ThemedText>
      <Field
        ref={email}
        label={m.auth_email_label()}
        value={values.email}
        error={errors.email}
        onChangeText={change("email")}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="username"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => password.current?.focus()}
      />
      <Field
        ref={password}
        label={m.auth_password_label()}
        value={values.password}
        error={errors.password}
        onChangeText={change("password")}
        secret
        autoComplete="current-password"
        textContentType="password"
        maxLength={PASSWORD_MAX}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />
      {failure ? (
        <ThemedText
          selectable
          accessibilityLiveRegion="polite"
          style={{ color: colors.destructive }}
        >
          {failure}
        </ThemedText>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
        onPress={() => void submit()}
        style={({ pressed }) => ({
          minHeight: spacing[12],
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: spacing[2],
          paddingHorizontal: spacing[4],
          borderRadius: radius.md,
          borderCurve: "continuous",
          backgroundColor: colors.primary,
          opacity: busy ? 0.7 : pressed ? 0.8 : 1,
        })}
      >
        {busy ? <ActivityIndicator color={colors.primaryForeground} /> : null}
        <ThemedText style={{ color: colors.primaryForeground }}>
          {busy ? m.auth_signing_in() : m.auth_sign_in_submit()}
        </ThemedText>
      </Pressable>
      <ThemedText variant="caption">{m.mobile_session({ part: "sign_in_hint" })}</ThemedText>
    </View>
  );
}

/** A labelled text field with its error under it; `secret` hides the text, with Show password beside it. */
function Field({
  label,
  error,
  ref,
  secret = false,
  ...input
}: TextInputProps & {
  label: string;
  error?: string;
  secret?: boolean;
  ref?: Ref<ComponentRef<typeof TextInput>>;
}) {
  const colors = useTheme();
  const [shown, setShown] = useState(false);
  return (
    <View style={{ gap: spacing[2] }}>
      <ThemedText variant="label">{label}</ThemedText>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: spacing[12],
          borderRadius: radius.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: error ? colors.destructive : colors.input,
        }}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={error}
          placeholderTextColor={colors.mutedForeground}
          secureTextEntry={secret && !shown}
          style={{
            flex: 1,
            minHeight: spacing[12],
            paddingHorizontal: spacing[3],
            color: colors.foreground,
            fontSize: fontSize.base.size,
          }}
          {...input}
        />
        {secret ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setShown((value) => !value)}
            style={({ pressed }) => ({
              minHeight: spacing[12],
              justifyContent: "center",
              paddingHorizontal: spacing[3],
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <ThemedText style={{ color: colors.primary }}>
              {m.mobile_session({ part: shown ? "hide_password" : "show_password" })}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <ThemedText
          selectable
          accessibilityLiveRegion="polite"
          style={{ color: colors.destructive }}
        >
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: spacing[12],
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <ThemedText style={{ color: colors.primary }}>{label}</ThemedText>
    </Pressable>
  );
}
