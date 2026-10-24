// The transactional outbox (RFC 0005 "Delivery"): every committed mutation writes its events here, in the same
// SQLite transaction as its rows, wrapped in the `BrigadeEvent` envelope.
//
// Phase 1 only writes. Draining (a DO alarm sending rows to the `brigade-events` Queue and deleting them only
// after the send succeeds) comes with the Queue; until then rows accumulate, which is fine for a dev shard.

import { newId, type Actor, type DomainEvent, type RandomBytes } from "@freecorps/brigade-schema";

/** RFC 0005's envelope. */
export type BrigadeEvent<T = unknown> = {
  /** `evt_<ULID>` (RFC 0003 prefixed ids); consumers de-duplicate by it. */
  id: string;
  type: string;
  /** `brigade://<workspace>/<shard>`; the workspace shard is `workspace`. */
  source: string;
  workspaceId: string;
  /** ISO 8601, from the mutation's `ctx.now`. */
  time: string;
  actor: { kind: Actor["kind"]; id: string };
  subject?: string;
  data: T;
  specversion: "1.0";
};

export const OUTBOX_SCHEMA = `
  create table if not exists outbox (
    seq integer primary key,
    id text not null unique,
    version integer not null,
    event text not null
  );
`;

export type OutboxContext = {
  workspaceId: string;
  shard: string;
  actor: Actor;
  now: number;
  /** The shard version the mutation committed as. */
  version: number;
  randomBytes: RandomBytes;
};

/** Wraps and writes `events`; call it inside the mutation's transaction. Returns the envelopes. */
export function writeOutbox(
  sql: SqlStorage,
  events: readonly DomainEvent[],
  ctx: OutboxContext,
): BrigadeEvent[] {
  return events.map((event) => {
    const envelope: BrigadeEvent = {
      id: newId("evt", ctx.now, ctx.randomBytes),
      type: event.type,
      source: `brigade://${ctx.workspaceId}/${ctx.shard}`,
      workspaceId: ctx.workspaceId,
      time: new Date(ctx.now).toISOString(),
      actor: { kind: ctx.actor.kind, id: ctx.actor.id },
      ...(event.subject === undefined ? {} : { subject: event.subject }),
      data: event.data,
      specversion: "1.0",
    };
    sql.exec(
      "insert into outbox (id, version, event) values (?, ?, ?)",
      envelope.id,
      ctx.version,
      JSON.stringify(envelope),
    );
    return envelope;
  });
}
