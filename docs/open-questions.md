# Open questions

Decisions we still need to make. Each one links to the RFC it affects. Once decided, the answer moves to the
"Decided" section below and into the RFC.

## Q8 — Critical Alerts entitlement (RFC 0006)

Owner: Freecorps Apple developer account holder. The bundle ID `app.freecorps.brigade` exists, so apply now;
mention on-call paging (PagerDuty/Opsgenie precedent). Everything that does not need the grant is built and off
behind `BRIGADE_CRITICAL_ALERTS=1`; RFC 0006 "Critical Alerts" lists the steps once Apple grants it.

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
- A monitor now picks its own policy (RFC 0003 "Escalation policies"); deleting a policy a monitor names puts it back
  on the default. An alert route picks one too, first in the order (RFC 0006 "Who is paged"). Still open: whether a
  member declaring by hand should be able to pick one.
- A member removed or demoted in D1 outside Brigade is no longer paged until somebody opens Brigade: the shard's
  alarm reconciles its member list a while after any activity, and a page checks a list not checked lately first,
  failing open on D1 (RFC 0006 "Who is paged", decided). A failed page can be paged again by an owner or admin, and a
  lost SEV1 or SEV2 declaration is paged again once on its own (RFC 0005 "Notifiers", decided).
- A failed page is surfaced on the timeline, in logs and now by email (RFC 0005 "Email"): a member a SEV1 or SEV2
  page missed is told once per incident, and the owners are told when a page reached nobody and nothing else will
  page on its own; both on by default, `workspace.setEmail` turns either off (a dashboard switch now). A member may
  turn their own missed-page email off (`member.setEmail`); the owners' email has no per-member opt-out, as the
  fallback when paging fails. Still open: whether the owners'
  email should also go to admins, or skip an owner who declared the incident; and whether the external dead-man
  switch should hear of it too. Email verification gates these emails now: only verified addresses get them (RFC
  0005 "Email", "Abuse"); the caps on them and on account emails are Q21's.
