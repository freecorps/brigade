# RFC 0005 — Domain events and the open integration model

- Status: Draft

## Domain events

Every successful mutation emits one or more events with a CloudEvents-style envelope (the one exception is a
mutation declared `silent`: today `monitor.report`'s routine refreshes, `member.sync`, the shard's cache of the
members in D1, `webhook.record`, an outbound webhook's delivery log, which emits only when it turns the endpoint
off, and `export.reserve`, an export's slot in the hourly limit, whose export emits `workspace.exported` once recorded;
RFC 0004):

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
(`id`; never the token or its hash) when an owner or admin gives a heartbeat a new URL; and, when the owner of an
address takes back an account someone else signed up with (RFC 0002 "Auth"), `monitor.paused` and
`monitor.heartbeat_revoked` (`id`) with actor `sys_account`.

Incidents emit `incident.declared`, `incident.status_changed`, `incident.severity_changed`,
`incident.acknowledged`, `incident.update_posted` (`entryId`, `body`) and `incident.role_assigned` (`role`,
`from`, `to`; `to` null when unassigned). Each of those mutations also appends the incident's timeline entry in
the same transaction (RFC 0003 "Timeline, updates and roles"); the monitor recovery note rides with
`alert.resolved`.

The catalog (RFC 0003 "Service catalog", "Incident types", "Custom fields") emits `service.created` (`id`, `name`,
`tier`, `owners`: how many, `escalationPolicyId`), `service.updated` (the same, plus `reason`: `edited`, or
`policy_deleted`, `schedule_deleted` or `member_removed` with the `ref` taken out), `service.deleted` (`id`, `name`),
`incident_type.created` (`id`, `name`, `defaultSeverity`, `escalationPolicyId`, `requiredFields`: how many),
`incident_type.updated` (the same, plus `reason`: `edited`, `policy_deleted` or `field_deleted`, and `ref`),
`incident_type.deleted`, `custom_field.created` and `custom_field.updated` (`id`, `name`, `kind`, `options`: how many)
and `custom_field.deleted`. On incidents: `incident.type_changed` (`from`, `to`: type ids or null),
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
member, after D1 committed (RFC 0003 "Members"); a removal also emits `device.unregistered` (`member_removed`) for
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
from `device.signOut`, or from `member.reconcile` when that failed, RFC 0002 "Auth") and `notification.failed` (`incidentId`, `eventId` of the event that asked for the page, `channel: "push"`,
`userId` or null, `reason`: `no_devices`, `token_invalid` (no device left because the push service refused the one a
page of this incident went to), `undelivered`, `unsupported`, `not_configured`, `over_limit`,
`dead_lettered`, and for escalation levels `nobody_on_call`, `schedule_missing`, `not_a_member`; `schedule`: the
name of the schedule nobody was on call for, else null; `page`: the escalation run and step it belongs to, absent
outside a run), with actor
`sys_notifier` for what the notifier records. Delivery receipts (RFC 0006 "Delivery receipts") emit
`notification.planned` (`incidentId`, `eventId`, `devices`: how many new, `page`, `dropped`: older delivery rows
removed to keep the latest 20 per device, absent when none), `notification.sent` (`incidentId`,
`eventId`, `accepted`, `failed`: one attempt's outcome) and `notification.delivered` (`incidentId`, `eventId`,
`userId`, `deviceId`: the phone opened it), actor `sys_notifier`; no notifier acts on them. `notification.failed` rides with a `page_failed` timeline entry. The
email notifier's own failures are `notification.failed` with `channel: "email"` (`incidentId`, `eventId`: the push
failure the email was about, `userId`, `reason`: `undelivered`, or `capped` when a cap dropped it, `about`: `unpaged` or `nobody_paged`), with an
`email_failed` entry ("Couldn't email Ana that nobody could be paged"). Changing who is emailed emits
`workspace.email_changed` (`unpaged`, `nobodyPaged`).

