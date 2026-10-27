# RFC 0003 — Domain model

- Status: Draft

Names below are the canonical vocabulary for code, API and UI (translated in the UI only).

## Entities

```
Workspace ─┬─ Member (User + role: owner | admin | responder | viewer)
           ├─ Team ── members
           ├─ Service (catalog) ── owners (schedules, members), tier, escalation policy
           ├─ Monitor ── target, regions, interval, quorum → raises Alerts
           ├─ AlertSource (webhook endpoint + mapper)
           ├─ AlertRoute (match rules → create/attach Incident, page EscalationPolicy)
           ├─ Schedule ── Rotation(s) ── Layer(s), Override(s)
           ├─ EscalationPolicy ── Level(s): targets (users | schedules | teams), timeout
           ├─ IncidentType (roles to fill), Severity config, CustomField definitions, Role definitions
           ├─ StatusPage ── components (mapped to Services)
           └─ Incident ─┬─ status, severity, type, summary, custom field values
                        ├─ RoleAssignment (role → user)
                        ├─ TimelineEntry (event-sourced, append-only)
                        ├─ Update (human-written status update, may publish to status page)
                        ├─ Alert(s) attached
                        ├─ Page(s) — an escalation run (level, acks)
                        ├─ FollowUp (action item: owner, due date, optional issue link; RFC 0013)
                        └─ Postmortem (sectioned document, optional Workers AI draft; RFC 0013)
```

## Incident lifecycle

`triage → investigating ⇄ fixing ⇄ monitoring → resolved` (resolved can reopen); `triage → declined`.
Implemented in `packages/schema` (`canTransition`). Severity is independent of status and can change any time
(every change is a timeline entry).

## Timeline, updates and roles

First slice, in `WorkspaceDO` until `IncidentDO` exists (the tables move with the incident then):

