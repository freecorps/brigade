import { m } from "@freecorps/brigade-i18n";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { AccessibilityInfo, Linking } from "react-native";
import { NativeForm } from "@/components/native-form";
import { say, useInstanceList, verdictText } from "@/components/instances";
import { openInstance } from "@/components/session";
import { defaultOrigin } from "@/lib/auth-client";
import { checkInstance, instances } from "@/lib/instance-clients";
import { hostOf, instanceLabel } from "@/lib/instance-address";
import { instanceAt, MAX_INSTANCES } from "@/lib/instances";

/** Closes the sheet: back to where it was opened from, or to the app's first screen when opened from nowhere. */
export function leaveSheet() {
  if (router.canDismiss()) router.dismissAll();
  else router.replace("/");
}

/**
 * "Add an instance" (RFC 0015 section 5), from the sign-in screen and the account section: the build's own Brigade
 * when it is not on the phone any more, another one by its address, or the dashboard's QR code. The address is checked
 * before anything is added (src/lib/instance-address.ts); one that passes is added and opened, and its sign-in
 * screen names the host in full before anyone types a password. At most `MAX_INSTANCES`.
 */
export function AddInstance() {
  const list = useInstanceList();
  const [address, setAddress] = useState("");
  const [problem, setProblem] = useState<{ text: string; app?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const checking = useRef(false);
  const full = list.instances.length >= MAX_INSTANCES;

  const open = async (origin: string) => {
    const known = instanceAt(instances.current(), origin);
    if (known) {
      leaveSheet();
      await openInstance(known.id);
      return;
    }
    const added = await instances.add(origin);
    if (added === "full") {
      setProblem({ text: m.mobile_instances_full({ max: MAX_INSTANCES }) });
      return;
    }
    if (added === "invalid") {
      setProblem({ text: say("invalid") });
      return;
    }
    leaveSheet();
    await openInstance(added.id);
  };

  const submit = async () => {
    if (checking.current) return;
    checking.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const checked = await checkInstance(address);
      const refused =
        "problem" in checked
          ? verdictText({ kind: checked.problem }, "")
          : verdictText(checked.verdict, hostOf(checked.origin));
      if (refused || "problem" in checked) {
        const text = refused ? [refused.title, refused.text].filter(Boolean).join("\n\n") : "";
        setProblem({ text, ...(refused?.app ? { app: refused.app } : {}) });
        AccessibilityInfo.announceForAccessibility(text);
        return;
      }
      await open(checked.origin);
    } catch {
      // Adding it failed (secure storage locked): said, and the address stays to try again.
      const text = say("add_failed");
      setProblem({ text });
      AccessibilityInfo.announceForAccessibility(text);
    } finally {
      checking.current = false;
      setBusy(false);
    }
  };

  // The build's own Brigade, offered while it is not on the phone (it can be removed once another is added).
  const offerDefault =
    defaultOrigin !== undefined && instanceAt(list, defaultOrigin) === undefined && !full;

  if (full) {
    return (
      <NativeForm
        title={say("add_title")}
        intro={m.mobile_instances_full({ max: MAX_INSTANCES })}
        fields={[]}
        links={[{ label: say("close"), onPress: leaveSheet }]}
      />
    );
  }
  return (
    <NativeForm
      title={say("add_title")}
      intro={say("add_intro")}
      fields={[
        {
          key: "address",
          label: say("another"),
          placeholder: "brigade.example.com",
          hint: say("address_hint"),
          error: undefined,
          autoComplete: "url",
          keyboardType: "url",
          autoCapitalize: "none",
          maxLength: 512,
          onChange: (text) => {
            setAddress(text);
            setProblem(null);
          },
        },
      ]}
      problem={problem?.text ?? null}
      submit={{
        label: busy ? say("checking") : say("continue"),
        busy,
        onPress: () => void submit(),
      }}
      links={[
        ...(problem?.app
          ? [
              {
                label: say("own_app_link"),
                onPress: () => void Linking.openURL(problem.app!).catch(() => {}),
              },
            ]
          : []),
        {
          label: say("scan"),
          note: say("scan_hint"),
          onPress: () => router.push("/scan"),
        },
        ...(offerDefault
          ? [
              {
                label: instanceLabel(defaultOrigin!),
                note: say("default_hint"),
                onPress: () =>
                  void open(defaultOrigin!).catch(() => setProblem({ text: say("add_failed") })),
              },
            ]
          : []),
      ]}
    />
  );
}
