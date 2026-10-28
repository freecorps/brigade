# RFC 0012 — Public status page

- Status: Draft

A public page per workspace where customers see which parts of the service work and what the team chose to tell
them about incidents (RFC 0001 goal 9, RFC 0003 `StatusPage`). The first slice: the page, its components, publishing an
incident update to it, and the public read path. The second: email subscriptions, uptime bars from monitors and
scheduled maintenance (their sections below). The third: the components' order, services linked to components, local
times on the page and its feeds. What is left is at the end ("Not yet"). The code:
`packages/schema/src/status.ts`, `maintenance.ts` and `uptime.ts`, `apps/api/src/status-page.ts` (the shard's push),
`status-route.ts`, `status-html.ts` and `status-feed.ts` (the routes, the page and its feeds), `status-subscribers.ts` (subscribing),
`status-mail.ts` and `notify-status.ts` (the emails), `status-domain.ts` and `status-domain-cf.ts` (custom domains), and the dashboard's Status page and Scheduled maintenance cards
and the incident page's Status page panel.

## Shape

```
Dashboard ──PUT /api/workspaces/:id/status-page──▶ api Worker ─▶ D1 status_slug (claim) ─▶ WorkspaceDO
Dashboard ──sync: statusComponent.*, incident.publishUpdate──────────────────────────────▶ WorkspaceDO

WorkspaceDO: commit marks the snapshot dirty ─▶ alarm ─▶ KV STATUS  "status:<slug>" = sanitized JSON

Visitor ──GET /status/:slug[/feed.atom|/feed.json]──▶ web Worker (forwarded unchanged) ─▶ api Worker
                                  ─▶ edge cache (Cache API) ─▶ KV get (cacheTtl 30 s) ─▶ HTML or feed
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
  order owners and admins set ("Order"), new ones last.
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
  internal title. Editing or removing a written update on the timeline (RFC 0003) therefore never changes what was
  published: that is corrected here, on its own.
- **The row** (`status_incidents`, keyed by the incident id): the public title, status, impact and components, and
  the updates, at most 50 per incident (`limit_reached` past that). `resolved` records when it was first resolved;
  publishing again with another status reopens it on the page.
- **The timeline** gets a `status_published` entry (status and text) in the same transaction, so the team sees what
  the public was told and by whom; the event is `incident.update_published`.
- **Who** (`status:publish`): owners, admins and responders. Whoever runs an incident tells the public about it,
  as they already post updates (decided, Q23: responders keep publishing). Viewers read.
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

## Order

- **One order for the components** (`position` on each, `statusComponent.reorder` with every component's id in its
  new order, `status:manage`, event `status_component.reordered` with `ids`). Groups have no order of their own: a
  group is listed where its first component is, and the ungrouped components always come first, as before. Moving a
  group moves its components together. One number per component, not a second table of groups, because a group is
  only a name on its components (renaming it is editing them) and a list of 50 rows is cheap to rewrite whole.
- **The whole list, checked**: an order that misses a component or names one that is gone (another member added or
  deleted one meanwhile) is `invalid_args`, so a stale order never drops anything; the same order is a `conflict`.
  Components from before reordering have no `position` and keep their old place (first, oldest first) until the first
  reorder; a new component is placed after every other.
- **On the dashboard** the Status page card lists the components in their groups as the page does, with Move up and
  Move down buttons on each component (within its group) and each group (among the groups): plain buttons, so the
  keyboard and screen readers work and nothing drags. Focus stays on the button that moved, an announcement says what
  moved, and a refused order says so. The change reaches the page with the next push, like every other.

## Services

- **A component stands for services** (`serviceIds` on the component, at most 10, `statusComponent.linkServices`,
  `status:manage`, event `status_component.services_linked` with `id` and `serviceIds`): the component side holds the
  link, as RFC 0003's model has it ("components (mapped to Services)") and as components already hold their monitors.
  Not the service side, because what the public sees is the page's call (`status:manage`), not the catalog's
  (`catalog:manage`), and a component often stands for several services.
- **Only a suggestion.** When nothing about an incident is on the page yet, the incident page's publish form starts
  with the components its services stand for ticked, and says they came from the services. The person still writes
  the update and presses Publish; a later publish starts from what the page says. Nothing is published, nor any
  component's status changed, by an incident naming a service.
- **Deleted services** stay on the component, skipped wherever it is read, like an incident's (RFC 0003 "Service
  catalog"): a service's id is never taken again, so a deleted one cannot match a new service, and deleting a service
  does not rewrite every component and push the page. Services never reach the snapshot.

## Who manages the page

`status:manage`, owners and admins: the page's settings and its components (`statusComponent.create`, `.update`,
`.delete`; deleting one takes it out of every published incident in the same transaction). Everyone reads them
(`status:read`, queries `statusPage.config`, `statusComponents.all`, `statusIncident.byId`). What the page lists is
the same kind of decision as what monitors watch, so it is an admin's call.

## Addresses

- A slug is 3 to 40 lowercase letters, digits and single hyphens, starting and ending with a letter or digit
  (`STATUS_SLUG`), unique across the instance's public pages. A shard cannot see other workspaces, so uniqueness lives in D1
  (`status_slug`, migration 0008: slug, workspace).
- **D1 first, then the shard**, as for member changes (RFC 0003 "Members"): `PUT /workspaces/:id/status-page` checks
  the origin, the session and the member's role in D1 (an outsider never wakes a shard), then the shard
  (`WorkspaceDO.configureStatusPage`) checks `status:manage` and the settings, claims the slug when the page is
  public ("Claimed when it first goes public" below; `insert … on
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
- **Claimed when it first goes public (decided, Q23).** A draft's slug is kept on the page alone (`claimed: false`
  on `status_page`), so a `slug_taken` never tells a workspace admin which addresses other drafts use, and two drafts
  may name one slug. The save that makes the page public claims it, and a slug another workspace holds is refused
  then (`409 slug_taken`, nothing changed). From then on the page holds it (`claimed: true`), also as a draft again,
  exactly as before. A slug that was never claimed is never retired, deleted from KV or released: it may be another
  page's by then (tested). Pages from before have no `claimed` and count as holding their slug, since every save
  claimed it.
