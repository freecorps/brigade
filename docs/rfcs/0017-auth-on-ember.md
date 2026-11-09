# RFC 0017 — Auth on Ember's `Auth` object (Q33)

- Status: Accepted (design); built in the order below
- Decision (owner, 2026-11-09): move auth to Ember's `Auth` Durable Object. Signing everyone out once is accepted:
  the only users are the two owners, told beforehand.

## Problem

Brigade runs Better Auth on D1 (RFC 0002 "Tooling decisions", `apps/api/src/auth.ts`), and Ember's shards trust a
short-lived token the API mints from the D1 session (RFC 0016 "Auth"). Since 2026-11-08 every workspace is on Ember,
so this is the last part of Brigade's runtime that Ember does not run. Ember's `Auth` object runs Better Auth too
(`@freecorps/ember-auth`, pinned to Better Auth `~1.7.17`): its tables in the object's SQLite, scrypt hashing in the
Worker, its own JWT plugin, sessions looked up over RPC. Moving lets one auth stack be maintained in Ember, served next
to the shards, and makes Brigade the real-world auth example for Ember, as it already is for push.

RFC 0016 kept auth on D1 for three reasons. Two remain and shape this design:

- Brigade's own rules on top of Better Auth (RFC 0002: per-address and per-IP limits, sign-up modes and the first
  owner, uniform sign-up, verified email, password reset that ends every session and drops devices, takeovers, QR
  sign-in, the Expo plugin). Each moves as Better Auth options, and each is tested again on the new store.
- D1 answers the cross-workspace questions a shard cannot (which workspaces a user is in, device registration in
  every workspace at once), and about 90 statements in 23 files of `apps/api` join Better Auth's tables with
  Brigade's own (`invitation_sends`, `api_token`, `session_end`, Slack, status).

The third, the live session migration, is gone: everyone signs in again once.

## Design

**Identity moves; workspaces stay.** The `Auth` object holds what Better Auth needs to sign someone in: `user`,
`account` (the scrypt password hashes, which `better-auth/crypto` reads unchanged), `session`, `verification`,
`rateLimit` and the JWT plugin's `jwks`. Workspaces are Brigade's domain and stay in D1: `organization`, `member` and
`invitation` keep their tables, names and columns, so the statements that read them do not change. Brigade already
writes them itself (`src/invitations.ts`, `src/members.ts`) with most organization routes refused; the organization
plugin goes, and what it gave the clients is replaced below.

**D1 keeps a read copy of `user`.** The joins on `user` (name, email, locale for notifications, members lists,
invitations, Slack) keep working against a D1 `user` table the `Auth` object writes after every change, through
Ember's profile sync hook (`onUserChange`, run after the write commits). Recovery of a lost write: the copy is
rewritten from `Auth.userForSync` on a cron sweep of rows changed in the last day, and at sign-in.

**Sessions are read over RPC.** The statements on `session` (`src/actor.ts`, `src/ember.ts`, `src/ember-devices.ts`,
`src/app-sign-in.ts`, `src/workspace.ts`, `src/auth.ts`) become `Auth.lookupSession`, and the writes (ending a removed
member's sessions in `src/members.ts`) become server-side calls into the object. The `session_end` ledger stays in D1;
the object's session delete hook writes it and asks the shards to close the session's sockets, as the D1 hook does
today (RFC 0016 "Session end").

**The shard token stays Brigade's.** `POST /api/ember-token/:workspace` keeps minting the HS256 token with `ws`,
`role` and `sid` (RFC 0016 "Auth"), resolving the caller with `Auth.lookupSession` instead of D1. Ember's own JWT
plugin is unused by the shards for now.

**The active workspace leaves the session.** The organization plugin's `activeOrganizationId` and its client hooks
(`useActiveOrganization` 5 uses, `organization.setActive` 5, `useListOrganizations` 2, `useActiveMember` 2) are
replaced by Brigade routes over D1: `GET /api/workspaces` (the caller's memberships with role) and the workspace the
client picked, kept by the client (the app already keeps `knownWorkspace`; the dashboard keeps it in the URL and local
storage). The hooks are used 9 times and `organization.setActive` 8 (dashboard: `src/lib/auth.ts` twice,
`members-card.tsx`; app: `session.tsx`, `account.tsx`, `new-workspace.tsx`, `sign-up.tsx` and `use-page-taps.ts`, which
switches to the paged workspace when a page is tapped). Creating a workspace (`auth.api.createOrganization`, 2 uses) is a D1 write in `createWorkspace`.

**Brigade's rules move as options.** `auth.config.ts` holds what `createAuth` builds today: the `before` and `after`
hooks, `databaseHooks`, `emailAndPassword` (reset email, `revokeSessionsOnPasswordReset`), `requireEmailVerification`,
`rateLimit.customRules`, `expo()`, the session's `deviceName`. The per-address counts stay in D1's `rateLimit` table,
which the hooks reach through the Worker's bindings. QR sign-in (`src/app-sign-in.ts`, Better Auth's internal adapter)
becomes a server-only endpoint of a Brigade plugin in the same config, called by the API over RPC.

**Routes.** The API serves the object's handler at `/auth/*` and `/api/auth/*` (the dashboard's proxy) as it serves
Better Auth's today. Cookies change name (Ember's prefix is the project, `brigade`), which is the sign-out.

