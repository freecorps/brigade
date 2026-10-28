# RFC 0005 — Domain events and the open integration model

- Status: Draft

## Domain events

Every successful mutation emits one or more events with a CloudEvents-style envelope (the one exception is a
mutation declared `silent`: today `monitor.report`'s routine refreshes, `member.sync`, the shard's cache of the
members in D1, `webhook.record`, an outbound webhook's delivery log, which emits only when it turns the endpoint
off, `export.reserve`, an export's slot in the hourly limit, whose export emits `workspace.exported` once recorded,
`alert.ingest`, an alert source's payload, whose repeats change rows but are no domain event, and `device.touch`,
which records when a member last registered a device that did not change (RFC 0006); RFC 0004):

```ts
interface BrigadeEvent<T = unknown> {
  id: string; // ULID, prefixed like every id (RFC 0003): "evt_01JB…"
  type: string; // "incident.declared", "incident.severity_changed", "alert.fired", "page.escalated", ...
  source: string; // "brigade://<workspace>/<shard>": "brigade://acme/workspace", "brigade://acme/inc_…"
  workspaceId: string;
  time: string; // ISO 8601
  actor: { kind: "user" | "system" | "integration"; id: string };
  subject?: string; // e.g. incident id
  data: T;
  specversion: "1.0";
}
```

Event types are versioned with the schema package and documented in the generated API reference. Monitors (RFC 0007)
emit `monitor.created`, `monitor.updated`, `monitor.paused`, `monitor.resumed`, `monitor.deleted`, `monitor.checked`
(when a source's verdict or failure reason changes; the 5-minute refreshes of an unchanged verdict are synced but
emit nothing), `monitor.status_changed` (to `unknown` too, when probes stop reporting), `alert.fired` and
`alert.resolved`, with actor `sys_monitors` for what the probes and heartbeats cause; `monitor.heartbeat_rotated`
(`id`; never the token or its hash) when an owner or admin gives a heartbeat a new URL; `monitor.cap_changed`
(`cap`, null for the instance's) when an owner sets the workspace's monitor limit; and, when the owner of an
address takes back an account someone else signed up with (RFC 0002 "Auth"), `monitor.paused` and
`monitor.heartbeat_revoked` (`id`) with actor `sys_account`.

Incidents emit `incident.declared`, `incident.renamed` (`from`, `to`: the titles before and after; RFC 0003
"Incident lifecycle"), `incident.status_changed`, `incident.severity_changed`,
`incident.acknowledged`, `incident.update_posted` (`entryId`, `body`), `incident.update_edited` (`entryId`, `body`,
`previous`: the text it replaced), `incident.update_deleted` (`entryId`, `author`; never the text; RFC 0003
"Editing and removing an update"), `incident.paged_again` (`entries`: the
`page_failed` entries paged again, `userIds`, `everyone`, `causedBy`: who the interim rule leaves out; "Page again"
below) and `incident.role_assigned` (`role`,
`roleId`, `roleName`, `from`, `to`; `to` null when unassigned; `roleId` the role's id, a built-in's name or a
workspace role's `rol_…`; `role` the built-in's name, or `custom`; `roleName` the workspace's name for it, null for a
built-in under its own; events from before role definitions have `role` only, which is the id). Each of those mutations also appends the incident's timeline entry in
the same transaction (RFC 0003 "Timeline, updates and roles"); the monitor recovery note rides with
`alert.resolved`.

The catalog (RFC 0003 "Service catalog", "Incident types", "Custom fields") emits `service.created` (`id`, `name`,
`tier`, `owners`: how many, `escalationPolicyId`), `service.updated` (the same, plus `reason`: `edited`, or
`policy_deleted`, `schedule_deleted` or `member_removed` with the `ref` taken out), `service.deleted` (`id`, `name`),
`incident_type.created` (`id`, `name`, `defaultSeverity`, `escalationPolicyId`, and `requiredFields`, `roles` and
`requiredRoles`: how many), `incident_type.updated` (the same, plus `reason`: `edited`,
`policy_deleted`, `field_deleted` or `role_deleted`, and `ref`), `incident_type.deleted`, `custom_field.created` and
`custom_field.updated` (`id`, `name`, `kind`, `options`: how many), `custom_field.deleted`, `incident_role.created`,
`incident_role.updated` and `incident_role.restored` (`id`, `name`: empty for a built-in under its own, `checklist`:
how many) and `incident_role.deleted` (`id`, `name`, `builtin`: a built-in taken out rather than deleted). On incidents: `incident.type_changed` (`from`, `to`: type ids or null),
`incident.services_changed` (`serviceIds`, `added`, `removed`) and `incident.field_changed` (`fieldId`, `kind`,
`value`: the text, number or option ids, null when cleared).

Follow-ups, postmortems and exports (RFC 0013) emit `follow_up.created`, `follow_up.updated` (plus `reason`: `edited`,
or `member_removed` when its owner left), `follow_up.completed`, `follow_up.reopened` and `follow_up.deleted` (each
with `id`, `incidentId`, `title`, `ownerId`, `dueDate`, `status`); `postmortem.saved` (`incidentId`, `revision`,
`characters`: never the text), `postmortem.draft_requested` (`incidentId`, `requestId`, `by`), `postmortem.drafted`
(the same as saved, plus `requestId` and `model`) and `postmortem.draft_failed` (`incidentId`, `requestId`, `reason`);
and `workspace.exported` (`id`, `scope`, `incidents`, `bytes`, `expiresAt`). No notifier acts on them yet and none pages; they are not in the outbound webhook catalog
(`WEBHOOK_EVENT_TYPES`) yet either.

On-call schedules (RFC 0003 "Schedules") emit `schedule.created` (`id`, `name`, `timeZone`, `layers`: how many),
`schedule.updated` (the same, plus `reason`: `edited`, or `member_removed` with the `userId` taken out of the
rotations), `schedule.deleted` (`id`, `overrides` deleted with it), `schedule.override_added` (`id`, `scheduleId`,
`userId`, `start`, `end`) and `schedule.override_removed` (`id`, `scheduleId`, `userId`, `reason`: `removed`,
`member_removed` or `expired`). Escalation policies (RFC 0003 "Escalation policies") emit `escalation_policy.created` (`id`, `name`, `levels`: how many,
`repeat`, `isDefault`), `escalation_policy.updated` (the same, plus `reason`: `edited`, `default_changed` when another
policy became the default, `member_removed` with the `userId` or `schedule_deleted` with the `scheduleId` taken out of
the levels) and `escalation_policy.deleted` (`id`, `wasDefault`). Escalation runs, actor `sys_escalation`, emit
`escalation.paged` for every level fired (`incidentId`, `policyId`, `level`, 1-based or null for everyone who can
respond, `round`, `userIds`, `missed`: the targets that could not be paged, `reason`: `started`, `timeout`,
`unreachable`, and for everyone who can respond also `exhausted` or `stalled`, `started`, true for the page a run
started with, which is paged on the event that started it, and `run` and `step`, the event that started the run and
the page's number in it, so a page from a run that has since stopped is not sent) and `escalation.exhausted` (`incidentId`, `policyId`, `levels`, `rounds`). An ack or a resolve stops a run with no
event of its own: `incident.acknowledged` and `incident.status_changed` say it. A member removal or a change to
viewer carries the schedule and policy events with
`member.removed` or `member.role_changed`, in the same transaction; a viewer role copied from D1 by `member.sync`
carries them alone (no `member.*` event: that change happened outside Brigade).

The status page (RFC 0012) emits `status_page.configured` (`slug`, `title`, `locale`, `enabled`, `previousSlug`),
`status_component.created` and `status_component.updated` (`id`, `name`, `group`, `status`),
`status_component.deleted` (`id`, `incidents`) and `incident.update_published` (`entryId`, `title`, `status`,
`impact`, `componentIds`, `body`), with a `status_published` timeline entry for the last; its corrections emit
`incident.published_update_edited` (`entryId`, `updateId`, `body`), `incident.published_update_removed` (`entryId`,
`updateId`) and `incident.unpublished` (`entryId`, `title`), each with a `status_corrected` entry. The public
snapshot is not an event consumer: the shard pushes it to KV from its alarm.

Users, sessions and membership live in D1, written by Better Auth (RFC 0002), not by a shard. A change there that
integrations care about is announced by the workspace shard: creating a workspace runs `workspace.create` in its
new `WorkspaceDO` (`workspace.created`, subject the workspace id). Member changes made through Brigade emit
`member.role_changed` (`userId`, `from`, `to`) and `member.removed` (`userId`, `role`, null when the shard no longer
knew it, `reason`: `removed`, `left`,
or `reconciled` when the shard caught up with a change D1 had and it missed, actor `sys_members`; a member
removed through Brigade whose copy a late sync upgrade restored is announced again as `reconciled`), subject the
member, after D1 committed (RFC 0003 "Members"); both carry `schedules`, the schedules the member was taken out of
(`id`, `name`, `emptied`; empty unless they left or became a viewer, RFC 0003 "Schedules"); a removal also emits `device.unregistered` (`member_removed`) for
each of the member's devices. Invitations (RFC 0003 "Invitations") emit `member.invited` (`invitationId`, `role`,
`invitedBy`, `expiresAt`, `send`; subject the invitation, never the address), `invitation.revoked` (`invitationId`,
`revokedBy`), `invitation.declined` (`invitationId`, `userId`) and, on acceptance, `member.added` (`userId`, `role`,
`invitationId`; subject the member, actor `sys_members`), each after D1 committed, with the same repair as member
changes when the shard step fails. The creator's own membership is part of `workspace.created` (`createdBy`). The
API still refuses Better Auth's routes that would change a workspace or its members without an event (update,
delete, member roles, removing or adding members, its invitation routes, teams, leaving); see RFC 0002 "Auth". The shard's own copy of a member (`members`, written by `member.sync` when they open a socket)
is a cache of D1, and `member.sync` emits nothing of its own; when it copies a viewer role it emits the schedule
events of taking that member out of the rotations (above).