- **Timeline** (`timeline` table, query `incident.timeline`): its own synced, append-only table, not a view of the
  outbox. Every mutation that changes an incident appends one entry in its own transaction, next to its event
  (RFC 0005): `declared`, `status_changed`, `severity_changed`, `acknowledged`, `role_assigned` (stored with the
  previous and new holder; the dashboard words it as assigned, unassigned, taken or stepped down), `update`, and
  `alert_resolved` when the alert of the monitor that opened it resolves (recovered, or the monitor paused or
  deleted), by `sys_monitors` or the member who did it; `alert_grouped` when a `group` route puts an alert onto the
  incident (a monitor's, "<monitor> went down and was grouped here", or an alert source's, by its title; RFC 0007
  "Monitor alerts through the routes"), since grouping pages nobody by itself; `alerts_resolved` when every alert-source alert on an incident
  people worked on resolved, which leaves it open for them (RFC 0005 "Alert sources"). The outbox is server-only and drained, while clients need
  entries live and optimistic, so deriving the timeline from events would need a projection anyway. Entries are
  numbered per incident (`<incident id>:<seq>`, from the incident's `timelineSeq`), so a client's optimistic entry
  and the server's share an id; nothing edits or deletes one. "Edit timeline" for responders means adding to it.
  A client numbers from the highest of `timelineSeq` and the entries it holds, since its subscriptions resume one
  by one; when another change landed first, its entry is re-applied under the next number. The query reads one
  incident's entries as an id range (`<id>:` up to `<id>;`) off the store's `(tbl, id)` key, not a scan of every
  incident's. `incident.byNumber` still scans the workspace's incidents (bounded while they live in
  `WorkspaceDO`); it gets a number index when `IncidentDO` takes them over.
- **Updates** (`incident.postUpdate`, `incident:update`, event `incident.update_posted`): a timeline entry of
  kind `update` with a multi-line body of 1 to 4000 characters (the text rules of RFC 0004), allowed in every
  status so a resolved incident can get closing notes. Every update is internal: publishing to the status page is its own action
  (`incident.publishUpdate`, `status:publish`, event `incident.update_published`, a `status_published` timeline
  entry) with text written for the public, never a copy of an update (RFC 0012 "Publishing"). What was published
  can be corrected or taken off the page (`incident.editPublishedUpdate`, `.removePublishedUpdate`, `.unpublish`,
  `status:publish`, a `status_corrected` timeline entry; RFC 0012 "Corrections").
- **Roles** (`incident.assignRole`, `incident:update`, event `incident.role_assigned`): the built-ins `commander`,
  `communications` and `operations` plus the workspace's own ("Role definitions" below), at most one member each,
  stored on the incident by role id (`roles`). `userId: null` unassigns. The assignee must be in the shard's member
  list and not a viewer (`invalid_args` on `userId` otherwise).
- **Members in the shard** (`members` table, query `members.all`, `workspace:read` for every role): a copy of
  D1's membership, so a shard can check an assignee without leaving its synchronous mutation and the dashboard can
  show names. The Worker already reads the member in D1 when it authenticates a sync upgrade; it passes their
  name along, and the shard runs the server-only `member.sync` (RFC 0004 "Server-side writes") when its copy is
  missing or stale. So a member appears once they have opened a socket. Member management (below) writes it too,
  and every sync upgrade reconciles it with D1.
- **Member names** (`memberName`): the title rules of RFC 0004, except that ZWNJ and ZWJ may stand between two
  letters (Persian, Arabic and Indic names need them). The rule does not check the script, so a joiner between two
  Latin letters passes and looks like the plain name; accepted on purpose, since names are not identifiers (roles
  and the picker use member ids) and two people can already share a visible name. Bidi controls and every other invisible character are still
  refused, and a name is 1 to 100 characters after trimming. The API applies it before Better Auth stores a name
  (sign-up, `update-user`: `INVALID_NAME`). A name already in D1 that predates the rule is trimmed and cut to the
  cap at a grapheme by the Worker; if that still fails, the shard stores `name: null` and the dashboard shows the
  member as unnamed, so they stay listed and assignable instead of being refused on every socket.

## Members

Changing a member's role, removing a member and leaving (`PATCH`/`DELETE /workspaces/:id/members/:userId`, the
dashboard's Members section). Better Auth's own organization routes for these stay refused (RFC 0002 "Auth"): they
would change D1 without the shard's copy or an event.

- **Rules** (`checkMemberChange`, `packages/schema`, used by the API and the dashboard): owners and admins
  (`members:manage`) change roles and remove members. An admin never touches an owner and never makes anyone an
  owner. Anyone may leave; responders and viewers change no role, their own included. Nobody demotes or removes the
  last owner, themselves included. **An owner may step down (or leave) while another owner remains**: requiring a
  hand-over first would add a step without protecting anything the last-owner rule does not. Setting the role a
  member already has is no change, checked only after the rules (a caller who may not make a change learns nothing
  from it). The dashboard asks before anyone steps their own role down, like leaving: only someone else can give it
  back. Every role sees the list, with names, emails and roles (`workspace:read`); the
  dashboard reads it from Better Auth's `get-full-organization` (D1), which returns at most 100 members, so a larger
  workspace needs a paged list.
- **Order: D1 first, then the shard.** D1 is the authority, so an event never announces a change D1 refused. The
  Worker checks the session and that the caller is a member, then calls the workspace shard
  (`WorkspaceDO.changeMember`), which does the rest under a per-shard member lock (so two changes, or a change and a
  reconcile, never interleave between reading and writing D1): it reads the workspace's members in D1, checks the
  rules, writes D1 (one conditional statement, or a batch that also moves the member's sessions with this workspace
  active to their oldest remaining one; the SQL re-checks that the last owner is kept, in case D1 was edited
  outside Brigade meanwhile), then runs a server-only mutation in its own store: `member.changeRole`
  (`member.role_changed`: `userId`, `from`, `to`) or `member.remove` (`member.removed`: `userId`, `role`, `reason`
  `removed` or `left`), which deletes the member's copy and every device of theirs in the same transaction
  (`device.unregistered`, `reason: member_removed`). It emits even for a member the shard never knew (who never
  opened Brigade). Then it closes the member's sockets (below).
- **Failure.** D1 failing changes nothing (`503 unavailable`). The shard failing after D1 committed answers
  `503 not_applied`, logs `member change not applied to the shard` and **arms the shard's alarm to reconcile** within
  10 s (`member_repair`, tried again every 30 s until it succeeds; it shares the one alarm with the outbox drain and
  monitor upkeep, which takes the earliest any of them needs), so the repair needs no socket. The shard also records
  the member whose change it missed, so a workspace too large for one `member.reconcile` still catches up on them
  one by one. Sending the request again finishes it sooner: a caller who may make the change has the shard catch up
  on that one member (`member.remove` with `reconciled`, or `member.changeRole`, as `sys_members`, so the events
  never name the caller), and a leaver D1 already dropped may repeat their own `DELETE`
  (the Worker lets it through for one's own id in an existing workspace; the shard checks its own copy and devices
  first, without the member lock or a D1 read, and runs `member.remove` with `left` only while it still has one;
  its `role` is null when only devices were left). Any other answer to someone D1 does not have is the same
  `403 not_a_member` with the same body, whether or not the workspace exists (Q16). The leave retry takes longer for
  a workspace that exists (it asks the shard), so the route hides which workspaces exist only because their ids are
  ULIDs nobody can guess: it takes `ws_<ULID>` ids alone (`ORGANIZATION_ID`), never a dev shard's short name. A
  `DELETE` by a member for someone with nothing left in D1 or the shard is `404`. The dashboard shows `not_applied`
  as a note, not an error: the change is saved and paging catches up within a minute, with nothing to retry; on
  one's own leave it is done, and the dashboard moves on. A `not_a_member` answer to one's own leave moves on only
  once D1 confirms they are gone (a member whose role is not a Brigade role gets it too, and stays). A narrow race is accepted: a leaver re-added in D1 between the shard's D1 read and its
  `member.remove` loses the devices they had (their new membership stays; they register the phone again).
  Besides, **every sync upgrade into the workspace reconciles** the shard with D1 (`member.reconcile`, run by
  `sys_members` after the socket is accepted, never holding it up): a copy D1 no longer has is deleted with its devices
  (`member.removed`, `reconciled`), a copy whose role differs takes D1's (`member.role_changed`), and a device whose
  member D1 no longer has is dropped. Members D1 has and the shard does not are left to `member.sync`. An empty
  read changes nothing (a workspace always has an owner). If that reconcile fails (D1 or the shard down), the
  upgrade arms the repair alarm. A removal whose shard step failed for a member the shard never knew emits no
  event: nothing in the shard is wrong (accepted).
- **Stale upgrades.** A removal leaves a tombstone in the shard for 60 s (`member_repair`, `gone:<userId>`): a sync
  upgrade the Worker authenticated just before the removal and that reaches the shard after it is refused
  (`403 not_a_member`) rather than letting `member.sync` restore the removed member's copy. Before refusing, the
  shard reads the member's row in D1 (under its member lock): if D1 has them again (re-added), the tombstone goes and
  the upgrade goes on, so a re-added member's own first upgrade is not refused; if that read fails, the refusal
  stands. A reconcile that finds them in D1 again drops it too. One arriving later still restores the copy until its own reconcile removes
  it again, a second `member.removed` (`reconciled`) for the same member (accepted).
- **A member's own settings.** What a member decides for themselves in a workspace lives in the shard's
  `member_settings` (one row per member who chose something, synced to every member; never in `members`, which
  `member.sync` rewrites from D1). Today that is which pages ring their iPhones as a call (`member.setCalls`, RFC 0010
  "Who a call rings"), which emails they get (`member.setEmail`, RFC 0005 "Email") and the time zone their follow-up
  reminders follow (`member.setTimeZone`, RFC 0013 "Reminders"); `member.remove` and `member.reconcile` delete the row
  with the member. The row is synced to every member, so **every member can see every other member's choices,
  including their time zone** (an IANA name such as `America/Sao_Paulo`, which says roughly where they are).
- **Open sockets.** After a change the shard closes the target's sockets: `1008` when removed (the client reconnects
  and the upgrade answers `403 not_a_member`), `1012` on a role change (it reconnects with the new role). The
  reconcile after every upgrade also closes any socket whose actor D1 no longer backs (gone, or another role),
  which covers an upgrade the Worker authenticated just before a change landed. What is left is RFC 0004
  "Session revocation".

