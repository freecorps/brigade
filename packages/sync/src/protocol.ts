// The Brigade Sync wire protocol (RFC 0004 "Protocol"): JSON text frames over one WebSocket per shard. Clients
// and the server import these types and parsers; nothing here touches a socket.
//
// Rules both sides rely on:
// - A socket delivers frames in order, and the server handles a socket's frames one at a time, in arrival order.
// - Versions are per shard: monotonic, safe non-negative integers. Every change (one mutation) is one version.
//   Versions only compare within one `epoch`: an opaque id the shard creates when its storage is first
//   initialised, carried by every data frame. Every restore from a backup writes a new epoch before the shard
//   accepts sockets, so data from before it never compares with data after it.
// - Every `subscribe` is answered by exactly one frame: a `snapshot`, a `patch` holding only that subscription
//   (possibly with no changes), or an `error` with its `subId`.
// - A change reaches a socket as ONE `patch` frame for its version, holding every subscription on that socket the
//   version touches; a version that touches none of them sends nothing there, except to the socket that ran it:
//   after an ok `mutationResult` that socket always gets a `patch` for the version, with empty `subs` if nothing on
//   it was touched. Any data frame at a version means the socket is at that version: the client advances every
//   other subscription in sync on that socket (same epoch) to it.
// - Resume: a `subscribe` with `{ version, epoch }`. The shard answers with a `patch` of what changed since then,
//   or with a `snapshot` when the epoch differs, the version is ahead of its own, or older than its change log.
//   A snapshot replaces the subscription's data whatever its version.
// - The server sends a mutation's `mutationResult` before the `patch` that carries its effects, on the same
//   socket. An ok result carries that version; the client keeps the mutation in its view until every
//   subscription on the shard that can receive data is in sync on the current socket at that version or later
//   (never re-applied on top of its own effects, no flicker, even when a patch is lost with a connection).
// - On every (re)connect the client sends `hello` first, then every unconfirmed `mutate` in its original order
//   (same `mutationId`: the server answers a retry with the stored result), then one `subscribe` per active
//   subscription, with `{ version, epoch }` when it holds data. Mutations go first so their results precede any
//   data with their effects. The shard resumes each subscription from its own `subscribe.version`.
// - The server keeps each mutation result for `MUTATION_RETENTION_MS` after running it, keyed by
//   (clientId, mutationId). The client never re-sends a mutation older than that (by its own clock, since the
//   mutation was created): it fails it with `expired` instead, as the server may no longer recognise a retry.

import type { MutationError, MutationErrorCode } from "@freecorps/brigade-schema";

/** Bumped on any incompatible change. The server answers another version with a `protocol` error. */
export const PROTOCOL_VERSION = 1;

/** How long the server keeps a mutation's result for de-duplication, and the oldest mutation a client re-sends. */
export const MUTATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Largest client frame, measured as the JSON text's length in UTF-16 code units (`string.length`, what both
 * sides can measure without an encoder). At most 192 KiB of UTF-8, well under the WebSocket message limit. The
 * client refuses to send a larger `mutate`; the server refuses to parse a larger frame.
 */
export const MAX_CLIENT_MESSAGE_LENGTH = 64 * 1024;

/** A row as it travels: a JSON object with a string `id`. Its table is the subscribed query's table. */
export type WireRow = { id: string; [column: string]: unknown };

/** Subscription, mutation and client ids: 1 to 64 characters of `A-Z a-z 0-9 _ : -`. */
export const TOKEN = /^[\w:-]{1,64}$/;

// ---------------------------------------------------------------------------------------------- client → server

export type HelloMessage = {
  type: "hello";
  protocol: number;
  /** Stable for the life of the client (an app install, a browser tab); the server de-duplicates by it. */
  clientId: string;
  /**
   * Reserved, unused in spike S3: the Worker authenticates the upgrade request (session cookie or bearer token)
   * and hands the DO a signed auth header (RFC 0004 "Socket topology"). The server must ignore it.
   */
  token?: string;
};

export type SubscribeMessage = {
  type: "subscribe";
  subId: string;
  /** A query name from the `queries` registry of `@freecorps/brigade-schema`. */
  query: string;
  args: unknown;
  /**
   * Resume, sent together with `epoch`: the last shard version the client received for this subscription. The
   * server replies with a `patch` of what changed in the result since then, or a `snapshot` if the epoch is not
   * its own, the version is ahead of its own, or its change log no longer reaches back. Absent: a `snapshot`.
   */
  version?: number;
  /** The epoch of the data the client holds for this subscription; present exactly when `version` is. */
  epoch?: string;
};

export type UnsubscribeMessage = { type: "unsubscribe"; subId: string };

export type MutateMessage = {
  type: "mutate";
  /** Unique per client; a retry reuses it and gets the stored result. */
  mutationId: string;
  /** A mutation name from the `mutations` registry. */
  name: string;
  args: unknown;
};

