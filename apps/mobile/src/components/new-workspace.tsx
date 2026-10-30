import { m } from "@freecorps/brigade-i18n";
import { WORKSPACE_NAME_MAX, workspaceName } from "@freecorps/brigade-schema";
import { useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { NativeForm, type NativeFormProps } from "@/components/native-form";
import { authClient, server } from "@/lib/auth-client";
import { createWorkspace } from "@/lib/workspaces";

/** Why a workspace name would be refused, in the words the dashboard uses; undefined when it is fine. */
export function workspaceNameError(name: string): string | undefined {
  if (name.trim() === "") return m.auth_error_required();
  if (workspaceName(name).ok) return undefined;
  if (name.trim().length > WORKSPACE_NAME_MAX)
    return m.auth_error_too_long({ max: WORKSPACE_NAME_MAX });
  return m.workspace_name_invalid();
}

/**
 * Names and creates a workspace the member owns (`POST /api/workspaces`), then makes it active, which opens it: the
 * session moves to it and the phone registers there too, keeping its other workspaces' registrations (RFC 0006
 * "Device registration"). `onDone`: after it is active.
 */
export function NewWorkspaceForm({
  onDone,
  intro,
  links,
}: {
  onDone?: () => void;
  /** Why the member is asked, above the field. */
  intro?: string;
  links?: NativeFormProps["links"];
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // State lags a render behind, so two quick taps would both pass a `busy` check.
  const sending = useRef(false);

  const fail = (message: string) => {
    setFailure(message);
    sending.current = false;
    setBusy(false);
    // The form's native text has no live region on either platform, so the screen reader says it once.
    AccessibilityInfo.announceForAccessibility(message);
  };

  const submit = async () => {
    if (sending.current || !server) return;
    const found = workspaceNameError(name);
    setError(found);
    if (found) {
      if (process.env.EXPO_OS === "ios") AccessibilityInfo.announceForAccessibility(found);
      return;
    }
    sending.current = true;
    setBusy(true);
    setFailure(null);
    const cookie = await authClient.getCookie().catch(() => "");
    const created = await createWorkspace(server.workspaces, name.trim(), cookie);
    if (!created.ok) {
      return fail(
        created.status === 0
          ? m.auth_error_network()
          : created.error === "workspace_limit"
            ? m.workspace_error_limit()
            : m.auth_error_generic(),
      );
    }
    // Created with a request of the app's own, which Better Auth's client does not see: its cached list of the
    // member's workspaces (the account section's) is read again, so the new one shows there.
    authClient.$store.notify("$listOrg");
    // The server made it active already; this tells the session hooks to read it again.
    try {
      await authClient.organization.setActive({ organizationId: created.id });
    } catch {
      // Offline right after creating it: the session reads the new workspace once back.
    }
    sending.current = false;
    setBusy(false);
    onDone?.();
  };

  return (
    <NativeForm
      intro={intro}
      fields={[
        {
          key: "name",
          label: m.workspace_name_label(),
          placeholder: m.workspace_name_hint(),
          error,
          autoComplete: "organization",
          onChange: (text) => {
            setName(text);
            setError(undefined);
            setFailure(null);
          },
        },
      ]}
      problem={failure}
      submit={{
        label: busy ? m.workspace_creating() : m.workspace_create_submit(),
        busy,
        onPress: () => void submit(),
      }}
      links={links}
    />
  );
}
