import { FieldGroup, Text } from "@expo/ui";
import { m } from "@freecorps/brigade-i18n";
import Constants from "expo-constants";
import { Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Linking } from "react-native";
import { FooterText } from "@/components/footer-text";
import { endText, say, useBoard, verdictText } from "@/components/instances";
import { ListItem } from "@/components/list-item";
import { NativeHost } from "@/components/native-host";
import { openInstance } from "@/components/session";
import { SubmitButton } from "@/components/submit-button";
import { useTheme } from "@/hooks/use-theme";
import type { ConnectLink } from "@/lib/connect-link";
import { checkInstance, instances, keepSignIn } from "@/lib/instance-clients";
import { hostOf } from "@/lib/instance-address";
import { instanceAt, MAX_INSTANCES } from "@/lib/instances";
import { runClaim, type ClaimState } from "@/lib/qr-sign-in";
import { leaveSheet } from "@/screens/add-instance";

type Step =
  | { kind: "checking" }
  | { kind: "refused"; title?: string; text: string; app?: string }
  | { kind: "already"; instanceId: string; origin: string }
  | { kind: "confirm"; origin: string; noRelay: boolean }
  | { kind: "claim"; origin: string; state: ClaimState; instanceId?: string };

/**
 * A dashboard link or QR (`brigade://connect?server=…[&code=…]`, RFC 0015 sections 5 and 6), opened by the system
 * camera or the in-app scanner. The address is checked first, as typed ones are. With the address alone: "You are
 * signing in to <host>", then its sign-in screen. With a code: "Sign in to <host>?", then the claim; the phone shows
 * the 2-digit number the member types on the dashboard, and once they did, "Signed in to <host> as <name>" and the
 * instance opens. Nothing is claimed before the member confirms, so a QR from a stranger is seen for what it is.
 */
export function Connect({ link }: { link: ConnectLink | undefined }) {
  const states = useBoard();
  const [step, setStep] = useState<Step>({ kind: "checking" });
  const left = useRef(false);
  useEffect(() => {
    left.current = false;
    return () => {
      left.current = true;
    };
  }, []);

  // Read when the check answers, so a session that loaded meanwhile counts.
  const statesRef = useRef(states);
  useEffect(() => {
    statesRef.current = states;
  });
  const signedIn = (id: string) => statesRef.current[id]?.kind === "signed-in";

  const server = link?.server;
  const code = link?.code;
  useEffect(() => {
    if (!server) {
      setStep({ kind: "refused", text: say("scan_not_brigade") });
      return;
    }
    let live = true;
    void checkInstance(server).then((checked) => {
      if (!live) return;
      if ("problem" in checked) {
        setStep({ kind: "refused", ...verdictText({ kind: checked.problem }, "")! });
        return;
      }
      const host = hostOf(checked.origin);
      const refused = verdictText(checked.verdict, host);
      if (refused) {
        setStep({ kind: "refused", ...refused });
        return;
      }
      const list = instances.current();
      const known = instanceAt(list, checked.origin);
      if (known && signedIn(known.id)) {
        setStep({ kind: "already", instanceId: known.id, origin: checked.origin });
        return;
      }
      if (!known && list.instances.length >= MAX_INSTANCES) {
        setStep({ kind: "refused", text: m.mobile_instances_full({ max: MAX_INSTANCES }) });
        return;
      }
      setStep({
        kind: "confirm",
        origin: checked.origin,
        noRelay: checked.verdict.kind === "no-relay",
      });
    });
    return () => {
      live = false;
    };
    // Checked once per link; the sessions are read when the answer comes.
  }, [server, code]);

  const addAndOpen = async (origin: string) => {
    const added = await instances.add(origin);
    if (typeof added === "string") {
      setStep({
        kind: "refused",
        text: added === "full" ? m.mobile_instances_full({ max: MAX_INSTANCES }) : say("invalid"),
      });
      return;
    }
    leaveSheet();
    await openInstance(added.id);
  };

  const claim = (origin: string) => {
    if (!code) return;
    let instanceId: string | undefined;
    void runClaim(
      {
        origin,
        code,
        deviceName:
          Constants.deviceName?.trim() || (process.env.EXPO_OS === "ios" ? "iPhone" : "Android"),
        platform: process.env.EXPO_OS === "android" ? "android" : "ios",
      },
      {
        fetch: (url, init) => fetch(url, init),
        now: Date.now,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        store: async (cookie) => {
          instanceId = (await keepSignIn(origin, cookie)).id;
        },
        onState: (state) => {
          setStep({ kind: "claim", origin, state, ...(instanceId ? { instanceId } : {}) });
          const host = hostOf(origin);
          if (state.step === "waiting") {
            AccessibilityInfo.announceForAccessibility(`${say("number_title")}: ${state.number}`);
          } else if (state.step === "signed-in") {
            AccessibilityInfo.announceForAccessibility(
              say("signed_in_as", host, state.user.name || state.user.email),
            );
          } else if (state.step === "ended") {
            AccessibilityInfo.announceForAccessibility(endText(state.reason, host));
          }
        },
        cancelled: () => left.current,
      },
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: code ? say("sign_in") : say("add_title") }} />
      <ConnectView
        step={step}
        code={code !== undefined}
        onConfirm={(origin) => (code ? claim(origin) : void addAndOpen(origin))}
        onOpen={(id) => {
          leaveSheet();
          void openInstance(id);
        }}
      />
    </>
  );
}

