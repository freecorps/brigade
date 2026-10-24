# Open questions

Decisions we still need to make. Each one links to the RFC it affects. Once decided, the answer moves to the
"Decided" section below and into the RFC.

## Q2 — Multi-tenancy (RFC 0002, 0003)

Design multi-workspace from day one (needed for a hosted offering and for agencies), even if self-hosters use one?
Proposal: yes — the cost is a `workspaceId` on every key, which DO sharding gives us almost for free.

## Q3 — Backups and data export (RFC 0002)

DO SQLite has point-in-time recovery (30 days), but self-hosters will want exports they control.
Proposal: nightly export of each DO to R2 (JSON/SQLite dump) + "export workspace" in the UI.

## Q4 — Socket topology (RFC 0004)

One WebSocket per shard (simple, more connections) vs a gateway DO per client session multiplexing shards
(fewer sockets on mobile, extra hop). Decide after spike S3.

## Q7 — PSTN provider in Brazil (RFC 0010)

In-app VoIP covers most voice paging. For the optional PSTN step (phone without data), compare Twilio with local
providers (Zenvia, others). Keep the `Notifier` interface provider-agnostic.

## Q8 — Critical Alerts entitlement (RFC 0006)

Owner: Freecorps Apple developer account holder. Apply as soon as the bundle ID exists; mention on-call paging
(PagerDuty/Opsgenie precedent).

## Q9 — i18n library (RFC 0008)

i18next vs Lingui vs Paraglide — must work in Workers, React web, TanStack Start (site) and Hermes (React Native).

## Q11 — Task runner (RFC 0002)

We started with Vite+'s built-in task runner (`vp run`) instead of Turborepo because it already provides caching,
`dependsOn` and filtering. Confirm, or add Turborepo if we need its remote cache.

## Q12 — CLA and legal review (RFC 0009)

Which CLA text, who reviews it, and when. Blocks external contributions and the store release.

---

# Decided

| #   | Question               | Decision                                                                                                      |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| Q1  | Authentication         | **Better Auth** (Workers + D1, Expo client). Already used in other Freecorps projects.                        |
| Q5  | Web/mobile UI sharing  | Share logic (`schema`, `sync`, `i18n`, tokens), not components. Web: **React + TanStack Router + shadcn/ui**. |
| Q6  | Slack app distribution | App manifest for self-hosters; Freecorps-published Slack app for the hosted version.                          |
| Q10 | Site and docs          | **Fumadocs on TanStack Start** (Vite-based, i18n support), prerendered and served by Workers static assets.   |
| Q7a | Voice paging           | In-app VoIP call screen with a real audio session (RFC 0010); PSTN only as optional last step.                |
