# RFC 0010 — In-app voice paging (VoIP call screen)

- Status: Draft — validate in spike S6

## Goal

Page responders with a **native incoming-call screen** (like WhatsApp/Telegram calls) instead of — or after —
a regular push notification, without paying for PSTN calls.

## Platform rules (the hard constraint)

- **iOS:** a VoIP push (PushKit) wakes the app, which **must** immediately report an incoming call to CallKit
  (`reportNewIncomingCall`). If a VoIP push does not end in a call, iOS terminates the app and, after repeated
  violations, stops delivering VoIP pushes to it. Apple's position is that VoIP pushes are for VoIP calls only;
  generic alerts must use regular pushes (time-sensitive / critical).
- **Android:** high-priority FCM data message → self-managed `ConnectionService` + `CallStyle` notification
  with a full-screen intent. Play policy allows full-screen intents for calling apps.
- **China storefront:** CallKit must be disabled; fall back to regular push there.

**Conclusion:** the call screen is only legitimate if answering it **starts a real audio call**.

## Design: the call is real

When the responder answers, the app joins a real-time audio session:

1. **Brigade voice bot** (default): a session where the incident is read aloud
   ("SEV1 declared: checkout API down in 3 regions. Say _acknowledge_ or press 1.") and the responder can
   acknowledge or escalate by voice or keypad. Audio via Cloudflare Realtime (SFU/TURN); speech via Workers AI
   (TTS + STT), or the Agents SDK voice support.
2. **Human call** (bonus, and it strengthens the App Review case): the incident lead can call any responder from
   the incident screen ("call on-call DBA now"); the callee gets the same native call screen.

Declining the call counts as "not acknowledged" and the escalation continues.

## Where it sits in the escalation ladder

| Step | Channel                                                 | Needs internet on the phone |
| ---- | ------------------------------------------------------- | --------------------------- |
| 1    | Push (time-sensitive; critical alert if granted)        | Yes                         |
| 2    | VoIP call screen (this RFC)                             | Yes                         |
| 3    | Optional PSTN call/SMS via provider (Twilio, Zenvia, …) | **No** — only cell signal   |

PSTN stays as an optional last step: VoIP fails exactly when the phone has signal but no data (roaming, weak 4G).
Escalation policies decide which steps to use; self-hosters can skip PSTN entirely.

## Relay impact (RFC 0006)

- VoIP pushes use a separate PushKit token and the `<bundle-id>.voip` APNs topic; the relay supports both token types.
- The VoIP payload cannot be handled by the NSE; the app itself decrypts it (it is already awake to report the call).
- Payload must be small and decryptable fast: CallKit must be informed before decryption finishes if needed
  (show "Brigade — incoming page", update caller name after decryption).

## Expo

`react-native-callkeep` + `react-native-voip-push-notification` (or equivalents) through config plugins in a development build.
WebRTC via `react-native-webrtc` (or the Cloudflare Realtime SDK when it supports React Native).

## Risks

- App Review may still question a "bot call". Mitigations: human calls are a real feature, the bot call carries real
  two-way audio, and documentation in the review notes.
- Critical Alerts entitlement (precedent: PagerDuty and Opsgenie mobile apps support it) reduces how often step 2 is needed.
