# Spike S6 — VoIP call screen

- Status: Done on the Android emulator and, up to CallKit's UI, on the iOS Simulator; left: real phones
- Roadmap: Phase 0, S6
- Settles: RFC 0010's Android API, how a page is read and acknowledged before the voice bot exists, the VoIP
  payload and relay route (RFC 0006), and the shape of `incident.ack` (RFC 0003, 0004)

## Question

Can a page ring a phone like a call, on the lock screen, with each platform's own call UI, and can answering
play the incident and take "ack" back to the server? The pass criterion: a locked iPhone and a locked Android
phone ring natively; answering plays the incident and accepts "ack".

The phones were not available for this spike, so it proves what an emulator and a Simulator can, and lists the
device steps that are left.

## What was built

- **`incident.ack`** (`packages/schema`): a named mutation with a new permission, `incident:ack` (owner, admin and
  responder; not viewer). It sets `acknowledgedAt` and `acknowledgedBy` on the incident and emits
  `incident.acknowledged { by }`. The first ack wins: a second is a `conflict` (no change). Resolved and declined
  incidents cannot be acknowledged (`invalid_transition`). Reopening a resolved incident clears the ack, so the
  next page can be acknowledged. Rows stored before the fields existed acknowledge fine. Any member with
  `incident:ack` can acknowledge, not only the page's targets (left for escalation runs). Escalation runs do not exist yet, so the ack lives on the incident until `IncidentDO` has runs (RFC 0003).
- **The relay sends calls** (`apps/relay`): `POST /send` with `kind: "call"` and a `callId` (lowercase UUID) sends
  a PushKit VoIP push, `apns-push-type: voip` to the `<APNS_TOPIC>.voip` topic, priority 10, body
  `{ call: { id }, brigade: <envelope> }`. A call must be `urgency: page` (its default), expires after 60 seconds by
  default and 5 minutes at most, and anything else is a `400` before APNs is called. `scripts/send-test-push.ts`
  sends one with `call` as its urgency argument.
