import { m } from "@freecorps/brigade-i18n";
import {
  authErrorMessage,
  checkSignIn,
  PASSWORD_MAX,
  type FieldErrors,
  type SignInField,
} from "@freecorps/brigade-i18n/auth";
import { spacing } from "@freecorps/brigade-ui";
import { router } from "expo-router";
import { useRef, useState, type ComponentRef } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Linking,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { Field, PrimaryButton, TextButton } from "@/components/form";
import { NewWorkspaceForm } from "@/components/new-workspace";
import { useSessionView } from "@/components/session";
import { ThemedText } from "@/components/themed-text";
import { useScreenPadding } from "@/hooks/use-screen-padding";
import { useTheme } from "@/hooks/use-theme";
import { authClient, server } from "@/lib/auth-client";
import { useSignUpMode } from "@/lib/sign-up-mode";

/**
 * Everything before a member is ready: the sign-in form, or why there is none yet (loading, no server, offline,
 * an account without a workspace, which can create one here). "Create an account" opens the sign-up screen.
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
        <View style={{ gap: spacing[5] }}>
          <ThemedText selectable>{m.account_flow({ part: "no_workspace", name: "" })}</ThemedText>
          <NewWorkspaceForm />
          <View style={{ alignItems: "flex-start" }}>
            <TextButton label={m.sign_out()} onPress={() => void view.signOut()} />
          </View>
        </View>
      ) : (
        <SignInForm />
      )}
    </ScrollView>
  );
}

function SignInForm() {
  const colors = useTheme();
  const forgotPassword = server?.forgotPassword;
  const signUpMode = useSignUpMode();
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
      <PrimaryButton
        busy={busy}
        label={busy ? m.auth_signing_in() : m.auth_sign_in_submit()}
        onPress={() => void submit()}
      />
      {forgotPassword ? (
        // The reset happens on the dashboard, where its email's link lands too.
        <View style={{ alignItems: "flex-start" }}>
          <TextButton
            label={m.reset_page({ part: "forgot_link", email: "" })}
            onPress={() => void Linking.openURL(forgotPassword).catch(() => {})}
          />
        </View>
      ) : null}
      {signUpMode === "open" || signUpMode === "invite" ? (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            columnGap: spacing[2],
          }}
        >
          <ThemedText variant="caption">{m.auth_no_account()}</ThemedText>
          <TextButton label={m.auth_to_sign_up()} onPress={() => router.push("/sign-up")} />
        </View>
      ) : signUpMode === "closed" ? (
        <ThemedText variant="caption" selectable>
          {m.auth_error_sign_up_closed()}
        </ThemedText>
      ) : null}
    </View>
  );
}