## Invitations

Owners and admins invite people by email (`/workspaces/:id/invitations`, the dashboard's Members card); the invitee
accepts or declines on the dashboard's `/invitations/:id`, where the email links. Better Auth's own invitation routes
stay refused (RFC 0002 "Auth"). The code is `apps/api/src/invitations.ts`; the rules are in `packages/schema`
(`checkInvite`, `inviteRoles`, `invitationEmail`).

- **Rules.** Owners and admins (`members:manage`) invite, resend and revoke; an admin never invites anyone as an
  owner nor touches an invitation to be one, as an admin never makes anyone an owner. Responders and viewers see no
  invitations (the list is for those who manage them). Inviting needs the inviter's own address verified: an
  invitation is an email from Brigade's domain to an address the inviter typed. An address that is already a member,
  or already has a pending invitation in the workspace, is refused (`already_member`, `already_invited`); D1 holds the
  second itself, with a unique index on pending invitations per workspace and address (migration 0004). Addresses
  are stored trimmed and lower-cased.
- **Accepting.** Signed in with the invited address (compared case-insensitively), and that address verified, read
  again from D1 (`wrong_email`, `unverified`). Someone signed in with another address learns only that the
  invitation is not for them: never the invited address, who invited or the role. Accepting adds the member with
  the invitation's role. Also refused: an invitation no longer pending (`not_found`), one that ran out (`expired`,
  410), a workspace at 100 members (`MAX_WORKSPACE_MEMBERS`, the most the dashboard lists), an invitee already in
  `WORKSPACE_LIMIT` workspaces. Both limits are checked again in the SQL that accepts, since another workspace's
  shard (under its own lock) may add the invitee meanwhile; losing that race answers `conflict`. Declining has the same checks, so an unproven account with someone else's address cannot decline for
  them. An account may be created from the invitation without a workspace of its own (sign-up skips the workspace
  name when it comes from an invitation).
- **Expiry and resending.** An invitation lasts 7 days (`INVITATION_TTL_MS`). Resend sends it again and restarts the
  7 days, including for one that ran out (it is still pending in D1). Inviting an address whose invitation ran out
  marks the old row `expired` and creates a new one.
- **Limits** (RFC 0005 "Abuse", Q21): at most 50 pending invitations per workspace (`MAX_PENDING_INVITATIONS`), 30
  invitation emails (invitations and resends) per workspace per day (`INVITATIONS_DAILY_CAP`, `rate_limited`), and
  one send of an invitation per 5 minutes (`INVITATION_RESEND_INTERVAL_MS`, `too_soon`), counted in the shard's own
  ledger (`invitation_sends`) under the member lock. Across workspaces, from D1's `invitation_send` (migration
  0005): 3 invitation emails per invited address per day (`INVITATIONS_PER_ADDRESS_DAILY_CAP`, `address_limited`;
  counted on `invitationAddressKey`, the address with any `+tag` dropped from the local part, so `jane+1@` and
  `jane+2@` share one count, while the invitation keeps the address as typed),
  50 per inviter per day (`INVITATIONS_PER_INVITER_DAILY_CAP`, `inviter_limited`) and 5 per invitation ever
  (`INVITATION_MAX_SENDS`, `send_limit`). The row is inserted only while all three have room, in the same D1 batch as
  the invitation (or its new expiry), so shards inviting at once cannot pass them together. Rows past the daily
  windows are pruned unless their invitation is still pending.
- **Order: D1 first, then the shard,** as for member changes. The Worker checks the origin, the session and that the
  caller is a member (and, to invite or resend, that their address is verified), then calls the workspace shard
  (`WorkspaceDO.invite`, `resendInvitation`, `revokeInvitation`, `acceptInvitation`, `declineInvitation`), which
  reads D1, checks the rules and writes D1 under the same member lock as member changes and reconciles. Every
  write re-checks in SQL (still pending, not run out); accepting is one batch that marks the invitation accepted and
  inserts the member only when that update changed the row. Then a server-only mutation runs in the shard:
  `invitation.create` (`member.invited`: `invitationId`, `role`, `invitedBy`, `expiresAt`, `send`, 1 then one more
  per resend; never the address), `invitation.revoke` (`invitation.revoked`: `invitationId`, `revokedBy`),
  `invitation.decline` (`invitation.declined`: `invitationId`, `userId`) or `member.add` (`member.added`: `userId`,
  `role`, `invitationId`), which also writes the shard's copy of the new member, so they can be put on call before
  they first open Brigade. The last two run as `sys_members`, since the invitee is not a member yet. Invitation rows
  get Brigade's prefixed ids (`inv_`, and `mem_` for the member), written by the shard with `authId`.
