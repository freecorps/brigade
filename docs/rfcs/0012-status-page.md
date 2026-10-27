# RFC 0012 — Public status page

- Status: Draft

A public page per workspace where customers see which parts of the service work and what the team chose to tell
them about incidents (RFC 0001 goal 9, RFC 0003 `StatusPage`). The first slice: the page, its components, publishing an
incident update to it, and the public read path. The second: email subscriptions, uptime bars from monitors and
scheduled maintenance (their sections below). What is left is at the end ("Not yet"). The code:
`packages/schema/src/status.ts`, `maintenance.ts` and `uptime.ts`, `apps/api/src/status-page.ts` (the shard's push),
`status-route.ts` and `status-html.ts` (the routes and the page), `status-subscribers.ts` (subscribing),
`status-mail.ts` and `notify-status.ts` (the emails), and the dashboard's Status page and Scheduled maintenance cards
and the incident page's Status page panel.

## Shape

```
Dashboard ──PUT /api/workspaces/:id/status-page──▶ api Worker ─▶ D1 status_slug (claim) ─▶ WorkspaceDO
Dashboard ──sync: statusComponent.*, incident.publishUpdate──────────────────────────────▶ WorkspaceDO

WorkspaceDO: commit marks the snapshot dirty ─▶ alarm ─▶ KV STATUS  "status:<slug>" = sanitized JSON

Visitor ──GET /status/:slug──▶ web Worker (forwarded unchanged) ─▶ api Worker
                                  ─▶ edge cache (Cache API) ─▶ KV get (cacheTtl 30 s) ─▶ HTML, no script
```

- **The workspace shard is the authority** (RFC 0002): the page's settings, its components and what was published
  about each incident are synced tables in `WorkspaceDO`, written only by named mutations with RBAC and an outbox
  event (RFC 0004, RFC 0005), like everything else.
- **The public never reaches the shard.** A visitor's request reads one KV key (often not even that: the edge
  cache and KV's own cache answer most), renders it and is done. No Durable Object is woken or loaded per visitor,
  so a page read by thousands during an outage costs the workspace's shard nothing, and an outage of the shard
  leaves the page showing what was last pushed.

## What a page is

- **One page per workspace** (`status_page`, one row): its name (the company's or product's, 1 to 80 characters),
  its address (`/status/<slug>`), its language and whether it is public. A page that is not public is a draft:
  members see and fill it in the dashboard; the address answers 404.
- **Components** (`status_components`, at most 50): the parts of the service the public knows by name (API, Website,
  Checkout), each with an optional group (components of a group are listed together under its name; ungrouped ones
  first) and a status set by hand: `operational`, `degraded`, `partial_outage`, `major_outage`. Listed in the
  order they were added; reordering is a later slice.
- **A component's status is derived**: the worse of its hand-set status and the impact of every published incident
  on it that is not resolved (`componentStatus`). So declaring an outage on the page needs no second step, and
  resolving the incident brings the component back by itself; a component can still be marked degraded by hand
  (planned work, a known slowness) without an incident.
- **The page's overall status** is the worst of its components and its open incidents ("All systems operational",
  "Some systems are slower than usual", "Some systems are down", "Major outage").
- **History**: resolved incidents from the last 90 days (`STATUS_HISTORY_DAYS`), newest first, at most 50 in the
  snapshot. Older rows stay in the shard (one per published incident, small); pruning them is a later slice.

## Publishing

- **An explicit choice, never the internal timeline.** `incident.publishUpdate` takes everything the public reads:
  a public title (1 to 200 characters), where it stands (`investigating`, `identified`, `monitoring`, `resolved`:
  the public's vocabulary, separate from the incident's own status), its impact (the component scale), the
  components it touches and the text (1 to 4000 characters, the update rules of RFC 0003). Each publish may change
  all of them. Nothing is copied from the incident: its internal title, severity, roles, members and timeline never
  reach the page. The dashboard's form starts the public title from what the public was last told, never from the
  internal title.
- **The row** (`status_incidents`, keyed by the incident id): the public title, status, impact and components, and
  the updates, at most 50 per incident (`limit_reached` past that). `resolved` records when it was first resolved;
  publishing again with another status reopens it on the page.