Devices and paging emit `device.registered` (`id`, `userId`, `platform`, `environment`, `voip`: never the tokens or
the key), `device.unregistered` (`reason`: `unregistered` by the member, `token_invalid` when APNs said the token is
gone, `member_removed` when its member left or was removed, `password_reset` when its member's password was reset,
from `device.signOut`, or from `member.reconcile` when that failed, RFC 0002 "Auth"), `device.voip_cleared` (`id`,
`userId`, `reason: token_invalid`: APNs refused a call to its PushKit token as gone, so it no longer rings; its pushes
go on, RFC 0010), `member.calls_changed` (`userId`, `calls`: the member's choice of which pages ring them as a call,
RFC 0010 "Who a call rings") and `notification.failed` (`incidentId`, `eventId` of the event that asked for the page, `channel: "push"`,
`userId` or null, `reason`: `no_devices`, `token_invalid` (no device left because the push service refused the one a
page of this incident went to), `undelivered`, `unsupported`, `not_configured`, `over_limit`,
`dead_lettered`, and for escalation levels `nobody_on_call`, `schedule_missing`, `not_a_member`; `schedule`: the
name of the schedule nobody was on call for, else null; `page`: the escalation run and step it belongs to, absent
outside a run), with actor
`sys_notifier` for what the notifier records. Delivery receipts (RFC 0006 "Delivery receipts") emit
`notification.planned` (`incidentId`, `eventId`, `devices`: how many new, `calls`: of those, how many a call row was
planned for too, absent when none, `page`, `dropped`: older delivery rows removed to keep the latest 20 per device and
kind, absent when none), `notification.sent` (`incidentId`, `eventId`, `accepted`, `failed`: one attempt's alert
pushes; `calls`: `{ accepted, failed }` for the calls it rang, absent when none) and `notification.delivered` (`incidentId`, `eventId`,
`userId`, `deviceId`: the phone opened it), actor `sys_notifier`; no notifier acts on them. A push held back behind
a page (RFC 0006 "Offline phones") goes out on `notification.released` (`incidentId`, `eventId` of the push held,
`deviceIds`), actor `sys_notifier`, which only the push notifier acts on. `notification.failed` rides with a `page_failed` timeline entry. The
email notifier's own failures are `notification.failed` with `channel: "email"` (`incidentId`, `eventId`: the push
failure the email was about, `userId`, `reason`: `undelivered`, or `capped` when a cap dropped it, `about`: `unpaged` or `nobody_paged`), with an
`email_failed` entry ("Couldn't email Ana that nobody could be paged"). Changing who is emailed emits
`workspace.email_changed` (`unpaged`, `nobodyPaged`); turning AI drafts of postmortems off or on emits
`workspace.ai_drafts_changed` (`enabled`, RFC 0013). `workspace.created` carries the workspace's `locale` too, and an owner changing
it emits `workspace.locale_changed` (`locale`, `previous`; RFC 0008 "Workspace locale", Q15).

Outbound webhooks ("Outbound webhooks" below) emit `webhook.created` (`id`, `events`, `enabled`), `webhook.updated`
(`id`, `events`, `urlChanged`, `headersCleared`), `webhook.enabled` (`id`), `webhook.disabled` (`id`, `reason`: `manual`, or `failing`
when Brigade turned it off, `failures`), `webhook.secret_rotated` (`id`), `webhook.headers_changed` (`id`, `names`: the
custom headers' names, never a value), `webhook.deleted` (`id`), `webhook.test` (`id`: "Send test event") and
`webhook.replay` (`id`, `eventId`, `type`: "Replay" from the delivery log), subject the endpoint; never its URL (which
may carry the receiver's token), its secret or a header's value. The webhook notifier's `webhook.redeliver`
(`eventId`) brings deliveries due again back to the queue ("Retries").

Alert sources (below, "Alert sources") emit `alert_source.created` and `alert_source.updated` (`id`, `name`, `kind`,
`headerName`, `signed`; never the token, the header value or the signing secret), `alert_source.rotated` (`id`),
`alert_source.mapping_changed` (`id`, `mapping`: the title template and severity map, or null; "Alert sources",
"Mapping"), `alert_source.deleted` (`id`, `resolved`: how many firing alerts it resolved) and, on a takeover (RFC 0002 "Auth"),
`alert_source.revoked` (`id`, actor `sys_account`); routes emit `alert_route.created` and `alert_route.updated` (`id`,
`name`, `position`, `match`, `action`, and `reason`: `policy_deleted` when the policy it named was deleted, or
`takeover` when a takeover disabled it),
`alert_route.moved` (`id`, `position`) and `alert_route.deleted` (`id`). Ingesting, as `sys_alerts`, emits
`alert.fired` (`id`, `fingerprint`, `sourceId`, `incidentId` or null, `outcome`: `opened`, `grouped` or
`suppressed`, `routeId` or null, `reason`: `matched`, `default`, `malformed` or `capacity`) after the
`incident.declared` it opened, `alert.dropped` (`id`, `fingerprint`, `sourceId`, `routeId`, `routeName`) and
`alert.resolved` (`id`, `sourceId`, `reason`: `resolved`, `source_deleted`, `incident_closed`, `expired`, `evicted` or
`rerouted`, and `resolvedIncident` when the incident resolved with it, followed by its `incident.status_changed`). A
monitor's `alert.*` events carry `monitorId` instead of `sourceId`; one a route took (RFC 0007 "Monitor alerts
through the routes") also carries `outcome`, `routeId` and `reason` `matched` on `alert.fired` (`incidentId` null when
suppressed), `alert.dropped` when dropped, and `alert.resolved` with `reason` `rerouted` when a quiet one is routed
again. A monitor's `alert.resolved` also has `reason` `incident_closed` (people closed the incident it was on while it
was down: it alerts again at its next report), `quiet: true` when the alert had no incident (suppressed or dropped),
and `resolvedIncident` when recovering settled an alert source's incident it was grouped onto. Receivers of the
public webhook catalog (below) get neither side of a quiet monitor alert: its `alert.fired` has no incident and its
`alert.resolved` is `quiet` (a `rerouted` one always is), so a receiver never gets a resolve for an alert it never saw
fire; they still get `monitor.status_changed`. A repeat of a firing alert emits nothing, nor
does a firing held by a resolve that came before it (recorded as `resolved_early`, "Alert sources").

The paging pipeline's own watchdog (RFC 0007 "Watching the watcher") writes events too, through its own outbox and
the same Queue, with `workspaceId` `_system` (no workspace can have it; `source` `brigade://_system/watchdog`, actor
`sys_watchdog`): `brigade.heartbeat` (`beat`, a counter) once a minute, which the consumer proves and never sends to
a shard, and `brigade.status_changed` (`status`, `previous`, `reasons`) when the pipeline turns `ok`, `degraded` or
`unknown`. Consumers that only care about workspaces skip `_system`.

## Delivery: transactional outbox

1. A mutation writes its rows **and** its events to an `outbox` table in the same DO SQLite transaction.
2. The shard's alarm drains the outbox to a Cloudflare Queue (`brigade-events`; `brigade-events-dev` and
   `brigade-events-staging` in those environments), deleting rows only after the send succeeds.
3. Consumers are idempotent by `event.id`.

Result: at-least-once delivery, no event lost if the Worker dies between write and publish.

Decided with the drain (`apps/api/src/outbox.ts`):

- **Trigger.** Every mutation that wrote events brings the shard's one alarm forward to now (or to the end of the
  backoff). The alarm is shared with monitoring (RFC 0007): it runs the monitor tick first, then the drain, so the
  tick's own events go out in the same run, and then moves to the earliest time either needs. No drain runs outside
  the alarm, so two never overlap.
- **Order.** Oldest row first (`seq`), one `sendBatch` at a time; nothing after a failed batch is sent. So the Queue
  receives a shard's events in commit order. Queues does not promise delivery order (retries and delays reorder),
  so consumers must not rely on it: the envelope's ULID `id` sorts by time.
- **Bounds.** At most 100 events or 200 KB per `sendBatch` (the Queue takes 100 messages or 256 KB), 10 batches
  per alarm run; more waits for the next run, set for right away. An event over 120 KB (the Queue's message limit is
  128 KB) is logged and dropped, so it cannot block the shard; no event comes near it today.
- **Failure.** A failed send keeps every row and backs off from 1 s, doubling to 5 minutes, with jitter (half to all
  of the step) so shards that failed together do not retry together. The backlog is logged on every failure, as an
  error past 1000 rows.
- **At-least-once.** If the object dies after a send resolved and before its rows are deleted, the rows go again
  with the same `event.id`: the idempotency key. The message body is the envelope as written, as JSON.
