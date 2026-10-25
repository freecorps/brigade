# RFC 0010 — In-app voice paging (VoIP call screen)

- Status: Draft — spike S6 done on the Android emulator and the iOS Simulator; devices left
  ([write-up](../spikes/s6-voip-call-screen.md))

## Goal

Page responders with a **native incoming-call screen** (like WhatsApp/Telegram calls) instead of — or after —
a regular push notification, without paying for PSTN calls.

## Platform rules (the hard constraint)

- **iOS:** a VoIP push (PushKit) wakes the app, which **must** immediately report an incoming call to CallKit
  (`reportNewIncomingCall`). If a VoIP push does not end in a call, iOS terminates the app and, after repeated
  violations, stops delivering VoIP pushes to it. Apple's position is that VoIP pushes are for VoIP calls only;
  generic alerts must use regular pushes (time-sensitive / critical).
- **Android:** high-priority FCM data message → self-managed `ConnectionService` + `CallStyle` notification
  with a full-screen intent. Play policy allows full-screen intents for calling apps. Since Android 14 the
  permission (`USE_FULL_SCREEN_INTENT`) can be missing or revoked; the app checks `canUseFullScreenIntent()` before
  every call and falls back (below).
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

## What spike S6 built (the call before the voice bot)

The voice bot needs Cloudflare Realtime, Workers AI and WebRTC in the app. The spike proved the part that does not:
a page rings natively, answering reads the incident aloud on the phone, and the responder acknowledges. It is
the fallback the bot keeps when the audio session cannot start.

- **Android: self-managed `ConnectionService` (platform Telecom) + `CallStyle` + full-screen intent.** Telecom
  knows Brigade is in a call (audio focus, other calls, headsets); the `CallStyle` notification on an
  `IMPORTANCE_HIGH` channel with the ringtone (`FLAG_INSISTENT`) rings; its full-screen intent opens a native
  ringing screen over the lock screen. Answer opens the React Native call screen, shown over the lock screen only
  while the call lasts. Core-Telecom (`androidx.core:core-telecom`) wraps the same API; the platform API was picked
  for the spike because it has no extra dependency and its failure callback (`onCreateIncomingConnectionFailed`) maps
  straight onto the fallback.
- **iOS: PushKit → CallKit.** The VoIP push handler reports the call before decrypting (caller name "Brigade
  on-call", localized), then updates it with the decrypted title. If CallKit refuses (Do Not Disturb, a block list,
  another call), the page is posted as a time-sensitive notification. An unanswered call ends after 60 seconds.
- **Reading the incident: platform text-to-speech** (`AVSpeechSynthesizer` after CallKit activates the audio
  session; Android `TextToSpeech` on the voice-call stream), in the app's language. The script is built from the
  decrypted title and body with `packages/i18n` messages.
- **Acknowledging: press 1**, not speech recognition. On iOS, 1 on CallKit's own keypad (a `CXPlayDTMFCallAction`,
  available on the lock screen) acknowledges; on both platforms the call screen has a "1 Acknowledge" button.
  On-device speech recognition would need the microphone and speech permissions, behaves differently per platform
  and language, and is what the voice bot's server-side STT replaces; a key press works in a noisy room and for
  someone who cannot speak at that moment. Saying "acknowledge" arrives with the bot.
- **The ack is a named mutation**, `incident.ack` (`packages/schema`, permission `incident:ack`), sent through
  Brigade Sync. The first ack wins; a second is a `conflict`, which the call screen shows as acknowledged (someone
  did, paging stopped).

### Fallbacks (paging paths need one)

| Situation                                                                     | What the phone does                                         |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Android: full-screen intents not allowed, Telecom refuses, call channel muted | Page notification on the `brigade_pages` channel (alarm)    |
| Android: notifications off                                                    | Nothing can show; the route is `blocked` (report it, below) |
| iOS: CallKit refuses the call                                                 | Time-sensitive notification with the decrypted page         |
| iOS: the VoIP push cannot be decrypted                                        | Still rings, as "Brigade on-call" with the fallback text    |
| Android: Telecom creates no connection, or the ringing notification fails     | The call ends; page notification on `brigade_pages`         |
| Nobody answers in 60 s, or the call is declined                               | The call ends; escalation continues on its own timeout      |

The Android decision and the iOS handling of repeated pushes are pure functions in
`apps/mobile/src/lib/call-route.ts`, tested in CI; the Kotlin and Swift copies mirror them. Every VoIP push is
reported to CallKit, repeats of a page included (a repeat after its call ended is reported and ended at once). An
answered call hangs up natively after 3 minutes. The step-1 alert push (RFC 0006) is
always sent before the call, so a phone whose call cannot ring has already been notified.

### Payload: nothing the app could ignore