- A level whose pushes all fail now escalates before its timeout, to the next level of its round only (RFC 0006 "Who
  is paged"): only refusals and failures with retries spent count, never a missing receipt. Still open: should a level whose members were all
  pushed but never opened it (no receipt within a minute or two) escalate early too, given receipts are best effort?
  And an exhausted run already falls back to everyone who can respond once; should a workspace be able to turn that
  off, or point it at a smaller group?
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

## Q21 — Caps on email to people (RFC 0005 "Abuse", RFC 0003 "Invitations", RFC 0002 "Auth")

Every email Brigade sends reaches an inbox someone else chose, so each kind is capped; the numbers are first guesses
to confirm in production:

- **Notifier emails** (a missed page, nobody paged): only to verified members, at most 5 per user per workspace an
  hour and 200 per workspace a day, read when the plan is made (deliveries at once can overshoot by a batch).
- **Invitations**, the one email to an unproven address: a verified inviter; per workspace 30 a day, 50 pending,
  one send per invitation per 5 minutes; across workspaces, counted atomically in D1, 3 a day per invited address
  (`+tags` counted as one),
  50 a day per inviter and 5 per invitation ever. Is 3 a day per address too few for someone invited to several
  teams at once (a consultant, an onboarding day)? Should an address be able to opt out of invitations altogether?
- **Verification**: one at sign-up, then at most 3 per user in 15 minutes and 5 a day. An address someone else
  signed up with and never verified stays taken (RFC 0002 "Auth"): no timed release, since a verification link holds
  only the address and an instance without email can never verify. Its owner takes it back with a password reset,
  which marks the address verified and signs everyone else out (RFC 0002 "Auth"), so no manual release is planned
  where email is set up. Left: an instance without email, where nobody can reset; should its operator have a way to
  free an address, or is no sign-up by others the answer there? Sign-up is now closed by default (`SIGNUP`, RFC 0002
  "Sign-up modes"), so on such an instance only an invited address can be signed up with by someone else; what is
  left is an operator who opens it.
- **Password reset**: at most 3 per address and IP an hour and 10 per address a day (counted for any address,
  account or not), and 3 per IP a minute. The hourly count is keyed by address and IP so that someone holding an
  account at another person's address cannot use up the owner's resets from their own network: the owner, asking
  from theirs, still gets a link. The daily cap is shared, so someone asking from many IPs can still deny the owner a
  link for a day, and fill their inbox with up to 10 emails. Is 10 a day the right trade, or should a request get
  through anyway when the address's last link has expired? Is 3 an hour too few for someone who mistypes?
- **Taking back an address** (RFC 0002 "Auth"): the reset pauses every monitor and revokes every heartbeat URL in the
  workspaces the account is alone in. Left to the owner: anything else the person who signed up configured there.
  Schedules and escalation policies only page members, for incidents only the owner or a (paused) monitor can open,
  so they are left as they are. A Slack connection is the open one: a workspace connected to the other person's
  Slack team would keep posting there, and may let that team's users act on incidents. The takeover should also
  disconnect it (or the notice should list it) once the Slack app lands (RFC 0011). Alert source URLs are revoked on a
  takeover (`alertSource.takeOver`), the alert routes the account created are disabled (one could drop what the owner
  needs paged), and the notice counts both; a future inbound integration (email ingest) needs the same.
- **Sign-up notices** (someone signed up with an address that has an account, RFC 0002 "Auth"): at most 3 a day per
  account. The sign-up itself answers as for a new account; whoever then signs in with a free address learns it was
  free (and holds it unverified until a reset). Requiring verification before sign-in would close that on instances
  with email; should it be an instance setting? Timing: both paths hash the password, and before answering a taken
  address's sign-up makes two D1 writes in a row (the notice's counter, then touching it again) as a free one makes two
  (the user, then its account), so their answers take about as long; the notice email goes after the response either
  way. What is left is noise between those writes (a new row against an update of one), measurable only over many
  tries, and those are bounded by the sign-up rate limit (3 per IP in 10 s). Is that enough, or should sign-up answer
  after a fixed delay?
- None of these counts the sender's own quota (Cloudflare Email Sending's limits answer `E_RATE_LIMIT_EXCEEDED`,
  retried); a Brigade-wide daily ceiling may be needed before open sign-up on a shared instance.

---

## Q22 — Slack: what Disconnect revokes, and who runs the app (RFC 0011)

Who a Slack user is no longer waits here: a Slack user maps to the member whose **verified** Brigade email equals
the email Slack confirmed for one of the connected team's own users (RFC 0011 "Who a Slack user is").

- Revoking is decided: Disconnect gives the bot token back with `auth.revoke` (the shard keeps it sealed until the
  notifier has), and `app_uninstalled` / `tokens_revoked` (Events API) mark the connection revoked (RFC 0011
  "Disconnecting", "Events API").
- Incident channels: created public unless the card says private, named `inc-<n>-<slug>` (the title as a slug), archived on resolve after
  the card's delay or kept. Should a severity raised to SEV1 or SEV2 after declaring create one too (today only the
  declaration does)?
