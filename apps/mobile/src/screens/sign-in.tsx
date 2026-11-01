import { m } from "@freecorps/brigade-i18n";
import {
  authErrorMessage,
  checkSignIn,
  PASSWORD_MAX,
  type FieldErrors,
  type SignInField,
} from "@freecorps/brigade-i18n/auth";
import { router, Stack } from "expo-router";
import { useRef, useState } from "react";
import { AccessibilityInfo, Linking } from "react-native";
import { NativeForm } from "@/components/native-form";
import { NewWorkspaceForm } from "@/components/new-workspace";
import { say as sayInstances, useInstanceList, useRelays } from "@/components/instances";
import { openInstance, useSessionView } from "@/components/session";
import { useActiveInstance } from "@/hooks/use-instance";
import { hostOf, instanceLabel } from "@/lib/instance-address";
import { DEFAULT_INSTANCE } from "@/lib/instances";
import { instancePaging } from "@/lib/switcher";
import { useSignUpMode } from "@/lib/sign-up-mode";

/**
 * Everything before a member is ready: the sign-in form, or why there is none yet (loading, no server, offline,
 * an account without a workspace, which can create one here). "Create an account" opens the sign-up screen.
 */
export function SignIn() {
  const view = useSessionView();
  // Every view says what the screen is for, so a title set by one never sticks to the next.
  const title =
    view.kind === "no-workspace"
      ? m.account_flow({ part: "new_title", name: "" })
      : m.auth_sign_in_title();
  return (
    <>
      <Stack.Screen options={{ title }} />
      <SignInView view={view} />
    </>
  );
}

/** Everything before a member is ready, by the session's view. */
function SignInView({ view }: { view: ReturnType<typeof useSessionView> }) {
  const instanceLinks = useOtherInstances();
  if (view.kind === "no-workspace") {
    return (
      <NewWorkspaceForm
        brand={m.account_flow({ part: "new_title", name: "" })}
        intro={m.account_flow({ part: "no_workspace", name: "" })}
        links={[{ label: m.sign_out(), destructive: true, onPress: () => void view.signOut() }]}
      />
    );
  }
  if (view.kind === "signed-out") return <SignInForm />;
  return (
    <NativeForm
      brand={m.auth_sign_in_title()}
      intro={
        view.kind === "no-server"
          ? m.mobile_session({ part: "no_server" })
          : view.kind === "unavailable"
            ? m.auth_error_network()
            : m.session_loading()
      }
      fields={[]}
      links={[
        ...(view.kind === "unavailable"
          ? [{ label: m.stack_check_again(), onPress: view.retry }]
          : []),
        // A build with no Brigade of its own can still be pointed at one.
        ...(view.kind === "no-server" || view.kind === "unavailable" ? instanceLinks : []),
      ]}
    />
  );
}

/**
 * The links under a sign-in to the other instances on this phone ("Open acme.example", each keeps paging in the
 * background) and to add another (RFC 0015 section 5).
 */
function useOtherInstances(): { label: string; note?: string; onPress: () => void }[] {
  const list = useInstanceList();
  const others = list.instances.filter((one) => one.id !== list.active);
  return [
    ...others.map((one, index) => ({
      label: sayInstances("open_instance", instanceLabel(one.origin)),
      ...(index === 0 ? { note: sayInstances("other_instances") } : {}),
      onPress: () => void openInstance(one.id),
    })),
    {
      label: sayInstances("another"),
      onPress: () => router.push("/add-instance"),
    },
  ];
}

function SignInForm() {
  const instance = useActiveInstance();
  const forgotPassword = instance?.server.forgotPassword;
  const signUpMode = useSignUpMode();
  const instanceLinks = useOtherInstances();
  const list = useInstanceList();
  const relays = useRelays(list);
  const host = instance ? hostOf(instance.instance.origin) : "";
  // Named in full before anyone types a password, so an address from a stranger is seen for what it is.
  const where = instance ? sayInstances("signing_in_to", host) : "";
  const relay = instance ? relays[instance.instance.id] : undefined;
  const noRelay =
    relay !== undefined &&
    instance !== undefined &&
    instancePaging(relay, instance.instance.id === DEFAULT_INSTANCE) === "no-relay";
  const [values, setValues] = useState<Record<SignInField, string>>({ email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors<SignInField>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      const first = found.email ?? found.password;
      if (process.env.EXPO_OS === "ios" && first) AccessibilityInfo.announceForAccessibility(first);
      return;
    }
    sending.current = true;
    setBusy(true);
    setFailure(null);
    let error: Parameters<typeof authErrorMessage>[0] = null;
    try {
      if (!instance) throw new Error("No server");
      ({ error } = await instance.authClient.signIn.email({
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
    // The form's native text has no live region on either platform, so the screen reader says it once.
    AccessibilityInfo.announceForAccessibility(message);
  };

  return (
    <NativeForm
      brand={m.auth_sign_in_title()}
      intro={[
        where,
        m.auth_sign_in_description(),
        // Closed: no way to sign up from the app, and the form says so up front.
        signUpMode === "closed" ? m.auth_error_sign_up_closed() : "",
        noRelay ? `${sayInstances("no_relay")}. ${sayInstances("no_relay_body", host)}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")}
      fields={[
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
          secure: true,
          autoComplete: "current-password",
          maxLength: PASSWORD_MAX,
          onChange: change("password"),
        },
      ]}
      problem={failure}
      submit={{
        label: busy ? m.auth_signing_in() : m.auth_sign_in_submit(),
        busy,
        onPress: () => void submit(),
      }}
      links={[
        ...(forgotPassword
          ? [
              {
                label: m.reset_page({ part: "forgot_link", email: "" }),
                onPress: () => void Linking.openURL(forgotPassword).catch(() => {}),
              },
            ]
          : []),
        ...(signUpMode === "open" || signUpMode === "invite"
          ? [
              {
                label: m.auth_to_sign_up(),
                note: m.auth_no_account(),
                onPress: () => router.push("/sign-up"),
              },
            ]
          : []),
        ...instanceLinks,
      ]}
    />
  );
}
