# Roadmap

Rough sizing assumes 1–2 developers. Each phase ends with something usable internally at Freecorps.

## Instructions for the manager

Run this with the `manager` skill ("use the manager skill and work through `docs/roadmap.md`").

- Work **top to bottom**: take the first unchecked item that is not blocked on Heitor. Re-read this file before each task; Heitor steers by
  editing it (reordering, adding detail, adding items).
- The PR that completes an item ticks its checkbox (`- [x]`). A partly done item stays unchecked, with a
  sub-bullet saying what is left.
- Spikes end with a write-up in `docs/spikes/<id>-<slug>.md` (question, what was tried, result, decision) and
  update the RFC or `docs/open-questions.md` they settle, in the same PR.
- Items marked as needing Heitor (credentials, accounts, deploys) are prepared as far as possible, then he is
  asked; meanwhile, continue with the next unblocked item.
- Stop at the end of each phase and report, so Heitor can review the phase before the next one starts.

## Phase 0 — Spikes (1–2 weeks)

Validate the risky assumptions before writing product code. Each spike produces a short write-up in
`docs/spikes/` and updates the RFC or open question it settles.

- [x] **S5 — Tooling skeleton.** Pass: `vp dev` runs the SPA and the Worker (with a Durable Object) locally;
      `vp check`, `vp run -r test` and `vp run -r build` pass in CI.
  - `apps/api`: Worker + one Durable Object, `wrangler.jsonc`, Cloudflare Vite plugin under Vite+.
  - `apps/web`: React + TanStack Router + Tailwind + shadcn/ui (`shadcn init`), light and dark themes from day one.
  - `packages/ui`: design tokens (color, spacing, type, radius, motion) consumed by `apps/web`; shadcn restyled to them.
  - `packages/i18n`: Paraglide with `en` and `pt-BR`, wired into `apps/web`.
- [x] **S3 — Sync engine prototype** (RFC 0004). Pass: two browser tabs and one Expo client stay in sync;
      reconnect resumes from the last version.
  - One `WorkspaceDO` with `subscribe` / `mutate` / `resume`; `packages/sync` with `useQuery` / `useMutation`.
  - Two dashboard tabs, the iOS Simulator and the Android emulator stayed in sync on one shard, and dropped iOS
    and Android sockets resumed from their last version with a patch ([write-up](spikes/s3-sync-engine.md)).
- [ ] **S4 — Expo in the workspace.** Pass: development build runs on the iOS Simulator importing `packages/*`
      through Metro; `eas build` succeeds (needs Heitor's EAS account); Hermes `Intl.PluralRules`,
      `RelativeTimeFormat` and `dateStyle`/`timeStyle` checked (polyfill if missing); Hermes regex Unicode
      property escapes checked (`UNICODE_PROPERTY_ESCAPES` from `packages/schema` is `true`, RFC 0004).
  - Done on Android: `apps/mobile` development build on the emulator, `packages/*` from source through Metro,
    Hermes `Intl` checked and polyfilled, regex Unicode property escapes supported (`UNICODE_PROPERTY_ESCAPES`
    is `true`; an emoji title is accepted, a zero-width space rejected) ([write-up](spikes/s4-expo-workspace.md)).
  - Done on iOS: development build on the iPhone 17 Simulator (iOS 27), the same `Intl` results and regex
    property escapes as Android, except that a medium date and time are joined with " at " instead of ", "; the
    launch screen now uses the splash ground ([write-up](spikes/s4-expo-workspace.md)).
  - eas build pending (needs Heitor's EAS account).
- [ ] **S2 — Probe placement** (RFC 0007). Pass: observed colo per `locationHint` over 48h (deploy needs Heitor's approval).
- [ ] **S1 — APNs from a Worker and payload encryption** (RFC 0006). Pass: push received on a real iPhone from a
      Worker, decrypted in the Notification Service Extension (needs Apple credentials and a device).
- [ ] **S6 — VoIP call screen** (RFC 0010). Pass: locked iPhone and Android ring natively; answering plays the
      incident and accepts "ack" (needs Apple credentials and devices).

## Phase 1 — Core loop (4–6 weeks)

- [ ] Auth (Better Auth), workspaces, members
- [ ] Monitors (HTTP/TCP/heartbeat) with quorum → alerts → incidents
- [ ] Incidents: declare, severity, status, roles, timeline, updates
- [ ] Brigade Sync in production for web + mobile
- [ ] Web dashboard: incident list/detail, monitors
- [ ] Mobile: login, incident list/detail, push via relay, ack from notification
- [ ] Event outbox + queue + push notifier
- [ ] External dead-man switch
- [ ] i18n plumbing (en, pt-BR)

## Phase 2 — On-call (4–6 weeks)

- [ ] Schedules, rotations, overrides; escalation policies with timeouts
- [ ] Slack app: `/inc`, incident channels, timeline mirror, ack buttons
- [ ] Email notifier; in-app VoIP call paging (RFC 0010); optional PSTN notifier (provider-agnostic)
- [ ] Mobile: on-call view, "I'm on call" widget, critical/time-sensitive notification setup
- [ ] Delivery receipts and "why wasn't I paged" debugging view

## Phase 3 — Parity where it matters (6–8 weeks)

- [ ] Alert sources: Grafana, Datadog, Sentry, generic webhook; alert routes
- [ ] Service catalog; custom fields; incident types; role definitions
- [ ] Follow-ups; postmortem draft with Workers AI; exports to R2
- [ ] Public status page with email subscriptions
- [ ] Outbound webhooks; OpenAPI reference; `packages/sdk` published

## Phase 4 — Open source launch (ongoing)

- [ ] One-command self-host deploy + setup wizard (Slack manifest, relay registration)
- [ ] Hosted push relay with terms of service
- [ ] App Store / Play Store release (after CLA is in place)
- [ ] Public site + docs (en, pt-BR); contribution guide; community translations
- [ ] More chat providers (Teams, Discord, Mattermost), UnifiedPush