- **`packages/push`**: the sealed content gains an optional `incident`, the id the ack names.
- **`apps/mobile/modules/brigade-call`**, a local Expo module (Swift and Kotlin), and **`plugins/incoming-call.ts`**:
  - **Android:** `Calls.ring` decides the route (`CallRoute.kt`, below). To ring, it registers a self-managed
    `PhoneAccount` and calls `TelecomManager.addNewIncomingCall`. `BrigadeConnectionService` creates the
    `Connection`, and Telecom's `onShowIncomingCallUi` posts a `CallStyle.forIncomingCall` notification on the
    `brigade_calls` channel (high importance, the ringtone, `FLAG_INSISTENT`) with a full-screen intent to
    `IncomingCallActivity`, a native ringing screen shown over the lock screen. Answer (on that screen or the
    notification) sets the connection active and opens the React Native call screen; while the call lasts, the
    app's activity may show over the lock screen (`setShowWhenLocked`), and that is cleared when it ends.
    Unanswered calls end after 60 seconds; answered ones hang up natively 3 minutes after answering, ack or not
    (`ANSWERED_CALL_MAX_MS`), which also bounds the time the app is shown over the lock screen. Both timers carry
    the call's state as their token: `end` cancels them, and they act only on the call that started them, never on
    a later call with the same id. If Telecom throws, gives the call no connection, or the ringing notification
    cannot be posted, the call ends and the page is posted on `fallbackChannel` instead (`brigade_pages`, or
    `brigade_calls` if the user muted pages). `CallSpeech` speaks through `TextToSpeech` on the voice-call stream.
    The ringing screen's and the channels' strings are resources the plugin generates from `packages/i18n`.
  - **iOS:** `CallCenter` registers PushKit from an `ExpoAppDelegateSubscriber` at launch (a VoIP push can launch
    the app in the background). Every VoIP push is reported to CallKit at once, as "Brigade on-call"; a missing or
    malformed call id gets a new UUID rather than no call. Then the envelope is decrypted with the same
    `BrigadePushCrypto` as the Notification Service Extension (now public in the `BrigadePush` pod) and the caller
    name updated. If CallKit refuses the call, the page is posted as a time-sensitive notification. On iOS 16
    (the app's minimum is 16.4; HPKE needs iOS 17) the envelope cannot be opened: the phone still rings, as
    "Brigade on-call" with the fallback text, but the call carries no incident id, so it cannot be acknowledged
    from the call. Documented rather than raising the minimum. Answering
    sets the audio session (`playAndRecord`, `voiceChat`) and speaks with `AVSpeechSynthesizer` once CallKit
    activates it; 1 on CallKit's keypad (`CXPlayDTMFCallAction`) acknowledges; the press is also kept on the call
    (`ackKeyPressed`), so JavaScript that attaches after it (a cold launch) acknowledges on mount. The plugin adds the `voip`
    background mode; `call_caller` joins the strings generated into `Localizable.strings`.
  - **JavaScript:** `src/lib/call-session.ts` holds the answered call: it reads `call_script` and
    `call_script_prompt` aloud in the app's language, sends `incident.ack` through Brigade Sync once (the button and
    the keypad together, or a double tap, send one), treats `conflict` as acknowledged, shows other failures with a
    retry, says `call_script_acked` and hangs up. `/call` is the call screen ("1 Acknowledge", "Hang up"; Back
    disabled while the call lasts). The development-only `/call-test` screen shows the route a page would take,
    the PushKit token, and rings a test call for the first unacknowledged incident after 10 seconds.
  - **Threads:** Expo's sync functions run on the JavaScript thread (`@JavaScriptActor` in expo-modules-core 58),
    never the main thread, and the call state lives on the main thread. The modules read only an immutable
    snapshot of the answered call (a `@Volatile` value on Android, an `OSAllocatedUnfairLock` on iOS, both replaced
    on the main thread) and post everything else to the main thread without waiting. `DispatchQueue.main.sync` was
    rejected: React Native's renderer can block the main thread on the JavaScript thread, and the two would
    deadlock.
  - **Test hooks, development builds only:** on Android, an `adb shell am broadcast` to `DebugCallReceiver` (in
    the module's `src/debug` source set, so release builds do not contain it; only senders holding `DUMP`, which
    adb's shell does, and ignored unless the app is debuggable; a `debugOptimized` build, which is not the `debug`
    build type, has no receiver at all, the safe direction); on iOS, launch
    arguments (`-BrigadeTestCall <title>`, `-BrigadeTestCallAnswer YES`, `-BrigadeTestCallAck YES`) that ring,
    then answer and press 1 as CallKit transactions, because this Simulator cannot be tapped
    (`-BrigadeTestCallId`, `-BrigadeTestCallRingTimeout <s>`, `-BrigadeTestCallDecline YES` and
    `-BrigadeTestCallRepeatAfter <s>` exercise the repeat rule below).

Versions: Expo SDK 58, React Native 0.88, Android emulator API 36 (Google APIs, arm64), Xcode 27.0 beta 6, iPhone 17
Simulator on iOS 27.0, macOS 27.2 on Apple silicon, Wrangler 4.152.

## Decisions

### Android: self-managed `ConnectionService` + `CallStyle` + full-screen intent

The `CallStyle` notification alone rings and shows Answer and Decline, but Android only posts it with a
full-screen intent or a foreground service, and without Telecom the system does not know a call is in progress:
no audio focus as a call, no headset or car buttons, no say in what happens to a cellular call. The self-managed
`ConnectionService` adds all of that, and its failure callback (`onCreateIncomingConnectionFailed`) is exactly
where the fallback goes. Core-Telecom (`androidx.core:core-telecom`) wraps the same API with coroutines and is
Google's recommendation for new apps; the spike used the platform API to avoid a dependency and keep the failure
path explicit. Moving to Core-Telecom later changes `Calls.kt` only.

The full-screen intent is the risky part. Since Android 14, `USE_FULL_SCREEN_INTENT` is granted by Google Play
only to apps whose core function is calling or alarms, and the user can revoke it. So the app asks
`NotificationManager.canUseFullScreenIntent()` before every call, and the dev screen links to the setting
(`ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`). The Play declaration for Brigade ("alarm or calling app") is
plausible, since paging is the app's purpose, but is not decided by this spike.

### The fallback (paging paths need one)