## Ember gaps

Each is an Ember change with its own tests, released before Brigade uses it.

- **A1. Options that depend on the environment.** Brigade's options read variables (`SIGNUP`, `REQUIRE_VERIFIED_EMAIL`,
  whether an email sender is bound). `defineAuth` takes a function of `env` besides a value; codegen calls it with an
  empty `env` (tables do not depend on it), the object with its own.
- **A2. Bindings in hooks.** Hooks run in the object and need D1, the email sender and the shards. The function form
  of A1 gets `env`; Ember documents it and tests a hook that writes D1.
- **A3. Server-side calls.** An RPC `api(endpoint, { body, headers, query })` that runs `auth.api[endpoint]` in the
  object and answers its JSON, for `getSession`, revoking sessions and plugin endpoints marked server-only.
- **A4. Import.** An admin RPC that inserts `user` and `account` rows with their ids and hashes, in one transaction,
  skipping rows already there, for the one-time copy from D1.

## Order of work

1. Ember: A1–A4, a release.
2. API: the `Auth` binding (Durable Object migration `v5`), `auth.config.ts`, the `user` copy, sessions over RPC, the
   workspace routes, behind `AUTH_ENGINE` (`d1` by default, `ember`). Tests run on both until step 5.
3. Clients: the workspace picker without the organization plugin, on both engines. An EAS update for the app (no
   native change).
4. Cutover, `dev` then production: import `user` and `account` from D1, set `AUTH_ENGINE=ember`, everyone signs in.
   Sessions are not imported (that is the sign-out), and neither is `verification`: a password-reset or verification
   link sent before the cutover stops working, and its owner asks for another one (the owners are told). The
   `rateLimit` counts start over.
   Turning back is `AUTH_ENGINE=d1`. D1 is not left as it was: the `user` copy (the same table Better Auth on D1
   reads) keeps every profile change made on the object, and `session_end` keeps the rows the object's hook wrote,
   which only matter for sessions that are gone either way. What D1 does not get back is the object's own state: a
   password changed there (D1's `account` still has the old hash), an account created there (a `user` row in the copy
   with no `account` row, so its owner resets the password), its sessions (everyone signs in again) and its
   verification links. D1's `account`, `session` and `verification` stay untouched until step 5.
5. After a keep window: remove the D1 path and the organization plugin's leftovers, drop D1's `session`, `account` and
   `verification`.

## Not changed

Workspaces, members, invitations, API tokens (RFC 0014: `api_token` stays in D1 and resolves its user from the copy),
`session_end`, the shard token and the paging path. Sending a page never waits on the `Auth` object: the outbox, the
push transport, the watchdog and the probes use no session, and a socket already open keeps the token it was given
until it refreshes. What does need it is what needs a session today, now read from the object instead of D1:
minting a token (opening or refreshing an app or dashboard socket, so the call screen's "press 1" ack over the
socket), the HTTP ack route a notification action calls, and signing in. So the object is on the acknowledge path as
D1 is today; the ack from a notification keeps its device-key path (RFC 0006), which needs no session.