- **Failure.** D1 failing changes nothing (`503 unavailable`). The shard failing after D1 committed answers `503
  not_applied` and records the mutation it owes (`invitation_repair`), then arms the member repair alarm, which runs
  every owed mutation again as `sys_members` until it is in (the same alarm and retry as member changes, run even
  when the members reconcile fails), under the member lock. An owed `member.add` runs only while D1 still has the
  member: one removed before the alarm ran is not added back, and no `member.added` follows their removal. An
  acceptance that answered `not_applied` did join: the dashboard opens the workspace.
- **The email.** `member.invited` goes through the outbox like every event; the email notifier sends the invitation
  from it (RFC 0005 "Email"), once per `send`, skipping one no longer pending.

## Schedules

First slice of on-call (Phase 2), in `packages/schema` (`schedules.ts`, `zoned.ts`), stored in `WorkspaceDO`. It
says who is on call; escalation policies (below) page from it.

- **Schedule** (`schedules` table, query `schedules.all`): a name, an IANA time zone (stored as the runtime spells
  it, so `america/sao_paulo` is saved as `America/Sao_Paulo`; Workers' and Chrome's V8 keep ICU's older names, such
  as `Asia/Calcutta` for `Asia/Kolkata`, and every runtime accepts both; the dashboard shows and finds a zone by
  IANA's current name, from a small map of the older names V8 lists, so "kolkata" finds `Asia/Calcutta` and it reads
  as Asia/Kolkata), and one to five **layers**
  (rotations), kept in the schedule's own row so an edit to several layers is one mutation and never half applied.
  A layer has an optional name (unnamed, it reads as "Primary", "Layer 2" in each reader's language), its members in rotation order (1 to 50, each once), a start date and a handoff time on the
  schedule's wall clock (`YYYY-MM-DD`, `HH:MM`), and a shift length: `count` hours (up to 168), days (up to 31) or
  weeks (up to 13). A weekly rotation hands off on the start date's weekday. Shift `k` (0 is the first) starts at the
  start date and time plus `k` shift lengths and goes to member `k mod n`.
- **Override** (`overrides` table, query `overrides.all`): a member covers a schedule over `[start, end)`, two
  instants on whole minutes, at most 90 days apart, ending in the future. Overrides are instants, not wall-clock
  times, so changing the schedule's time zone does not move them.
- **Who is on call at instant T** (`onCallAt`): an override of the schedule covering T wins over everything; of
  overlapping overrides, the one the shard added last (`createdAt`, then the highest id: clients mint ids, so ids
  only break a tie). Otherwise the last layer that has someone at T: layers are
  stacked, a later layer wins where it has someone and an earlier one shows through where it does not (before its
  start, or emptied). Nobody is a gap (`null`), shown as "Nobody on call". `nextHandoffs` lists the stretches from
  now (each layer handoff and override edge where the person changes; a handoff to the same person is none), for
  the dashboard's upcoming shifts. It walks handoffs in order and stops at the last one it shows, and a one-member
  layer has one handoff (its start), so a page of hourly rotations costs what it shows; a layer is not walked past
  the start of a later layer with people (it never shows again), and a layer hidden otherwise (behind a long
  override) is walked for at most 2000 handoffs, the list then ending where it stopped.
- **Wall-clock handoffs and DST.** Handoffs happen at the local time the layer says, in every unit, so a daily
  09:00 handoff stays at 09:00 and the shift over a DST change lasts 23 or 25 hours (a weekly one 167 or 169).
  Times are converted with `Intl.DateTimeFormat` alone (no Temporal: Workers, browsers and Hermes differ), like
  Temporal's `compatible` disambiguation: a local time that happens twice is the earlier instant; one that never
  happens (clocks set forward) moves forward by the gap, so a midnight handoff in Sao Paulo's old DST (midnight
  skipped) happens at 01:00. An hourly shift whose start and end both fall in the skipped hour is empty and its
  member is skipped that once. Tests cover New York, London and Sao Paulo's historical transitions, Lord Howe's
  30-minute DST, Kathmandu's +05:45, and Pacific/Apia's skipped 2011-12-30 (every time that day lands a day later).
- **Who manages them** (`schedule:read`, `schedule:manage`, `schedule:override`): owners and admins create, edit and
  delete schedules and add or remove anyone's override; **responders add and remove overrides for themselves only**
  (covering a shift, "manage own on-call overrides" in the role table below), never someone else's and never the
  rotations; viewers read. Members of a layer and of an override must be in the shard's member list and not
  viewers (viewers only read, so they never hold a shift).
