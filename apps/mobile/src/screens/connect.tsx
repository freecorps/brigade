import { FieldGroup, Text } from "@expo/ui";
import { m } from "@freecorps/brigade-i18n";
import Constants from "expo-constants";
import { Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Linking } from "react-native";
import { FooterText } from "@/components/footer-text";
import { endText, say, verdictText } from "@/components/instances";
import { ListItem } from "@/components/list-item";
import { NativeHost } from "@/components/native-host";
import { openInstance, signOutInstance, useSessionView } from "@/components/session";
import { SubmitButton } from "@/components/submit-button";
import { useTheme } from "@/hooks/use-theme";
import { askFor, linkKey, type ConnectLink } from "@/lib/connect-link";
import { checkInstance, instances, keepSignIn, sessionAt } from "@/lib/instance-clients";
import { hostOf, readAddress } from "@/lib/instance-address";
import { instanceAt, MAX_INSTANCES, type Instance } from "@/lib/instances";
import { runClaim, type ClaimState } from "@/lib/qr-sign-in";
import { alreadyChoices } from "@/lib/switcher";
import { leaveSheet } from "@/screens/add-instance";

type Step =
  /** A link from outside the app: the host shown, nothing asked of it yet. */
  | { kind: "ask"; host: string }
  | { kind: "checking" }
  | { kind: "refused"; title?: string; text: string; app?: string }
  /**
   * A session is kept there, at `home`: a listed instance, or the build's own instance, removed, under its keys from
   * before (`listed` false). `ended`: found after the claim, when the delivered session went unused.
   */
  | {
      kind: "already";
      origin: string;
      home?: Instance;
      listed?: boolean;
      /** Not listed, and the phone has the most instances it can: Open cannot add it back. */
      full?: boolean;
      ended?: boolean;
    }
  | { kind: "confirm"; origin: string; noRelay: boolean }
  | { kind: "claim"; origin: string; state: ClaimState; instanceId?: string };

/**
 * A dashboard link or QR (`brigade://connect?server=…[&code=…]`, RFC 0015 sections 5 and 6), opened by the system
 * camera or the in-app scanner. The address is checked first, as typed ones are. With the address alone: "You are
 * signing in to <host>", then its sign-in screen. With a code: "Sign in to <host>?", then the claim; the phone shows
 * the 2-digit number the member types on the dashboard, and once they did, "Signed in to <host> as <name>" and the
 * instance opens. Nothing is claimed before the member confirms, so a QR from a stranger is seen for what it is; and a
 * link from outside the app (`trusted` false) asks nothing of the address before the member taps Continue. A session
 * kept at that instance is never replaced: the screen offers to open it, or to sign out of it first.
 */