`decideRoute` decides, from five facts, how a page reaches this phone. Its source of truth is TypeScript,
`apps/mobile/src/lib/call-route.ts`, because CI runs `vp run -r test` on Linux and cannot run Kotlin or Swift tests;
`CallRoute.kt` mirrors it, and the TypeScript test also reads `CallRoute.kt` and checks its branches match:

1. Notifications off for the app: **blocked**. Nothing can be shown; the phone should report it so the instance
   escalates past it.
2. The call channel on, full-screen intents allowed and Telecom permitting an incoming call: **ring**.
3. Otherwise, the page channel on: **notify** on `brigade_pages`.
4. Otherwise, the call channel on: **notify** on `brigade_calls` (a plain notification, no call).
5. Otherwise (both channels off): **blocked**.

`brigade_pages` uses the alarm sound and asks to bypass Do Not Disturb. If Telecom accepts the call and then
fails to create it, or creates none, or the ringing notification cannot be posted, the page becomes a
notification too. `call-route.test.ts` covers the table in CI, including all 32 combinations against "something is
shown whenever something can be" and "rings only when all three allow it"; the JVM tests (`CallRouteTest.kt`)
still run by hand with `./gradlew :brigade-call:testDebugUnitTest`. A Gradle job in CI was not added: it needs a
prebuild, a JDK and the Android SDK for a five-line function. The side effects around the decision (Telecom's
failure callbacks, a refused notification, the iOS fallback notification) stay untested in CI; they are checked
on the emulator below and on phones. On iOS, a `reportNewIncomingCall` error posts a time-sensitive notification with the decrypted page.
The step-1 alert push (RFC 0006) is sent before any call, so a phone that cannot ring has already been notified.

### Reading the incident: platform text-to-speech

`AVSpeechSynthesizer` and Android's `TextToSpeech` are on every phone, need no network or bundled audio, and speak
the user's language: the script comes from `packages/i18n` (`call_script`, `call_script_prompt`), filled with the
decrypted title and body, in `en-US` or `pt-BR` after the app's locale. A bundled clip could not say the incident.
The voice bot (RFC 0010) replaces this with server-side TTS in a real audio session; on-device speech stays as its
fallback.

### Acknowledging: press 1, not speech recognition

On-device speech recognition needs the microphone and speech-recognition permissions (asked during an incident,
on a lock screen), differs between platforms and between `en` and `pt-BR`, and fails in exactly the noisy rooms
people get paged in. A key works for someone who cannot speak at that moment. iOS has a native key: CallKit's own
keypad sends `CXPlayDTMFCallAction`, including on the lock screen, so "press 1" works without unlocking. Android's
self-managed calls have no system keypad, so the call screen's "1 Acknowledge" button is it. Saying "acknowledge"
arrives with the voice bot's server-side recognition, where one model serves both platforms.

### The payload cannot be ignored

Apple terminates an app that receives a VoIP push and does not report a call to CallKit before the handler returns,
and stops delivering VoIP pushes after repeated failures. So:

- The relay sends a call only for a page (`urgency: page`), with a call id, and with nothing else in clear: no
  `aps`, no flag, nothing the app could read as "do not ring".
- The app reports first and decrypts second. A push it cannot decrypt still rings as "Brigade on-call" with the
  fallback text; a push without a valid call id rings under a new UUID.
- Repeats of one page share the call id, and **every push is reported**, repeats included (`voipPushPlan` in
  `src/lib/call-route.ts`, tested in CI; `CallCenter` mirrors it). A repeat while the call rings or is answered
  gets CallKit's `callUUIDAlreadyExists`, treated as success, so it never rings twice. Only the development
  `simulate` path skips CallKit for a known id.