function ConnectView({
  step,
  code,
  onConfirm,
  onOpen,
}: {
  step: Step;
  code: boolean;
  onConfirm: (origin: string) => void;
  onOpen: (instanceId: string) => void;
}) {
  const colors = useTheme();
  const heading = (text: string) => (
    <FieldGroup.Section>
      <ListItem>
        <Text textStyle={{ fontSize: 22, fontWeight: "700" }}>{text}</Text>
      </ListItem>
    </FieldGroup.Section>
  );
  const close = (
    <FieldGroup.Section>
      <ListItem onPress={leaveSheet}>
        <Text textStyle={{ color: colors.primary }}>{say("close")}</Text>
      </ListItem>
    </FieldGroup.Section>
  );
  let body;
  if (step.kind === "checking") {
    body = (
      <FieldGroup.Section>
        <ListItem>
          <Text textStyle={{ color: colors.mutedForeground }}>{say("checking")}</Text>
        </ListItem>
      </FieldGroup.Section>
    );
  } else if (step.kind === "refused") {
    body = (
      <>
        {heading(step.title ?? say("ended_title"))}
        <FieldGroup.Section>
          <ListItem>
            <Text>{step.text}</Text>
          </ListItem>
          {step.app ? (
            <ListItem onPress={() => void Linking.openURL(step.app!).catch(() => {})}>
              <Text textStyle={{ color: colors.primary }}>{say("own_app_link")}</Text>
            </ListItem>
          ) : null}
        </FieldGroup.Section>
        {close}
      </>
    );
  } else if (step.kind === "already") {
    body = (
      <>
        {heading(say("already", hostOf(step.origin)))}
        <FieldGroup.Section>
          <SubmitButton
            label={say("open_instance", hostOf(step.origin))}
            onPress={() => onOpen(step.instanceId)}
          />
        </FieldGroup.Section>
        {close}
      </>
    );
  } else if (step.kind === "confirm") {
    const host = hostOf(step.origin);
    body = (
      <>
        {heading(code ? say("sign_in_question", host) : say("signing_in_to", host))}
        <FieldGroup.Section>
          {code ? (
            <ListItem>
              <Text>{say("sign_in_question_body", host)}</Text>
            </ListItem>
          ) : null}
          {step.noRelay ? (
            <ListItem supportingText={say("no_relay_body", host)}>
              <Text textStyle={{ color: colors.destructive, fontWeight: "600" }}>
                {say("no_relay")}
              </Text>
            </ListItem>
          ) : null}
          {!code && !step.noRelay ? (
            <ListItem>
              <Text>{step.origin}</Text>
            </ListItem>
          ) : null}
        </FieldGroup.Section>
        <FieldGroup.Section>
          <SubmitButton
            label={code ? say("sign_in") : say("continue")}
            onPress={() => onConfirm(step.origin)}
          />
        </FieldGroup.Section>
        <FieldGroup.Section>
          <ListItem onPress={leaveSheet}>
            <Text textStyle={{ color: colors.primary }}>
              {m.mobile_session({ part: "cancel" })}
            </Text>
          </ListItem>
        </FieldGroup.Section>
      </>
    );
  } else {
    const host = hostOf(step.origin);
    const state = step.state;
    if (state.step === "claiming") {
      body = (
        <FieldGroup.Section>
          <ListItem>
            <Text textStyle={{ color: colors.mutedForeground }}>{say("claiming", host)}</Text>
          </ListItem>
        </FieldGroup.Section>
      );
    } else if (state.step === "waiting") {
      body = (
        <>
          {heading(say("number_title"))}
          <FieldGroup.Section>
            <ListItem>
              <Text
                textStyle={{
                  fontSize: 72,
                  fontWeight: "700",
                  letterSpacing: 12,
                  textAlign: "center",
                  color: colors.foreground,
                }}
              >
                {state.number}
              </Text>
            </ListItem>
            <FieldGroup.SectionFooter>
              <FooterText>{say("number_waiting", host)}</FooterText>
            </FieldGroup.SectionFooter>
          </FieldGroup.Section>
          <FieldGroup.Section>
            <ListItem>
              <Text textStyle={{ color: colors.destructive, fontWeight: "600" }}>
                {say("number_never_share")}
              </Text>
            </ListItem>
          </FieldGroup.Section>
          <FieldGroup.Section>
            <ListItem onPress={leaveSheet}>
              <Text textStyle={{ color: colors.primary }}>
                {m.mobile_session({ part: "cancel" })}
              </Text>
            </ListItem>
          </FieldGroup.Section>
        </>
      );
    } else if (state.step === "signed-in") {
      body = (
        <>
          {heading(say("signed_in_as", host, state.user.name || state.user.email))}
          <FieldGroup.Section>
            <ListItem supportingText={state.user.email}>
              <Text>{state.user.name || state.user.email}</Text>
            </ListItem>
          </FieldGroup.Section>
          <FieldGroup.Section>
            <SubmitButton
              label={say("open_instance", host)}
              onPress={() => (step.instanceId ? onOpen(step.instanceId) : leaveSheet())}
            />
          </FieldGroup.Section>
        </>
      );
    } else {
      body = (
        <>
          {heading(say("ended_title"))}
          <FieldGroup.Section>
            <ListItem>
              <Text>{endText(state.reason, host)}</Text>
            </ListItem>
          </FieldGroup.Section>
          {close}
        </>
      );
    }
  }
  return (
    <NativeHost style={{ flex: 1 }}>
      <FieldGroup>{body}</FieldGroup>
    </NativeHost>
  );
}