- **The timeline** gets a `status_published` entry (status and text) in the same transaction, so the team sees what
  the public was told and by whom; the event is `incident.update_published`.
- **Who** (`status:publish`): owners, admins and responders. Whoever runs an incident tells the public about it,
  as they already post updates; an organisation that wants only the communications role to publish can ask for it
  later (role definitions, Phase 3). Viewers read.
- **The page must be set up** (enabled or not): publishing to a draft lets a team prepare before going public.

## Corrections

What was published can be taken back, since a status page is read at the worst moment and a wrong word (a customer's
name, an internal hostname, the wrong incident) must not stay up:

- `incident.editPublishedUpdate` corrects an update's text in place (its time and status stay);
  `incident.removePublishedUpdate` takes one update off, unless it is the last (`invalid_args`: an incident on the
  page always says something); `incident.unpublish` takes the incident off with every update, as if it was never
  published (publishing again starts it afresh). Removing an update leaves the incident's public title, status and
  impact as the last publish set them; publishing again changes them.
- **Who** (`status:publish`): the same people who publish. Whoever told the public something wrong at 3 a.m. must be
  able to take it back without waiting for an admin; the timeline records who did.
- **The timeline** gets a `status_corrected` entry in the same transaction (`change`: `edited` with the new text,
  `removed` with the text taken down, `withdrawn` with the public title), so the team keeps what the public was
  shown even after it is gone from the page. Events: `incident.published_update_edited`,
  `incident.published_update_removed`, `incident.unpublished`.
- The dashboard's Status page panel lists the updates on the page, newest first, each with Edit and Remove, and Take
  off the page; removing asks first, and every correction says how long caches may still show the old version.

## Who manages the page

`status:manage`, owners and admins: the page's settings and its components (`statusComponent.create`, `.update`,
`.delete`; deleting one takes it out of every published incident in the same transaction). Everyone reads them
(`status:read`, queries `statusPage.config`, `statusComponents.all`, `statusIncident.byId`). What the page lists is
the same kind of decision as what monitors watch, so it is an admin's call.

## Addresses

- A slug is 3 to 40 lowercase letters, digits and single hyphens, starting and ending with a letter or digit
  (`STATUS_SLUG`), unique across the instance. A shard cannot see other workspaces, so uniqueness lives in D1
  (`status_slug`, migration 0008: slug, workspace).
- **D1 first, then the shard**, as for member changes (RFC 0003 "Members"): `PUT /workspaces/:id/status-page` checks
  the origin, the session and the member's role in D1 (an outsider never wakes a shard), then the shard
  (`WorkspaceDO.configureStatusPage`) checks `status:manage` and the settings, claims the slug (`insert … on
  conflict do nothing`, then reads who holds it: another workspace is `409 slug_taken`) and runs the server-only
  `statusPage.configure` with its event `status_page.configured`. Server only because a socket's mutation is
  synchronous and cannot wait on D1. A slug the shard then refuses (nothing changed) is released again if it was
  free before; a storage failure after the claim leaves it with the workspace, which is harmless (`503
  not_applied`; saving again with it succeeds).
- **A slug given up stays claimed until no cache can serve its snapshot.** Changing the slug records the old one
  (`status_retired`, server only) in the same transaction; the shard's push deletes the old KV key, records when
  (`cleared`), and deletes the D1 row only `STATUS_SLUG_GRACE_MS` (5 minutes) later: a KV delete takes up to a
  minute to reach every location, and KV's cache and the edge cache may each keep the old page 30 s after that.
  Otherwise another workspace could claim the slug and have its fresh snapshot deleted, or served next to the old
  one. Taking a slug back before that ran just drops it from the list; a release only ever deletes the record it
  read, so a slug taken back and given up again meanwhile keeps its newer record and is released after its own grace. Without a `STATUS` binding nothing was ever
  published under a slug, so one given up is released at once.
