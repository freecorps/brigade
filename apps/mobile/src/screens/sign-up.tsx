import { getLocale, m } from "@freecorps/brigade-i18n";
import {
  authErrorMessage,
  checkEmail,
  checkPassword,
  PASSWORD_MAX,
  type FieldErrors,
} from "@freecorps/brigade-i18n/auth";
import { memberName } from "@freecorps/brigade-schema";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { NativeForm } from "@/components/native-form";
import { workspaceNameError } from "@/components/new-workspace";
import { useActiveInstance } from "@/hooks/use-instance";
import { useSignUpMode } from "@/lib/sign-up-mode";
import { createWorkspace } from "@/lib/workspaces";

type SignUpField = "name" | "email" | "password" | "workspace";
const FIELDS: readonly SignUpField[] = ["name", "email", "password", "workspace"];
/** What a user may type as their name (the dashboard's `NAME_MAX`). */
const NAME_MAX = 80;

function checkSignUp(values: Record<SignUpField, string>): FieldErrors<SignUpField> {
  const errors: FieldErrors<SignUpField> = {};
  if (values.name.trim() === "") errors.name = m.auth_error_required();
  else if (values.name.trim().length > NAME_MAX)
    errors.name = m.auth_error_too_long({ max: NAME_MAX });
  else if (!memberName(values.name).ok) errors.name = m.auth_name_invalid();
  const email = checkEmail(values.email);
  if (email) errors.email = email;
  const password = checkPassword(values.password);
  if (password) errors.password = password;
  const workspace = workspaceNameError(values.workspace);
  if (workspace) errors.workspace = workspace;
  return errors;
}

/**
 * Creating an account from the app, as on the dashboard: the account, then signing in with it (a sign-up answers the
 * same whether or not the address was taken, RFC 0002 "Auth"), then the member's first workspace. If that last step
 * fails, the account is signed in without a workspace and the sign-in screen offers to create one.
 */
export function SignUp() {
  const [values, setValues] = useState<Record<SignUpField, string>>({
    name: "",
    email: "",
    password: "",
    workspace: "",
  });
  const [errors, setErrors] = useState<FieldErrors<SignUpField>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const signUpMode = useSignUpMode();
  const instance = useActiveInstance();

  const change = (field: SignUpField) => (text: string) => {
    setValues((current) => ({ ...current, [field]: text }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFailure(null);
  };

  const fail = (message: string) => {
    setFailure(message);
    sending.current = false;
    setBusy(false);
    // The form's native text has no live region on either platform, so the screen reader says it once.
    AccessibilityInfo.announceForAccessibility(message);
  };

  const submit = async () => {
    if (sending.current) return;
    const found = checkSignUp(values);
    setErrors(found);
    const first = FIELDS.find((field) => found[field]);
    if (first) {
      const message = found[first];
      if (process.env.EXPO_OS === "ios" && message)
        AccessibilityInfo.announceForAccessibility(message);
      return;
    }
    if (!instance) return;
    const { authClient, server } = instance;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    const email = values.email.trim();
    try {
      const { error } = await authClient.signUp.email({
        name: values.name.trim(),
        email,
        password: values.password,
        // Emails to them come in the app's language (RFC 0008).
        locale: getLocale(),
      });
      if (error) return fail(authErrorMessage(error, "sign-up"));
    } catch {
      return fail(authErrorMessage(null, "sign-up"));
    }
    try {
      const { error } = await authClient.signIn.email({ email, password: values.password });
      if (error) return fail(authErrorMessage(error, "after-sign-up"));
    } catch {
      return fail(authErrorMessage(null, "after-sign-up"));
    }
    const cookie = await authClient.getCookie().catch(() => "");
    const created = await createWorkspace(server.workspaces, values.workspace.trim(), cookie);
    if (created?.ok) {
      try {
        await authClient.organization.setActive({ organizationId: created.id });
      } catch {
        // The server made it active already; the session reads it once back online.
      }
    }
    // Signed in: the stack moves to the incidents, or to the sign-in screen's "create a workspace" if that failed.
    // Opened with nothing behind it (a link straight to sign-up), it goes home, which shows either.
    sending.current = false;
    setBusy(false);
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace("/sign-in"));
  // Closed: the app has no invitation flow, so no form (RFC 0002 "Sign-up modes"); an invitation's link opens the
  // dashboard, where its owner signs up.
  if (signUpMode === "closed") {
    return (
      <NativeForm
        intro={m.auth_error_sign_up_closed()}
        fields={[]}
        links={[{ label: m.auth_to_sign_in(), onPress: back }]}
      />
    );
  }

  return (
    <NativeForm
      intro={signUpMode === "invite" ? m.auth_sign_up_invite_only() : m.auth_sign_up_description()}
      fields={[
        {
          key: "name",
          label: m.auth_name_label(),
          error: errors.name,
          autoComplete: "name",
          autoCapitalize: "words",
          onChange: change("name"),
        },
        {
          key: "email",
          label: m.auth_email_label(),
          error: errors.email,
          autoComplete: "email",
          keyboardType: "email-address",
          autoCapitalize: "none",
          onChange: change("email"),
        },
        {
          key: "password",
          label: m.auth_password_label(),
          error: errors.password,
          hint: m.auth_password_hint(),
          secure: true,
          autoComplete: "new-password",
          maxLength: PASSWORD_MAX,
          onChange: change("password"),
        },
        {
          key: "workspace",
          label: m.workspace_name_label(),
          // What the account will own, apart from who it is.
          section: m.workspace_label(),
          placeholder: m.workspace_name_hint(),
          error: errors.workspace,
          autoComplete: "organization",
          onChange: change("workspace"),
        },
      ]}
      problem={failure}
      submit={{
        label: busy ? m.auth_signing_up() : m.auth_sign_up_submit(),
        busy,
        onPress: () => void submit(),
      }}
      links={[{ label: m.auth_to_sign_in(), note: m.auth_have_account(), onPress: back }]}
    />
  );
}