The relay sends a call only as `{ call: { id }, brigade: <envelope> }` with `apns-push-type: voip` on the
`<bundle id>.voip` topic, and only for `urgency: page`. The call id is a UUID that every repeat of the same page
reuses (CallKit de-duplicates it). There is no `aps` and no flag that could make the app skip reporting the call,
and the app reports even a malformed payload, under a new UUID. A call lives 60 seconds by default (at most 5
minutes): a phone that comes online later gets the stored alert push, not a stale call. The sealed plaintext gains
an optional `incident` (the id the ack names).

On Android the same payload will arrive as a high-priority FCM data message (`{ kind: "call", id, enc, ct }`); the
app's `FirebaseMessagingService` decrypts it with Tink's HPKE and calls the same `Calls.ring` the spike's debug
broadcast calls. FCM is not set up yet.

### Left

- Real phones (the write-up's list), the voice bot, and FCM.
- Any member with `incident:ack` can acknowledge, not only the page's targets; escalation runs decide whether the
  ack is limited to them.

## Where it sits in the escalation ladder

| Step | Channel                                                 | Needs internet on the phone |
| ---- | ------------------------------------------------------- | --------------------------- |
| 1    | Push (time-sensitive; critical alert if granted)        | Yes                         |
| 2    | VoIP call screen (this RFC)                             | Yes                         |
| 3    | Optional PSTN call/SMS via provider (Twilio, Zenvia, …) | **No** — only cell signal   |

PSTN stays as an optional last step: VoIP fails exactly when the phone has signal but no data (roaming, weak 4G).
Escalation policies decide which steps to use; self-hosters can skip PSTN entirely.

## PSTN step (optional last resort)

### Notifier contract

```ts
interface VoiceProvider {
  id: string; // "twilio", "zenvia", ...
  call(to: E164, script: VoiceScript, callbackUrl: string): Promise<{ providerCallId: string }>;
  sms(to: E164, text: string, callbackUrl: string): Promise<{ providerMessageId: string }>;
  parseCallback(req: Request): Promise<VoiceCallback>; // answered | dtmf | no-answer | busy | failed | sms-reply
}
```

A provider qualifies if it supports outbound calls with text-to-speech, DTMF capture with a webhook, and SMS with
inbound replies. Twilio (TwiML `<Say>` + `<Gather>`) is the reference; local providers are evaluated by price.

### Call flow

```
IncidentDO alarm (level N = PSTN)
  └─▶ queue: notify.voice ─▶ notifier Worker ─▶ provider.call(+55…, script, /webhooks/voice/<attemptId>)
                                                          │
  phone rings → TTS: "Brigade. SEV1 checkout API down. Press 1 to acknowledge, 2 to escalate."
                                                          │ DTMF webhook (signed, provider-verified)
  api Worker ─▶ incident.ack / incident.escalate (system actor "voice:<userId>") ─▶ timeline
```

- **SMS:** short code per page attempt ("Reply 1 to ack — #4821"); replies map back by attempt id.
- **Phone verification:** users add numbers through an OTP flow; unverified numbers are never called.
- **Cost control:** PSTN only from escalation levels that enable it; per-workspace monthly budget and rate limit;
  usage shown in settings. Self-hosters bring their own provider credentials.
- **Caller ID tip:** the app offers a contact card ("Brigade Paging") with the provider's numbers so users can mark it
  as a favorite / emergency bypass and let it ring through Do Not Disturb.
- **Delivery receipts:** every attempt and provider callback is stored on the page record ("why wasn't I paged?").

## Relay impact (RFC 0006)

- VoIP pushes use a separate PushKit token and the `<bundle-id>.voip` APNs topic; the relay supports both token
  types (`kind: "call"` on `POST /send`, spike S6). The App ID needs the VoIP Services capability; the team's APNs
  token key (`.p8`) signs for every topic, so no separate VoIP certificate is needed.
- The VoIP payload cannot be handled by the NSE; the app itself decrypts it (it is already awake to report the call).
- CallKit is informed before decryption: "Brigade on-call" first, the caller name updated after decryption.

## Expo

Our own local Expo module, `apps/mobile/modules/brigade-call` (Swift and Kotlin), and config plugin,
`plugins/incoming-call.ts`, rather than `react-native-callkeep` and `react-native-voip-push-notification`: PushKit
must be registered at launch (an `ExpoAppDelegateSubscriber`), the push must be decrypted with the same
`BrigadePushCrypto` as the extension, and the Android route decision and fallback are ours. Development builds only.
WebRTC via `react-native-webrtc` (or the Cloudflare Realtime SDK when it supports React Native).

## Risks

- The React Native call screen is shown over the Android lock screen while a call lasts; Back is disabled there,
  but a dedicated native in-call activity would expose less of the app to someone holding a locked phone.

- App Review may still question a "bot call". Mitigations: human calls are a real feature, the bot call carries real
  two-way audio, and documentation in the review notes.
- Critical Alerts entitlement (precedent: PagerDuty and Opsgenie mobile apps support it) reduces how often step 2 is needed.