- **Claims and releases need no lock.** Each claim stamps the D1 row with its time (`created_at`; claiming a slug the
  workspace already holds rewrites it), and a release deletes only a row stamped no later than the claim it undoes,
  or stamped before the slug was given up (strictly: a claim in the same millisecond is a claim made since). A release that lands late, after the slug was taken back, finds
  a newer stamp and leaves it. So `configure` never waits on a push, and a push stuck on KV never holds it.
- **Custom domains are later**: a domain would map to a slug (Cloudflare for SaaS custom hostnames) and the same
  route would serve it.

## The snapshot

`statusSnapshot` (packages/schema) builds the whole public page as JSON: the page's name and language, when it was
built, the overall status, the groups with each component's name, derived status and uptime bar, the open incidents
(most impact first) and the history, each incident with its public title, status, impact, the names of its components
and its updates (newest first), and the maintenance windows under way and upcoming. It holds no ids, no members and
nothing internal (tested: the snapshot never contains the internal title, any member, workspace, incident, component,
monitor or maintenance id). Version 2 added uptime, maintenance and the `maintenance` component status; the reader
renders 1 and 2 and refuses anything else, and a 1 carrying the new fields.

- **Where it lives: Workers KV** (binding `STATUS`, key `status:<slug>`). Chosen for the read path: KV is built for
  data read far more often than it is written and cached at the edge near readers (cacheTtl, default 60 s, at least
  30 s), which is exactly a status page. Its trade-offs fit: writes are eventually consistent (other locations may
  see a change up to 60 s or more later), at most one write a second to a key, values up to 25 MiB (a full snapshot
  is a few KB). R2 was the alternative: strongly consistent, but its reads are not cached at the edge on their own,
  so every visit would be an R2 read unless the Cache API sat in front anyway. The Cache API alone is per location
  and cannot be pushed to globally, so it cannot be the store, only a layer in front (used below). A Durable Object
  per page would put a single location behind every visitor, which is what this design avoids.
- **The push.** Every commit that changes `status_page`, `status_components` or `status_incidents` marks the snapshot
  dirty (`status_dirty` in `shard_meta`, the version of the change) **in the change's own transaction**, so a change
  is never lost to the object dying before it is published. The mutation's outbox hook brings the shard's one alarm
  forward; the alarm, after the escalations and the outbox drain, builds the snapshot and puts it (or deletes the key
  when the page is not public), then deletes retired slugs' keys and releases them in D1 after their grace. It clears
  the dirty mark only up to the version it read, so a change committed during the write is pushed next. Pushes are
  spaced at least 1 s apart (KV's per-key limit).
- **A slow KV never holds the paging path.** KV calls have no deadline of their own. The alarm waits on a push at most
  `STATUS_PUSH_BUDGET_MS` (5 s); past that the push carries on in the background and backs off as if it had failed,
  so the alarm comes back later, not at once. One push runs at a time (two could land in KV out of order): an alarm
  that finds the last one still out when a push is due does not wait on it and backs off again, doubling to 5
  minutes. A push still out after `STATUS_PUSH_ABANDON_MS` (3 minutes) is abandoned and the next due push starts;
  the abandoned one records nothing, and when it settles it marks the page to be pushed again (`status_repush`,
  cleared only by a push started after it), so its write, landing late, is never the last. Whenever a push settles
  it brings the alarm forward for what is due by then, so a change made while it was out goes out at once. Escalation
  levels fire before the push in every alarm, the alarm's next time includes theirs, and the alarm waits on the push
  no longer than until the next level is due (at least 100 ms), so a level is never late because of the page (tested
  with a KV that never answers and with one that answers after 3 s).
- **Rebuilt daily.** A public page is pushed again at least once a day (`STATUS_REFRESH_MS`) even when nothing changed,
  under the same backoff, so the 90-day history drops what aged out and "Updated" stays true on a quiet page. One KV
  write a day per page.
- **Fallback.** A failed push keeps everything pending and is retried from the alarm with backoff (1 s doubling to
  5 minutes, jittered), logged on every failure. The page always says when its snapshot was built ("Updated … UTC"),
  so a visitor can tell how fresh it is; while KV or the shard is down, visitors keep reading the last snapshot,
  which is the honest answer (the last thing the team said). Without a `STATUS` binding nothing is pushed and every
  address answers 404, while the dashboard still sets the page up; adding the binding later publishes on the next
  change. Q23 asks whether the page should also say when its snapshot is older than a threshold.

## The public page

- `GET /status/:slug` on the dashboard's origin: the web Worker forwards `/status/*` to the API unchanged (it is in
  `run_worker_first`, so the SPA never answers it), and the API renders HTML from the snapshot. No session, no
  cookies read, only `GET` and `HEAD`.