- **Custom domains (decided, Q23)**: see "Custom domains" below.

## Custom domains

A page may also be served at a domain of the workspace's own (`status.example.com`), through Cloudflare for SaaS
custom hostnames: the owner points a CNAME at the instance's fallback origin and Cloudflare issues the certificate.

- **Off unless the instance is set up for it.** The API needs `CF_SAAS_TOKEN` (an API token scoped to "SSL and
  Certificates: Edit" on the SaaS zone alone), `CF_ZONE_ID` (that zone), `CF_SAAS_FALLBACK_ORIGIN` (the fallback
  origin's hostname, what owners point their CNAME at) and `DASHBOARD_URL`. Without all four the dashboard hides the
  section and the routes answer `503 not_configured`; nothing else changes.
- **One per page** (`status_domain`, one synced row: hostname, Cloudflare's id, `pending`, `active` or `failed`, the
  DNS records to create, Cloudflare's reason, when it was last checked). Owners and admins (`status:manage`) add,
  check and remove it from the dashboard's Custom domain card; everyone reads it.
- **D1 first, then Cloudflare, then the shard**, as for a slug: `PUT /workspaces/:id/status-page/domain`
  `{ hostname }` checks the session and the role in D1 (an outsider never reaches Cloudflare or a shard), the
  hostname, and Workers Rate Limiting per workspace (`STATUS_DOMAIN_LIMIT`, 10 a minute: each change calls
  Cloudflare's API). It claims the hostname in D1 (`status_custom_host`, migration 0014, unique across the instance;
  another workspace's is `409 hostname_taken`), creates the custom hostname (`POST /zones/:zone/custom_hostnames`,
  certificate validated over HTTP once the CNAME points here; Cloudflare's own duplicate is `hostname_taken` too) and
  runs the server-only `statusDomain.add` with its event `status_domain.added`. A refusal after the claim deletes
  Cloudflare's hostname and releases the claim, so nothing is left behind (tested).
- **What a hostname may be**: lowercase letters, digits and hyphens in two or more labels, an internationalized name
  as punycode, at most 253 characters, no scheme, port or path, and no IP address in any spelling (`1.2.3`, `0x7f.1`,
  `[::1]`). Never the instance's own domain, anything under it, or a parent of the dashboard's hostname: the own domain
  is the dashboard's hostname without its first label (or itself when it has two), since a page must never answer for
  the dashboard's origin.
- **Verification**: the card shows the records Cloudflare asked for (the CNAME, and its ownership TXT record) with the
  state, and "Check again" (`POST …/domain/check`) asks Cloudflare (`GET …/custom_hostnames/:id`) and runs
  `statusDomain.check` (event `status_domain.checked`, with the state it moved from). Active means the hostname and its
  certificate are; failed means Cloudflare gave up (blocked, moved, deleted, a validation that timed out), shown with
  its reason; anything else is pending.
- **Removing** (`DELETE …/domain`) deletes the hostname at Cloudflare first (one it no longer has counts as deleted),
  then runs `statusDomain.remove` (`status_domain.removed`) and releases D1. If Cloudflare refuses, nothing changes,
  so a domain the dashboard no longer shows never keeps serving.
- **The public lookup** is a KV key per hostname (`host:<hostname>` = the slug, in `STATUS`), kept in step by the
  queue consumer on `status_domain.added`, `.checked`, `.removed` and `status_page.configured`. It reads the shard's
  domain and page as they are now, never the event's copy, so events handled late or twice leave the latest state:
  the key exists only while the domain is active, the hostname is this workspace's in D1 and the page is public under
  a slug it holds. A hostname another workspace holds by then is left to that workspace's events (tested).
- **Serving.** Custom hostnames reach the API Worker through a Workers route on the SaaS zone (the dashboard keeps its
  own, more specific route). A request whose host is not the dashboard's, when custom domains are on, reaches only
  that page: `/` is the page, `/status/<its slug>/…` its feeds and subscription routes, and anything else (another
  page, the API, sign-in) is the 404 page, counted as a miss. A hostname with no lookup is the same 404. The page,
  its caches and its headers are the ones of `/status/<slug>`; feed and email links stay on `DASHBOARD_URL`.
- **Setup** (apps/api README "Custom domains", not run by Brigade): a zone for Cloudflare for SaaS, a fallback origin
  on it (a proxied hostname such as `status-origin.example.net`), a Workers route `*/*` on that zone to the API
  Worker, the token with "SSL and Certificates: Edit" on the zone, then the three settings as secrets. The setup
  wizard will take the same steps.

## The snapshot

`statusSnapshot` (packages/schema) builds the whole public page as JSON: the page's name and language, when it was
built, the overall status, the groups with each component's name, derived status and uptime bar, the open incidents
(most impact first) and the history, each incident with its public title, status, impact, the names of its components
and its updates (newest first), and the maintenance windows under way and upcoming. It holds no ids, no members and
nothing internal (tested: the snapshot never contains the internal title, any member, workspace, incident, component,
monitor or maintenance id). Version 2 added uptime, maintenance and the `maintenance` component status; the reader
renders 1 and 2 and refuses anything else, including a 1 carrying the new fields. A page with no uptime bar and no
maintenance window under way or upcoming is still written as a 1, so a Worker rolled back to a reader of 1 keeps
serving it; only a page using what 2 added needs the newer reader. Incidents and windows also say when what the
public reads about them last changed (`updatedAt`, and a window's `publishedAt`), optional in both versions: every
reader skips fields it does not check, so they need no new version ("Feeds").

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
- **Rebuilt daily.** A public page is pushed again at the first UTC midnight after its last push (so at least once a
  day, `STATUS_REFRESH_MS`) even when nothing changed, under the same backoff, so the 90-day history drops what aged
  out, the uptime bars' "today" moves on with the date and "Updated" stays true on a quiet page. One KV write a day
  per page, and one every 5 minutes (`STATUS_OUTAGE_REFRESH_MS`) while an alert of a monitor linked to an uptime bar
  is firing, so an outage under way grows on the bar instead of showing as the blip it was at its last push.
- **Fallback.** A failed push keeps everything pending and is retried from the alarm with backoff (1 s doubling to
  5 minutes, jittered), logged on every failure. The page always says when its snapshot was built ("Updated … UTC"),
  so a visitor can tell how fresh it is; while KV or the shard is down, visitors keep reading the last snapshot,
  which is the honest answer (the last thing the team said). Without a `STATUS` binding nothing is pushed and every
  address answers 404, while the dashboard still sets the page up; adding the binding later publishes on the next
  change. Past 48 hours (`STATUS_STALE_MS`) the page also says "This page may be out of date: it was last updated
  …" under its banner (decided, Q23), since a page that is rebuilt daily and is older than that means the shard or
  KV is stuck. The Worker decides when it renders, so the notice appears within the page's 30 s of caching.

## The public page

- `GET /status/:slug` on the dashboard's origin: the web Worker forwards `/status/*` to the API unchanged (it is in
  `run_worker_first`, so the SPA never answers it), and the API renders HTML from the snapshot. No session, no
  cookies read, only `GET` and `HEAD`.
- **Server-rendered, one script.** A plain HTML document with inline CSS, the design tokens of `packages/ui` (light
  and dark by `prefers-color-scheme`), readable on a phone: the viewport set, safe-area padding, 16 px text, rows at
  least 48 px tall, long names wrapping. Past incidents fold behind `<details>`. Everything works without script; the
  one script only shows times in the visitor's zone ("Local times").
- **Read defensively.** A snapshot is rendered only if it is the version the Worker knows, its language and every
  status one it has words for, and every time a real date (`isSnapshot`); anything else, or a render that throws,
  is the 503 page (not cached), so a Worker older or newer than the shard never shows half a page.
- **Headers**: `Cache-Control: public, max-age=30` (404s 60 s), a Content-Security-Policy that allows nothing but
  inline style, the local times script by its hash and a form posting to the page's own origin (`default-src 'none'`,
  `script-src 'sha256-…'`, `form-action 'self'`, no frames), `nosniff`, `no-referrer`. Every piece of text is
  escaped.
- **Caching and abuse.** The response is kept in the edge cache (the Cache API, keyed by slug alone, so headers and
  hosts never split it; a no-op on workers.dev) and the KV read uses `cacheTtl: 30`, so a busy page costs about one
  KV read per location every 30 s, and a flood of made-up addresses one cached 404 per address. Nothing on the read
  path touches D1 or a shard. **Misses are rate-limited per caller** (decided, Q23): every answer of the page and
  its feeds that would be the 404 (a bad slug, a cached 404, nothing in KV) first counts against the caller's
  address (`cf-connecting-ip`) in Workers Rate Limiting (`STATUS_MISS_LIMIT`, 30 a minute, namespaces 418x); past it
  the answer is a `429` page with `Retry-After: 60`, never cached. A page that exists is never counted, so a busy
  page is never refused to anyone. What it bounds is the answers a caller gets, not what probing reveals or costs: past
  the limit a made-up address answers `429` where a real one still answers `200`, the same signal a `404` gave, and the
  limiter runs after the KV read, so an uncached miss costs the read as before. A request without a
  caller address (a local run) or a limiter that fails is answered as before. Subscribing is the one write a visitor makes, and
  it is rate-limited before it touches either ("Email subscriptions").

## Local times

- **Every time is UTC without script, the visitor's own with it.** Each time on the page is a `<time datetime>` whose
  text is the time in UTC with the zone named ("Oct 27, 2026, 12:05 PM UTC", in the page's language); a script inline
  at the end of the page rewrites each in the visitor's zone with the same format ("9:05 AM GMT-3") and keeps the UTC
  text as its tooltip. Where script is off, blocked or fails, the page reads exactly as before.
- **Why a script, on a page built to need none.** The Worker cannot know a visitor's zone (no header carries it, and
  guessing from the address is wrong for travellers and VPNs), and rendering per visitor would split the one cached
  document and wake KV per zone. Neither HTML nor CSS can format a time in the reader's zone. So a progressive
  enhancement it is, kept as small as the job: one inline script of a few hundred bytes, no file to fetch, no
  library, nothing read but the page and nothing sent anywhere, so the cached document stays the same for everyone.
- **Allowed by its hash, nothing else.** The Content-Security-Policy lists the script's SHA-256 (`script-src
  'sha256-…'`, `LOCAL_TIMES_SCRIPT_HASH`, tested against the script), not `'unsafe-inline'`: a script injected through
  a published text, were escaping ever to fail, still would not run. Keeping the script is decided (Q23). The uptime bars' days stay UTC days, which is
  how they are counted.

## Feeds

- **Atom and JSON Feed**: `GET /status/:slug/feed.atom` (RFC 4287) and `/feed.json` (JSON Feed 1.1), linked from the
  page (`<link rel="alternate">` and in its footer). One entry per open incident, maintenance window under way or
  upcoming, and incident of the history, in the page's order; each with its public title and, as plain text (never
  HTML, so a reader renders nothing the page would not), where it stands, what it affects and every update with its
  time in UTC.
- **The same snapshot, nothing more.** Built from the KV snapshot by the same read path as the page (KV `cacheTtl`,
  the edge cache, `isSnapshot`, the 404 and 503 pages), never from the shard: a feed holds nothing the page does not
  show (tested). An entry's id is the page's address and when the incident was first published (or the window
  starts), since the snapshot has no ids; an incident taken off and published again is a new entry.
- **Dated by what the public reads.** An entry's `updated` (Atom) and `date_modified` (JSON Feed) is when what the
  page says about it last changed (the snapshot's `updatedAt`, from the row): a publish, an edited or removed update,
  a component taken out, a window edited, started or ended. So a correction moves it and a reader replaces the text
  it kept. A window is published when it was planned (`publishedAt`), never at its start, so an upcoming one is not
  dated in the future; its times are in the text. Both fields are optional additions to the snapshot (no version
  change): one written before them dates an incident by its newest update and a window by the earlier of its start
  and the snapshot's build.
- **Headers**: the page's caching (`max-age=30`, the edge cache keyed by slug, format and origin),
  `Access-Control-Allow-Origin: *` (it is public, and a widget on another site may read it; decided, Q23), `nosniff`. Addresses in
  a feed are absolute, from `DASHBOARD_URL` (the page's origin), else the request's.

## Uptime

- **Optional per component**: `statusComponent.linkMonitors` (`status:manage`) links a component to up to 5 of the
  workspace's monitors (`MAX_COMPONENT_MONITORS`); an empty list takes the bar off. Deleting a monitor takes it out of
  every component in the same transaction.
- **Computed in the shard**, in the snapshot (`uptime`, packages/schema): 90 UTC days (`UPTIME_DAYS`), today included.
  A day's downtime is the time any linked monitor had an alert firing (the union, so two monitors down at once count
  once); an alert is the monitor's own verdict after its consecutive checks (RFC 0007), so one failed check is not
  downtime. A day is `up` with none, `degraded` under an hour (`UPTIME_DOWN_MS`), `down` from an hour, and `none`
  before the first linked monitor existed. The percentage is the watched time that was up, two decimals, rounded down
  so 99.999 never shows 100. Monitors keep no history of their checks, which is why alerts are the source. A
  monitor paused now has watched nothing since its pause: those days are `none` unless another linked monitor
  watched, and downtime counts only while one did. Earlier pauses are not kept, so they count as up (Q23).
- **Pushed when it moves**: an alert firing or resolving marks the snapshot dirty only when its monitor is linked to
  a component (`touchesStatusPage`), so a busy monitor nobody shows never rebuilds the page; the page is rebuilt
  every 5 minutes while a linked one fires, and at UTC midnight the bars move on to the new day ("The
  snapshot").
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
  components, at most 10, soonest first, in UTC (the visitor's zone with script, "Local times"). A component under maintenance shows it only while nothing worse (an
  incident, its own status) does, and the banner says "Scheduled maintenance in progress" when everything else is
  operational. The page's overall status is unchanged: maintenance is not an outage.
- **A planned outage** (decided, Q23): a window may say it takes its components down (`outage` on
  `maintenance.schedule` and `.update`, carried by every maintenance event, `outage: true` on the snapshot's window,
  an optional field, so no new snapshot version). While it runs its components show `major_outage` (the worse of
  that and anything else); the page's overall status and banner stay the team's and the incidents', as for any
  maintenance, so planned work never reads as an incident. The window carries a "Planned outage" chip and says its
  components are down while it runs, upcoming or under way, and so do its feed entries. The emails are unchanged.
- **The dashboard's Scheduled maintenance card** lists open and recent windows with their times in the viewer's time
  zone, and plans, edits, ends and calls them off (asking first); a "Planned outage" box under the components, and a
  badge on the row.

## Email subscriptions

Visitors subscribe on the page to hear of incidents and maintenance by email, in the page's language.

- **Subscribers live in D1** (`status_subscriber`, migration 0009: id `ssb_…`, workspace, lower-cased address with
  its domain in ASCII (an internationalized domain as punycode, so both spellings are one address), the inbox it
  reaches (`canonical`: the `+tag` dropped at every domain, and at Gmail the dots, `googlemail.com` as `gmail.com`),
  `pending`
  or `confirmed`, when, and how many confirmations were asked for), never in the shard: the shard keeps no email
  addresses (RFC 0005 "Email"), and a refused or repeated subscribe never wakes it. One inbox is one subscriber per
  page, whichever spelling it came with. Every change still emits an event through the shard's outbox, with the
  subscriber's id and never the address: `status_subscriber.requested` (`subscriberId`, `send`), `.confirmed`,
  `.removed` (`reason`: `unsubscribed`, `deleted` or `expired`), `.followed` (`follows`: how many keys, "Following
  components"), from server-only mutations.
- **The shard and D1 stay in step.** A request writes D1, then runs its mutation; a shard that refuses or cannot be
  reached gives the confirmation back in D1: its send counted back, and a row whose sends in its first window all
  went back deleted (an older one stays for the sweep and its `expired` event), so asking again sends it. Two
  requests at once that both failed end with no row, in either order (tested).
  Confirming, unsubscribing and deleting run the shard's mutation first and then write D1; the shard records each
  subscriber's confirmation and removal once (`status_subscriber_events`, kept 15 days), so a retry after a failure
  in between finishes the D1 write without a second event.
- **The form**: a plain `POST /status/:slug/subscribe` form on the page (no script), shown only where email can be
  sent. The answer is always "Check your inbox: if this address isn't subscribed yet, we've sent it a link", whether
  the address was new, pending, confirmed, over its caps or the honeypot field (`website`, off-screen, never filled by
  a person) was filled: the form tells nobody who is subscribed. Nor does its timing: past the rate limits the answer
  goes out at once, and D1 and the shard run after it (`waitUntil`). A bad address is a 400, another origin a 403.
- **Abuse.** Workers Rate Limiting before D1 or a shard: 5 a minute per caller address
  (`STATUS_SUBSCRIBE_IP_LIMIT`) and 30 a minute per page (`STATUS_SUBSCRIBE_PAGE_LIMIT`), namespaces 416x and 417x
  per environment; over either a 429 page. Every cap on an address counts its inbox (`canonical`), so `+tags` and
  Gmail's dots add up to one. The `+tag` is dropped at every domain, not only where `+` is known to be a tag: a rare
  address whose `+` is part of its name shares a subscription with the one without it, which is the safer mistake
  for abuse. A pending inbox gets at most 3 confirmations from one page (`STATUS_CONFIRM_SENDS`) and an inbox at
  most 5 a day from every page together (`status_confirmation_send`). By recipient domain, unless the inbox is
  already confirmed on some page of the instance (its owner reads them; found by `canonical`, migration 0010): one
  page sends a domain at most 20 a day (`STATUS_CONFIRM_PAGE_DOMAIN_DAILY_CAP`, `status_confirmation_page_domain`),
  and a domain that is not a large mail provider's (Gmail, Outlook and Hotmail, Live, MSN, Yahoo, iCloud, Proton,
  GMX: `isLargeProvider`) gets at most 50 a day from every page together (`STATUS_CONFIRM_DOMAIN_DAILY_CAP`,
  `status_confirmation_domain`). So one page cannot use up a large provider for everyone, and made-up addresses
  cannot flood a catch-all domain. Spellings of one inbox that `canonical` cannot see (a custom domain's own dots
  or aliases, a catch-all, subdomain addressing) are bounded by that same non-provider cap. All are counted in D1
  when sent, once per confirmation: a retry after a refused send does not count it again. A page
  sends at most 200 confirmations a day (`STATUS_CONFIRM_PAGE_DAILY_CAP`, counted in the shard apart from its
  notifications, so sign-ups never spend their budget). A page holds at most 1000 confirmed subscribers
  (`STATUS_SUBSCRIBERS_MAX`) and, apart from them, 200 pending (`STATUS_PENDING_MAX`). A pending subscriber is
  deleted once its link has expired, 48 hours after it was last asked for, by the API's cron once an hour
  (`sweepSubscribers`, each with its `expired` event), which also drops the daily counts of days gone. Nothing but
  that one confirmation ever goes to an unconfirmed address. These numbers stay as they are (decided, Q23).
- **Double opt-in.** The confirmation email links `/status/:slug/confirm?t=…`, signed (HMAC-SHA256 under a key
  derived from `BETTER_AUTH_SECRET`; the token carries the kind, workspace, subscriber and expiry) and valid until 48
  hours after the subscribe it answers, when the row is swept. The sweep deletes only rows still as it read them
  (`requested_at` unchanged), so one asked for again while it ran keeps its new confirmation.
  A `GET` only shows a "Confirm subscription" button that posts, so a mail scanner opening links confirms nobody.
- **Links work from their token alone.** It names the workspace, so a link keeps working after the page moved to
  another address or stopped being public: the page's title and language come from the address only while it still
  shows this workspace's page, and otherwise the page is plain English named by the address in the link.
- **Leaving.** Every notification carries a manage link (`/manage?t=…`, signed, no expiry, dead once the row is
  gone) showing the masked address, what it follows (with the choice to change it, "Following components") and an
  Unsubscribe button, and RFC 8058's `List-Unsubscribe` (https only, which
  Email Sending requires) with `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, so a mail client unsubscribes in
  one click with a `POST`. The email's footer links `/unsubscribe` too: a `GET` there shows the manage page and its
  button, so a scanner unsubscribes nobody. Unsubscribing deletes the row.
- **Owners and admins** (`status:manage`, checked in D1): `GET /workspaces/:id/status-page/subscribers` (counts, and
  what confirmed subscribers follow: "Following components"),
  `…/export` (CSV of address, status, times and what each follows; a value starting with a formula character is quoted), and `DELETE`
  with `{ email }` (any spelling of the inbox). The dashboard's Status page card shows the counts, the export and removal by address; no other
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
  go at most 2 s later, so the next batch's pages never wait on email. A confirmation runs its D1 reads, its caps and
  its send in one slot the same way, so a flood of sign-ups in a batch never holds a page's relay call (tested); one
  that finds no slot in time is tried again soon, without counting as a failure in the ledger. That wait rides the
  message's Queue retries (a confirmation that finds no slot through all of them is dead-lettered, and the visitor
  can ask again); moving confirmations onto the outbox like long lists is left until slot waits show up in the
  logs. Subscribers left: the shard runs
  `statusEmail.continue`, whose `status_email.continue` event brings the event back through the outbox, never riding
  the original message's Queue retries. A refusal a retry may fix stops the batch there and is retried (30 s doubling
  to 5 minutes, at most 5 failed batches, then given up and logged); one refused for good is skipped. A lost report
  can send a batch twice (at least once, like every delivery here).
