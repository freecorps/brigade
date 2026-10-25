# Spike S3 — Sync engine prototype

- Status: Done
- Roadmap: Phase 0, S3
- Settles: RFC 0004's shard server ("Shard server", written during S3), the client ("Clients": one client and
  hooks for web and Hermes) and open question Q5 (share logic, not components)

## Question

Does Brigade Sync, our own engine (RFC 0004, "Why not an existing engine"), keep several clients on one workspace in
step through a Durable Object? The pass criterion: two browser tabs and one Expo client stay in sync, and a client
that reconnects resumes from the last version it had instead of downloading everything again.

## What was built

| Piece                                                                                           | Where                          | PR      |
| ----------------------------------------------------------------------------------------------- | ------------------------------ | ------- |
| Shared core: tables, named mutations with RBAC, queries, the row store, validators              | `packages/schema`              | #11     |
| The client: wire protocol, optimistic store, reconnect and resume, React hooks                  | `packages/sync`                | #13     |
| The shard: `WorkspaceDO` serving `/sync/<workspace>`, change log, resume, de-duplication, epoch | `apps/api`                     | #14     |
| `useConnectionState`, and the hooks mounted in a test                                           | `packages/sync`                | #17     |
| The dashboard's live incident list: declare, status and severity, connection states             | `apps/web`                     | #19     |
| The same list in the Expo app; `syncView` moved to `packages/sync` for both apps                | `apps/mobile`, `packages/sync` | this PR |

The mobile screen is the app's home: the active list from `useQuery("incidents.active", {})` with number (or
"Saving" / "Not sent" before the shard numbers it), title, severity and status badges and the declared time; a
declare form (title, severity defaulting to SEV3, "Declare SEV3"); and per row, the severity and status badges are
buttons. Tapping one opens the system action sheet on iOS (`ActionSheetIOS`) and a plain dialog on Android, which
React Native has no native list dialog for. Status offers only the moves `canTransition` allows, and a pick is
checked again against the latest rows when it is made (`pickTarget`): nothing is sent if the incident left the list,
already has that value, or can no longer move there. A refused change rolls back on its own and leaves a translated
message in its row, announced to VoiceOver on iOS; a declare refused for its title gives the title back to an
empty field, as the dashboard does. The connection reads as a word and a small glyph
(Live, Connecting…, Reconnecting…, Sync unavailable, Not loaded), from the same `syncView` the dashboard uses.

The app has one `SyncClient` at module scope. Its URL is `ws://<Metro host>:5173/api/sync/demo` in development,
from Expo's `hostUri` (development builds only), or `EXPO_PUBLIC_BRIGADE_SYNC_URL`. Ids come from `client.newId("inc")` with `expo-crypto`'s
random bytes, and the optimistic actor mirrors the shard's dev actor, tied by a test. The client id is per launch:
pending mutations live in memory, so a per-install id would buy nothing until they are persisted.

One dependency was added: `expo-crypto`, because Hermes has no `crypto.getRandomValues`. No UI library: the action
sheet is React Native's own.

## Result

It passes. Run on 2026-10-25 with `vp run dev` (dashboard, web Worker, API Worker and `WorkspaceDO` on
`localhost:5173`), two Chromium contexts on the dashboard (Playwright), the development build on the iPhone 17
Simulator (iOS 27.0) and on an Android emulator (API 36, arm64, Pixel 8 profile). The shard started empty, at
epoch `ep_01M5RSC1JZ50BN9MMDNXX4C9B5`, version 0. Frames were read from the browser's WebSocket events and, on
the phones, from a temporary logging transport (`createSyncClient({ transport })`) printing to Metro, not committed.

### Four clients on one shard

| Version | Change                                           | Made from                 | Seen by                        |
| ------- | ------------------------------------------------ | ------------------------- | ------------------------------ |
| 1–3     | Declare INC-1 (SEV2), INC-2 (SEV1), INC-3 (SEV4) | web tab A (the form)      | tab B and iOS, one patch each  |
| 4       | INC-1 → Investigating                            | iOS (`client.mutate`)     | both tabs                      |
| 5–6     | INC-3 → SEV2, INC-2 → Investigating              | web tab B (the menus)     | tab A; iOS on resume (below)   |
| 7       | INC-3 → SEV3                                     | Android (`client.mutate`) | both tabs and iOS              |
| 8       | Declare INC-4 (SEV2)                             | web tab A                 | iOS; Android on resume (below) |
| 9       | INC-4 → Investigating                            | web tab B                 | tab A, iOS and Android         |

Each change reached every connected client as one `patch` frame for its version. At version 9 the two tabs, the
Simulator and the emulator showed the same four incidents in the same order, with the same badges
(`clients-side-by-side.png`).