- **Server-rendered, no script.** A plain HTML document with inline CSS, the design tokens of `packages/ui` (light
  and dark by `prefers-color-scheme`), readable on a phone: the viewport set, safe-area padding, 16 px text, rows at
  least 48 px tall, long names wrapping. Past incidents fold behind `<details>`. Times are in UTC and say so, since
  the Worker does not know the visitor's time zone and no script asks (local times are slice 2).
- **Read defensively.** A snapshot is rendered only if it is the version the Worker knows, its language and every
  status one it has words for, and every time a real date (`isSnapshot`); anything else, or a render that throws,
  is the 503 page (not cached), so a Worker older or newer than the shard never shows half a page.
- **Headers**: `Cache-Control: public, max-age=30` (404s 60 s), a Content-Security-Policy that allows nothing but
  inline style and a form posting to the page's own origin (`default-src 'none'`, `form-action 'self'`, no frames),
  `nosniff`, `no-referrer`. Every piece of text is escaped.
- **Caching and abuse.** The response is kept in the edge cache (the Cache API, keyed by slug alone, so headers and
  hosts never split it; a no-op on workers.dev) and the KV read uses `cacheTtl: 30`, so a busy page costs about one
  KV read per location every 30 s, and a flood of made-up addresses one cached 404 per address. Nothing on the read
  path touches D1 or a shard, so there is nothing per request to rate-limit; a rate limit and Cloudflare's own DDoS
  protection on the custom hostname are for the custom-domain slice. Subscribing is the one write a visitor makes, and
  it is rate-limited before it touches either ("Email subscriptions").

## Uptime

- **Optional per component**: `statusComponent.linkMonitors` (`status:manage`) links a component to up to 5 of the
  workspace's monitors (`MAX_COMPONENT_MONITORS`); an empty list takes the bar off. Deleting a monitor takes it out of
  every component in the same transaction.
- **Computed in the shard**, in the snapshot (`uptime`, packages/schema): 90 UTC days (`UPTIME_DAYS`), today included.
  A day's downtime is the time any linked monitor had an alert firing (the union, so two monitors down at once count
  once); an alert is the monitor's own verdict after its consecutive checks (RFC 0007), so one failed check is not
  downtime. A day is `up` with none, `degraded` under an hour (`UPTIME_DOWN_MS`), `down` from an hour, and `none`
  before the first linked monitor existed. The percentage is the watched time that was up, two decimals, rounded down
  so 99.999 never shows 100. Monitors keep no history of their checks, which is why alerts are the source; paused
  time counts as up (Q23).
- **Pushed when it moves**: an alert firing or resolving marks the snapshot dirty when any component is linked, and
  the daily rebuild moves the bars on at midnight.
- **On the page**: 90 thin bars under the component, coloured like the component scale, each with its day as a
  tooltip, hidden from screen readers behind one text alternative (`role="img"`): the percentage and every day with
  downtime and how long. No script.

## Scheduled maintenance

- **A window** (`status_maintenance`, synced, `mnt_` ids): a public title and text (the update rules), the components
  it touches, when it starts and ends (at most 14 days long, at most a year ahead, not already over), and where it
  stands: `scheduled`, `in_progress`, `completed`. At most 20 open at once; completed ones older than 90 days are
  dropped when the next is planned.
- **Who** (`status:publish`): owners, admins and responders, like publishing. `maintenance.schedule`, `.update` (not
  once completed), `.end` (now, while under way) and `.cancel` (deletes one not completed), each with its event
  (`maintenance.scheduled`, `.updated`, `.ended` with `early: true`, `.cancelled`; each carries the window's id,
  title, components, times and phase).
