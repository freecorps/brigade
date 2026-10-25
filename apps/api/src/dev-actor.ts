// Kept free of Workers imports so the web dashboard's tests can check its optimistic actor matches this one.
import type { Actor } from "@freecorps/brigade-schema";

/**
 * DEV ONLY. There is no auth yet, so every socket acts as this responder, and only where `SYNC_DEV_ACTOR` is "1":
 * the `dev` environment in wrangler.jsonc and local runs (vite.config.ts, the tests). Anywhere else the sync
 * upgrade is refused with 501. Once auth exists the Worker authenticates the upgrade and passes the actor to the
 * shard in a signed header (RFC 0004 "Socket topology").
 */
export const DEV_ACTOR: Actor = { kind: "user", id: "usr_dev", role: "responder" };

/** The variable that enables `DEV_ACTOR`. */
export const DEV_ACTOR_VAR = "SYNC_DEV_ACTOR";