Outbound webhooks ("Outbound webhooks" below) emit `webhook.created` (`id`, `events`, `enabled`), `webhook.updated`
(`id`, `events`, `urlChanged`), `webhook.enabled` (`id`), `webhook.disabled` (`id`, `reason`: `manual`, or `failing`
when Brigade turned it off, `failures`), `webhook.secret_rotated` (`id`), `webhook.deleted` (`id`) and `webhook.test`
(`id`: "Send test event"), subject the endpoint; never its URL (which may carry the receiver's token) or its secret.
The webhook notifier's `webhook.redeliver` (`eventId`) brings deliveries due again back to the queue ("Retries").

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
  catches what still fails (a bug). Nothing reads it yet: inspect and replay it by hand.

## Notifiers

The first consumer is the API Worker's own `queue` handler (`apps/api/src/notify.ts`). It routes each event to its
notifiers: push, and email for a page that failed ("Email" below). Email stays in this Worker too: it needs the same
bindings (the shards, D1) and is small; RFC 0002's notifier Worker splits off with Slack, or when a notifier's load
or dependencies should not share the API's.

- **What pages**: `incident.declared` (urgency `page` for SEV1 and SEV2, `high` otherwise),
  `incident.severity_changed` raised into SEV1 or SEV2 (`page`), and `escalation.paged` for a level the shard's
  alarm fired (urgency from the incident's severity). With a default escalation policy the first of those starts a
  run and pages its first level (RFC 0006 "Who is paged"). Monitors open incidents with
  `incident.declared` as `sys_monitors` (SEV2), so they page through the same rule. A page is not sent for an
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
  still its escalation run's last is paged again on an event of its own (RFC 0006 "A lost page"). If the shard
  still cannot be reached it logs `dead-lettered page could not be recorded` and retries in 2 minutes, up to 5
  times (`max_retries: 5`, no dead-letter queue of its own, so spent retries delete the message: nothing loops).
- **The outbox.** A row the drain cannot read (not JSON) or too large for the Queue is logged and dropped, so it
  never blocks the events after it; any drain that throws (storage) backs off like a failed send.
- **Delivery receipts.** Each page records a row per device, from planned to accepted by APNs, and the phone reports
  when it opened it (RFC 0006 "Delivery receipts"); the dashboard explains from them why someone was or was not
  paged. None of it is in a page's way: recording fails open. A level whose pushes all fail escalates to the next
  level of its round at once (RFC 0006 "Who is paged"; what else should count is Q18). Outside the incident, a failed page reaches people by email
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
  - **The owners, when nobody could be paged** (`nobody_paged`, Q18): the page settled having reached nobody on any
    device and nothing else will page on its own: there is no escalation run (the interim rule was the page), or the
    page was the last of a run that ended (everyone who can respond). A level that missed everyone is not it: the
    next level fires. Neither is a dead-lettered page (paged again on its own event), a stalled level (everyone is
    paged after it) or a page only its declarer could answer. Owners come from D1, so one who never opened Brigade
    is told too; at most 50. Once per page.
  - Neither once the incident is acknowledged or no longer active, or when the workspace turned it off.
- **Workspace settings.** `workspace.setEmail` (`workspace:manage`: owners and admins) sets both on or off; both are
  on by default (`DEFAULT_EMAIL_SETTINGS`), since the alternative is that nobody outside the incident hears of a page
  that failed. The dashboard has no switch yet. Per-member opt-out is deferred: these emails say a page failed, so
  turning them off is a workspace's decision for now; a member preference arrives with notification preferences.
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
  Invitations are the one email to an address nobody proved, so they have their own bounds (RFC 0003
  "Invitations"): only a verified member may invite; per workspace, 30 invitation emails a day, 50 pending and one
  send per invitation per 5 minutes; and across every workspace, counted in D1, 3 a day to one address (its `+tags` counted as one), 50 a day
  from one inviter and 5 per invitation ever, so many workspaces cannot add up to flood one inbox. The verification
  email goes only to one's own address and never carries the name typed at sign-up: at most 3 per user in 15
  minutes and 5 a day. The password reset email goes to an address that has an account (the same answer either
  way) and carries no name: at most 3 per address and IP an hour and 10 per address a day, counted for any address, and 3 per IP a
  minute. An address someone else signed up with and never verified stays taken until its owner resets the
  password, which takes the account back (RFC 0002 "Auth"). Whether these caps are right in production is Q21's.
- **Push first.** Email only acts on failures push already recorded, so it can never delay or stop a page. The
  consumer handles a batch's messages in parallel and acks each on its own: a page in the same batch as an email
  goes to the relay without waiting for it (tested). Every wait on the email side is bounded (10 s a send, 5 s the
  D1 read).
- **Not yet.** No email to Brigade's operators when the paging pipeline degrades (Q19), to owners when a rotation
  changes (Q20); each can build on the `EmailSender`.

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
  `webhook.delete` and `webhook.sendTest` (at most one per endpoint per 10 s) over sync; `webhook.create` and
  `webhook.rotateSecret` are server-only, run by the API as the member (`POST /workspaces/:id/webhooks`,
  `…/webhooks/:webhookId/rotate`) because the server makes the secret. An endpoint takes events from when it was
  created, and only while it is on: deliveries pending when it is turned off or deleted are dropped.
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
  type, time, workspaceId, actor: { kind, id }, data }`; `time` is when the event happened. Member ids, never names
  or addresses. **What version 1 may grow by:** new event types, new values in any list (a severity, a status, a
  monitor kind, a role, an actor kind, a reason) and new fields, anywhere. Removing or renaming any of them, or changing
  a field's type or meaning, is `version: 2`, never an edit of version 1. So a receiver must take what it does not know
  yet: the validators accept any string where a list may grow (typed as the known values or `string`), text much
  longer than Brigade writes today (`WEBHOOK_PAYLOAD_TEXT_MAX`), and a `type` they do not know as an unknown payload
  (the envelope checked, `data` as sent) rather than an error; a field they do not know is dropped. The catalog
  (`WEBHOOK_EVENT_TYPES`) and each `data`:
  - `incident.declared` (`incident`), `incident.status_changed` and `incident.severity_changed` (`incident`, `from`,
    `to`), `incident.acknowledged` (`incident`, `by`), `incident.update_posted` (`incident`, `body`: what the member
    wrote, which every member already reads) and `incident.role_assigned` (`incident`, `role`, `from`, `to`), where
    `incident` is `{ id, number, title, severity, status, declaredAt, acknowledgedAt }`;
  - `alert.fired` (`alertId`, `monitor`, `incidentId`), `alert.resolved` (`alertId`, `monitor`, `reason`) and
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
  latency, error, and for a failure at most 200 characters of the answer, printable text only), written by the
  silent `webhook.record`. No request bodies are kept beyond the ledger's payload (15 days, like the page ledger).
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
- **Not yet.** Publishing the SDK to npm (the owner's call); per-endpoint custom headers; replaying a given-up
  delivery from the dashboard.

## Slack (first ChatProvider)

The first slice is designed in RFC 0011: install, `/inc declare` and `ack`, an Acknowledge button and one message per
incident. It emits `slack.connected` (`teamId`, `teamName`, `replaced`), `slack.configured` (`channelId`, `locale`)
and `slack.disconnected` (`teamId`), never the token; a message the notifier gave up on is `notification.failed`
with `channel: "slack"` (`incidentId`, `eventId`, `userId: null`, `reason`: `no_channel`, `not_authorized`,
`rate_limited`, `undelivered`) and a `slack_failed` timeline entry. The notifier runs in the API's consumer next to push
(RFC 0011 "Shape": no binding cycle), so the notifier Worker has not split off yet.

- Distributed as an **app manifest** in the repo: each instance creates its own Slack app in one click (see open question Q6).
- `/inc` declare, `/inc update`, `/inc severity`, `/inc resolve`; buttons for ack/escalate.
- Per-incident channel, pinned summary message kept in sync, timeline mirrored both ways (opt-in per message).
