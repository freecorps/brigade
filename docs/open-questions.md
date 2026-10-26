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
it? Text written to one person already follows theirs: each user has a `locale`, and emails are rendered in it
(RFC 0005 "Email"); a workspace locale would default it and cover what is shared.

## Q18 — Who is paged, what is left after escalation policies (RFC 0005, RFC 0006)

Mostly answered by escalation policies (RFC 0003 "Escalation policies", RFC 0006 "Who is paged"): a workspace that
sets a default policy pages whoever is on call, level by level, and a larger team no longer wakes everybody; one
without a policy keeps the interim rule (commander, then every owner, admin and responder with a device). Still open:

- Should SEV3 and SEV4 escalate at all (today a run starts for every declared incident, at `high` urgency below
  SEV2), or should a policy say from which severity it runs?
- Should a monitor (and later an alert route) pick its own policy? Runs already record theirs; only the default is
  used in this slice.
- A failed page is surfaced on the timeline, in logs and now by email (RFC 0005 "Email"): a member a SEV1 or SEV2
  page missed is told once per incident, and the owners are told when a page reached nobody and nothing else will
  page on its own; both on by default, `workspace.setEmail` turns either off. Still open: a dashboard switch for it;
  whether a member may opt out of their own emails (deferred to notification preferences); whether the owners'
  email should also go to admins, or skip an owner who declared the incident; and whether the external dead-man
  switch should hear of it too. Until email verification lands, any sign-up can make Brigade email an address it
  does not own with words it chose (RFC 0005 "Email", "Abuse"): the ledger caps it (5 emails per user per hour, 200
  per workspace per day), and the plan is that verification gates email, so no deployed environment sets
  `EMAIL_FROM` before it. Are those caps right once it does?
- Should a level whose pushes all fail escalate before its timeout? Delivery receipts now say per device whether
  APNs refused a push and whether the phone opened it (RFC 0006 "Delivery receipts"), but a missing receipt is not
  proof a page was not shown (receipts are best effort), so only refusals could trigger it. An exhausted run
  already falls back to everyone who can respond once (RFC 0006 "Who is paged"); should a workspace be able to turn
  that off, or point it at a smaller group?
- Every member without a device the page was for still gets their own "Couldn't page …" line: right for a small
  team, noisy for a large one where most never install the app. The same members are emailed (SEV1 and SEV2, once
  per incident), which is the point for those who never install it, and the same noise for those who do not want it.

Who counts as a member is the shard's copy of the member list, not D1 (RFC 0006 "Who is paged"). Member changes made
through Brigade (roles, removal, leaving) update it with D1 and drop a removed member's devices at once (RFC 0003
"Members"), every sync upgrade into the workspace reconciles it with D1, and a change whose shard step failed after
D1 committed arms the shard's alarm to reconcile within seconds. What is left is an edit made in D1 outside Brigade
while nobody opens Brigade: that member is paged as before until someone does. Should the shard also reconcile on a
timer (its alarm reading D1 every few minutes, off the page path), or is the next upgrade enough?
And should the app treat `403 not_a_member` on a kept sign-out as finished, since the removal already freed the
phone (RFC 0006 "A handed-over phone")?

## Q19 — What else the dead-man switch should prove (RFC 0007)

The external dead-man switch pings only when a heartbeat went through the watchdog's outbox, the Queue, the consumer
and a relay that takes the send token (RFC 0007 "Watching the watcher"). It does not prove each workspace shard's own
alarm and drain (a shard stuck on a storage error still backs off alone and logs), APNs (the token check stops before
it), or D1 (sign-in, heartbeat routing). Options, not exclusive:

- Have the watchdog read a cheap liveness summary from shards with a backlog (the drain's `failures` and backlog
  size) and turn `degraded` past a threshold. Needs a registry of shards, which does not exist yet.
- A relay `/health?deep=1` that asks APNs for a provider token (no push), so a revoked key shows up.
- One D1 read per beat.

Also open: who inside Brigade hears `brigade.status_changed` (an email to the instance's operators, now that the email
notifier exists; it needs a list of operators, which the instance-operator role below would give), and whether paging Brigade's operators on a monitor stuck at `unknown` should ride on this switch (it carries no
workspace data today).