- **Only to those it is for**: see "Following components". The batches, budgets, caps and the cursor are unchanged:
  the cursor walks confirmed subscribers in id order, and a batch reads only those the event is for.
- **Cap per page**: 5000 emails a UTC day (`STATUS_EMAIL_DAILY_CAP`); past it the rest of the day's are dropped and
  logged.
- **Links** use `DASHBOARD_URL` (the page is served on the dashboard's origin); without it nothing is sent, except by
  the dev log sender, which uses the origin the visitor subscribed through.

## Following components

A visitor may follow some components only. Nothing chosen is everything, which is what every subscriber from before
had and keeps (migration 0013 adds a nullable column).

- **Keys, not ids.** The snapshot gives each component a follow key (`c-` and 16 hex digits of a hash of its id) and
  each named group one (`g-` and a hash of its name): `statusFollowKey` in packages/schema. They are optional fields,
  so the snapshot's version is unchanged and an older snapshot shows the form without the choice. A key is public
  (it is in the HTML) but it is not an id, so nothing the snapshot promises about ids changes. A renamed component
  keeps its key; a renamed group gets a new one, so its followers no longer match it (as below).
- **The form** (still no script): the checkboxes, named `follow`, are in the subscribe form behind a `<details>`
  ("Only some components (optional)"), one fieldset per group with a box for the whole group (it covers components
  added to it later) above its components. The API keeps only keys the page offers at that moment, at most 100 (every
  component and group of a full page), and stores them as a JSON array in `status_subscriber.follows`; none is
  `null`, everything. A pending subscriber asking again gets the new choice with the new confirmation, since that is
  the request its link answers; a confirmed subscriber's choice is never changed from the public form (anyone can
  type their address into it), and the answer is the same as ever, so the form still tells nobody who is subscribed.
