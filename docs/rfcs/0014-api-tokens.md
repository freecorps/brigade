# RFC 0014 — API tokens

- Status: Draft

How something that is not a browser calls Brigade's public HTTP API (RFC 0002 "Public HTTP API") and opens Brigade
Sync: a per-workspace token sent as `Authorization: Bearer`. Until now only the Better Auth session cookie worked,
which a script or a CI job cannot hold comfortably. The code: `packages/schema/src/api-tokens.ts` (scopes, the shard's
copy, the mutations), `apps/api/src/api-tokens.ts` (minting, revoking, resolving a bearer), the D1 table
`migrations/0009_api_token.sql`, and the dashboard's API tokens card.

## Who mints them, and what they carry

- **Per workspace.** A token acts in one workspace only. Owners and admins mint and revoke them (`token:manage`,
  RFC 0003's table). The list is synced to every member (`apiToken.all`, `workspace:read`): who in the workspace
  acts through a script is no secret, like the member list. The list never holds the token or its hash.
- **Name, expiry, scopes.** A name (1 to 60 characters), an optional expiry (1 to 365 days; none means until
  revoked) and one or more scopes. Up to 50 tokens a workspace that are neither revoked nor expired.
- **Scopes are the permissions** of RFC 0003 (`incident:ack`, `incident:update`, `monitor:manage`, `members:manage`,
  …): `TOKEN_SCOPES`, every permission except `workspace:create` (a token belongs to a workspace that exists),
  `device:register` (devices are a person's phone) and `token:manage` (a token never mints or revokes tokens; those
  routes take the cookie only). Minting checks every scope against the creator's role then.
- **Never more than its creator.** The token acts with its creator's **current** role, read in D1 on every use, and
  a permission passes only when both the role and the token's scopes grant it (`allows` in
  `packages/schema/src/access.ts`, used by `runMutation` and `runQuery`). An admin demoted to responder keeps a
  token with `monitor:manage`, but every use of that scope is refused from then on (`403 forbidden`); promoted back,
  it works again.
- **Its creator leaving disables it for good.** A use needs the creator to be a member with a Brigade role whose
  membership is older than the token: one who left (or was removed) and was invited back later does not bring their
  old tokens back. The dashboard shows such a token as disabled; revoking it tidies the list. Disabling rather
  than deleting keeps the timeline readable, and needs no write when D1 is edited outside Brigade.

## The token

- **Format:** `brg_` and 43 characters of base64url: 32 random bytes from `crypto.getRandomValues`. Shown once, in
  the answer to the request that minted it, with a Copy button in the dashboard; never again.
- **At rest:** only its digest, in D1 (`api_token.hash`, unique): HMAC-SHA-256 under the optional `API_TOKEN_KEY`
  secret (32 random bytes, base64url) when it is set, else SHA-256 of the token. 256 random bits need no salt or
  slow hash; the key adds a server-side pepper, so a copy of D1 alone cannot be checked against a guess.
- **Setting the key later** ends no token: with `API_TOKEN_KEY` set, a digest D1 does not have is looked up again by
  the plain SHA-256, and a row found so is moved to the HMAC digest in one conditional update (so two isolates never
  both move it). A token minted before the key was set therefore works on, and its row is peppered from its next use;
  one never used since keeps its plain digest until then. A wrong token costs two lookups instead of one. Changing or
  removing the key does end every token hashed under the old one (refused like a wrong token): there is no second
  key to try.
- **Lookup:** the digest is the index (a lookup by a hash of 256 random bits leaks nothing by its timing), and the
  row's digest is then compared with the computed one in constant time (`crypto.subtle.timingSafeEqual`) anyway.
- **Secret scanning:** the prefix makes a leaked token findable. A GitHub custom pattern for it:

  ```text
  brg_[A-Za-z0-9_-]{43}
  ```

  with "Before secret" `(?:\A|[^A-Za-z0-9_-])` and "After secret" `(?:\z|[^A-Za-z0-9_-])`. Applying to GitHub's
  partner program, so leaks in public repositories are reported to Brigade and revoked, is the owner's call later.

## Using one

- **Header:** `Authorization: Bearer brg_…`. A request that carries one is authenticated by it alone: its cookie, if
  any, is ignored. It skips the `Origin` check cookie routes make, since that check protects a cookie a browser sends
  by itself; a page on another site cannot set `Authorization` on a request to Brigade without CORS, which Brigade
  does not answer. Cookie requests keep their `Origin` check.
- **Every refusal of the token itself is the same `401 unauthenticated`** (with `WWW-Authenticate: Bearer`): a wrong
  token, a revoked one, an expired one, one whose creator left, and one for another workspace than the path's. A
  valid token without the scope is `403 forbidden`.