- **Consumer settings.** Batches of up to 10, waiting at most 1 s (pages are urgent), `max_retries` 10, then the
  dead-letter queue `brigade-events-dlq` (`-dev`, `-staging`). Consumers decide when to give up on their own
  (`MAX_PAGE_ATTEMPTS`, below the Queue's retries) so a failure is recorded, not dropped; the dead-letter queue only
  catches what still fails (a bug). The API Worker consumes it for pages ("Notifiers" below); anything else in it is
  inspected by hand.

## Notifiers

The first consumer is the API Worker's own `queue` handler (`apps/api/src/notify.ts`). It routes each event to its
notifiers: push, and email for a page that failed ("Email" below). Email stays in this Worker too: it needs the same
bindings (the shards, D1) and is small; RFC 0002's notifier Worker splits off with Slack, or when a notifier's load
or dependencies should not share the API's.

- **What pages**: `incident.declared` (urgency `page` for SEV1 and SEV2, `high` otherwise),
  `incident.severity_changed` raised into SEV1 or SEV2 (`page`), `escalation.paged` for a level the shard's
  alarm fired, and `incident.paged_again` for a failed page paged again ("Page again" below; both with urgency from
  the incident's severity). With a default escalation policy the first of those starts a
  run and pages its first level (RFC 0006 "Who is paged"). Monitors open incidents with
  `incident.declared` as `sys_monitors` (SEV2), and alert sources as `sys_alerts` (their route's severity), so they
  page through the same rule. A page is not sent for an
  incident already acknowledged or no longer active.
- **Who** is RFC 0006 "Who is paged".
- **Idempotency.** The shard keeps a ledger per `event.id`: the devices each page reached, and pages that are
  settled. A redelivered event skips the devices already reached and does nothing once settled; the same event twice
  in one batch is acked once. The ledger lives 15 days, past the Queue's longest retention (14 days).
- **Failure (the paging path's fallback).** A relay that is unreachable, `apns_unreachable`, APNs throttling or 5xx
  is retried with the message: 5, 10, 20, 40 s. After 5 attempts, or at once when retrying cannot help (no relay
  configured, a platform the relay cannot reach, a request the relay refuses), every member reached on none of their
  devices gets `notification.failed` and a `page_failed` entry on the incident's timeline ("Couldn't page Ana: …"),
  which the dashboard shows. So does every member the page was for who has no device (`no_devices`, whoever caused
  the event), and one left out by the 200-device cap (`over_limit`). A page with nobody at all to go to is recorded
  once (`userId: null`, `no_devices`) when a monitor caused it; a member who declared it by hand knows. APNs saying
  a token is gone drops the device (`device.expire`, only if the token is still the one the push went to) and retries
  the page while attempts remain, so a commander whose only device just expired is replaced by everyone who can
  respond on the next attempt. A member left without a device that way is recorded as `token_invalid`, not
  `no_devices`, so the timeline and the email say the phone was refused and opening the app registers it again.
- **The shard failing.** The shard being unreachable or throwing retries the whole message, up to the Queue's
  `max_retries` (10, so 11 deliveries); the last logs `page dead-lettered` (event, incident, workspace) and the
  message goes to `brigade-events-dlq`. The same Worker consumes that queue: for a page not already settled, on an
  incident still active and unacknowledged, it records `notification.failed` with `userId: null` and
  `dead_lettered` ("A page may not have gone out"), closes the page in the ledger, and acks; a lost page that is
  still its escalation run's last is paged again on an event of its own (RFC 0006 "A lost page"). A lost SEV1 or
  SEV2 `incident.declared` the interim rule paged (no escalation run on the incident, so nothing else would page it
  again) is paged again once, `PAGE_REPLAY_DELAY_MS` (30 s) later, from the shard's alarm: `incident.pageAgain` as
  `sys_notifier`, de-duplicated by the lost event (`replay:<event id>`), refused once the incident was acknowledged,
  resolved or paged again by hand, dropped once an escalation run started on the incident meanwhile (the run pages
  it), and whoever declared it still not pushed. Its own page lost too is only recorded.
  If the shard still cannot be reached it logs `dead-lettered page could not be recorded` and retries in 2 minutes,
  up to 5 times (`max_retries: 5`, no dead-letter queue of its own, so spent retries delete the message: nothing
  loops).
- **Page again (decided).** An owner or admin (`escalation:manage`) can page a failed page again from the incident
  page: "Page again" under a `page_failed` entry (or a grouped line of them) whose reason paging again can help
  (`dead_lettered`, `undelivered`, `token_invalid`, `not_configured`, `no_devices`; not an escalation's own misses).
  It is a named mutation, `incident.pageAgain` (`packages/schema`), with RBAC and a `paged_again` timeline entry, and
  it pages through the outbox on an event of its own, `incident.paged_again`: the old event is never replayed (its
  ledger stays closed). It goes to the members the entries name; an entry for nobody in particular (a lost page)
  goes to the escalation level it belonged to while the incident row keeps that page, else to the interim rule,
  which leaves out whoever caused the lost page (who declared it; the entry keeps `causedBy`), not whoever asks. It
  never starts or moves an escalation run, each entry is paged again once, never one whose run already paged it again
  on its own (`escalation.repage`, `escalation.fallback`: the `escalated` entry's `repaged`), and only while the
  incident is active and unacknowledged; each refusal is `conflict` with its own message (`PAGE_AGAIN_CONFLICTS`), so
  the dashboard says whether it was acknowledged, resolved or already paged again, and offers nothing already
  answered. The mobile app offers it under the same lines to the same members, and asks first (an alert with
  Cancel and Page again), since a stray tap on a phone is likelier than a stray click. A member named who left or became a viewer since is recorded as not paged (`not_a_member`), and a page
  to everyone that finds only whoever caused it as `nobody_else`, so the `paged_again` line never stands alone. Tests: `apps/api/test/notify.test.ts` ("paging a failed page again",
  "paging a lost declaration again on its own"), `packages/schema/tests/escalation.test.ts` ("incident.pageAgain").
- **The outbox.** A row the drain cannot read (not JSON) or too large for the Queue is logged and dropped, so it
  never blocks the events after it; any drain that throws (storage) backs off like a failed send.
- **Delivery receipts.** Each page records a row per device, from planned to accepted by APNs, and the phone reports
  when it opened it (RFC 0006 "Delivery receipts"); the dashboard explains from them why someone was or was not
  paged. None of it is in a page's way: recording fails open. A level whose pushes all fail escalates to the next
  level of its round at once (RFC 0006 "Who is paged"; a missing receipt never counts, decided in Q18). Outside the incident, a failed page reaches people by email
  (below).

## Email

The second notifier, in the same consumer (`apps/api/src/notify-email.ts`; the shard's side in `src/mailer.ts`).
It also sends the account emails: email verification (RFC 0002 "Auth", sent by Better Auth through the same
`EmailSender`), password reset (RFC 0002 "Auth", the same) and invitations (`member.invited`, below).

- **Provider-agnostic.** An `EmailSender` (`src/email.ts`) takes one rendered email (`to`, `subject`, `text`,
  `html`) and answers accepted, or refused with whether a retry may help; it never throws. Implementations:
  Cloudflare Email Sending through the Workers `send_email` binding (`EMAIL`), which needs no API key; a double that
  logs each email instead of sending it (`EMAIL_LOG=1`, set by `vp run dev`); the tests' recorder. The sender
  address is the secret `EMAIL_FROM`, on a domain onboarded to Email Sending, so no domain is in the repo; without it
  (and without the double) no email is sent and nothing is recorded: failed pages are on the timeline as before.
  The binding's limit, quota and service errors and the receiving server refusing for now are retried; any other
  code (an unverified sender, a suppressed address, a bad message) is final at once.
- **What leads to an email.** Only `notification.failed` from push. The shard decides (`Mailer.plan`), reading the
  page ledger, never writing it:
  - **A member a page missed** (`unpaged`: `no_devices`, `token_invalid`, `undelivered`, `unsupported`, `not_configured`,
    `over_limit`), for a SEV1 or SEV2 incident, once per incident and member: "Brigade tried to page you about
    SEV1 · INC-142 in Acme, but the page didn't reach your phone: …". A member without a phone also reads how to get
    pages on it.
  - **The owners and admins, when nobody could be paged** (`nobody_paged`, Q18 decided): the page settled having
    reached nobody on any device and nothing else will page on its own: there is no escalation run (the interim rule
    was the page), the page was the last of a run that ended (everyone who can respond), or it was the one page of a
    run below its policy's severity (`paged_once`, RFC 0006 "Who is paged"). A level that missed everyone is not it:
    the next level fires. Neither is a dead-lettered page (paged again on its own event), a stalled level (everyone
    is paged after it) or a page only its declarer could answer. Owners and admins come from D1 (verified addresses
    only, the same caps), so one who never opened Brigade is told too; at most 50. Whoever declared the incident is
    not left out: an owner or admin who declared it is told like the others. Once per page. Tests:
    `apps/api/test/email.test.ts` ("a page that reached nobody emails the owners and the admins, …", "a run below its
    policy's severity escalates no further, …").
  - Neither once the incident is acknowledged or no longer active, or when the workspace turned it off. The
    member's email neither when they turned it off themselves (below).
- **Workspace settings.** `workspace.setEmail` (`workspace:manage`: owners and admins) sets both on or off; both are
  on by default (`DEFAULT_EMAIL_SETTINGS`), since the alternative is that nobody outside the incident hears of a page
  that failed. The dashboard's "Email when paging fails" card (owners and admins only) has a switch for each, and
  warns while the owners' email is off.
- **A member's own choices.** `member.setEmail` (`device:register`, every role, only the member's own, never an API
  token; `member.email_changed`) turns off the missed-page email for that member (and the follow-up reminders, RFC 0013
  "Reminders"); both are on by default (`DEFAULT_MEMBER_EMAIL`), kept on their `member_settings` row next to their call
  choice. The dashboard's Email card and the app's account settings set it. That row is synced to every member, so every
  member can see every other member's email choices and time zone (RFC 0003 "A member's own settings"). **The owners' "a
  page reached nobody" email has no per-member opt-out**: it is the fallback when paging fails, so only the workspace's
  setting turns it off, and an owner who turned their own missed-page email off still gets it (tested). Both screens say
  so.
- **Addresses and language.** The shard keeps no email addresses. The consumer reads each recipient's address, name
  and `locale` from D1 (Better Auth's `user`, joined with `member` so a member removed since is not emailed). D1 is
  read only here, off the page path; a D1 failure is retried like a failed send, and given up after the last attempt
  (for the owners' email only logged, since who the owners are is what could not be read). Each email is rendered in the
  recipient's locale (RFC 0008, `email_text` in `packages/i18n`), plain text plus simple HTML. Every line is rendered
  as text and escaped as a whole in the HTML, so an incident's title, a workspace's or a person's name never becomes
  markup; the subject and display names are made single-line. A link to the incident needs `DASHBOARD_URL` (an
  http(s) origin, a secret).
- **Idempotency.** The shard keeps an email ledger: emails by key (`unpaged:<incident>:<member>`,
  `nobody:<page event>`) and who each reached. A plan holds each email it returns for 60 s (`EMAIL_CLAIM_MS`), so the
  failures of one page in one batch (one event per member) send the owners' email once. A delivery that finds an
  email held is never acked for it: the plan says `held` with when the hold ends, and the consumer retries the message
  no sooner than that (and never under 60 s). By then the email is done, and the retry finds nothing to send; or the
  holder died, or its report to the shard failed after it sent (the message is then retried, and its redelivery is
  held by its own claim), and the retry takes the email. So an email is never lost to a hold; one whose report was
  lost may go twice (at least once, like every delivery here). A redelivery skips whoever an email reached and does
  nothing once the email is done. The ledger lives 15 days, like the page ledger.
- **Failure.** A failed send is retried with the message: 30 s, 1, 2, 4 minutes. After 5 attempts, or at once for a
  refusal retrying cannot fix, each recipient the email never reached gets an `email_failed` entry and a
  `notification.failed` (`channel: "email"`), which no notifier acts on (nothing loops). The shard being unreachable
  retries the message like any event and, past the Queue's retries, it is dead-lettered and dropped (logged): only
  pages are recorded from there.
- **Invitations.** `member.invited` from the outbox leads to the invitation email (`src/notify-invite.ts`): the shard
  claims it in its own ledger (`invitation_sends`, one row per `send`, held 60 s like the email ledger, so a
  redelivery sends nobody twice), the consumer reads the invitation, the workspace's name and the inviter from D1
  and sends it in the invitee's `locale` if they have an account, else the inviter's (`email_invite`, escaped like
  the others). One no longer pending (accepted, declined, revoked, run out) is not sent. A failed send is retried
  like the notifier's (30 s to 4 minutes, 5 attempts), then only logged: the dashboard lists the invitation, and
  Resend sends it again. The link is the dashboard's `/invitations/:id`, from `DASHBOARD_URL`; only the dev log sender
  falls back on the origin the invitation was made through, so a deployed Worker without `DASHBOARD_URL` sends no
  invitation (or verification) email rather than a link built from whatever host a request named. The invited
  address need not be verified (that email is how its owner learns of it); the inviter's must be.
- **Abuse.** An address is verified now (RFC 0002 "Auth"): the notifier's emails go only to members whose
  `user.emailVerified` is set, read in the same D1 query, so signing up with someone else's address no longer gets
  their inbox Brigade's emails; an unverified member is skipped with nothing recorded. The incident's title (in the
  subject and the body) is still whatever a member typed. Before verification, anyone could sign up with someone
  else's address, declare incidents in their own workspace and have Brigade email that address their words. The
  ledger still caps it: at most 5 emails to one user from a workspace in an hour (`EMAIL_USER_HOURLY_CAP`), and 200
  from a workspace in a day (`EMAIL_WORKSPACE_DAILY_CAP`), counted from the emails that went out. Over either, the
  email is dropped, logged, and noted on the timeline (`email_failed`, `capped`) with `notification.failed`; it is
  not retried. The caps are read when the plan is made, so deliveries running at once can overshoot by a batch.
  Reminders of follow-ups due (RFC 0013 "Reminders") have caps of their own (`REMINDER_WORKSPACE_DAILY_CAP`, 200 a
  day per workspace; `REMINDER_USER_DAILY_CAP`, 2 a day per user) and never count toward these: a morning of
  reminders can never drop an email about a page that failed (tested).
  Invitations are the one email to an address nobody proved, so they have their own bounds (RFC 0003
  "Invitations"): only a verified member may invite; per workspace, 30 invitation emails a day, 50 pending and one
  send per invitation per 5 minutes; and across every workspace, counted in D1, 3 a day to one address (its `+tags` counted as one), 50 a day
  from one inviter and 5 per invitation ever (5 a day per address decided, Q21; to build), so many workspaces cannot add up to flood one inbox. The verification
  email goes only to one's own address and never carries the name typed at sign-up: at most 3 per user in 15
  minutes and 5 a day. The password reset email goes to an address that has an account (the same answer either
  way) and carries no name: at most 3 per address and IP an hour and 10 per address a day, counted for any address, and 3 per IP a
  minute. An address someone else signed up with and never verified stays taken until its owner resets the
  password, which takes the account back (RFC 0002 "Auth"). **Decided (Q21):** these caps stay as they are, except
  invitations per address (5 a day, built).
- **The Brigade-wide daily ceiling (Q21, built).** Below every cap above and below the sender's own quota
  (Cloudflare Email Sending answers `E_RATE_LIMIT_EXCEEDED` past it), so one busy or abused workspace cannot use up
  the others' sends: every email the API Worker sends, from every workspace and of every kind (the notifier's,
  reminders, rotations, invitations, verification, reset, sign-up notices, status page emails, webhook emails, the
  operators'), goes through `emailSender(env)`, which counts it in D1's `email_day` (one row per UTC day, migration 0014) with one upsert that only goes through below `EMAIL_DAILY_CEILING` (a whole number; unset or unreadable is
  2000), so isolates sending at once never overshoot it (`src/email-ceiling.ts`). Past it, an email is dropped,
  logged (never the address) and answered as a refusal that is not retried, which each caller records as it records
  any refused send. **An email about a page that failed is never dropped**: the notifier's member and owners' emails
  and the operators' email are marked `priority: "paging"`, counted (so the rest of the day stays closed) and always
  sent, without waiting on D1: the count runs alongside the send, so a D1 that hangs (the outage the operators'
  email may be about) never holds it up (tested in `apps/api/test/email.test.ts`, `email-ceiling.test.ts` and
  `watchdog.test.ts`). Any other email waits at most `CEILING_COUNT_TIMEOUT_MS` (1.5 s) for its count; if D1 cannot
  count by then, or fails, it is sent and the failure logged: the per-feature caps still hold. An email is counted
  before it is sent, so an attempt that fails and is retried counts each time. The cron deletes days older than a week. With it in
  place, a shared instance may open sign-up (RFC 0002 "Sign-up and the first user").
- **Push first.** Email only acts on failures push already recorded, so it can never delay or stop a page. The
  consumer handles a batch's messages in parallel and acks each on its own: a page in the same batch as an email
  goes to the relay without waiting for it (tested). Every wait on the email side is bounded (10 s a send, 5 s the
  D1 read).
- **Status page emails** (RFC 0012 "Email subscriptions", `src/notify-status.ts`): the confirmation of a
  subscription and the page's notifications (incidents published, updated and resolved; maintenance scheduled,
  started, ended and called off) to its confirmed subscribers, who are not members: addresses in D1
  (`status_subscriber`), a ledger in the shard, batches of 50 within a 3 s budget through the side connection slots,
  carried on through the outbox (`status_email.continue`), 5000 a day per page. The only emails with extra headers:
  RFC 8058's `List-Unsubscribe` and `List-Unsubscribe-Post` (https links only), `Auto-Submitted` and
  `Content-Language` (`OutgoingEmail.headers`, only headers Email Sending allows). The confirmation is the one email to
  an address nobody proved, counted per inbox (`+tag` dropped, and Gmail's dots): at most 3 per inbox and page while it
  is pending, 5 per inbox and 200 per recipient domain a day across pages, and 200 a day per page, apart from the
  page's notifications.
- **Rotations** (Q20, RFC 0003 "Schedules", `src/notify-rotation.ts`): `member.removed`, or `member.role_changed` to a
  viewer, whose `schedules` lists any leads to an email to the workspace's owners (verified addresses only, from D1,
  at most 50; not the admins): the member's name (read from D1's `user`, "A member" without one) and why (removed,
  left, made a viewer), each schedule by name, saying which now has a layer with nobody in it, and a link to the
  dashboard's On-call card. Nothing else about the member. Each owner's locale (`email_rotation`), escaped like the
  others. A schedule deleted since is left out; none left is nothing to send. Claimed in the email ledger
  (`rotation:<event id>`, held 60 s, so a redelivery emails no owner twice), within caps of its own, like reminders
  (`ROTATION_USER_DAILY_CAP` 20 per owner and `ROTATION_WORKSPACE_DAILY_CAP` 100 per workspace a day). It never
  counts toward the paging caps: an offboarding hour that emptied a layer must not cap the email about the page that
  then reaches nobody. Retried like the others (30 s to 4 minutes, 5 attempts) skipping owners it reached, then only
  logged: it has no incident timeline. No verified owner is logged too (admins are not a fallback). Tests:
  `apps/api/test/email.test.ts` ("the owners' email about a member taken out of schedules").
- **Not yet (decided, to build).** An email to Brigade's operators (`OPERATOR_EMAILS`) on `brigade.status_changed`
  (Q19, RFC 0007 "Watching the watcher"), on the `EmailSender`.

## Alert sources

First slice of Phase 3's alert sources (`packages/schema` `alert-sources.ts` and `alert-normalize.ts`,
`apps/api/src/alert-intake.ts`). Everything runs in the workspace shard for now; `AlertGroupDO` is later work (RFC
0007 "`AlertGroupDO` (later)").

- **Sources** (`alertSource.create`, `.update`, `.rotate`, `.delete`; owners and admins, `alert:manage`): a name and a
  kind, `generic`, `grafana`, `datadog` or `sentry`, at most 20 per workspace (`MAX_ALERT_SOURCES`). Each has a secret
  URL, `POST /alerts/<workspace id>.<source id>.<secret>` (also under the dashboard's `/api`), made like a heartbeat's
  (RFC 0007): the dashboard makes 32 random bytes, shows the URL once and sends only its SHA-256, which the shard
  keeps in a server-only table (`alert_source_secrets`) and compares in constant time. A new URL (`.rotate`) refuses
  the old one from the next request. A takeover revokes every source URL (`alertSource.takeOver`, RFC 0002 "Auth").
- **Optional checks.** A header the sender must also send (`auth`: its name, and its value's SHA-256; Basic auth is
  the `authorization` header), for Grafana's and Datadog's header and Basic auth options. A provider's HMAC
  signature where it has one: Sentry's `Sentry-Hook-Signature` (HMAC-SHA256 of the raw body with the integration's
  client secret, required for a Sentry source) and Grafana's `X-Grafana-Alerting-Signature` (the same over the body,
  optional; without the timestamp header). The HMAC is over the bytes as sent, never text decoded and encoded again.
  Datadog has no signature: its URL secret and the optional header are the check. The signing secret is kept as given
  (server-only), since verifying needs it. Comparisons are constant-time: Workers' `crypto.subtle.timingSafeEqual` (a
  non-standard extension), else a loop over every byte.
- **The request.** The Worker parses the token, checks the workspace in D1 (cached, fail open, as for a heartbeat),
  reads at most 256 KiB, and hands the shard the bytes and the headers: the ones that authenticate a payload
  (`authorization`, `sentry-hook-*`, `x-grafana-alerting-signature`) always, and at most 64 others, where a source's
  own header must be. Every refusal, in the Worker or the shard (a wrong secret, header or signature, a deleted
  source, a made-up workspace), is the same `404`. Accepted is `202`. **A payload past 256 KiB still pages**: the
  Worker stops reading there (never buffering more), logs it, and asks the shard (`alertTooLarge`), which checks the
  URL's secret and the source's header and pages the unreadable alert, "Unreadable alert from <source> (payload too
  large)", answered `202` so the sender does not drop it on a `413`. A provider's signature cannot be checked without
  the body, so for a signed source (Sentry, a signed Grafana) the secret URL alone authenticates this one alert: whoever
  holds the URL could page that alert with any body anyway. The dashboard's Grafana setup says to set the webhook's
  Max alerts to 50 (the most a payload is read for), which keeps a Grafana group under the limit.
- **Rate limits** (Workers Rate Limiting: approximate, per Cloudflare location, each failing open, since a lost alert is
  worse than a busy shard). `ALERT_WORKSPACE_LIMIT`, 1,200 a minute per workspace, before the shard wakes,
  spent only by a token the isolate has not seen the shard accept in the last hour (an LRU of at most 10,000 SHA-256s
  of accepted tokens, per isolate; a token the shard refuses is taken out): a source already sending skips it, and
  the shard still checks its secrets and spends its `ALERT_LIMIT`.
  `ALERT_LIMIT`, 300 a minute per source, spent by the shard only once the secrets matched, so requests with a wrong
  secret never use up the real source's budget. `ALERT_REFUSED_LIMIT`, 120 refused requests a minute per workspace,
  counted apart; past it, a token refused in the last minute is answered by the Worker without waking the shard, with
  `503` and `Retry-After` (the rest of that minute), not `404`: a real token refused once (a signature or header that
  did not match, fixed since) is retried rather than dropped, since senders do not retry a `404`. A guesser learns
  nothing from it: only a token the shard already refused with a `404` reaches it. Over a
  limit is `503` with `Retry-After`, never `429`: Datadog retries a 5xx and gives up on a 429. A flood of random
  secrets against one workspace spends its workspace budget and wakes its shard at most that often, but cannot hold
  back a source an isolate has accepted lately; a source's first payload on an isolate that has not seen it during
  such a flood still waits (`503`, retried by the sender). Cloudflare's own rules in front are the outer layer.
- **Normalizing** (`normalizeAlerts`, pure, with fixtures from the providers' documented samples): each payload to
  alerts with a dedup key, a title, a severity (`critical`, `high`, `warning`, `info`), firing or resolved, an http(s)
  link and labels, all fitted to Brigade's text rules by UTF-16 length (what the shard's validators count), never
  splitting a pair: 150 emoji make a 100-emoji title, not a refusal. Keys are fitted after their prefix; one that would
  pass 200 is cut and ends in a hash of the whole, so two long keys stay two alerts. Keys: Grafana's `fingerprint`
  per entry of `alerts`; Sentry's issue id (`event_alert`, `issue`) or metric alert id (`metric_alert`; `resolved`
  resolves, `warning` is a warning and `critical` critical); generic: `dedup_key`, else the title. Datadog, with the
  payload the dashboard shows: the monitor and the group (`$ALERT_ID` and `$ALERT_SCOPE`), so the groups of a
  multi-alert monitor are separate alerts, else `$AGGREG_KEY`; with Datadog's default payload (`$ID`, `$EVENT_TITLE`,
  …), the title without its `[Triggered on …]` bracket plus the scope in it, which Triggered and Recovered share; a
  title with no bracket, with its scope if it has one, else a hash of the title and the tags. Never `$ID`: it is new
  on every notification, so a recovery keyed by it would never resolve its firing. Datadog's transition (`$ALERT_TRANSITION`, else the title's bracket):
  Recovered resolves, a Warn is a warning whatever the monitor's priority, the rest fire. At most 50 alerts a payload.
  When the sender says when an alert happened, it is kept (`at`): Grafana's `startsAt` (firing) or `endsAt`
  (resolved), Sentry's metric alert `date_started` or `date_closed`, Datadog's `date` (`$DATE`, in the dashboard's
  payload). Only an early resolve reads it.
