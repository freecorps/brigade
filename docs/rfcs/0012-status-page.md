# RFC 0012 — Public status page

- Status: Draft

A public page per workspace where customers see which parts of the service work and what the team chose to tell
them about incidents (RFC 0001 goal 9, RFC 0003 `StatusPage`). This RFC covers the first slice: the page, its
components, publishing an incident update to it, and the public read path. What is left is at the end ("Not in this
slice"). The code: `packages/schema/src/status.ts`, `apps/api/src/status-page.ts` (the shard's side),
`apps/api/src/status-route.ts` and `status-html.ts` (the routes and the page), and the dashboard's Status page card
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
- **A slug given up stays claimed until its snapshot is gone.** Changing the slug records the old one
  (`status_retired`, server only) in the same transaction; the shard's push deletes the old KV key and only then
  deletes the D1 row. Otherwise another workspace could claim the slug and have its fresh snapshot deleted, or
  served next to the old one. Taking a slug back before that ran just drops it from the list. Claims and releases
  run one at a time in the shard (an in-memory lock; the object is single-threaded but both wait on D1), so a
  release never undoes a claim made meanwhile.
- **Custom domains are later**: a domain would map to a slug (Cloudflare for SaaS custom hostnames) and the same
  route would serve it.

## The snapshot

`statusSnapshot` (packages/schema) builds the whole public page as JSON: the page's name and language, when it was
built, the overall status, the groups with each component's name and derived status, the open incidents (most
impact first) and the history, each incident with its public title, status, impact, the names of its components
and its updates (newest first). It holds no ids, no members and nothing internal (tested: the snapshot never
contains the internal title, any member, workspace, incident or component id).

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
  forward; the alarm, after the outbox drain (a page never waits on KV; the push gets 5 s of the alarm, then
  finishes in the background, so a slow KV never delays the next escalation level), builds the snapshot and puts it (or
  deletes the key when the page is not public), then deletes retired slugs' keys and releases them in D1. It clears
  the dirty mark only up to the version it read, so a change committed during the write is pushed next. Pushes are
  spaced at least 1 s apart (KV's per-key limit).
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
- **Headers**: `Cache-Control: public, max-age=30` (404s 60 s), a Content-Security-Policy that allows nothing but
  inline style (`default-src 'none'`, no frames), `nosniff`, `no-referrer`. Every piece of text is escaped.
- **Caching and abuse.** The response is kept in the edge cache (the Cache API, keyed by slug alone, so headers and
  hosts never split it; a no-op on workers.dev) and the KV read uses `cacheTtl: 30`, so a busy page costs about one
  KV read per location every 30 s, and a flood of made-up addresses one cached 404 per address. Nothing on the path
  touches D1 or a shard, so there is nothing per request to rate-limit; a rate limit and Cloudflare's own DDoS
  protection on the custom hostname are for the custom-domain slice.

## Language

Chosen per page (`locale`, `en` or `pt-BR`; RFC 0008): a status page is one document every visitor reads, like a
shared Slack channel, not text addressed to one person. The page's wording (`status_text`) is rendered in it on the
server; what the team writes is not translated. The 404 and error pages, which have no page to take a language
from, are in English.

## Privacy

Nothing internal leaks: no member names (no "updated by"), no internal titles, severities, roles or timeline
entries, no ids. Only what someone typed into the publish form or the components list reaches the public, and the
form says so. Showing who published an update could become a per-page choice later.

## Events

`status_page.configured` (`slug`, `title`, `locale`, `enabled`, `previousSlug`), `status_component.created` and
`.updated` (`id`, `name`, `group`, `status`), `status_component.deleted` (`id`, `incidents`: how many published
incidents named it) and `incident.update_published` (`entryId`, `title`, `status`, `impact`, `componentIds`,
`body`). No notifier acts on them yet; email subscriptions (slice 3) will.

## Not in this slice

- Email subscriptions (RFC 0001 goal 9) with double opt-in, through the email notifier (slice 3).
- Custom domains, uptime bars from monitors, scheduled maintenance, reordering components, local times on the page,
  a JSON or RSS feed, embedding, pruning history past 90 days, showing who published (choice per page).
- Deployed KV namespaces: `STATUS` is bound only for local runs and the tests (apps/api README "Status page").