The mobile changes in this table went through the app's `SyncClient` (`client.mutate`, the function `useMutation`
returns), driven from the host because taps cannot be injected on this Simulator runtime (S4, "How it was
driven").

A second run after review (a fresh shard) used real taps on the Android emulator (`adb shell input`): the status
badge opened the dialog with its Cancel row (`android-status-dialog.png`), picking Investigating sent
`incident.setStatus` and the dashboard showed it at version 7, a tap on the backdrop closed a second dialog with
nothing sent, and typing a title and pressing return declared INC-5 (version 8), which the dashboard and the
Simulator listed.

### Resume

The temporary transport closed the socket and refused new ones for a set time, while the dashboard changed
things:

- **iOS.** Holding version 4, the socket was dropped for 30 s. Tab B made versions 5 and 6. The app showed
  "Reconnecting…" over the last list it had (`ios-incidents-reconnecting.png`); the client's retries, with
  backoff, were refused until the 30 s were up. Then it sent `subscribe … version=4 epoch=ep_01M5RSC1JZ50BN9MMDNXX4C9B5` and received
  `patch version=6` with two upserts: no snapshot.
- **Android.** Holding version 7, dropped for 25 s; tab A declared INC-4 (version 8). On reconnect it sent
  `subscribe … version=7` with the same epoch and received `patch version=8` with one upsert.
- **Nothing changed.** A later iOS drop at version 9 resumed with `subscribe … version=9` and got an empty patch
  (`version=9`, no rows).

A new process starts from nothing, as designed: each cold launch subscribed without a version and got a snapshot
(version 0 empty, then version 4 with 3 rows and version 9 with 4 rows).

### A refused change

Staged in the second run with temporary code. The Simulator's socket was dropped while INC-3 was in Triage; tab B
moved it to Investigating. The app, still showing Triage, then picked Declined through the screen's own pick
handler (the one the action sheet calls), which allowed it from the stale view and queued it. On reconnect the
shard refused it with `invalid_transition`; the row rolled back to Investigating and read "Couldn't move it to
Declined. Its status changed in the meantime, so that move is no longer allowed." (`ios-incidents-refused.png`).
The same pick sent again once the app was live sent nothing: the pick-time check saw Investigating.

### Screens

Screenshots are attached to the pull request, not committed. Each was checked by eye:
`ios-incidents-{light,dark}-{en,pt-BR}`, `android-incidents-{light,dark}-{en,pt-BR}`, `ios-incidents-empty`
(version 0: "All clear."), `ios-incidents-reconnecting`, `ios-incidents-refused`, `android-status-dialog`,
`clients-side-by-side`, and three at `accessibility-extra-extra-extra-large`: `ios-incidents-dynamic-type-xxxl`
(the top), `-rows` (rows: text wraps, badges stack one per line, nothing clips) and `-sev1` (the whole Declare
button above the SEV1 row). On the iPhone 17 at that size the two together are taller than the screen, so the
SEV1 badge's last few points run off the bottom edge in `-sev1`. The glyphs keep their fixed size, as in S4.

What needed a decision or a workaround:

- **Which host.** The dashboard's dev server listens on `localhost` only (IPv6 `::1` here). `expo run:*` puts
  Metro's LAN address in `hostUri` unless `REACT_NATIVE_PACKAGER_HOSTNAME=localhost` is set. With it, the
  Simulator reaches `localhost:5173` directly and the emulator through `adb reverse tcp:5173 tcp:5173`, which
  reached the IPv6-only listener without change. LAN mode and physical devices would need the dev server on the
  LAN (`apps/mobile/README.md`).
- **What is shared, and what is duplicated for now.** `syncView` and `nextFailed` moved to `packages/sync`: pure
  functions of the query status and the socket state, used by both apps (the dashboard re-exports them). The
  helpers that word a refused change (the error-reason table, the per-kind sentences, the relative age) use the
  same `packages/i18n` messages but are duplicated in `apps/web/src/lib/incidents.ts` and
  `apps/mobile/src/lib/incidents.ts`; moving them to a shared place is tracked in #20.
- **Three new messages**: the app's "keeps trying" and offline hints (the dashboard's say "this page") and the
  hint for the badge buttons.

## What was not verified

- **Taps on iOS.** The iOS action sheet and the iOS declare form were not operated or seen on screen (no tap
  injection on this Simulator runtime); the Android dialog and form were tapped (above).
- **VoiceOver.** The announcement of a refused change was not listened to.
- **Physical devices and LAN mode.** Only the Simulator and the emulator, both on the Mac's `localhost`.
- **Auth.** Every socket is the dev actor (`SYNC_DEV_ACTOR`); refusals for permissions were not exercised end to
  end.
- **Background and suspension.** A suspended iOS app, a killed app with pending changes, and the `expo-sqlite`
  cache RFC 0004 plans for mobile are outside S3.
- **Epoch rotation on a phone.** Covered by `apps/api` tests, not run against a device.

## Decision

Keep Brigade Sync as designed in RFC 0004. The same client and hooks run in the browser and on Hermes; React
Native only passes `randomBytes`. Client ids stay per tab and per launch until pending mutations are persisted,
then both become stable together (RFC 0004, "Clients").