- **After a call ends, its end reason decides whether a repeat rings** (`knownCall`, the same rule on Android). A
  repeat after a decline, or after the call was answered (hung up, acknowledged, or ended at 3 minutes), is
  reported and ended at once (`answeredElsewhere`): the responder saw the call. A repeat after a **missed** call
  (60 s unanswered) or a **failed** one (no ringing UI, CallKit reset) **rings again**: nobody was reached, and
  silencing it would turn one unanswered ring into a silent phone. The end is remembered for 5 minutes: the relay
  never repeats by itself, the instance re-sends, and each send expires at most 5 minutes (`MAX_CALL_TTL_SECONDS`)
  after it was sent, so a copy sent before the end arrives within 5 minutes of it; a later send is a new attempt
  and rings. The memory is in RAM, so a killed app treats a repeat as new and rings. On iOS, a call the system ends
  before it is answered reaches the app as a `CXEndCallAction`, like a decline; one that ends within 2 seconds of
  ringing (`SYSTEM_END_MS`) is recorded as `failed`, so its repeat rings. (A Focus that blocks calls is different:
  CallKit refuses the report, and the refusal path posts the time-sensitive notification.)
- A call lives 60 seconds by default. A phone that comes online later should get the stored alert push, not a call
  for a page that may already be acknowledged.

The App ID needs the VoIP Services capability. The team's APNs token key (`.p8`) signs for every topic, including
`.voip`, so no separate VoIP certificate is needed.

### How FCM will drive Android

FCM is not set up. The instance will send a high-priority FCM data message (`priority: high`, no `notification`
block, so the app's code always runs) with `{ kind: "call", id, enc, ct }` through the relay. That differs from the
APNs body (`{ call: { id }, brigade: <envelope> }`) on purpose: FCM data values are flat strings, so the envelope's
fields are spread out and the kind is explicit, where APNs carries JSON and the push type already says "call". The app's
`FirebaseMessagingService.onMessageReceived` decrypts it with the device key (Tink's HPKE, the same suite as
`packages/push`) and calls `Calls.ring`, the function the debug broadcast calls today. A high-priority message
lets the app start the call from the background; FCM may deprioritize an app whose high-priority messages do not
end in a user-visible notification, which a ring or the fallback notification always is.

## Result

### Android emulator (API 36): passes, except real audio

Run on 2026-10-25 against this branch's local stack (`vp dev` in `apps/web` on another port, the app pointed at
it with `EXPO_PUBLIC_BRIGADE_SYNC_URL` and `adb reverse`), with a PIN set on the emulator (`adb shell locksettings
set-pin`) so the keyguard was really up (`isKeyguardShowing=true`):

1. The `/call-test` screen showed the route "It rings as a call".
2. Screen off and locked, the debug broadcast rang: `Calls.ring` chose `ring`; Telecom listed a self-managed call in
   `RINGING` for `BrigadeConnectionService`; the `CallStyle` notification on `brigade_calls` carried
   `INSISTENT|ONGOING_EVENT` and a full-screen intent; `AudioPlaybackConfiguration` showed the ringtone playing
   (`USAGE_NOTIFICATION_RINGTONE`, started); the screen turned on with `IncomingCallActivity` as the resumed
   activity above the keyguard (`test-results/pr-media/s6-android-ringing-locked.png`).
3. Answer: Telecom moved the call to `ACTIVE`; the React Native call screen came up over the keyguard, still locked
   (`s6-android-in-call-locked.png`); `TextToSpeech` read the incident (engine connected, "speaking" to "spoken",
   about 10 seconds).
4. "1 Acknowledge": the shard stored `acknowledgedAt` and `acknowledgedBy: usr_dev` on the incident (read back
   over the sync protocol); the screen said "Acknowledged" (`s6-android-acknowledged.png`); the app spoke the
   confirmation and hung up; the keyguard covered the app again.
5. Decline from the ringing screen ended the call (`declined`).
6. **Fallback:** with `appops set app.freecorps.brigade USE_FULL_SCREEN_INTENT deny`, the same broadcast took the
   `notify` route: no Telecom call, a page notification on `brigade_pages`.
7. **pt-BR** (per-app language): the ringing screen ("Acionamento recebido", "Recusar", "Atender") and the call
   screen ("Chamada", "1 Confirmar", "Desligar") were in Portuguese (`s6-android-ringing-locked-pt-BR.png`,
   `s6-android-in-call-pt-BR.png`). Pressing "Confirmar" for the incident acknowledged in step 4 got `conflict`,
   which the screen showed as "Confirmado" before hanging up.

The emulator ran with `-no-audio`, so nobody heard the ringtone or the voice; the audio system's playback state
and the TTS callbacks are the evidence.