Decided for now: `GET /health/paging` says only `{ status }` without a session or to a user in no workspace; the
reasons and times to any member of a workspace; `external` (whether the check is set up and answering) to nobody,
since with open sign-up anyone can own a workspace and no workspace role stands in for the instance's operator, who
reads it in the logs. Open: an instance-operator role (or an allowlist in configuration) to show it in the dashboard.

## Q20 — On-call schedule choices to confirm (RFC 0003 "Schedules")

The first schedules slice made choices that are easy to change now and harder once escalation pages from them:

- A member removed from the workspace (or made a viewer) is taken out of every rotation and the rest move up, so
  everyone's later shifts shift. The alternative keeps their slots as gaps. Which should it be, and should the
  owners be told (the email notifier exists now, RFC 0005 "Email")?
- Responders may add and remove overrides for themselves only. Should they also swap a shift with someone else
  (an override for another member, accepted by them)?
- A layer emptied by removals stays, as a gap, until someone edits it. Should an empty schedule warn on the
  dashboard's overview once schedules page?
- The cap of 100 overrides not yet ended is per schedule, not per member, so one responder adding overrides for
  themselves can fill it and block everyone else's until theirs end or an admin removes them. Should there be a
  per-member cap too (say 20), or is the admin's remove enough?

---

# Decided

| #   | Question                       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Authentication                 | **Better Auth** (Workers + D1, Expo client). Already used in other Freecorps projects.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Q2  | Multi-tenancy                  | Multi-workspace from day one: workspace = Better Auth organization, with teams and roles (RFC 0003).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Q3  | Backups                        | Nightly export of every DO to R2 + "export workspace" in the UI. A restore rotates the shard epoch (RFC 0004).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Q4  | Socket topology                | One WebSocket per shard behind a client connection pool; `SessionDO` gateway as upgrade path (RFC 0004).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Q5  | Web/mobile UI sharing          | Share logic (`schema`, `sync`, `i18n`, tokens), not components. Web: React + TanStack Router + shadcn/ui. Shared now: string-free incident helpers (moves, checks, links, busy counts) in `packages/sync`, and incident and sign-in wording in `packages/i18n` (`./incident`, `./auth`; i18n now depends on `schema`) (#20).                                                                                                                                                                                                                                                                                                                                                                  |
| Q6  | Slack app distribution         | App manifest for self-hosters; Freecorps-published Slack app for the hosted version.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Q7  | Voice paging                   | In-app VoIP call screen with real audio; PSTN as optional last step via provider-agnostic `VoiceProvider` (RFC 0010).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Q9  | i18n library                   | **Paraglide JS** (RFC 0008).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Q10 | Site and docs                  | **Fumadocs on TanStack Start**, prerendered, served by Workers static assets.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Q11 | Task runner                    | Vite+ `vp run`, no Turborepo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Q12 | CLA                            | Handled by Freecorps; CLA Assistant + standard CLA text reviewed by counsel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Q16 | Heartbeats, made-up workspaces | The Worker looks the workspace id up in D1 (`organization`, cached per isolate) before it routes a ping, so a token for a workspace that does not exist gets the same 404 and creates no Durable Object (RFC 0007). If D1 fails, the ping goes to the shard anyway. Leaving likewise: a non-member's own `DELETE …/members/:userId` gets the same 403 `not_a_member` body whether or not the workspace exists, and the shard answers it from its own rows, without D1 (RFC 0003). Its timing differs (only an existing workspace asks the shard), so it relies on workspace ids being unguessable ULIDs: the route takes `ws_<ULID>` ids only. A per-user rate limit on it is on the roadmap. |
| Q17 | Should "no data" page?         | No. `unknown` ("No data") opens no incident and pages no one in the workspace; the dashboard and `monitor.status_changed` are the signal. The blind spot (an outage only the surviving probes see) is accepted; whether Brigade's own operators hear about stalled probes is part of Q19.                                                                                                                                                                                                                                                                                                                                                                                                     |
