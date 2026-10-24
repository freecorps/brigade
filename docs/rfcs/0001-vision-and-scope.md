# RFC 0001 — Vision and scope

- Status: Draft
- Authors: Freecorps

## Problem

Incident management platforms (incident.io, PagerDuty, Rootly, FireHydrant) charge per user per month.
For a company where everyone on engineering may need to be paged, declare or follow an incident,
seat-based pricing gets expensive fast — even though the underlying workload is small.

Existing open-source tools cover only parts of the problem:

| Project                 | Covers                                       | Gap                                               |
| ----------------------- | -------------------------------------------- | ------------------------------------------------- |
| OneUptime               | Monitoring, status pages, incidents, on-call | Heavy to operate (Kubernetes, multiple databases) |
| Dispatch (Netflix)      | Slack-centric incident response              | Heavy, no monitoring, no mobile app               |
| GoAlert (Target)        | On-call scheduling and escalation            | No incident workflow                              |
| Grafana OnCall OSS      | On-call                                      | Archived by Grafana                               |
| Uptime Kuma, OpenStatus | Monitoring and status pages                  | No incident workflow, no on-call                  |

Nothing is **light, Cloudflare-native, open source and mobile-first**.

## Vision

**Freecorps Brigade** is an open-source incident management platform that deploys to a single
Cloudflare account and ships with first-class mobile apps.

- One `deploy` to a Cloudflare account (Workers, Durable Objects, D1, Queues, R2). No servers.
- Real-time everywhere: web dashboard and mobile app stay in sync live (see RFC 0004).
- Pager-grade mobile notifications on iOS and Android, without self-hosters needing Apple or Google accounts (see RFC 0006).
- Open integration model: alerts in, chat out, notifications out, all through documented interfaces (see RFC 0005).
- Internationalized from day one (see RFC 0008).

## Goals (v1)

1. **Monitors** — multi-region HTTP/TCP/keyword/TLS checks with quorum-based alerting.
2. **Alerts** — ingest webhooks (own monitors, Grafana, Datadog, Sentry, generic), deduplicate and group.
3. **Incidents** — declare, severity, status, roles (lead, comms, ...), custom fields, timeline, updates.
4. **On-call** — schedules, rotations, overrides, escalation policies with acknowledgement timeouts.
5. **Notifications** — push (iOS/Android), Slack, email; SMS/voice as a final escalation step.
6. **Slack** — `/inc` to declare, auto-created incident channel, timeline sync.
7. **Mobile app** — incident list, ack/escalate/resolve, on-call view, notification actions.
8. **Post-incident** — follow-ups (action items), postmortem draft generated from the timeline (Workers AI).
9. **Status page** — public page per workspace, subscriptions by email.

## Non-goals (v1)

- Full parity with incident.io. We focus on the daily loop: **detect → page → coordinate → communicate → learn**.
- Offline-first editing on mobile (read-only offline cache + queued mutations is enough, see RFC 0004).
- Running outside Cloudflare. The architecture leans on Durable Objects; portability is not a v1 goal.
- Chat platforms other than Slack (the interface exists; Teams/Discord/Mattermost come later).
- APM/logs/metrics. Brigade consumes alerts from those tools; it does not replace them.

## Principles

1. **Paging must be boring.** Every path that wakes someone up has a fallback and a test.
2. **Server is the source of truth.** Clients are optimistic, never authoritative (RFC 0004).
3. **One event stream.** Every state change emits a domain event; Slack, push, webhooks and the audit log all consume it.
4. **Public API only.** The web and mobile apps use the same documented API that third parties use.
5. **Self-hosting is a first-class citizen.** Anything the hosted version uses must work for a self-hoster.
