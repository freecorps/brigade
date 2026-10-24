# Freecorps Brigade

**Open-source incident management that deploys to your Cloudflare account.**
Monitors, alerts, on-call, incidents, Slack and native mobile apps — without per-seat pricing.

> 🚧 **Early design phase.** Nothing here is usable yet. Read the plans in [`docs/`](docs/) and join the discussion.

[Português (Brasil)](README.pt-BR.md)

## What it will do

- **Monitors** from multiple regions with quorum-based alerting
- **Alerts** from your own monitors and tools like Grafana, Datadog and Sentry, deduplicated and routed
- **Incidents** with severity, status, roles, custom fields and a live timeline
- **On-call** schedules, overrides and escalation policies
- **Mobile apps** (iOS/Android) with pager-grade notifications and ack from the lock screen
- **Slack** to declare and run incidents where your team already talks
- **Status pages** and **postmortems** (with AI-drafted summaries)
- **Real-time sync** across web and mobile
- **Internationalized** from day one (English, Português)

## How it works

Brigade runs entirely on Cloudflare: Workers, Durable Objects (real-time state and sync), D1, Queues and R2.
See [RFC 0002 — Architecture](docs/rfcs/0002-architecture.md).

## Docs

- [Vision and scope](docs/rfcs/0001-vision-and-scope.md)
- [Architecture](docs/rfcs/0002-architecture.md)
- [Domain model](docs/rfcs/0003-domain-model.md)
- [Sync engine](docs/rfcs/0004-sync-engine.md)
- [Events and integrations](docs/rfcs/0005-events-and-integrations.md)
- [Push notifications and relay](docs/rfcs/0006-push-relay.md)
- [Monitoring](docs/rfcs/0007-monitoring.md)
- [Internationalization](docs/rfcs/0008-i18n.md)
- [Licensing and governance](docs/rfcs/0009-licensing-and-governance.md)
- [Voice paging](docs/rfcs/0010-voice-paging.md)
- [Roadmap](docs/roadmap.md) · [Open questions](docs/open-questions.md)

## Development

Requires [Vite+](https://viteplus.dev) (`vp`). Bun is the package manager (pinned in `package.json`).

```bash
vp install          # install dependencies
vp check            # format, lint, type check
vp run -r test      # run tests in every package
vp run -r build     # build every package
```

## License

Applications are licensed under [AGPL-3.0](LICENSE). Packages under `packages/` are MIT.
See [RFC 0009](docs/rfcs/0009-licensing-and-governance.md).

"Freecorps" and "Freecorps Brigade" are trademarks of Freecorps Tecnologia da Informação LTDA.