export type ClientMessage = HelloMessage | SubscribeMessage | UnsubscribeMessage | MutateMessage;

// ---------------------------------------------------------------------------------------------- server → client

/** The subscription's full result at `version`; replaces whatever the client held for it. */
export type SnapshotMessage = {
  type: "snapshot";
  subId: string;
  /** The shard's epoch (see the top of this file). */
  epoch: string;
  version: number;
  rows: WireRow[];
};

/**
 * Changes to one subscription's result: rows that entered or changed (whole rows), and ids that left the result
 * (deleted, or no longer matching the query). A delete for a row the client lacks is a no-op.
 */
export type SubscriptionChanges = { upserts: WireRow[]; deletes: string[] };

/**
 * Every change of one version on this socket, by subscription. Subscriptions on the socket that are absent were
 * not touched by it, so they hold the state at `version` too.
 */
export type PatchMessage = {
  type: "patch";
  epoch: string;
  version: number;
  subs: { [subId: string]: SubscriptionChanges };
};

export type MutationResultMessage =
  | {
      type: "mutationResult";
      mutationId: string;
      ok: true;
      /** The shard version holding its effects. */
      version: number;
    }
  | { type: "mutationResult"; mutationId: string; ok: false; error: MutationError };

/**
 * Something the server could not do.
 * - With `subId`: the subscription was refused (`unknown_query`, `forbidden`, `invalid_args`, `internal`) and gets
 *   no data until it is subscribed again.
 * - With `mutationId`: a final refusal of a `mutate` the server could parse, before running it and without
 *   recording a result for it (so a retry with that id is not de-duplicated), e.g. a per-client limit on
 *   mutations. The client fails the mutation with this code (`internal` unless it is a mutation error code) and
 *   never re-sends it. The server never answers a parseable `mutate` with a `protocol` error: every one gets a
 *   `mutationResult` (domain failures, bad args and unknown names included) or this error. A frame it cannot
 *   parse at all (the client never sends one) gets a `protocol` error without ids.
 * - With neither: about the socket. `protocol` (unsupported version, a malformed frame, no `hello` first) makes the
 *   client close the socket and reconnect with backoff.
 */
export type ErrorMessage = {
  type: "error";
  code: string;
  message: string;
  subId?: string;
  mutationId?: string;
};

export type ServerMessage = SnapshotMessage | PatchMessage | MutationResultMessage | ErrorMessage;

// --------------------------------------------------------------------------------------------------- parsing

export type Parsed<T> = { ok: true; message: T } | { ok: false; reason: string };

export const MUTATION_ERROR_CODES: readonly MutationErrorCode[] = [
  "unknown_mutation",
  "invalid_args",
  "forbidden",
  "not_found",
  "invalid_transition",
  "conflict",
  "limit_reached",
  "internal",
];

const MAX_ISSUES = 10;

class Invalid extends Error {}

function fail(reason: string): never {
  throw new Invalid(reason);
}

type Obj = Record<string, unknown>;

function isPlainObject(value: unknown): value is Obj {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const has = (obj: Obj, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

/** Rejects any field not in `keys`. */
function only(value: unknown, keys: readonly string[], what = "frame"): Obj {
  if (!isPlainObject(value)) fail(`${what} must be an object`);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`unexpected field ${key.slice(0, 32)}`);
  }
  return value;
}

function token(obj: Obj, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || !TOKEN.test(value)) fail(`${key} must be a token`);
  return value;
}

/** A string; `max` bounds texts the client keeps (messages), not names (bounded by the frame). */
function text(obj: Obj, key: string, max = Infinity): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length > max) fail(`${key} must be a string`);
  return value;
}

function version(value: unknown, key = "version"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(`${key} must be a safe non-negative integer`);
  }
  return value;
}

function row(value: unknown): WireRow {
  if (!isPlainObject(value) || typeof value.id !== "string" || value.id.length === 0) {
    fail("rows must be objects with a string id");
  }
  return value as WireRow;
}

function rows(value: unknown, key: string): WireRow[] {
  if (!Array.isArray(value)) fail(`${key} must be an array`);
  return value.map(row);
}

function ids(value: unknown, key: string): string[] {
  // The row id rule: a non-empty string.
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || id.length === 0)) {
    fail(`${key} must be an array of ids`);
  }
  return [...(value as string[])];
}

function mutationError(value: unknown): MutationError {
  const obj = only(value, ["code", "message", "issues"], "error");
  const code = obj.code;
  if (!(MUTATION_ERROR_CODES as readonly unknown[]).includes(code)) fail("unknown error code");
  const error: MutationError = {
    code: code as MutationErrorCode,
    message: text(obj, "message", 1024),
  };
  if (has(obj, "issues")) {
    if (!Array.isArray(obj.issues)) fail("issues must be an array");
    error.issues = obj.issues.slice(0, MAX_ISSUES).map((issue: unknown) => {
      const fields = only(issue, ["path", "message"], "issue");
      return { path: text(fields, "path", 256), message: text(fields, "message", 1024) };
    });
  }
  return error;
}

