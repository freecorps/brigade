# Open questions

Decisions we still need to make. Each one links to the RFC it affects. Move to the RFC once decided.

## Q1 — Authentication (RFC 0002)

Self-hosters need auth that works without external services; the hosted version wants SSO.
Options: Better Auth (runs on Workers + D1, has Expo support), roll our own (passkeys + email magic link + OIDC),
Cloudflare Access (simple, but ties identity to Cloudflare Zero Trust and is awkward for mobile).
Mobile login flow: OAuth/OIDC with PKCE via system browser, plus QR pairing from the web dashboard.

## Q2 — Multi-tenancy (RFC 0002, 0003)

Design multi-workspace from day one (needed for a hosted offering and for agencies), even if self-hosters use one?
Proposal: yes — the cost is a `workspaceId` on every key, which DO sharding gives us almost for free.

## Q3 — Backups and data export (RFC 0002)

DO SQLite has point-in-time recovery (30 days), but self-hosters will want exports they control.
Proposal: nightly export of each DO to R2 (JSON/SQLite dump) + "export workspace" in the UI.

## Q4 — Socket topology (RFC 0004)

One WebSocket per shard (simple, more connections) vs a gateway DO per client session multiplexing shards
(fewer sockets on mobile, extra hop). Decide after spike S3.

## Q5 — Web and mobile UI sharing (RFC 0002)

Share data/hooks only (`schema`, `sync`, `i18n`, design tokens) and build UI natively per platform
(React + Vite on web, React Native on mobile)? Or Expo for web too? Proposal: share logic, not components.
Web UI stack to pick: React + TanStack Router/Query? Component library (shadcn/ui, Radix, Ark)?

## Q6 — Slack app distribution (RFC 0005)

Each instance creates its own Slack app from a manifest (fully self-hosted, a few manual steps)
vs a Freecorps-published Slack app that routes to instances (one-click, but central — same problem as push).
Proposal: manifest for self-hosters; published app for the hosted version.

## Q7 — SMS/voice in Brazil (RFC 0005)

Twilio works but is expensive for BR numbers; local providers (Zenvia, TotalVoice/Vonage) may be cheaper.
Keep the `Notifier` interface provider-agnostic and pick the first implementation by cost.

## Q8 — Critical Alerts entitlement (RFC 0006)

Apply to Apple early (it can take weeks and may be denied). Who at Freecorps owns the Apple developer account?

## Q9 — i18n library (RFC 0008)

i18next vs Lingui vs Paraglide — must work in Workers, React web and Hermes (React Native).

## Q10 — Site and docs generator (RFC 0008)

Needs i18n routing and to build with Vite+: VitePress (Vite-native, built-in i18n), Astro (Vite-based, Starlight docs),
or a hand-rolled Vite SPA. Proposal: Astro + Starlight, if it builds cleanly under Vite+ (otherwise VitePress).

## Q11 — Task runner (RFC 0002)

We started with Vite+'s built-in task runner (`vp run`) instead of Turborepo because it already provides caching,
`dependsOn` and filtering. Confirm, or add Turborepo if we need its remote cache.

## Q12 — CLA and legal review (RFC 0009)

Which CLA text, who reviews it, and when. Blocks external contributions and the store release.