- **Moved on by the shard's alarm**: the alarm is set for the next start or end (`nextMaintenanceAt`, armed after
  every mutation and on every wake) and runs the server-only `maintenance.advance`, which emits
  `maintenance.started` or `maintenance.ended` (only the latter when both passed while the shard was away). The
  change marks the snapshot dirty, so the push that follows shows it. Nobody needs to be signed in.
- **On the page**: windows under way first (with the component chip "Under maintenance"), upcoming ones after the
  components, at most 10, soonest first, in UTC. A component under maintenance shows it only while nothing worse (an
  incident, its own status) does, and the banner says "Scheduled maintenance in progress" when everything else is
  operational. The page's overall status is unchanged: maintenance is not an outage.
- **The dashboard's Scheduled maintenance card** lists open and recent windows with their times in the viewer's time
  zone, and plans, edits, ends and calls them off (asking first).

## Email subscriptions

Visitors subscribe on the page to hear of incidents and maintenance by email, in the page's language.

- **Subscribers live in D1** (`status_subscriber`, migration 0009: id `ssb_…`, workspace, lower-cased address,
  `pending` or `confirmed`, when, and how many confirmations were asked for), never in the shard: the shard keeps no
  email addresses (RFC 0005 "Email"), and a refused or repeated subscribe never wakes it. Every change still emits an
  event through the shard's outbox, with the subscriber's id and never the address: `status_subscriber.requested`
  (`subscriberId`, `send`), `.confirmed`, `.removed` (`reason`: `unsubscribed` or `deleted`), from server-only
  mutations run after the D1 write.
- **The form**: a plain `POST /status/:slug/subscribe` form on the page (no script), shown only where email can be
  sent. The answer is always "Check your inbox: if this address isn't subscribed yet, we've sent it a link", whether
  the address was new, pending, confirmed, over its caps or the honeypot field (`website`, off-screen, never filled by
  a person) was filled: the form tells nobody who is subscribed. A bad address is a 400, another origin a 403.
- **Abuse.** Workers Rate Limiting before D1 or a shard: 5 a minute per caller address
  (`STATUS_SUBSCRIBE_IP_LIMIT`) and 30 a minute per page (`STATUS_SUBSCRIBE_PAGE_LIMIT`), namespaces 411x and 412x
  per environment; over either a 429 page. A pending address gets at most 3 confirmations from one page a week
  (`STATUS_CONFIRM_SENDS`), and an address at most 5 a day from every page together, counted in D1 when sent
  (`status_confirmation_send`), so many pages cannot add up to flood one inbox. A page holds at most 1000 subscribers
  (`STATUS_SUBSCRIBERS_MAX`). Nothing but that one confirmation ever goes to an unconfirmed address. Q21 has the
  numbers.
- **Double opt-in.** The confirmation email links `/status/:slug/confirm?t=…`, signed (HMAC-SHA256 under a key
  derived from `BETTER_AUTH_SECRET`; the token carries the kind, workspace, subscriber and expiry) and valid 48 hours.
  A `GET` only shows a "Confirm subscription" button that posts, so a mail scanner opening links confirms nobody.