function decode(data: unknown, max?: number): Obj {
  if (typeof data !== "string") fail("frames must be text");
  if (max !== undefined && data.length > max) fail("frame too large");
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    fail("frames must be JSON");
  }
  if (!isPlainObject(value)) fail("frames must be JSON objects");
  return value;
}

function parse<T>(data: unknown, read: (obj: Obj) => T, max?: number): Parsed<T> {
  try {
    return { ok: true, message: read(decode(data, max)) };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, reason: error.message };
    // A hostile value (a getter, a proxy) cannot arrive through JSON.parse; anything else is still not a crash.
    return { ok: false, reason: "unreadable frame" };
  }
}

/**
 * Reads a frame from the server. Never throws: anything malformed is `{ ok: false, reason }`, which the client
 * logs and ignores. Returns fresh, validated objects; unknown fields are rejected.
 */
export function parseServerMessage(data: unknown): Parsed<ServerMessage> {
  return parse(data, (obj): ServerMessage => {
    switch (obj.type) {
      case "snapshot":
        only(obj, ["type", "subId", "epoch", "version", "rows"]);
        return {
          type: "snapshot",
          subId: token(obj, "subId"),
          epoch: token(obj, "epoch"),
          version: version(obj.version),
          rows: rows(obj.rows, "rows"),
        };
      case "patch": {
        only(obj, ["type", "epoch", "version", "subs"]);
        if (!isPlainObject(obj.subs)) fail("subs must be an object");
        // No prototype: a subId such as `__proto__` stays an ordinary key.
        const subs = Object.create(null) as PatchMessage["subs"];
        for (const [subId, value] of Object.entries(obj.subs)) {
          if (!TOKEN.test(subId)) fail("subs keys must be tokens");
          const changes = only(value, ["upserts", "deletes"], "subs entry");
          subs[subId] = {
            upserts: rows(changes.upserts, "upserts"),
            deletes: ids(changes.deletes, "deletes"),
          };
        }
        return { type: "patch", epoch: token(obj, "epoch"), version: version(obj.version), subs };
      }
      case "mutationResult": {
        const mutationId = token(obj, "mutationId");
        if (obj.ok === true) {
          only(obj, ["type", "mutationId", "ok", "version"]);
          return { type: "mutationResult", mutationId, ok: true, version: version(obj.version) };
        }
        if (obj.ok === false) {
          only(obj, ["type", "mutationId", "ok", "error"]);
          return { type: "mutationResult", mutationId, ok: false, error: mutationError(obj.error) };
        }
        return fail("ok must be a boolean");
      }
      case "error": {
        only(obj, ["type", "code", "message", "subId", "mutationId"]);
        const message: ErrorMessage = {
          type: "error",
          code: text(obj, "code", 64),
          message: text(obj, "message", 1024),
        };
        if (has(obj, "subId")) message.subId = token(obj, "subId");
        if (has(obj, "mutationId")) message.mutationId = token(obj, "mutationId");
        return message;
      }
      default:
        return fail("unknown message type");
    }
  });
}

/**
 * Reads a frame from a client, for the server. Never throws. Refuses frames over `MAX_CLIENT_MESSAGE_LENGTH`.
 * Checks the envelope only: `query`/`name` and `args` are checked by `runQuery`/`runMutation`, which accept
 * anything off the wire (and clip names they echo).
 */
export function parseClientMessage(data: unknown): Parsed<ClientMessage> {
  return parse(
    data,
    (obj): ClientMessage => {
      switch (obj.type) {
        case "hello": {
          only(obj, ["type", "protocol", "clientId", "token"]);
          const message: HelloMessage = {
            type: "hello",
            protocol: version(obj.protocol, "protocol"),
            clientId: token(obj, "clientId"),
          };
          if (has(obj, "token")) message.token = text(obj, "token");
          return message;
        }
        case "subscribe": {
          only(obj, ["type", "subId", "query", "args", "version", "epoch"]);
          const message: SubscribeMessage = {
            type: "subscribe",
            subId: token(obj, "subId"),
            query: text(obj, "query"),
            args: obj.args,
          };
          if (has(obj, "version") !== has(obj, "epoch")) fail("version and epoch go together");
          if (has(obj, "version")) {
            message.version = version(obj.version);
            message.epoch = token(obj, "epoch");
          }
          return message;
        }
        case "unsubscribe":
          only(obj, ["type", "subId"]);
          return { type: "unsubscribe", subId: token(obj, "subId") };
        case "mutate":
          only(obj, ["type", "mutationId", "name", "args"]);
          return {
            type: "mutate",
            mutationId: token(obj, "mutationId"),
            name: text(obj, "name"),
            args: obj.args,
          };
        default:
          return fail("unknown message type");
      }
    },
    MAX_CLIENT_MESSAGE_LENGTH,
  );
}

/** Serializes a message for the wire. */
export function encode(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}