- **The manage link** shows what the subscriber follows and, while the page is public at the link's address, the same
  checkboxes ticked as they are, "Save" and "Follow everything" (`POST /status/:slug/manage?t=…`). Saving runs the
  server-only `statusSubscriber.follow` first (its `status_subscriber.followed` event carries the subscriber's id and
  how many keys, never the keys or the address), then writes D1, like confirming; it is not deduplicated, since a
  subscriber may change their mind, so a retry after a D1 failure can emit a second event. Unsubscribing is unchanged
  and stays one click (RFC 8058): its own `POST /unsubscribe`.
- **Who is emailed.** The shard's plan carries an audience (`statusAudience`): an incident or maintenance window that
  names no component still on the page goes to every confirmed subscriber; one that does goes to those following
  everything, one of its components or one of their groups, read when the batch is planned (like the content).
- **A component that is gone.** Deleting a component leaves its key in preferences, where it never matches again. A
  subscriber none of whose keys is on the page any more (each component deleted, each group renamed or emptied)
  hears of everything again: the plan also carries every key the page has now, and the query treats "none of mine
  is known" as everything. Chosen over "nothing" because a subscriber who asked for updates and silently gets none
  is the worse failure; the manage page says so ("no longer on the page, so you hear about everything"). Tested.
- **Owners and admins**: the counts add `everything` and each key with its confirmed count; the dashboard's
  subscriber view lists them by name in the page's order (keys it does not know, of components gone, are left out).
  The CSV's `follows` column is `everything` or the names (a group as `group: <name>`), read from the shard.

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
cache purged by hand.

