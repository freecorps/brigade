# Open questions

Decisions we still need to make. Each one links to the RFC it affects. Once decided, the answer moves to the
"Decided" section below and into the RFC.

## Q8 — Critical Alerts entitlement (RFC 0006)

Owner: Freecorps Apple developer account holder. The bundle ID `app.freecorps.brigade` exists, so apply now;
mention on-call paging (PagerDuty/Opsgenie precedent).

## Q13 — PSTN provider choice (RFC 0010)

The `VoiceProvider` contract is defined; pick the first implementation by price for Brazilian numbers
(Twilio vs local providers) once Phase 2 starts.

## Q14 — A call iOS ends on its own (RFC 0010)

CallKit sometimes ends a call it accepted before anyone could answer (seen on the Simulator within a second). The
app now records an unanswered end within 2 seconds of ringing as `failed`, so a repeat of the page rings. Should it
also post the time-sensitive fallback notification at once? Check on devices which real cases look like this
(spike S6 write-up).

## Q15 — Locale of text the server writes into shared data (RFC 0008)

An incident a monitor opens is titled "<name> is down" in English: data is not translated, and workspaces have no
default locale yet. Add a workspace locale (set at sign-up, editable by owners) and render server-written titles in
it?

## Q18 — Who is paged before on-call schedules (RFC 0005, RFC 0006)

Until Phase 2's schedules, a page goes to the incident commander if assigned, otherwise to every owner, admin and
responder with a registered device (except whoever caused it), and every declared incident notifies, SEV3 and SEV4
at `high` urgency. For a small team that is what we want; for a larger one it wakes everybody. Should SEV3 and SEV4
notify at all, and should a workspace be able to narrow the interim rule (owners and admins only) before schedules
land? Also: a failed page is surfaced only on the incident's timeline and in logs; should it also reach someone
outside the incident (an email to owners, the external dead-man switch) when nobody at all was paged? And every
member the page was for without a device gets their own "Couldn't page …" line: right for a small team, noisy for a
large one where most never install the app.

Who counts as a member is the shard's cached member list, not D1 (RFC 0006 "Who is paged"): a member removed in D1
keeps being paged, and one demoted keeps being paged until they next open Brigade, until the `member.*` mutations
(member management) delete the row and the member's devices, or change the role, in the shard. No API path removes or
demotes a member today, so only an edit made outside Brigade hits this.

## Q19 — What else the dead-man switch should prove (RFC 0007)

The external dead-man switch pings only when a heartbeat went through the watchdog's outbox, the Queue, the consumer
and a relay that takes the send token (RFC 0007 "Watching the watcher"). It does not prove each workspace shard's own
alarm and drain (a shard stuck on a storage error still backs off alone and logs), APNs (the token check stops before
it), or D1 (sign-in, heartbeat routing). Options, not exclusive:

- Have the watchdog read a cheap liveness summary from shards with a backlog (the drain's `failures` and backlog
  size) and turn `degraded` past a threshold. Needs a registry of shards, which does not exist yet.
- A relay `/health?deep=1` that asks APNs for a provider token (no push), so a revoked key shows up.
- One D1 read per beat.

Also open: who inside Brigade hears `brigade.status_changed` (an email to the instance's operators once the email
notifier exists?), and whether paging Brigade's operators on a monitor stuck at `unknown` should ride on this switch (it carries no
workspace data today).

Decided for now: `GET /health/paging` says only `{ status }` without a session or to a user in no workspace; the
reasons and times to any member of a workspace; `external` (whether the check is set up and answering) to nobody,
since with open sign-up anyone can own a workspace and no workspace role stands in for the instance's operator, who
reads it in the logs. Open: an instance-operator role (or an allowlist in configuration) to show it in the dashboard.

---

# Decided

| #   | Question                       | Decision                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Authentication                 | **Better Auth** (Workers + D1, Expo client). Already used in other Freecorps projects.                                                                                                                                                                                                                                       |
| Q2  | Multi-tenancy                  | Multi-workspace from day one: workspace = Better Auth organization, with teams and roles (RFC 0003).                                                                                                                                                                                                                         |
| Q3  | Backups                        | Nightly export of every DO to R2 + "export workspace" in the UI. A restore rotates the shard epoch (RFC 0004).                                                                                                                                                                                                               |
| Q4  | Socket topology                | One WebSocket per shard behind a client connection pool; `SessionDO` gateway as upgrade path (RFC 0004).                                                                                                                                                                                                                     |
| Q5  | Web/mobile UI sharing          | Share logic (`schema`, `sync`, `i18n`, tokens), not components. Web: React + TanStack Router + shadcn/ui. Shared now: string-free incident helpers (moves, checks, links, busy counts) in `packages/sync`, and incident and sign-in wording in `packages/i18n` (`./incident`, `./auth`; i18n now depends on `schema`) (#20). |
| Q6  | Slack app distribution         | App manifest for self-hosters; Freecorps-published Slack app for the hosted version.                                                                                                                                                                                                                                         |
| Q7  | Voice paging                   | In-app VoIP call screen with real audio; PSTN as optional last step via provider-agnostic `VoiceProvider` (RFC 0010).                                                                                                                                                                                                        |
| Q9  | i18n library                   | **Paraglide JS** (RFC 0008).                                                                                                                                                                                                                                                                                                 |
| Q10 | Site and docs                  | **Fumadocs on TanStack Start**, prerendered, served by Workers static assets.                                                                                                                                                                                                                                                |
| Q11 | Task runner                    | Vite+ `vp run`, no Turborepo.                                                                                                                                                                                                                                                                                                |
| Q12 | CLA                            | Handled by Freecorps; CLA Assistant + standard CLA text reviewed by counsel.                                                                                                                                                                                                                                                 |
| Q16 | Heartbeats, made-up workspaces | The Worker looks the workspace id up in D1 (`organization`, cached per isolate) before it routes a ping, so a token for a workspace that does not exist gets the same 404 and creates no Durable Object (RFC 0007). If D1 fails, the ping goes to the shard anyway.                                                          |
| Q17 | Should "no data" page?         | No. `unknown` ("No data") opens no incident and pages no one in the workspace; the dashboard and `monitor.status_changed` are the signal. The blind spot (an outage only the surviving probes see) is accepted; whether Brigade's own operators hear about stalled probes is part of Q19. |