export function Connect({ link, trusted }: { link: ConnectLink | undefined; trusted: boolean }) {
  const view = useSessionView();
  const server = link?.server;
  const code = link?.code;
  // Opened from outside the app (any app or web page can open a `brigade://` link): nothing is asked of the address,
  // not even its `/config`, before the member says so. The in-app scanner's own link goes straight on. Derived for
  // every link the screen shows: approving one approves only that one (`approved`, its key).
  const [approved, setApproved] = useState<string | null>(null);
  const ask = askFor(link, trusted, approved, (value) => {
    const read = readAddress(value, typeof __DEV__ !== "undefined" && __DEV__);
    return "origin" in read ? read.origin : undefined;
  });
  const askHost = ask?.host;
  const [step, setStep] = useState<Step>(
    askHost !== undefined ? { kind: "ask", host: askHost } : { kind: "checking" },
  );
  // Bumped to check again after signing out of a session kept there.
  const [round, setRound] = useState(0);
  const left = useRef(false);
  useEffect(() => {
    left.current = false;
    return () => {
      left.current = true;
    };
  }, []);

  useEffect(() => {
    if (askHost !== undefined) {
      setStep({ kind: "ask", host: askHost });
      return;
    }
    if (!server) {
      setStep({ kind: "refused", text: say("scan_not_brigade") });
      return;
    }
    let live = true;
    setStep({ kind: "checking" });
    void checkInstance(server).then(async (checked) => {
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
      // From what secure storage keeps, not the session as last read: one still loading or offline counts.
      const kept = await sessionAt(checked.origin);
      if (!live) return;
      if (kept) {
        setStep(alreadyAt(kept, checked.origin));
        return;
      }
      // Read after the wait: the list may have changed meanwhile.
      const list = instances.current();
      const known = instanceAt(list, checked.origin);
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
    // Checked for each link once it may be (trusted or approved), and again after signing out of a session kept there.
  }, [server, code, trusted, askHost, round]);

  /**
   * Signs out of the session kept there through the account section's own path (the build's own instance, removed,
   * with its keys from before, not listed again), then checks again; one that may still be live there is said, and
   * nothing is claimed over it.
   */
  const signOutFirst = async (home: Instance, origin: string) => {
    setStep({ kind: "checking" });
    const shown =
      instances.current().active === home.id
        ? view.kind === "ready"
          ? () => view.member.signOut()
          : view.kind === "no-workspace"
            ? view.signOut
            : undefined
        : undefined;
    const ended = await signOutInstance(home, shown).catch(() => "unknown" as const);
    if (left.current) return;
    if (ended === "unknown") {
      setStep({ kind: "refused", text: say("sign_out_failed", hostOf(origin)) });
      return;
    }
    setRound((value) => value + 1);
  };

  const addAndOpen = async (origin: string) => {
    let added: Awaited<ReturnType<typeof instances.add>>;
    try {
      added = await instances.add(origin);
    } catch {
      // Secure storage could not keep the list: said, nothing opened.
      setStep({ kind: "refused", text: say("add_failed") });
      return;
    }
    if (typeof added === "string") {
      setStep({
        kind: "refused",
        text: added === "full" ? m.mobile_instances_full({ max: MAX_INSTANCES }) : say("invalid"),
      });
      return;
    }
    leaveSheet();
    await openInstance(added.instance.id);
  };

  // One claim per screen: a second tap would spend nothing but end the first claim's screen as `invalid_code`.
  const claimed = useRef(false);
  useEffect(() => {
    claimed.current = false;
  }, [server, code]);
  const claim = async (origin: string) => {
    if (!code || claimed.current) return;
    claimed.current = true;
    // Signed in there since the check (a password sign-in, another link): the code is not spent on it.
    const kept = await sessionAt(origin);
    if (kept) {
      claimed.current = false;
      setStep(alreadyAt(kept, origin));
      return;
    }
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
          const host = hostOf(origin);
          // Signed in there while the code waited: the same choice as before a claim, not a dead end.
          if (state.step === "ended" && state.reason === "already") {
            setStep({ kind: "already", origin, ended: true });
            AccessibilityInfo.announceForAccessibility(endText(state.reason, host));
            return;
          }
          setStep({ kind: "claim", origin, state, ...(instanceId ? { instanceId } : {}) });
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
        onContinue={() => {
          if (link) setApproved(linkKey(link));
        }}
        onConfirm={(origin) => void (code ? claim(origin) : addAndOpen(origin))}
        onOpen={(origin) => void addAndOpen(origin)}
        onSignOutFirst={code ? (home, origin) => void signOutFirst(home, origin) : undefined}
      />
    </>
  );
}

/** "You're already signed in": with the instance's id only when it is listed (its sign-out needs it). */
function alreadyAt(kept: Instance, origin: string): Step {
  const { listed, full } = alreadyChoices(kept, instances.current());
  return { kind: "already", origin, home: kept, listed, full };
}

function ConnectView({
  step,
  code,
  onContinue,
  onConfirm,
  onOpen,
  onSignOutFirst,
}: {
  step: Step;
  code: boolean;
  onContinue: () => void;
  onConfirm: (origin: string) => void;
  /** Opens the instance at that origin, added back to the list when it is not on it. */
  onOpen: (origin: string) => void;
  /** With a sign-in code: sign out of the session kept there, then go on with the code. */
  onSignOutFirst?: (home: Instance, origin: string) => void;
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
  if (step.kind === "ask") {
    body = (
      <>
        {heading(say("check_question", step.host))}
        <FieldGroup.Section>
          <ListItem>
            <Text>{say("check_body", step.host)}</Text>
          </ListItem>
        </FieldGroup.Section>
        <FieldGroup.Section>
          <SubmitButton label={say("continue")} onPress={onContinue} />
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
  } else if (step.kind === "checking") {
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
        {step.ended ? (
          <FieldGroup.Section>
            <ListItem>
              <Text>{endText("already", hostOf(step.origin))}</Text>
            </ListItem>
          </FieldGroup.Section>
        ) : null}
        <FieldGroup.Section>
          <SubmitButton
            label={say("open_instance", hostOf(step.origin))}
            onPress={() => onOpen(step.origin)}
          />
          {step.full ? (
            <FieldGroup.SectionFooter>
              <FooterText>{m.mobile_instances_full({ max: MAX_INSTANCES })}</FooterText>
            </FieldGroup.SectionFooter>
          ) : null}
        </FieldGroup.Section>
        {/* Before the code is spent: listed or not (the build's own instance, removed, signs out with its old keys). */}
        {onSignOutFirst && !step.ended && step.home ? (
          <FieldGroup.Section>
            <ListItem onPress={() => onSignOutFirst(step.home!, step.origin)}>
              <Text textStyle={{ color: colors.destructive }}>{say("sign_out_first")}</Text>
            </ListItem>
            <FieldGroup.SectionFooter>
              <FooterText>{say("sign_out_first_hint", hostOf(step.origin))}</FooterText>
            </FieldGroup.SectionFooter>
          </FieldGroup.Section>
        ) : null}
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
            <SubmitButton label={say("open_instance", host)} onPress={() => onOpen(step.origin)} />
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