## Events

`status_page.configured` (`slug`, `title`, `locale`, `enabled`, `previousSlug`), `status_component.created` and
`.updated` (`id`, `name`, `group`, `status`), `status_component.reordered` (`ids`),
`status_component.services_linked` (`id`, `serviceIds`), `status_component.deleted` (`id`, `incidents`: how many published
incidents named it), `incident.update_published` (`entryId`, `title`, `status`, `impact`, `componentIds`,
`body`), `incident.published_update_edited` (`entryId`, `updateId`, `body`), `incident.published_update_removed`
(`entryId`, `updateId`) and `incident.unpublished` (`entryId`, `title`); `status_component.monitors_linked` (`id`,
`monitorIds`); `status_domain.added` (`hostname`, `state`), `.checked` (`hostname`, `state`, `previous`) and
`.removed` (`hostname`); the maintenance and subscriber events above, and `status_email.continue` (`eventId`). The status page
email notifier acts on `incident.update_published`, the maintenance events, `status_subscriber.requested` and
`status_email.continue`; none of them is in the webhook catalog yet.

## Not yet

- Embedding, purging a custom domain's cache by URL, pruning history past 90 days, showing who published (choice per page), maintenance and subscriber
  events in the webhook catalog, the mobile app's publish and maintenance actions.
- KV namespaces for staging and production: `STATUS` is bound for local runs and the tests and, in `dev`, to
  `brigade-status-dev` (apps/api README "Status page"). The self-host setup steps create it (decided, Q23; apps/api
  README "Self-host setup").