- **Leaving.** Every notification carries a manage link (`/manage?t=…`, signed, no expiry, dead once the row is
  gone) showing the masked address and an Unsubscribe button, and RFC 8058's `List-Unsubscribe` (https only, which
  Email Sending requires) with `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, so a mail client unsubscribes in
  one click with a `POST`. Unsubscribing deletes the row.
- **Owners and admins** (`status:manage`, checked in D1): `GET /workspaces/:id/status-page/subscribers` (counts),
  `…/export` (CSV of address, status and times; a value starting with a formula character is quoted), and `DELETE`
  with `{ email }`. The dashboard's Status page card shows the counts, the export and removal by address; no other
  member ever sees an address, and none reaches the page or the snapshot.
- **What is sent.** `incident.update_published` (the first update of an incident is "created", a `resolved` one
  "resolved", the rest "updated"; the text as it reads when the email goes out, so a correction made first goes out
  corrected, and an update removed or an incident taken off the page sends nothing), and `maintenance.scheduled`,
  `.started`, `.ended` and `.cancelled` (a window called off before its scheduled email went out sends nothing). Only
  to `confirmed` subscribers, only while the page is public. Plain text and escaped HTML in the page's language
  (`email_status`), with `Auto-Submitted: auto-generated` and `Content-Language`.
- **From the queue, never the request path** (src/notify-status.ts): the consumer asks the shard for a plan
  (src/status-mail.ts, a ledger keyed by event, held 60 s so two deliveries never send one batch), reads the next
  confirmed subscribers from D1 after the ledger's cursor, at most 50 (`STATUS_EMAIL_BATCH`), sends each through a
  side connection slot (shared with Slack and webhooks, so the relay always has its own) and reports back. Sends start
  only within `STATUS_EMAIL_BUDGET_MS` (3 s); one under way past that finishes under `waitUntil`, and the delivery lets
  go at most 2 s later, so the next batch's pages never wait on email. Subscribers left: the shard runs
  `statusEmail.continue`, whose `status_email.continue` event brings the event back through the outbox, never riding
  the original message's Queue retries. A refusal a retry may fix stops the batch there and is retried (30 s doubling
  to 5 minutes, at most 5 failed batches, then given up and logged); one refused for good is skipped. A lost report
  can send a batch twice (at least once, like every delivery here).
- **Cap per page**: 5000 emails a UTC day (`STATUS_EMAIL_DAILY_CAP`); past it the rest of the day's are dropped and
  logged.
- **Links** use `DASHBOARD_URL` (the page is served on the dashboard's origin); without it nothing is sent, except by
  the dev log sender, which uses the origin the visitor subscribed through.

## Language

Chosen per page (`locale`, `en` or `pt-BR`; RFC 0008): a status page is one document every visitor reads, like a
shared Slack channel, not text addressed to one person. The page's wording (`status_text`) is rendered in it on the
server; what the team writes is not translated. The 404 and error pages, which have no page to take a language
from, are in English.

## Privacy

Nothing internal leaks: no member names (no "updated by"), no internal titles, severities, roles or timeline
entries, no ids. Only what someone typed into the publish form or the components list reaches the public, and the
form says so. Showing who published an update could become a per-page choice later.

**Nothing is taken down at once.** A correction, a removed update, an incident taken off the page and a page turned
private (or moved to another address) reach the shard at once but visitors only as caches expire: the push itself
(seconds; longer while KV is slow), KV's propagation (up to about 60 s) and cache (`cacheTtl` 30 s), the edge cache
(30 s) and the visitor's browser (`max-age` 30 s). In practice about 1 to 2 minutes, and a browser that already has
the page keeps showing it until reloaded. The dashboard says so where the page is made public and wherever a
correction is made. Anything truly sensitive that was published needs a correction now and, where it matters, the
cache purged by hand (custom domains, a later slice, can purge by URL).

## Events

`status_page.configured` (`slug`, `title`, `locale`, `enabled`, `previousSlug`), `status_component.created` and
`.updated` (`id`, `name`, `group`, `status`), `status_component.deleted` (`id`, `incidents`: how many published
incidents named it), `incident.update_published` (`entryId`, `title`, `status`, `impact`, `componentIds`,
`body`), `incident.published_update_edited` (`entryId`, `updateId`, `body`), `incident.published_update_removed`
(`entryId`, `updateId`) and `incident.unpublished` (`entryId`, `title`); `status_component.monitors_linked` (`id`,
`monitorIds`); the maintenance and subscriber events above, and `status_email.continue` (`eventId`). The status page
email notifier acts on `incident.update_published`, the maintenance events, `status_subscriber.requested` and
`status_email.continue`; none of them is in the webhook catalog yet.

## Not yet

- Custom domains, reordering components, local times on the page, a JSON or RSS feed, embedding, pruning history past
  90 days, showing who published (choice per page), subscribing to some components only, maintenance and subscriber
  events in the webhook catalog, the mobile app's publish and maintenance actions.
- KV namespaces for staging and production: `STATUS` is bound for local runs and the tests and, in `dev`, to
  `brigade-status-dev` (apps/api README "Status page").