- **Members leaving.** `member.remove` (removed, left or reconciled) and a change to `viewer` (`member.changeRole`,
  `member.reconcile`, or `member.sync` copying a viewer role D1 got outside Brigade) take the member out of every layer and delete their overrides in the same transaction
  (`schedule.updated` with `reason: member_removed`, `schedule.override_removed` with `member_removed`). The rest
  of each layer keeps its order and the rotation counts again from its start, so later shifts move up (as PagerDuty
  does); the alternative, leaving their shifts as holes, keeps everyone else's dates but leaves time nobody covers,
  which is worse once schedules page. A layer left with nobody is a visible gap until someone edits it; the editor
  asks for at least one member. Promoting a viewer back does not restore their place.
- **On the phone.** The app's on-call screen and the incident list's line work out the member's shifts from the same
  rows (`nextHandoffs`). The iOS "I'm on call" widget cannot reach the shard: the app writes it a snapshot of the
  member's stretches on call (merged across schedules, 4 weeks ahead) into the App Group whenever the rows change,
  and the widget flips at each handoff by the clock alone. A snapshot over 24 hours old asks to open the app, since
  an override added since would not be in it (`apps/mobile/src/lib/widget.ts`).
- **Limits.** 50 schedules per workspace, 100 overrides not yet ended per schedule; an override that ended over 30
  days ago is deleted when the next one is added to its schedule (`schedule.override_removed`, `expired`), so the
  table stays small. Deleting a schedule deletes its overrides.

## Alert → incident flow

1. Alert arrives (monitor or webhook) → normalized to `AlertEvent { source, fingerprint, status: firing|resolved, labels, payload }`.
   First slice (RFC 0007): monitor alerts live in `WorkspaceDO` (`alerts`, deduplicated per monitor) and go through
   the same routes when a route names them (RFC 0007 "Monitor alerts through the routes"), else open an incident
   directly. Alert sources (RFC 0005 "Alert sources") normalize webhooks to `NormalizedAlert` (dedup key,
   title, severity, firing or resolved, link, labels) and keep them in `WorkspaceDO` too (`source_alerts`).
2. `AlertGroupDO(fingerprint)` deduplicates within a window. Not built: the shard deduplicates by source and key while
   the alert fires (RFC 0007 "`AlertGroupDO` (later)").
3. `AlertRoute` rules (evaluated in order) decide: drop, suppress, group into an open incident, or open a new incident
   with a severity, a type, services and an escalation policy. Built for alert sources and monitors (`alert_routes`,
   `alertRoute.*`).
4. Creating a page starts an escalation run on the `IncidentDO` (alarm per level timeout).

## Escalation policies

Second slice of on-call (Phase 2), in `packages/schema` (`policies.ts`, `escalation.ts`), stored in `WorkspaceDO`.
How a page uses them is RFC 0006 "Who is paged".

- **Policy** (`escalation_policies` table, query `escalationPolicies.all`): a name, one to ten **levels** in order,
  and `repeat` (0 to 9): how many more times the whole list runs when nobody acknowledges. A level has one to ten
  **targets**, each a schedule (whoever `onCallAt` says is on call when the level fires) or a member, and a timeout
  of 1 to 1440 minutes before the next level fires. Levels and targets are kept in the policy's own row, so an edit
  is one mutation and never half applied. At most 50 policies per workspace.
- **The default policy** (`isDefault`, at most one): every page uses it unless the monitor that opened the incident
  names its own (below). Making a policy the default takes the flag from the previous one (its own
  `escalation_policy.updated`, `reason: default_changed`). With no default, RFC 0006's interim rule pages, unchanged,
  so a workspace that never creates a policy pages as before.