### iOS Simulator (iOS 27): everything up to CallKit's UI

- **A real VoIP push reaches the Simulator.** Unlike what RFC 0010 assumed, PushKit on this Apple-silicon Simulator
  issued an 80-byte VoIP token, and a call sent by `brigade-relay-dev` (`kind: call`) through the APNs sandbox got
  `200` and was delivered: the app logged `voip push decrypted` (sealed in Node, opened by CryptoKit in the app),
  and `callservicesd` received `reportNewIncomingCall` with the payload's call UUID and the decrypted title as the
  caller name.
- **CallKit's incoming-call UI does not run on this Simulator.** About a second after accepting the call as
  `Ringing`, `callservicesd` logs "Disconnecting call because there wont be a UI to host the call" and sends the
  provider a `CXEndCallAction` (the app logged `call ended`). The same happened for the launch-argument test call,
  so the answer and keypad transactions then failed with `unknownCallUUID`. Answering, the audio session, speech and
  the keypad ack on iOS are left for a device.
- Before the device token test, a VoIP call to a random 32-byte token got `400 BadDeviceToken` from APNs, like an
  alert: the provider token is accepted for the `.voip` topic, which says nothing yet about the App ID's VoIP
  capability (a real device token will).

Not verified: the CallKit-refused fallback notification, a VoIP push launching a terminated app.

### Re-run after the review fixes

On 2026-10-25, after the fixes for an independent review (every VoIP push reported, the ack cleared on reopen,
fallbacks when Telecom or the ringing notification fails, a maximum call length, the keypad ack kept for a
late JavaScript):

- **Android emulator**, PIN set, screen off: the broadcast rang over the keyguard (`IncomingCallActivity` above
  `isKeyguardShowing=true`, Telecom `RINGING`, `brigade_calls` with `INSISTENT` and a full-screen intent). A
  second broadcast with the same call id while it rang made no second Telecom call. Answer → `ACTIVE`, the call
  screen over the keyguard, speech; "1 Acknowledge" → "Acknowledged", the confirmation spoken, hung up, keyguard
  back. An answered call left alone hung up natively exactly 3 minutes after answering (`call ended:
  timed_out`). With `USE_FULL_SCREEN_INTENT` denied the route was `notify` on `brigade_pages`, no Telecom call; a
  second page while one rang also became a `notify`. The forced connection failure (`onCreateIncomingConnection`
  with no call) could not be triggered from outside the app; it stays untested. A release build's merged manifest
  has no `DebugCallReceiver`; the debug one does.
- **The shard:** a second ack was `conflict`; resolving and reopening the incident and acking again was `ok`.
- **iOS Simulator** (builds with Xcode 27 beta 6): three VoIP pushes with one call id straight to the APNs
  sandbox (all `200`) gave `call reported`, then, after the Simulator ended the call, `repeat of an ended call
  reported and ended` twice; two pushes sent at once with a new id gave `call reported` and `repeat reported`
  (`callUUIDAlreadyExists`). The app was never terminated. Those pushes carried a dummy envelope: `voip push not
  decrypted` each time, and each was still reported, so a push that cannot be decrypted still rings.

### Second review: the repeat rule, timers, threads, fallback channel

On 2026-10-25, after a second review (a repeat after a missed call was silenced; Android timers could end a
later call with the same id; native state read off the main thread; fallbacks hard-wired to `brigade_pages`):

