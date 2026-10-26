# RFC 0005 — Domain events and the open integration model

- Status: Draft

## Domain events

Every successful mutation emits one or more events with a CloudEvents-style envelope (the one exception is a
mutation declared `silent`: today `monitor.report`'s routine refreshes and `member.sync`, the shard's cache of the
members in D1; RFC 0004):

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
`alert.resolved`, with actor `sys_monitors` for what the probes and heartbeats cause.

Incidents emit `incident.declared`, `incident.status_changed`, `incident.severity_changed`,
`incident.acknowledged`, `incident.update_posted` (`entryId`, `body`) and `incident.role_assigned` (`role`,
`from`, `to`; `to` null when unassigned). Each of those mutations also appends the incident's timeline entry in
the same transaction (RFC 0003 "Timeline, updates and roles"); the monitor recovery note rides with
`alert.resolved`.

On-call schedules (RFC 0003 "Schedules") emit `schedule.created` (`id`, `name`, `timeZone`, `layers`: how many),
`schedule.updated` (the same, plus `reason`: `edited`, or `member_removed` with the `userId` taken out of the
rotations), `schedule.deleted` (`id`, `overrides` deleted with it), `schedule.override_added` (`id`, `scheduleId`,
`userId`, `start`, `end`) and `schedule.override_removed` (`id`, `scheduleId`, `userId`, `reason`: `removed`,
`member_removed` or `expired`). Escalation policies (RFC 0003 "Escalation policies") emit `escalation_policy.created` (`id`, `name`, `levels`: how many,
`repeat`, `isDefault`), `escalation_policy.updated` (the same, plus `reason`: `edited`, `default_changed` when another
policy became the default, `member_removed` with the `userId` or `schedule_deleted` with the `scheduleId` taken out of
the levels) and `escalation_policy.deleted` (`id`, `wasDefault`). Escalation runs, actor `sys_escalation`, emit
`escalation.paged` for every level fired (`incidentId`, `policyId`, `level`, 1-based or null for everyone who can
respond, `round`, `userIds`, `missed`: the targets that could not be paged, `reason`: `started`, `timeout` or
`unreachable`, and `started`, true for the level a run started with, which is paged on the event that started it)
and `escalation.exhausted` (`incidentId`, `policyId`, `levels`, `rounds`). An ack or a resolve stops a run with no
event of its own: `incident.acknowledged` and `incident.status_changed` say it. A member removal or a change to
viewer carries the schedule and policy events with
`member.removed` or `member.role_changed`, in the same transaction; a viewer role copied from D1 by `member.sync`
carries them alone (no `member.*` event: that change happened outside Brigade).

Users, sessions and membership live in D1, written by Better Auth (RFC 0002), not by a shard. A change there that
integrations care about is announced by the workspace shard: creating a workspace runs `workspace.create` in its
new `WorkspaceDO` (`workspace.created`, subject the workspace id). Member changes made through Brigade emit
`member.role_changed` (`userId`, `from`, `to`) and `member.removed` (`userId`, `role`, null when the shard no longer
knew it, `reason`: `removed`, `left`,
or `reconciled` when the shard caught up with a change D1 had and it missed, actor `sys_members`; a member
removed through Brigade whose copy a late sync upgrade restored is announced again as `reconciled`), subject the
member, after D1 committed (RFC 0003 "Members"); a removal also emits `device.unregistered` (`member_removed`) for
each of the member's devices. `member.added` waits for invitations; until then the creator's membership is part of
`workspace.created` (`createdBy`). The API still refuses Better Auth's routes that would change a workspace or its
members without an event (update, delete, member roles, removing or adding members, invitations, teams, leaving);
see RFC 0002 "Auth". The shard's own copy of a member (`members`, written by `member.sync` when they open a socket)
is a cache of D1, and `member.sync` emits nothing of its own; when it copies a viewer role it emits the schedule
events of taking that member out of the rotations (above).

Devices and paging emit `device.registered` (`id`, `userId`, `platform`, `environment`, `voip`: never the tokens or
the key), `device.unregistered` (`reason`: `unregistered` by the member, `token_invalid` when APNs said the token is
gone, `member_removed` when its member left or was removed) and `notification.failed` (`incidentId`, `eventId` of the event that asked for the page, `channel: "push"`,
`userId` or null, `reason`: `no_devices`, `undelivered`, `unsupported`, `not_configured`, `over_limit`,
`dead_lettered`, and for escalation levels `nobody_on_call`, `schedule_missing`, `not_a_member`; `schedule`: the
name of the schedule nobody was on call for, else null), with actor
`sys_notifier` for what the notifier records. `notification.failed` rides with a `page_failed` timeline entry.

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

The first consumer is the API Worker's own `queue` handler (`apps/api/src/notify.ts`); RFC 0002's notifier Worker
splits off when there is more than push to run. It routes each event to its notifiers; push is the only one so far.

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
  respond on the next attempt.
- **The shard failing.** The shard being unreachable or throwing retries the whole message, up to the Queue's
  `max_retries` (10, so 11 deliveries); the last logs `page dead-lettered` (event, incident, workspace) and the
  message goes to `brigade-events-dlq`. The same Worker consumes that queue: for a page not already settled, on an
  incident still active and unacknowledged, it records `notification.failed` with `userId: null` and
  `dead_lettered` ("A page may not have gone out"), closes the page in the ledger, and acks. If the shard
  still cannot be reached it logs `dead-lettered page could not be recorded` and retries in 2 minutes, up to 5
  times (`max_retries: 5`, no dead-letter queue of its own, so spent retries delete the message: nothing loops).
- **The outbox.** A row the drain cannot read (not JSON) or too large for the Queue is logged and dropped, so it
  never blocks the events after it; any drain that throws (storage) backs off like a failed send.
- **Not yet.** Delivery receipts (did the phone show it, did anyone see it) and the "why wasn't I paged" view are
  Phase 2; until then "delivered" means the relay and APNs accepted the push. Escalating early when a level's pushes all
  fail (rather than at its timeout) waits for delivery receipts. A failed page alerts nobody outside the incident yet:
  the timeline entry and the log line are what surfaces it.

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
- Lightweight alternative for anything outside Cloudflare: **outbound webhooks** (signed, HMAC-SHA256, retries with backoff)
  and the public REST API (OpenAPI spec generated from `packages/schema`).

## Slack (first ChatProvider)

- Distributed as an **app manifest** in the repo: each instance creates its own Slack app in one click (see open question Q6).
- `/inc` declare, `/inc update`, `/inc severity`, `/inc resolve`; buttons for ack/escalate.
- Per-incident channel, pinned summary message kept in sync, timeline mirrored both ways (opt-in per message).