- **A policy per monitor** (`policyId` on the monitor, RFC 0007): a monitor may name a policy, set by `monitor.create*`
  and `monitor.update*` (null: the default; left out, a new monitor takes the default and an edit keeps the monitor's,
  so a client that does not know the field never clears it), checked against the shard's policies (`invalid_args` on
  `policyId` otherwise), with the monitors' own RBAC (`monitor:manage`, owners and admins) and in `monitor.created` and
  `monitor.updated`. Changing it never starts the checks over. An incident a monitor opened starts its run on that
  policy (`incidentPolicy`: the monitor still firing on the incident, else the one whose alert opened it); a monitor
  that names none, or one since deleted, goes to the default, then to the interim rule. The run records which and why
  (`monitor`: the monitor's id and name, null for the default), and the incident page says it. A member's own
  declaration always uses the default. An alert route picks a policy the same way, and comes first (RFC 0006 "Who is
  paged"); deleting a policy a route names puts the route back on the default (`alert_route.updated`,
  `reason: policy_deleted`).
- **Deleting a policy a monitor names** is not refused: the monitor goes back to the default in the same transaction
  (`monitor.updated`, `reason: policy_deleted`), so a monitor never names a policy that is gone and a delete never
  needs the monitors edited first. Falling back is the safe side: the default pages (or the interim rule), never
  nobody. Runs under way keep their snapshot.
- **Who manages them** (`escalation:read`, `escalation:manage`): owners and admins create, edit, delete and pick the
  default; everyone reads. A member target must be in the shard's member list and not a viewer; a schedule target
  must exist (`invalid_args` otherwise).
- **References that go away** are taken out in the same transaction, never left dangling: deleting a schedule takes
  it out of every level (`escalation_policy.updated`, `reason: schedule_deleted`), and a member removed or made a
  viewer is taken out with their rotations (`member_removed`, wherever `dropFromSchedules` runs). A level left with
  no targets stays, shown as "Nobody to page at this level" until someone edits it; when it fires it is skipped like
  an unreachable level (RFC 0006).

## Escalation run

- **State** lives on the incident (`escalation` on its row, synced with it, so every client can show "Level 2 paged
  at 14:05 · next level at 14:20"): the policy's id, name, levels and repeat as they were when the run started, and
  the monitor whose policy it is, if any (a snapshot, so an edit or a delete mid-run changes nothing for a run under
  way; the next run reads the policy again), the level and round paged last, `status` (`running`, `acknowledged`, `resolved`, `exhausted`), when it
  started, when the next level fires (`nextAt`), how many pages it made (`paged`) and the last 20 of them (`pages`:
  level, round, when, whom, why, and the first 20 targets that could not be paged with their count; the timeline and
  the events keep everything, the row stays small). A server-only `escalation_timers` row per running run (incident id, `nextAt`) is what the shard's alarm
  reads, so it never scans every incident.
- **Start.** The first page of an incident starts a run (`escalation.start`, server only, as `sys_escalation`):
  level 1 is resolved and paged at once, on the same event that asked for the page (no extra trip through the
  Queue). **Next level.** At `nextAt` the shard's alarm runs `escalation.advance`: the next level, or level 1 of the
  next round, or, past the last round, `exhausted`: nobody acknowledged, so everyone who can respond is paged once
  (the interim rule, RFC 0006) and the run ends (a timeline entry, `escalation.exhausted`). A level `escalation.advance`
  keeps refusing is recorded at once and, 3 minutes after its first refusal, ends the run the same way
  (`escalation.fallback`). **Early.** A level every push of which failed for good (no device took any) fires the
  next level of its round that reaches someone at once (`escalation.unreached`, from the pager when that page
  settles), rather than waiting out its timeout. Never past the round: the round's last level waits for its timeout,
  which starts the next round or ends the run as above, so a relay that refuses everything cannot spend every round in
  moments (RFC 0006 "Who is paged").
- **Stop.** `incident.ack` (any responder, through any route: the mutation does it, not an endpoint) sets the run
  `acknowledged`, and a status change out of the active ones (resolved, declined) sets it `resolved`; both delete
  the timer in the same transaction, so no level fires after them. Both also close a run that already ended
  (`exhausted`), keeping when it ended, so none of its pages is sent after a reopen. A reopened incident starts no
  run by itself; its next page does (as a page to an acknowledged incident is not sent).
- Every level fired is an `escalation.paged` event and an `escalated` timeline entry; levels that could not be
  paged are `page_failed` entries ("Couldn't page Primary: nobody on call"). What each page did on each phone, and
  why someone was or was not paged, is RFC 0006 "Delivery receipts".

## Service catalog

First slice of Phase 3, in `packages/schema` (`catalog.ts`), stored in `WorkspaceDO` like the on-call tables.

- **Service** (`services` table, query `services.all`, most critical first): a name (1 to 80), an optional
  description (up to 500, multi-line), a **tier** (`tier1` critical, `tier2` important, `tier3` supporting), its
  **owners** (0 to 10 schedules or members who can respond, the same targets as an escalation level; no teams yet)
  and an optional escalation policy, which pages the incidents that name the service: after the alert route's and
  the type's, before the monitor's and the default (RFC 0006 "Who is paged"; the first of the incident's services
  that names one, when the run starts). At most 100 services per workspace (every client holds them).
- **Incidents name the services they affect** (`serviceIds` on the incident row, at most 10, `incident.setServices`
  replacing the list, event `incident.services_changed`, timeline `services_changed` by the names they had then).
  `incident.declare` takes them too.
- **Who manages it** (`catalog:read`, `catalog:manage`): owners and admins create, edit and delete services, incident
  types and custom fields; everyone reads. Naming an incident's type and services and setting its fields is
  `incident:update`, so responders do it and viewers do not.
- **References that go away** are handled like the escalation policies' (no dangling owner or policy): deleting a
  policy unsets it on every service and type (`service.updated`/`incident_type.updated`, `policy_deleted`), deleting a
  schedule or removing a member (or making them a viewer) takes them out of every service's owners
  (`schedule_deleted`, `member_removed`; a service left with none reads as unowned). Deleting a service or a type does
  **not** rewrite the incidents that name it, which would sync every incident for a catalog edit: readers skip a
  deleted service and show a deleted type as such, and the next change to that incident drops it. So a deleted
  service's, type's or field's id is never taken again: the shard keeps it (`catalog_deleted`, server-only, one small
  row per delete) and refuses to create an entry with it (`conflict`). Otherwise a new field of another kind would
  inherit old values, or a new type the incidents of a deleted one and its policy.
- Incidents list their services in the order picked, so reordering them is a change too (timeline
  `services_changed` with nobody added or removed).
- **Status page components name the services they stand for** (`serviceIds` on the component, RFC 0012 "Services"),
  so declaring an incident with services ticks those components when someone publishes to the page; publishing stays
  a person's action. A deleted service stays on a component, skipped, as on incidents.
- **Over HTTP** (RFC 0002 "Public HTTP API"): services, incident types and custom fields are listed, read, made and
  changed (services also removed) through the same mutations, as the member or an API token with `catalog:read` or
  `catalog:manage`; incidents are listed with filters by status, severity, type and service, and their type,
  services and fields set, with `incident:read` and `incident:update`.
- Not yet: a monitor naming the service it watches, dependencies and links.

## Role definitions

Owners and admins (`catalog:manage`) define who does what on an incident; it is part of the catalog, so it is stored
in `WorkspaceDO` and synced like types and fields (`incident_roles` table, query `incidentRoles.all`, `catalog:read`).

- **Built-ins keep their names as ids.** `commander`, `communications` and `operations` exist in every workspace
  without a row. `incidentRole.update` renames one, describes it or gives it a checklist (writing its row); an empty
  name puts it back under its own, translated name. Paging reads `roles.commander` (RFC 0006 "Who is paged"), so a
  renamed commander is still paged first, exactly as before. **The commander can never be removed**
  (`incidentRole.delete` answers `invalid_args`); the other two can be taken out (`removed` on their row: not offered
  on incidents, kept on the incidents that hold them) and brought back as they were (`incidentRole.restore`).
- **A workspace's own roles** (`incidentRole.create`, `rol_<ULID>` made by the client): a name (1 to 60), a
  description (up to 500, multi-line) and a **checklist** of responsibilities (up to 20, each 1 to 200 characters on
  one line, distinct without case). At most 15 roles per workspace, the three built-ins counted, removed or not.
  Deleting one retires its id (`catalog_deleted`) and takes it out of every type; incidents keep who held it, like a
  deleted type: readers skip it, and the holder can still be taken off.
- **Incident types list roles to fill** (`roles`, in order, and `requiredRoles`, a part of them; both optional
  arguments, so a client from before them leaves a type's roles as they were). The incident page lists the
  commander, then the type's roles, then any other role someone holds; an incident without a type, or of one that
  lists none, lists every role offered. A required role nobody holds is flagged (`missingRoles`); like required fields,
  nothing waits on it. Each role's description and checklist fold out under it.
- **Assigning** stays `incident.assignRole`, with `role` now a role id: a built-in's name, as clients from before
  role definitions send, or a `rol_` id. Giving a role needs one the workspace offers (not deleted, not removed);
  taking it away works for any role someone holds. Timeline entries keep `role` (the id) and add `roleName`, the
  workspace's name for it then (absent for a built-in under its own name), so an entry still reads once the role is
  renamed or deleted; older entries read as before. The event keeps `role` (the built-in's name, or `custom`) and adds
  `roleId` and `roleName` (RFC 0005); webhook payloads do the same.
- The mobile app shows the built-ins under the workspace's names and assigns them as before; the workspace's own
  roles show read-only while someone holds them.

## Incident types

- **Type** (`incident_types` table, query `incidentTypes.all`; at most 20 per workspace): a name, an optional
  description, an optional **default severity**, an optional **escalation policy** and the custom fields it
  **requires**. Declaring with a type (`incident.declare`'s `typeId`) takes its default severity when the declare
  names none (else SEV3); the dashboard's form also preselects it. A type or service deleted while a declare waited
  (offline, queued) is left out rather than refused: declaring never fails on the catalog.
- **Its policy pages** (`incidentPolicy`, RFC 0006 "Who is paged"): an incident of a type with a policy pages through
  it while both exist; else the policy of the monitor that opened it, else the default policy, else the interim rule.
  The type comes first: it is the choice someone made about this incident, the monitor's is about what it watches.
  The run keeps the policy it started with.
- **Changing it later** is `incident.setType` (`incident:update`, event `incident.type_changed`, timeline
  `type_changed` with the types' names then; `fromDeleted` when the type it had was deleted, so it reads as a change
  from a deleted type). It changes nothing else: severity defaults apply only when declaring, and a run under way
  keeps its levels.
- **Its postmortem template** (`postmortem_templates`, keyed by the type's id; `postmortemTemplate.set` and `.reset`,
  `catalog:manage`): the sections a new postmortem of an incident of the type starts with (RFC 0013 "Templates"),
  else the workspace's `default` one, else the seven built-in sections. Deleting the type deletes its template.
  A postmortem keeps the sections it was made with, so `incident.setType` never changes one already made.

## Custom fields

- **Field** (`custom_fields` table, query `customFields.all` in creation order; at most 25 per workspace): a name, an
  optional description and a **kind** fixed at creation: `text` (1 to 500 characters, multi-line), `single_select`,
  `multi_select` (up to 20 choices), `number` (any finite number up to 1e15 either way) or `link` (`http(s)://`, up to
  1000). Selects have 1 to 50 options with ids (`opt_…`) and distinct labels, so renaming an option keeps every value.
- **Values** live on the incident row (`fields`, by field id), set one at a time by `incident.setField` (value `null`
  clears), checked against the field's kind in the mutation (`checkFieldValue`, the same check the dashboard runs
  before sending: text rules and sizes, the number bounds, `http(s)` links, live options); event
  `incident.field_changed`, timeline `field_changed` with the field's name and the value as it read then (a select's
  labels). Readers take a value only if it still fits its field (`liveValue`), and clients render a link only if it
  passes the same link check.
- **Size**: the caps bound an incident's values to about 25k UTF-16 code units (25 link fields of 1000), which is
  about 25 KiB of UTF-8 for ASCII and at most about 73 KiB if every character takes three bytes. That rides on the
  incident row in every snapshot and patch; one `incident.setField` frame carries one value, far inside RFC 0004's
  client frame limit.
- **Required fields** never hold anything up: declaring, paging and resolving do not wait for paperwork. A required
  field is flagged on the incident page until filled (`missingFields`), and once filled it can change but not be
  cleared (`invalid_args`). Enforcing them at a chosen status can come later, opt-in.
- **What goes away fades**: an option taken out of a field stops counting in values that hold it (`liveValue`); a
  deleted field leaves every type that required it (`incident_type.updated`, `field_deleted`) and its values are
  ignored, then dropped by the incident's next field write.
- Filtering incidents by type, service or field comes later; the mobile app shows them read-only for now.

## Follow-ups and postmortems

RFC 0013 has the detail. In short: **follow-ups** (`follow_ups`, `followUp.create`, `.update`, `.setStatus`,
`.delete`) and the **postmortem** (`postmortems`, one per incident, `postmortem.save` over the revision its editor
opened, its sections from its type's template when it was made) are `incident:update`, so responders change them
and viewers read them; owners and admins set the templates (`catalog:manage`). Follow-up changes and the first save
of a postmortem are timeline entries (`follow_up` with its `change` and title, `postmortem` with `started` or
`ai_drafted`). A member removed or made a viewer is taken off their open follow-ups with their rotations. AI drafts are
server-only mutations (`postmortem.requestDraft` as the member, `.writeDraft` and `.failDraft` as `sys_ai`). Exports
(`data:export`, owners and admins) are recorded by the server-only `export.record` in the `exports` table.

## Tenancy and access control

- **Workspace = Better Auth organization** (`organization` plugin). Users can belong to many workspaces and switch
  between them; invitations, membership and the active workspace live in Better Auth's D1 tables (invitations are
  written by the workspace shard, "Invitations" above).
- **Teams** use the plugin's teams support (on-call schedules and service ownership point at teams).
- **Roles** are defined with Better Auth access control (`createAccessControl`) in `packages/schema`, so the same
  permission table is used by the API, the sync engine (mutation RBAC) and the UI (hide what you cannot do):

| Role        | Typical permissions                                                                    |
| ----------- | -------------------------------------------------------------------------------------- |
| `owner`     | Everything, including billing/deletion and transferring ownership                      |
| `admin`     | Manage members, integrations, monitors, schedules, escalation policies, the catalog    |
| `responder` | Declare/run incidents, ack/escalate pages, edit timeline, manage own on-call overrides |
| `viewer`    | Read-only (stakeholders)                                                               |

- How it is wired (auth slice): `packages/schema` keeps the table framework-free (`statement`, `roles`, `can`), and
  `apps/api/src/auth.ts` builds Better Auth's `createAccessControl` from it, merged with the plugin's own
  `organization`/`member`/`invitation` grants for `owner` and `admin`. Each member holds exactly one Brigade role;
  a member whose role is anything else (Better Auth's default `member`, or several comma-separated roles) is
  refused on the sync upgrade.
- A new account creates its first workspace right away (sign-up asks for its name) and is its `owner`. A session
  starts in the user's oldest workspace (`activeOrganizationId`).
- Monitors (`monitor:read`, `monitor:manage`): owners and admins manage them (create, edit, pause, delete);
  responders and viewers read them. Responders run the incidents monitors open, but changing what is watched is an
  admin's call.
- The status page (`status:read`, `status:manage`, `status:publish`; RFC 0012): owners and admins set it up and
  manage its components; owners, admins and responders publish incident updates to it; everyone reads it.
- Exports (`data:export`; RFC 0013): owners and admins take incidents out as a file and read the list of exports.
- Workspace settings (`workspace:manage`): owners and admins. The first is who is emailed when paging fails
  (`workspace.setEmail`, `workspace.email_changed`; kept on the `workspace` row as `email`, absent meaning both on;
  RFC 0005 "Email"). A failed email is an `email_failed` timeline entry, written by `sys_notifier` like
  `page_failed`.
- **System actors** (RFC 0004 "Server-side writes") carry a role like members and pass the same check. Monitors run
  as `{ kind: "system", id: "sys_monitors", role: "admin" }` (`MONITOR_ACTOR`); incidents they open are declared by
  `sys_monitors`. Alert sources run as `sys_alerts` (`ALERTS_ACTOR`, `alert.ingest`). Their server-only mutations
  (`monitor.report`, `alert.ingest`) are never reachable from a socket, so the role grants no member anything.
- Alert sources and routes (`alert:read`, `alert:manage`; RFC 0005 "Alert sources"): owners and admins create sources
  (secret URLs) and routes; everyone reads them and the recent alerts. A source's token, header value and signing
  secret are never in a synced row.
- API tokens (`token:manage`; RFC 0014): owners and admins mint and revoke them. A token acts as a `token` actor
  with its creator's current role and its own scopes (`allows`: both must grant a permission), never `token:manage`,
  `workspace:create` or `device:register`. Every role reads the list (`apiToken.all`, `workspace:read`).
- Workspace-defined custom roles can come later via Better Auth dynamic access control.
- Every DO key is prefixed by the organization id; a shard never serves data of another workspace.

## Storage sketch

DO SQLite tables mirror the entities they own (RFC 0002). Every table row carries `version` (monotonic per DO)
for the sync protocol (RFC 0004). D1 holds the Better Auth tables (users, sessions, organizations, members, teams, invitations), `devices`,
and projection tables `incident_index`, `search_documents`.

Exact columns are defined in code (`packages/schema`) rather than duplicated here.

## Identifiers

ULIDs, prefixed by type (`inc_…`, `svc_…`, `typ_…`, `fld_…`, `opt_…`, `usr_…`) for readable logs and URLs. Better Auth's rows use them too
(`advanced.database.generateId`): `usr_` users, `ses_` sessions, `acc_` accounts, `ver_` verifications, `ws_`
workspaces (organizations), `mem_` members, `inv_` invitations (the shard writes invitation and accepted-member rows
itself with the same `authId`). A workspace id names its shard. Incidents also get a short
human number per workspace (`INC-142`), assigned by `WorkspaceDO`.