- **Android emulator** (API 36, debug build, the debug broadcast with a fixed `callId`): a call left ringing ended
  `missed` after 60 s, and its repeat rang again (`ring`, Telecom `RINGING`). That call declined from the ringing
  screen, its repeat did not ring (`repeat of an ended call: not ringing again`, no Telecom call). A new id
  answered, then hung up with the headset end-call key (`KEYCODE_ENDCALL`, Telecom's `onDisconnect`, `hung_up`):
  its repeat did not ring either. With a temporary local build (3-minute limit cut to 40 s, the ended memory to
  10 s, not committed) so one id could ring again while its first call's timers were pending: call 1 answered at
  :03 and hung up, call 2 with the same id answered at :22 and hung up natively at 40.0 s after **its** answer
  (`timed_out`), not at :43 when call 1's timer was due; a declined call's id rung again 15 s later was `missed` 60 s
  after the second ring, not 45 s. The three Telecom and notification fallbacks still cannot be triggered from
  outside the app; `fallbackChannel` is tested in TypeScript and JVM tests, and the three call sites in
  `Calls.kt` are checked by text.
- **iOS Simulator** (Xcode 27 beta 6, builds without warnings in the module), with the development launch
  arguments: a call with `-BrigadeTestCallRingTimeout 0` ended `missed`, and its repeat (`simulateRepeat`, the
  push handler's decision) gave `call reported`, a new ring. A call declined through a `CXEndCallAction` (or
  ended by the Simulator itself within 60 ms, which reaches the app the same way) gave `repeat of an ended call
  reported and ended`. A 0.2 s ring timeout lost the race to the Simulator's own end, so that call counted as
  declined: on this Simulator a missed call can only be produced with a zero timeout.

### Tests

- `packages/schema`: `incident.ack` (event, first ack wins, legacy rows, inactive incidents, not found, invalid args,
  viewer forbidden, client and server agree) and the permission table.
- `apps/relay`: calls go to the `.voip` topic as `voip` pushes with only the call id and envelope, expire after a
  minute, and every call the app could not ring for (no or bad UUID, not a page, try-once, over 5 minutes, a call id
  on an alert, an unknown kind) is a `400` that never reaches APNs.
- `packages/push`: the incident id round-trips through the envelope.
- `packages/schema` also: reopening clears the ack, client and server agree on it.
- `apps/mobile` (second review): `knownCall` for every end reason inside and outside the memory, the memory equal
  to the relay's maximum call TTL, `fallbackChannel` against `decideRoute` for every combination that rings, the
  Kotlin and Swift copies of the reasons, memory and branches, the three Kotlin fallbacks going through
  `notifyFallback`, the Android timers keyed and checked by call instance, and the Swift handler reporting before
  any return in each `report*` function, completing once from the `defer` in CallKit's callback (a check of the
  source, not of behaviour). The JVM tests gained the same rules (12 tests, run by hand).
- `apps/mobile`: the call session (the script in both languages, one ack for two presses, conflict as success,
  retry after failure, no ack without an incident, hang up once, a key pressed before JavaScript listened), the
  paging decisions (`call-route.test.ts`: the Android route table, every VoIP push reported, the maximum call
  length, each checked against the Kotlin and Swift copies), the plugin (Android strings from the catalog,
  escaping, `voip` background mode), and the Kotlin route table again (JVM, run by hand as above).

### Building locally

No EAS cloud build was used. From `apps/mobile`:

```bash
bunx expo prebuild --platform android --no-install
ANDROID_HOME=$HOME/Library/Android/sdk ./android/gradlew -p android :app:assembleDebug
ANDROID_HOME=$HOME/Library/Android/sdk ./android/gradlew -p android :brigade-call:testDebugUnitTest
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081 && adb reverse tcp:<sync port> tcp:<sync port>
EXPO_PUBLIC_BRIGADE_SYNC_URL=ws://localhost:<sync port>/api/sync REACT_NATIVE_PACKAGER_HOSTNAME=localhost \
  bunx expo start --dev-client
adb shell am broadcast -a app.freecorps.brigade.call.DEBUG_RING \
  -n app.freecorps.brigade/app.freecorps.brigade.call.DebugCallReceiver \
  --es title "'SEV1 · Checkout API down'" --es body "'502s from payments.'" --es incident <incident id>

export DEVELOPER_DIR=/Applications/Xcode-27.0.0-Beta.6.app/Contents/Developer
bunx expo prebuild --platform ios
xcodebuild -workspace ios/Brigade.xcworkspace -scheme Brigade -configuration Debug \
  -destination 'id=<simulator udid>' -derivedDataPath <dir> build
xcrun simctl install booted <dir>/Build/Products/Debug-iphonesimulator/Brigade.app
xcrun simctl launch booted app.freecorps.brigade --initialUrl http://127.0.0.1:8081 \
  -BrigadeTestCall "SEV2 · Search latency" -BrigadeTestCallIncident <incident id> \
  -BrigadeTestCallAnswer YES -BrigadeTestCallAck YES
xcrun simctl spawn booted log show --last 5m --info --predicate 'subsystem == "app.freecorps.brigade"'
```

