# Open questions

Decisions we still need to make. Each one links to the RFC it affects. Once decided, the answer moves to the
"Decided" section below and into the RFC.

## Q8 — Critical Alerts entitlement (RFC 0006)

Owner: Freecorps Apple developer account holder. Apply as soon as the bundle ID exists; mention on-call paging
(PagerDuty/Opsgenie precedent).

## Q13 — PSTN provider choice (RFC 0010)

The `VoiceProvider` contract is defined; pick the first implementation by price for Brazilian numbers
(Twilio vs local providers) once Phase 2 starts.

---

# Decided

| #   | Question               | Decision                                                                                                                    |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Authentication         | **Better Auth** (Workers + D1, Expo client). Already used in other Freecorps projects.                                      |
| Q2  | Multi-tenancy          | Multi-workspace from day one: workspace = Better Auth organization, with teams and roles (RFC 0003).                        |
| Q3  | Backups                | Nightly export of every DO to R2 + "export workspace" in the UI. A restore rotates the shard epoch (RFC 0004).              |
| Q4  | Socket topology        | One WebSocket per shard behind a client connection pool; `SessionDO` gateway as upgrade path (RFC 0004).                    |
| Q5  | Web/mobile UI sharing  | Share logic (`schema`, `sync`, `i18n`, tokens), not components. Web: React + TanStack Router + shadcn/ui. Held in spike S3. |
| Q6  | Slack app distribution | App manifest for self-hosters; Freecorps-published Slack app for the hosted version.                                        |
| Q7  | Voice paging           | In-app VoIP call screen with real audio; PSTN as optional last step via provider-agnostic `VoiceProvider` (RFC 0010).       |
| Q9  | i18n library           | **Paraglide JS** (RFC 0008).                                                                                                |
| Q10 | Site and docs          | **Fumadocs on TanStack Start**, prerendered, served by Workers static assets.                                               |
| Q11 | Task runner            | Vite+ `vp run`, no Turborepo.                                                                                               |
| Q12 | CLA                    | Handled by Freecorps; CLA Assistant + standard CLA text reviewed by counsel.                                                |
