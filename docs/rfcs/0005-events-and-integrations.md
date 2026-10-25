# RFC 0005 — Domain events and the open integration model

- Status: Draft

## Domain events

Every successful mutation emits one or more events with a CloudEvents-style envelope:

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

Event types are versioned with the schema package and documented in the generated API reference.

Users, sessions and membership live in D1, written by Better Auth (RFC 0002), not by a shard. A change there that
integrations care about is announced by the workspace shard: creating a workspace runs `workspace.create` in its
new `WorkspaceDO` (`workspace.created`, subject the workspace id). Membership changes (`member.added`,
`member.role_changed`, `member.removed`) follow the same path when invitations land; until then the creator's
membership is part of `workspace.created` (`createdBy`).

## Delivery: transactional outbox

1. A mutation writes its rows **and** its events to an `outbox` table in the same DO SQLite transaction.
2. A DO alarm drains the outbox to a Cloudflare Queue (`brigade-events`), deleting rows only after the send succeeds.
   Spike S3 does step 1 only (`WorkspaceDO`'s `outbox` table); draining comes with the Queue.
3. Consumers are idempotent by `event.id`.

Result: at-least-once delivery, no event lost if the Worker dies between write and publish.

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