`<sync port>` was not 5173 because another checkout's dev server held it: `vp dev --port <sync port>` in
`apps/web`.

## Left for the phones

On an iPhone (needs the Freecorps Apple team):

1. Enable **VoIP Services** (Push Notifications) on the `app.freecorps.brigade` App ID, register the phone and build
   with automatic signing (`APPLE_TEAM_ID`, `-destination 'generic/platform=iOS' -allowProvisioningUpdates`, as in
   the S1 write-up).
2. Read the PushKit token from `/call-test` and send a call: `send-test-push.ts <voip token> <public key> <title>
   <body> call <incident id>`. With the phone **locked**: CallKit's full-screen incoming call shows the decrypted
   title.
3. Answer: the incident is read aloud through the earpiece; press **1** on CallKit's keypad without unlocking and
   check the shard records the ack; then the confirmation is spoken and the call ends.
4. Decline, and let one ring out (60 s): both end without an ack.
5. Kill the app, send a call: PushKit relaunches it in the background and it still rings.
6. Turn on a Focus that blocks calls and check what CallKit does (rings, or refuses and the time-sensitive
   fallback appears). Repeat with the phone in Portuguese.

On an Android phone (needs FCM, or the debug broadcast over USB):

1. Install the debug build, lock the phone with a PIN, and ring with the broadcast: ringtone, vibration, the
   ringing screen over the keyguard; Answer, hear the incident through the earpiece and a Bluetooth headset;
   acknowledge.
2. Revoke "full-screen notifications" in the app's settings and ring again: the page notification with the alarm
   sound. Turn on Do Not Disturb and check `brigade_pages` with "override Do Not Disturb".
3. Ring during a cellular call: Telecom's handling of the self-managed call (or the fallback).
4. With FCM set up: a high-priority data message from the relay, app killed, Doze (`adb shell dumpsys deviceidle
   force-idle`).

## Open questions

- **The voice bot.** This spike's call is the phone talking to itself. RFC 0010's case for App Review is a real
  audio session (Cloudflare Realtime) with server-side TTS and STT; until then, is "the incident read on the phone,
  press 1" enough for App Review to accept PushKit and CallKit? Ship the alert push alone until the bot exists?
- **A call the system ends at once.** On the Simulator, CallKit ended a call it had accepted within a second; it is
  now `failed`, so a repeat rings. Whether it should also post the fallback notification is Q14 in
  `docs/open-questions.md`; a device shows which real cases look like that.
- **Over the lock screen.** On Android, the React Native app is shown over the keyguard while the call lasts, with
  Back disabled; a native in-call activity would expose less. Decide before release.
- **Native tests in CI.** The decisions are tested in TypeScript and the native copies checked by text; a native
  CI job (Gradle unit tests, a macOS runner for Swift) would test the native code itself. Worth it once the
  module grows past a few decisions.
- **Who may ack.** Any member with `incident:ack` can acknowledge, not only the page's targets; escalation runs
  decide whether that stays.
- **Ack over HTTPS.** RFC 0004 sends paging actions from notifications over plain HTTPS because iOS suspends
  sockets in the background. During a CallKit call the app runs, so the socket worked here; a keypad ack from a
  cold launch may need the HTTPS path.
- **Ack per escalation run.** `incident.ack` lives on the incident until escalation runs exist; then it moves to the
  run, and "a second ack is a conflict" becomes per run.
- **Play's full-screen intent declaration** and **Core-Telecom** (see Decisions).
- **One VoIP token per device**, registered with the relay next to the APNs and FCM tokens; the device registration
  (RFC 0006) needs a field for it and for the route the phone reports (`ring`, `notify`, `blocked`).

## Resources created

- Redeployed the Worker `brigade-relay-dev` (workers.dev, the `dev` environment of `apps/relay/wrangler.jsonc`) with
  `kind: "call"`, from the existing secrets file. Nothing new was created on Cloudflare.
- Nothing on the Apple team or in Firebase: Simulator builds are signed ad hoc, and FCM is not set up.