- Channel messages are written in a language chosen on the card (default: the connecting member's), until workspaces
  have a default locale (Q15). Is that enough, or should it follow Q15's workspace locale once it exists?
- Who may connect Slack: owners and admins (`workspace:manage`). Should integrations get their own permission?
- Getting the Slack app (Freecorps' hosted app, the dev app): who creates it in Slack, and under which Slack workspace?

## Q23 — Status page choices to confirm (RFC 0012)

- Responders may publish to the status page (`status:publish`), as they post updates. Should it be owners, admins
  and whoever holds the incident's communications role only? Role definitions exist now (RFC 0003), but a workspace
  may take that role out, so the rule would need a fallback.
- The page now carries one inline script, allowed by its hash, that shows times in the visitor's zone; without it
  they read in UTC (RFC 0012 "Local times"). Is a script on the public page acceptable, or should it stay script-free
  and UTC only? The feeds answer `Access-Control-Allow-Origin: *` so another site can show them; should they?
- The page shows when its snapshot was built and nothing else about freshness. Should it also say "this page may be
  out of date" past a threshold? The shard now rebuilds a public page at least daily, so a snapshot older than a day
  or two means the shard or KV is stuck, which a visitor could be told.
- Misses are not rate-limited: each made-up address costs one KV read per location a minute (the cached 404). A
  rate limit per IP on `/status/*` misses (Workers rate limiting binding) would bound a flood of distinct addresses;
  is that worth it before custom domains bring Cloudflare's own protection?
- Subscribers and their emails (slice 2): 5 subscribes a minute per caller address and 30 per page; caps counted per
  inbox (`+tag` dropped, and Gmail's dots): at most 3 confirmations per inbox and page while it is pending and 5 per
  inbox a day across pages; 20 confirmations a day per recipient domain from one page, 50 a day per domain across
  the instance for domains that are not a large provider's (an inbox confirmed anywhere skips both), and 200 a day
  per page;
  1000 confirmed and 200 pending subscribers per page, a pending one deleted 48 hours after it asked; 5000
  notifications a page a day. A page past its caps drops new subscribers silently (the answer cannot say so without
  telling who is subscribed); should they be higher, per plan, or should owners be told? The large-provider list is
  short and fixed in code (src/status-subscribers.ts): should an instance be able to extend it? A company domain
  with many people signing up on one busy page meets the 50 a day across the instance: is that low enough to stop a
  catch-all flood and high enough for them? Should subscribers pick components?
- Uptime counts an alert firing as downtime and anything else as up, including a degraded component the team set by
  hand. A monitor paused now shows no data from its pause on; earlier pauses are not kept, so they count as up. Should
  pauses be kept so they always show as no data, and should hand-set or incident impact count as degraded? An hour of
  downtime makes a day `down`; is that the right line?
- Maintenance never changes the page's overall status, and a component under maintenance shows it only while nothing
  worse does. Should a window be able to say it takes a component down (planned outage)?
- Slugs can be probed: `GET /status/<slug>` tells anyone which public pages exist, and saving a slug another
  workspace holds answers `slug_taken`, so any workspace admin can learn which addresses are in use, drafts
  included. Should a draft's slug be claimed only when it first goes public, or the 409 be rate-limited?
- Times are shown in UTC because the page has no script. Is a small script for local times worth giving up
  `default-src 'none'`?
- Without a `STATUS` KV namespace every address answers 404. Deployed environments need one each (apps/api README
  "Status page"); should self-host setup create it?

## Q24 — Follow-ups, postmortems and exports to confirm (RFC 0013)

- Postmortems keep no revision history: last writer wins with a conflict check. Is keeping the last N revisions (a
  server-only table, restore from the dashboard) worth it, and how many?
- AI drafts are 20 a day per workspace and read members by name. Should an instance operator be able to turn drafts
  off per workspace, or pick another Workers AI model, without a deploy?
- The draft's language is the status page's, else the asker's. Should workspaces get their own language setting?
- Follow-up reminders go at 09:00 on the owner's clock (their devices' time zone, the last one used; else UTC), once
  a day, while anything is due or overdue. Should the hour be a member's choice, should reminders also go a day
  before the due date, and should an overdue follow-up stop reminding after a while?
- Exports last 7 days and only owners and admins make them. Should responders export the incidents they ran?
- A postmortem keeps the template sections it was made with, even when its incident's type changes later. Should a
  postmortem that is still blank follow its incident's new type, or should the editor offer to switch sections?

## Q25 — API tokens to confirm (RFC 0014)

- A token whose creator leaves stays disabled for good, even if they come back. Should an owner be able to hand a
  token over to another member instead of minting a new one?
- Every member can see the token list (names, scopes, last use), not the tokens. Should it be owners and admins only?
- 300 requests a minute per token. Enough for CI and integrations, or should a workspace set its own limit?

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
