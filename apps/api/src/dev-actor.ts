// Kept free of Workers imports so the mobile app's tests can check its optimistic actor matches this one.
import type { Actor } from "@freecorps/brigade-schema";

/**
 * DEV ONLY: who a sync upgrade without a session acts as, and only where `SYNC_DEV_ACTOR` is "1": local runs
 * (vite.config.ts) and the tests, never a deployed environment (src/actor.ts). Everywhere else such an upgrade
 * gets 401. No app relies on it since the mobile app signs in; it stays for local tools and the tests.
 */
export const DEV_ACTOR: Actor = { kind: "user", id: "usr_dev", role: "responder" };

/** The variable that enables `DEV_ACTOR`. */
export const DEV_ACTOR_VAR = "SYNC_DEV_ACTOR";