- **A payload Brigade cannot read still pages.** Not JSON, or no readable alert: it becomes one alert of its own
  ("Unreadable alert from <source>", key `malformed`, high) that skips the routes. Brigade's own alerts (this one and
  the capacity alert) are told apart from a sender's by why they exist, not by key: a sender's alert keyed `malformed`
  or `capacity` is its own alert, and never merges into or resolves them. It cannot be dropped by a route, and
  opens an incident through the default route. A payload with some unreadable entries pages the readable ones and that
  alert too (a Grafana group with one bad alert still pages the others). An alert the shard would refuse is left out
  the same way, and a payload the shard refuses anyway (`invalid_args`, a declare it could not make) is logged and
  pages as that alert alone: a refusal that would repeat is never a `503` the sender retries forever. Repeats of it
  are one alert, like any other key. Sentry's `installation` hook and resources that are no alert are answered `202`
  and ignored.
- **Mapping** (`alertSource.setMapping`, owners and admins, `alert:manage`; `packages/schema` `alert-mapping.ts`): per
  source, how its alerts are named and how urgent they are, applied in `alert.ingest` to every alert it sends before
  anything else reads it, so the routes match the mapped severity and dedup keys are untouched. A source without one
  (every source from before) keeps the sender's title and severity. **Title template**: literal text and
  placeholders, `{title}`, `{severity}` (the mapped one) and `{labels.<key>}`, at most 200 characters and 10
  placeholders; `{` and `}` mean nothing else, so a template is parsed, never run, and one with an unknown
  placeholder, an unclosed `{` or a stray `}` is refused when saved. A label the alert lacks is empty. The result is
  fitted like any sender text (`fitText`: hidden and control characters become spaces, cut to 200 UTF-16 units
  without splitting a pair) and shown as text wherever titles are (escaped in email, plain text in the dashboard).
  **Severity map**: the value is the sender's own word (`providerSeverity`, kept by the normalizer: Grafana's
  `severity` label, Datadog's priority or alert type, Sentry's level or metric action, the generic `severity`) or a
  label's value; at most 20 rules, each value once, matched ignoring case and surrounding space; then a fallback,
  else the severity Brigade read. **Never in a page's way**: a template that cannot be parsed (stored before a rule
  changed, or written by hand), or one that leaves nothing visible, gives the alert's own title; a rule or a fallback
  that is not a known severity is skipped. Brigade's own alerts (unreadable, capacity) are never mapped. The row keeps
  the alert as sent (`received`: title, severity, sender's word), which the dashboard's preview maps with the form's
  draft, naming the route the mapped alert would take (so a map that moves a source onto a dropping route shows); alerts already in are not mapped again (a quiet one is, on its next repeat, and routed again like any
  repeat). Tests: `packages/schema/tests/alert-mapping.test.ts` ("a stored template or map that cannot be read still
  pages…", "a template that leaves nothing visible pages with the alert's own title"), `apps/api/test/alerts.test.ts`
  ("a source's mapping names and ranks its incidents; one stored broken still pages as sent").
- **Ingesting** (`alert.ingest`, server only, as `sys_alerts`, in one transaction per payload): the same source and
  key while firing is the same alert: refreshed, counted (`repeats`), no event and no page, so a dedup storm pages
  once. Two repeats do more. A repeat the routes kept quiet (suppressed or dropped) is routed again, and becomes a new
  alert if they now do something louder with it: a suppressed warning that turns critical past a route that suppresses
  warnings opens an incident. A repeat more urgent than before (Datadog's Warn becoming Triggered, Sentry's warning
  becoming critical) raises its open incident to the severity the routes give it now (the route's, else the type's,
  else the alert's own), never lowering it, which pages again into SEV1 or SEV2 (RFC 0006 "Who is paged"); a critical
  alert grouped into a warning's incident raises it the same way.
- **Resolving.** A resolve resolves its alert. Once nothing fires on its incident, an incident nobody touched (still
  in triage, not acknowledged, no role held, every timeline entry Brigade's own) resolves with it: the sender said the
  problem is gone and nobody is on it. One people worked on stays open for them, with an `alerts_resolved` timeline
  entry. **Flapping:** a key firing again within 10 minutes (`FLAP_WINDOW_MS`) of its incident resolving by itself
  reopens that incident (to investigating, as `sys_alerts`, which pages again: nobody acknowledged it) rather than
  opening another, so a flapping alert is one incident and one page per flap. The flap goes through the routes as
  they are now: a suppress or drop route added since keeps it quiet (the incident stays resolved, the alert is
  recorded as that route has it); otherwise the incident reopens at the more urgent of its own severity and the one
  the routes give the alert, with one page: the raise comes first, marked `reopening`, and only the reopen pages.
  Reopened, it is no longer untouched, so the next resolve leaves it open for people; past the window, or after
  people resolved it, the key opens a new incident. A resolve that comes before its firing (out of order: a key with
  no row at all, and no capacity alert firing that it may have been folded into) is remembered for 5 minutes
  (`EARLY_RESOLVE_TTL_MS`, server-only `alert_resolve_markers`, at most 200, with when the sender says it resolved),
  and the late firing opens nothing. The span is the realistic reordering of a sender's retries and no more, because
  the same marker is left when a firing's own delivery never reached Brigade (too large before it paged, a 503 the
  sender gave up on, an outage, a source created mid-alert), and a real firing after it must not wait long. A firing
  that says when it started (`at`) is held only if it started no later than the resolve (the sender's resolve time,
  else when the resolve came): one that started after it is a new problem and always pages. A held firing is never
  silent: it is recorded already resolved, as `resolved_early`, and the dashboard lists it with the other alerts. A
  resolve for a key that already fired (a sender resolving again, as Grafana does, or after people closed its
  incident, or after it expired or was let go for room) is remembered by nothing, so the key's next firing pages.
  Once `MAX_ALERT_ROWS` has pruned every row of a key, a repeated resolve of it counts as early again.
- **Room.** Alerts that hold nothing are let go (`closed`): closing an incident (resolved or declined) releases the
  alerts on it (`incident.setStatus`), and a suppressed or dropped alert not sent for 24 hours expires
  (`ALERT_IDLE_TTL_MS`; an alert on an open incident never expires, its incident holds it). At most 200 alerts fire
  at once (`MAX_OPEN_ALERTS`, dropped ones aside), and a new alert is never refused for room: past it the oldest
  suppressed alert is let go, else the oldest alert grouped onto an incident another firing alert still holds (the
  incident stays open; that alert, sent again, groups onto it again), else the new one pages as the workspace's single "Alert capacity reached" alert
  (through the default route, as urgent as the most urgent alert it stands for), whose repeats count like any other.
  The last 300 rows are kept (`MAX_ALERT_ROWS`), oldest resolved or closed first.
- **Routes** (`alertRoute.create`, `.update`, `.move`, `.delete`; at most 50): tried in order, the first that matches
  decides. A route matches on where the alert comes from, alert severities and labels (`key=value`, or a key alone for
  any value); empty severities or labels match any. Where it comes from (`match.sourceIds`, `routeMatches`) has two
  halves: alert sources, named (at most 20) or every source (`sources`), and monitors, named (at most 100) or every
  monitor (`monitors`, RFC 0007 "Monitor alerts through the routes"). A monitor matches only a route that names it or
  every monitor. An alert source matches a route that names it or every source, or one that names no source and no
  monitor (an empty list, as every route saved before monitors were routed, keeps meaning every source); a list naming
  only monitors takes no source. The route editor has "Every source" beside the sources and writes `sources`
  explicitly whenever a route that took every source names monitors, so adding monitors never changes which sources a
  route takes. Its action: `open` an incident (a severity, else the type's default, else the
  alert's own: critical SEV1, high SEV2, warning SEV3, info SEV4; an incident type and services, checked to exist when
  the route is saved and left out by `incident.declare` if deleted since; and an escalation policy, or the default),
  `group` into the open incident of its `groupBy` label's value (opening one when there is none; the incident's
  timeline says so, `alert_grouped`, since grouping pages nobody by itself), `suppress` (kept as an alert, no incident)
  or `drop` (recorded with the route that dropped it, never paged). When the routes change, the shard routes every
  suppressed or dropped alert still firing that the routes would now page again (`alert.reroute`, as `sys_alerts`), so
  deleting or changing the route that kept one quiet pages it now: at most 200 a run, 50 to a mutation
  (`REROUTE_CHUNK`), the rest on the shard's alarm a tick later. A chunk that fails runs again a row at a time, and a
  row that fails alone is logged and left for 10 minutes (`REROUTE_RETRY_MS`), so one bad row never holds the others
  back; an alert source's next repeat routes it again anyway.
  **The default route** takes what no route matches: it opens an incident at the alert's own severity, paged through
  the default policy, and cannot be changed, so an unmatched alert always pages. A route naming a deleted source
  matches nothing from it (never widening to every source); one naming a deleted policy goes back to the default.
  Routes record who created them; a takeover (RFC 0002 "Auth") disables the routes the taken-back account created
  (`disabled: "takeover"`, skipped by routing, their quiet alerts routed again) besides revoking every source URL, and
  the takeover notice counts both. Saving a disabled route enables it.
- **Paging** is the incident's: `incident.declare` as `sys_alerts`, through the same path as monitors, with the
  route's policy first in the policy order (RFC 0006 "Who is paged"), then the type's, then the first of the
  incident's services (the route's `serviceIds`) that names a policy, then the default. The route an incident was opened through is kept
  with it (server-only `incident_routes`, by incident id, written with the declaration), so its policy pages the
  incident for as long as it lives, however many of its alert rows were pruned since. One row per incident: a flap
  reopening the incident replaces it with the route that matches the alert now (deleting it when that is the default
  route), so the reopen pages through that route's policy. Tests: `apps/api/test/alerts.test.ts`, a
  paging path ("a dedup storm pages once", "a malformed payload still pages instead of being silently dropped", "an
  unmatched alert still pages through the default route", "a dropped alert records which route dropped it", "past the
  open-alert cap a new alert still pages", "a flapping alert reopens its incident and pages again", "a payload over
  the limit still pages, unread"), and
  `packages/schema/tests/alert-sources.test.ts` ("alerts that must still page": 200 closed incidents then a critical
  alert, the capacity alert, Datadog Warn to Triggered, Sentry warning to critical, astral text, re-routing, the
  takeover, "a firing that started after the early resolve is a new problem, and pages", "Datadog: a title with no
  bracket fires and recovers as one alert", "a flap reopens through the route that matches now").
- **Known limits.** Every payload scans the shard's alert rows (at most 300, plus up to 200 early resolves): fine at
  this size, and the reason grouping and deduplication move to `AlertGroupDO` before the caps rise. Grafana's signature
  is checked without its timestamp header, so a captured signed payload can be replayed; a replay is a repeat of an
  alert that already fired, or a resolve. A Datadog source still using an older payload (no `alert_id`) is keyed by
  `$AGGREG_KEY`, which the groups of one multi-alert monitor may share; the dashboard's payload avoids it.
- **Dashboard.** The Alert sources card: the sources with when each last sent, a new source's URL once with what to
  paste in Grafana, Datadog or Sentry, the routes in order with the default last, and the latest alerts with what
  became of each (opened or added to which incident, suppressed, dropped, held by a resolve that came first, and by
  which route).
- **Not yet.** `AlertGroupDO`; email ingest; Slack naming `sys_alerts` (it reads "a teammate" today).

## Provider interfaces (published in `packages/sdk`, MIT)

```ts
interface AlertSource {
  id: string; // "grafana", "datadog", "generic", ...
  parse(req: Request): Promise<AlertEvent[]>; // normalize inbound webhook
}

interface ChatProvider {
  id: string; // "slack" first
  handleInbound(req: Request, ctx: ProviderContext): Promise<Response>; // slash commands, interactivity
  onEvent(event: BrigadeEvent, ctx: ProviderContext): Promise<void>; // mirror timeline, create channels
}

interface Notifier {
  id: string; // "push", "email", "sms", "voice", "slack-dm"
  send(target: NotifyTarget, message: NotifyMessage): Promise<DeliveryResult>;
}
```

## Packaging integrations

- Built-in integrations live in `integrations/*` as separate Workers bound to `api` via **service bindings** (RPC).
- Third parties implement the same interfaces in their own Worker and register the binding in config — no core fork needed.
- Lightweight alternative for anything outside Cloudflare: **outbound webhooks** (below) and the public REST API
  (the OpenAPI reference, `docs/api/openapi.json`, its bodies and payloads converted from `packages/schema`; RFC 0002
  "Public HTTP API").

## Outbound webhooks

Endpoints a workspace's owners and admins register (`webhook:manage`) to get its events as signed JSON over HTTPS
(`packages/schema` `src/webhooks.ts`, the API's `src/webhooks.ts`, `src/notify-webhooks.ts`, `src/webhook-sign.ts`).

- **Endpoints.** A URL, a description (up to 200 characters, optional), the catalog events it takes (at least one)
  and whether it is on; at most 20 per workspace (`MAX_WEBHOOKS_PER_WORKSPACE`, `limit_reached`). Rows sync only to
  owners and admins (`webhook.all`): receivers put tokens in URLs, so responders and viewers never get them, and the
  dashboard's rows show host and path, never the query. Mutations: `webhook.update`, `webhook.setEnabled`,
  `webhook.delete`, `webhook.sendTest` (at most one per endpoint per 10 s) and `webhook.replay` ("Replay" below) over
  sync; `webhook.create`, `webhook.rotateSecret` and `webhook.setHeaders` are server-only, run by the API as the member
  or API token (`POST /workspaces/:id/webhooks`, `…/webhooks/:webhookId/rotate`, `PUT …/webhooks/:webhookId/headers`;
  `webhook:manage`, RFC 0014) because the server makes the secret and seals header values. An endpoint takes events
  from when it was created, and only while it is on: deliveries pending when it is turned off or deleted are dropped.
- **Custom headers.** Up to 5 per endpoint (`MAX_WEBHOOK_HEADERS`), a name and a value each, set when it is created
  (`headers` in the create's body) and changed with `PUT …/webhooks/:webhookId/headers` (the whole list; a header sent
  without `value` keeps the value it has, so one can change without retyping the others; an empty list removes them),
  and sent on every delivery, before Brigade's own headers. A name is an HTTP token of at most 64 characters, once per
  endpoint whatever its case; Brigade refuses the request's framing and hop-by-hop names (`Host`, `Content-Length`,
  `Transfer-Encoding`, `Connection`, `Keep-Alive`, `TE`, `Trailer`, `Upgrade`, `Expect`), what it sets itself
  (`Content-Type`, `Content-Encoding`, `User-Agent` and every `webhook-*`, so a header never forges a signature), and
  what proxies and Cloudflare own or a receiver may read as the client's address (`Forwarded`, `Via`, `X-Real-IP`,
  `True-Client-IP`, `X-Client-IP`, `Client-IP`, `X-Cluster-Client-IP`, `proxy-*`, `sec-*`, `cf-*`, `x-forwarded-*`;
  `WEBHOOK_RESERVED_HEADERS`). A value is 1 to 1024 characters of visible ASCII and inner spaces: no CR, LF or other
  control, so it cannot split the request. `Authorization` is allowed (decided: many receivers want a bearer token
  rather than checking a signature), so every value is treated as a secret: the API seals each one like the signing
  secret (AES-256-GCM under `WEBHOOK_SECRET_KEY`, bound to the workspace, the endpoint and the header's name) into the
  server-only `webhook_secrets` row, and never answers it. The synced row keeps each name and a hint (the last 4
  characters of a value of at least 16, else none), which the card shows; the event names the headers only. The
  consumer opens them before each delivery; one that does not open fails the attempt as `secret`, like the signing
  secret. The values belong to the receiver they were entered for, so `webhook.update` to a URL on another origin
  (scheme, host or port; a new path or query keeps them) removes every header, values and names, in the same change,
  with `headersCleared` on `webhook.updated` and a `webhook.headers_changed` naming none (decided: otherwise anyone
  who can edit the URL, another admin or a token with only `webhook:manage`, could point it at their own host and
  replay a delivery to read a stored `Authorization`). The dashboard says so on the URL field before it is saved; the
  headers are entered again with `PUT …/headers`. A delivery reads the URL and the headers together when it is
  claimed, so one claimed before the change carries the old URL with the old headers and one claimed after the new URL
  with none.
- **Secrets.** `whsec_` and 32 random bytes in base64 (Standard Webhooks' format), made by the API, shown once in the
  answer, never again. Brigade must sign with it, so it cannot be kept as a hash: it is sealed with AES-256-GCM under
  `WEBHOOK_SECRET_KEY` (a secret on the API Worker; the same sealing as Slack's bot tokens, RFC 0011, with the
  workspace and endpoint ids as additional data, so a sealed secret copied to another row does not open) and kept in
  the server-only `webhook_secrets` table. The trade-off: whoever has both the shard's storage and the key can sign
  as Brigade; neither alone can. Without the key, webhooks are off (creating answers `not_configured`, nothing is
  delivered). Rotating keeps the previous secret signing alongside the new one for 24 hours
  (`WEBHOOK_ROTATION_GRACE_MS`), so a receiver can switch without dropping deliveries; two at most. Create and rotate
  take an `Idempotency-Key` (the dashboard sends one, and sends a request again with it when the answer was lost): it
  is the mutation's id, and the secret is derived from it (HKDF-SHA256 under `WEBHOOK_SECRET_KEY`, over the
  workspace, endpoint, member, action and key), so a retried request answers the first one's outcome and the same
  secret, and a retried rotation never rotates again (which would cut the previous secret's grace short).
- **Signatures** ([Standard Webhooks](https://www.standardwebhooks.com), so any of its libraries verifies them). Each
  delivery is `POST` with `Content-Type: application/json` and:
  - `webhook-id`: the event's id (`evt_…`), the same on every retry: the idempotency key;
  - `webhook-timestamp`: the attempt's time in Unix seconds (receivers should refuse one more than 5 minutes off);
  - `webhook-signature`: `v1,<base64 HMAC-SHA256>` for each secret in use, space separated, the current one first.
    The HMAC key is the secret's bytes after `whsec_`, base64-decoded; the signed content is
    `<webhook-id>.<webhook-timestamp>.<body>`, the body exactly as sent. The specification's own example is the test
    vector (apps/api test/webhooks.test.ts).
- **Payloads** (`WebhookPayload` and its validators `WEBHOOK_PAYLOADS`, MIT, which the SDK and the OpenAPI reference
  reuse): an envelope `{ version: 1, id,
  type, time, workspaceId, actor: { kind, id }, data }`; `time` is when the event happened. `actor.kind` is `user`,
  `system`, `integration` or `token` (an API token, `tok_…`, RFC 0014; an id that stands where a member's would, like
  `incident.acknowledged`'s `by`, may be one too). Member ids, never names or addresses. **What version 1 may grow by:** new event types, new values in any list (a severity, a status, a
  monitor kind, a role, an actor kind, a reason) and new fields, anywhere. Removing or renaming any of them, or changing
  a field's type or meaning, is `version: 2`, never an edit of version 1. So a receiver must take what it does not know
  yet: the validators accept any string where a list may grow (typed as the known values or `string`), text much
  longer than Brigade writes today (`WEBHOOK_PAYLOAD_TEXT_MAX`), and a `type` they do not know as an unknown payload
  (the envelope checked, `data` as sent) rather than an error; a field they do not know is dropped. The catalog
  (`WEBHOOK_EVENT_TYPES`) and each `data`:
  - `incident.declared` (`incident`), `incident.renamed` (`incident`, `from`, `to`; `incident.title` is `to`),
    `incident.status_changed` and `incident.severity_changed` (`incident`, `from`,
    `to`), `incident.acknowledged` (`incident`, `by`), `incident.update_posted` (`incident`, `entryId`, `body`: what the member
    wrote, which every member already reads; `entryId` added with edits, absent from events before),
    `incident.update_edited` (`incident`, `entryId`, `body`, `previous`), `incident.update_deleted` (`incident`,
    `entryId`, `author`; the remover is the `actor`) and `incident.role_assigned` (`incident`, `role`, `roleId`, `roleName`,
    `from`, `to`, as the event has them; `roleId` added with role definitions, taken from `role` for events from
    before), where
    `incident` is `{ id, number, title, severity, status, declaredAt, acknowledgedAt }`;
  - `alert.fired` (`alertId`, `monitor`, `incidentId`), `alert.resolved` (`alertId`, `monitor`, `reason`:
    `recovered`, `paused`, `deleted` or `incident_closed`; never for a monitor alert a route kept quiet, whose
    `alert.fired` was never sent either) and
    `monitor.status_changed` (`monitor`, `from`, `to`), where `monitor` is `{ id, name, kind, status }` (never its URL,
    host or heartbeat token; `name`, `kind` and `status` null once it is deleted);
  - `escalation.paged` (`incident`, `level`, `round`, `reason`, `paged` and `missed`: how many, never who or why);
  - `webhook.test` (`webhookId`), sent by "Send test event" to that endpoint only, on or off, whatever its filter.

  Nothing else is delivered: members, invitations, devices, schedules and policies, the notifiers' own records and the
  webhooks' own changes stay inside. The incident or monitor is read when the event is first delivered and the
  payload kept in the shard's ledger, so every retry carries the same bytes.

- **Delivery.** From the queue consumer, never from the shard (which only writes the outbox, like every event). For
  each event the shard's ledger (`webhook_sends`, per event and endpoint) says which endpoints are due and holds each
  for 30 s, so two deliveries of one event never send it at once; a redelivery skips endpoints already done. Targets
  follow the monitors' rules (RFC 0007 "Targets": no credentials, the same ports, no private, loopback, link-local,
  reserved or local-only host) plus `https:` only and no literal Cloudflare address, checked on save and again before
  each attempt; redirects are never followed (a 3xx is a failure), each attempt gets 5 s
  (`WEBHOOK_TIMEOUT_MS`, reading the answer included), and at most 1 KB of a failed answer is read. Only 2xx is
  success. A local receiver is reached through a public https tunnel: plain http is refused everywhere, since the
  rules live in the mutation. The rules check the URL, not where its name resolves: a Worker's `fetch` cannot pin
  an address, so a public name that resolves to a private one is kept off private networks by Cloudflare's network
  alone (deployed Workers cannot reach them; RFC 0007 "Targets"). Under `wrangler dev`, or workerd run outside
  Cloudflare, nothing stops it: such a name resolving to `127.0.0.1` reaches the machine's own services, so a local
  or self-hosted run must not let untrusted members add endpoints.
- **Retries.** At least once: 6 attempts per event and endpoint, after 30 s, 2 min, 10 min, 1 h and 4 h
  (`WEBHOOK_RETRY_DELAYS_MS`), then given up (logged); a blocked URL or a secret that no longer opens is not retried.
  The schedule is the shard's, not the Queue's: the ledger keeps when each delivery is due again (`retry_at`, or its
  hold running out with nothing recorded) and the shard's alarm brings it back as `webhook.redeliver` (`eventId`), a
  server-only mutation's event through the outbox, which the consumer plans as the original event for the endpoints
  still open (one turned off or deleted since is dropped). Not delivered within 10 min (`WEBHOOK_REQUEUE_MS`), it is
  queued again. So a webhook never asks for the event's own message to be retried, and never spends the Queue's
  `max_retries`, which a page on the same event needs; the only exception is a shard that cannot be reached at all,
  which nothing was recorded for.
- **Delivery log.** Each endpoint keeps its last 10 attempts on its row (`recent`: event, attempt, time, ok, status,
  latency, error, and for a failure at most 200 characters of the answer, printable text only; `replay` for a replay),
  written by the silent `webhook.record`. No request bodies are kept beyond the ledger's payload (15 days, like the
  page ledger).
- **Replay.** Owners and admins (or a token with `webhook:manage`) resend a delivery from the log: any event in it,
  given up or not (a given-up one is the reason to), with `webhook.replay` (`id`, `eventId`) over sync. The shard
  checks the event is in the endpoint's log and its payload still kept (14 days after the event, by its id's time,
  `WEBHOOK_REPLAY_MAX_AGE_MS`, a day inside the ledger's 15; never measured from a replay's own entry in the log, which
  would outlive the payload), and emits `webhook.replay` through the outbox like every
  event. The consumer plans it as one more attempt for that endpoint only: the kept body, byte for byte, with the
  same `webhook-id` (the event's id, so a receiver that has it de-duplicates) and a fresh `webhook-timestamp` and
  signature (the current secrets, and the current custom headers). It has its own row in the ledger, keyed by the
  replay's id, so the event's own row (done or not) is never reopened; if the consumer never records it (put off for
  a free connection, or it died), the alarm brings it back like any delivery. A replay is one attempt: a failed one is
  logged and not retried by itself (replay it again). Refused for an endpoint that is off (`invalid_transition`:
  decided, turn it back on first, since an endpoint is off because its receiver is broken or unwanted) or deleted
  (`not_found`); one turned off after it was asked is dropped. A payload the shard no longer has when the consumer
  plans it is a failed attempt in the log (`expired`, not counted towards auto-disable), never a silent drop. A
  delivery of `incident.update_posted` or `incident.update_edited` whose update was removed since is refused
  (`conflict`; the log keeps the attempt's `entryId` for that), and one removed after the replay was asked is a failed
  attempt (`removed`, not counted either): a removed update's text is never sent again (RFC 0003). At most
  one replay per endpoint per 10 s (`WEBHOOK_REPLAY_EVERY_MS`), 10 an hour per endpoint (`WEBHOOK_REPLAYS_PER_HOUR`)
  and 30 an hour across the workspace (`WEBHOOK_WORKSPACE_REPLAYS_PER_HOUR`, counted in server-only counters, so
  deleting an endpoint gives none back; `limit_reached`), so replays add at most 30 requests an hour to a receiver,
  even one every endpoint points at. It runs like every delivery, inside the webhooks' budget and side connections ("Never in a
  page's way").
- **Auto-disable.** An endpoint whose attempts all failed for 24 hours (`WEBHOOK_DISABLE_AFTER_MS`), at least 10 in a
  row (`WEBHOOK_DISABLE_FAILURES`), with no success since, is turned off: `webhook.disabled` (`failing`), a notice on
  its row on the dashboard, and an email to the workspace's owners (verified addresses, at most 50, in their language;
  description or host only, never the path or query), claimed in the shard so a redelivery sends nobody twice.
  Turning it back on starts the count over.
- **Never in a page's way.** Webhooks are not a paging path, but share the consumer. They run alongside push like
  Slack, and get at most 3 s per event in a batch (`WEBHOOK_BUDGET_MS`): past it the consumer moves on without a
  retry, an attempt under way finishes under `waitUntil` and records its outcome, and the alarm brings back whatever
  is due. They also share the invocation's connections: a Worker invocation has six open at once and a seventh
  subrequest waits, so a relay reached through `RELAY_URL` would wait behind receivers that never answer. Slack and
  webhooks together hold at most 3 per invocation (`SIDE_CONNECTIONS`, src/side-connections.ts; a Slack answer is
  read before its slot is freed); a delivery still waiting for one at its budget is not started (no attempt; the
  alarm brings it back when its hold runs out). A page in the same batch (or the same event) goes to the relay at
  once (tested with 20 receivers that never answer, against a model of the six-connection limit).
- **For receivers.** `@freecorps/brigade-sdk` (`packages/sdk`, MIT) verifies a delivery (`verifyWebhook`: every `v1`
  signature against every secret given, in constant time; the timestamp within 5 minutes either way by default; an
  optional `whsec_` prefix; a tolerance or a `now` that is not finite is refused, never a replay check quietly off)
  and parses its payload with `WEBHOOK_PAYLOADS`, the schema package's validators for each `type`, into a typed
  `WebhookPayload`, or an `UnknownWebhookPayload` (`known: false`) for a type added since; or it answers a typed error
  (`invalid_signature`, `timestamp_too_old`, `invalid_payload`, …). A receiver answers 2xx to every delivery whose
  signature holds, known or not, and 4xx only to one whose signature or timestamp does not: a delivery it refuses for
  its content is retried and, after 24 hours of those, turns its endpoint off ("Auto-disable"), so an SDK one release
  behind would stop all of a workspace's webhooks. The API reference's `webhooks` section is converted from the same
  validators (RFC 0002 "Public HTTP API").
- **Not yet.** Publishing the SDK to npm (the owner's call); REST routes for the endpoints' other changes (list,
  edit, on and off, delete, test, replay are over sync).

## Slack (first ChatProvider)

Designed in RFC 0011: install, `/inc` (declare and its form, ack, update, sev, resolve, role, escalate), an
Acknowledge button, one message per incident, a channel per incident (opt-in), the timeline mirrored both ways and
the Events API. It emits `slack.connected` (`teamId`, `teamName`, `replaced`), `slack.configured` (the channel, its
name, the language and the incident-channel settings), `slack.disconnected` (`teamId`, and `reason: "takeover"` when
the owner of an address took back the account that made it, RFC 0002), `slack.revoked` (`teamId`,
`reason`), `slack.token_forgotten` (`teamId`) and `slack.archive_due` (`incidentId`), never the token; a Slack user's
action is the dashboard's own mutation and event, and `/inc escalate` is `escalation.paged` with `reason: "manual"`.
A job the notifier gave up on is `notification.failed`
with `channel: "slack"` (`incidentId`, `eventId`, `userId: null`, `reason`: `no_channel`, `not_authorized`,
`rate_limited`, `undelivered`) and a `slack_failed` timeline entry. The notifier runs in the API's consumer next to push
(RFC 0011 "Shape": no binding cycle), so the notifier Worker has not split off yet.

- Distributed as an **app manifest** in the repo: each instance creates its own Slack app in one click (see open question Q6).
- `/inc` declare, `/inc update`, `/inc severity`, `/inc resolve`; buttons for ack/escalate.
- Per-incident channel, pinned summary message kept in sync, timeline mirrored both ways (opt-in per message).