- **Routes** (RFC 0002's public list): changing and removing members (`members:manage`; a token never changes or
  removes its own creator, see "Members" below), listing, sending, revoking and resending invitations (`members:manage`; sending also
  needs the creator's address verified, and the invitation is from the creator), acknowledging an incident
  (`incident:ack`) and the sync WebSocket (each query and mutation checked against the scopes). Not: `POST
  /workspaces` (a token belongs to a workspace that exists) and the invitee's routes (they are about one person's
  own address). The dashboard's internal routes (webhooks, the status page, exports, drafts) stay cookie-only.
- **As an actor** (RFC 0004): `{ kind: "token", id: "tok_…", role, by: "usr_…", scopes }`, where `role` is the
  creator's current role and `by` the creator. The shard records `tok_…` as the actor of what it does (timeline
  entries, events' `actor`), and the dashboard names it "API token <name> (by Ana)" from the synced list. Outbound
  webhook payloads carry it as `actor: { kind: "token", id: "tok_…" }`, and `incident.acknowledged`'s `by` is then
  the token's id too (RFC 0005 "Payloads"; the SDK's `WebhookActor`).
- **Open sync sockets:** a token's socket is checked against the shard's copy of the token on every frame, not only
  at the upgrade (in memory, no D1): one that expired, was revoked, or whose creator the shard demoted since is closed
  (1008 `token ended`, or 1012 to reconnect with the new role) instead of answering. The upgrade brings the shard's
  alarm to the token's expiry, and the alarm closes the token's sockets then, so an idle one stops receiving patches
  too.
- **Members:** `members:manage` lets a token do less than its creator. It never grants `owner` or `admin` (an
  invitation to either, or a role change to either), never changes, removes, or revokes or resends an invitation for,
  someone who is an `owner` or `admin` (or invited as one), and never targets its creator: making or unmaking the
  people who run the workspace is a person's call (`TOKEN_OUT_OF_REACH`, `checkMemberChange` and `checkInvite` in
  `packages/schema`, checked by the shard against D1 before it writes, and again by `member.changeRole` and
  `member.remove`). The dashboard says so next to the scope. In the shard, `member.remove` asks a token for
  `members:manage` (`tokenPermission`) rather than the `workspace:read` a member's own leave needs, so a token holding
  only `members:manage` removes as well as it changes roles. A removal D1 has whose shard step still fails is caught
  up by the repair alarm (`member.reconcile`, RFC 0006 "Who is paged"), so the removed member stops being paged.
- **Rate limit:** 300 requests a minute per token (Workers Rate Limiting, `API_TOKEN_LIMIT`, namespace ids 4141,
  4142 for `staging` and 4143 for `dev`, after 41X1 to 41X3 for the receipt and alert limits), counted once the
  token itself is valid (its digest found, its workspace and expiry checked) and before its creator is read, so wrong
  tokens never spend a real one's budget and one over its limit costs no more D1 reads. Over it: `429 rate_limited`, `Retry-After: 60`.
  Approximate and per location, and failing open, like the alert limits.
- **Last used:** written to D1 at most once every 5 minutes per token (a conditional update, so isolates never
  write it twice in the window), then copied to the shard's list by a silent server-only mutation
  (`apiToken.touch`), so the dashboard shows it live.

## Revoking

- `DELETE /workspaces/:id/api-tokens/:tokenId` (owners and admins, cookie only) marks the D1 row revoked, then runs
  `apiToken.revoke` in the shard (event `apiToken.revoked`) and closes the token's sync sockets.
- The Worker caches a found token's own row per isolate for 10 seconds (found and not revoked then; its creator's
  membership and role are still read on every use), and revoking drops it from the revoking isolate's cache at once. Every bearer request that reaches the shard (all but listing invitations) is
  checked again there against its own copy, which `apiToken.revoke` changes before the request answers, so a revoke
  is immediate on those routes everywhere. Listing invitations reads D1 only: another isolate may serve it for up
  to 10 seconds more. A member change through Brigade closes the sync sockets of the member's tokens like their own.

## Events

`apiToken.created` (`id`, `name`, `scopes`, `expiresAt`, `createdBy`) and `apiToken.revoked` (`id`, `name`), both
through the shard's outbox (RFC 0005). Neither carries the token or its digest; nor does any log line, synced row or
mutation result. The shard never sees either: minting writes D1 first, then runs `apiToken.create` (a server-only
mutation) with the id, name, scopes and expiry; if the shard refuses or fails, the D1 row is deleted again and the
token never works. They are not outbound webhook types yet.

## Not in this slice

- Tokens for the dashboard's internal routes (outbound webhooks, the status page settings, exports, AI drafts):
  they become public routes with their own scopes when someone needs them.
- Rotating a token in place (mint a new one and revoke the old instead), per-token IP allow lists, and an audit
  view of each token's requests beyond its timeline entries and events.
- Per-user personal tokens across workspaces.
