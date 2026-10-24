# Roadmap

Rough sizing assumes 1–2 developers. Each phase ends with something usable internally at Freecorps.

## Phase 0 — Spikes (1–2 weeks)

Validate the risky assumptions before writing product code. Each spike produces a short write-up in `docs/spikes/`.

| ID  | Question                                                                                                        | Pass criteria                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| S1  | Can a Worker deliver to APNs (HTTP/2)? Which payload encryption works in Workers + iOS NSE + Android?           | Push received on a real iPhone from a Worker, decrypted in the NSE                      |
| S2  | Do `ProbeDO`s with `locationHint` actually land in the hinted regions?                                          | Observed colo per hint over 48h                                                         |
| S3  | Sync engine prototype: one `WorkspaceDO`, `subscribe` + `mutate` + resume, React hook                           | Two browsers + one Expo client stay in sync; reconnect resumes                          |
| S4  | Expo (dev build) in the Bun workspace, importing `packages/*` through Metro                                     | `eas build` succeeds with workspace packages                                            |
| S5  | Cloudflare Vite plugin under Vite+ for `apps/api` and `apps/web`                                                | `vp dev` runs Worker + DOs + SPA locally                                                |
| S6  | VoIP call screen (RFC 0010): PushKit/CallKit + Android ConnectionService in Expo, audio via Cloudflare Realtime | Locked iPhone and Android ring natively; answering plays the incident and accepts "ack" |

## Phase 1 — Core loop (4–6 weeks)

- Auth (Better Auth), workspaces, members
- Monitors (HTTP/TCP/heartbeat) with quorum → alerts → incidents
- Incidents: declare, severity, status, roles, timeline, updates
- Brigade Sync in production for web + mobile
- Web dashboard: incident list/detail, monitors
- Mobile: login, incident list/detail, push via relay, ack from notification
- Event outbox + queue + push notifier
- External dead-man switch
- i18n plumbing (en, pt-BR)

## Phase 2 — On-call (4–6 weeks)

- Schedules, rotations, overrides; escalation policies with timeouts
- Slack app: `/inc`, incident channels, timeline mirror, ack buttons
- Email notifier; in-app VoIP call paging (RFC 0010); optional PSTN notifier (provider-agnostic)
- Mobile: on-call view, "I'm on call" widget, critical/time-sensitive notification setup
- Delivery receipts and "why wasn't I paged" debugging view

## Phase 3 — Parity where it matters (6–8 weeks)

- Alert sources: Grafana, Datadog, Sentry, generic webhook; alert routes
- Service catalog; custom fields; incident types; role definitions
- Follow-ups; postmortem draft with Workers AI; exports to R2
- Public status page with email subscriptions
- Outbound webhooks; OpenAPI reference; `packages/sdk` published

## Phase 4 — Open source launch (ongoing)

- One-command self-host deploy + setup wizard (Slack manifest, relay registration)
- Hosted push relay with terms of service
- App Store / Play Store release (after CLA is in place)
- Public site + docs (en, pt-BR); contribution guide; community translations
- More chat providers (Teams, Discord, Mattermost), UnifiedPush
