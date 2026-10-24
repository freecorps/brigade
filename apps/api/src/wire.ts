// The frames this shard sends (RFC 0004 "Protocol"). Client frames are read with packages/sync's
// `parseClientMessage`; server frames are built here, in one place, so the server follows the protocol's shape:
//
// - `snapshot` is per subscription.
// - `patch` is one frame per version per socket, covering every subscription on that socket the version touched.
// - `error` may name the subscription (`subId`) or the mutation (`mutationId`) it is about.
//
// TODO(S3): import these types from `@freecorps/brigade-sync/protocol` once the client slice that settles the
// per-version patch lands, and delete the copies.

import type { MutationError } from "@freecorps/brigade-schema";

export type WireRow = { id: string; [column: string]: unknown };

export type SubPatch = { upserts: WireRow[]; deletes: string[] };

export type ServerFrame =
  | { type: "snapshot"; subId: string; version: number; rows: WireRow[] }
  | { type: "patch"; version: number; subs: { [subId: string]: SubPatch } }
  | { type: "mutationResult"; mutationId: string; ok: true; version: number }
  | { type: "mutationResult"; mutationId: string; ok: false; error: MutationError }
  | { type: "error"; code: string; message: string; subId?: string; mutationId?: string };

export type MutationResultFrame = Extract<ServerFrame, { type: "mutationResult" }>;

export const encodeFrame = (frame: ServerFrame): string => JSON.stringify(frame);
