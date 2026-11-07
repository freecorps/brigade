// Workspace id patterns, in a module of their own so code that runs outside the Durable Object (Ember functions, the
// Node tests) can use them without importing `WorkspaceDO`.

/**
 * Workspace ids: a workspace's own id (`ws_<ULID>`, the Better Auth organization id), or 1-63 chars of `a-z`,
 * `0-9`, `-`, `_` starting with `a-z0-9` (dev shards such as `demo`, and the tests).
 */
export const WORKSPACE_ID = /^(?:ws_[0-9A-HJKMNP-TV-Z]{26}|[a-z0-9][a-z0-9_-]{0,62})$/;

/**
 * A workspace's own id alone (`ws_<ULID>`, src/auth.ts `authId`): what routes for D1's workspaces accept, so none
 * of them takes a short, guessable dev-shard name.
 */
export const ORGANIZATION_ID = /^ws_[0-9A-HJKMNP-TV-Z]{26}$/;
