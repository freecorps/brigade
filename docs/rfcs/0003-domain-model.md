# RFC 0003 — Domain model

- Status: Draft

Names below are the canonical vocabulary for code, API and UI (translated in the UI only).

## Entities

```
Workspace ─┬─ Member (User + role: owner | admin | responder | viewer)
           ├─ Team ── members
           ├─ Service (catalog) ── owner Team, dependencies, links
           ├─ Monitor ── target, regions, interval, quorum → raises Alerts
           ├─ AlertSource (webhook endpoint + mapper)
           ├─ AlertRoute (match rules → create/attach Incident, page EscalationPolicy)
           ├─ Schedule ── Rotation(s) ── Layer(s), Override(s)
           ├─ EscalationPolicy ── Level(s): targets (users | schedules | teams), timeout
           ├─ IncidentType, Severity config, CustomField definitions, Role definitions
           ├─ StatusPage ── components (mapped to Services)
           └─ Incident ─┬─ status, severity, type, summary, custom field values
                        ├─ RoleAssignment (role → user)
                        ├─ TimelineEntry (event-sourced, append-only)
                        ├─ Update (human-written status update, may publish to status page)
                        ├─ Alert(s) attached
                        ├─ Page(s) — an escalation run (level, acks)
                        ├─ FollowUp (action item; optional external issue link)
                        └─ Postmortem (document, generated draft)
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
  deleted), by `sys_monitors` or the member who did it. The outbox is server-only and drained, while clients need
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
  status so a resolved incident can get closing notes. No visibility flag yet: every update is internal, and
  publishing one to a status page (Phase 3) will be its own action with its own event.
- **Roles** (`incident.assignRole`, `incident:update`, event `incident.role_assigned`): a fixed set until role
  definitions exist (Phase 3), `commander`, `communications` and `operations`, at most one member each, stored on
  the incident (`roles`). `userId: null` unassigns. The assignee must be in the shard's member list and not a
  viewer (`invalid_args` on `userId` otherwise).
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
- **Open sockets.** After a change the shard closes the target's sockets: `1008` when removed (the client reconnects
  and the upgrade answers `403 not_a_member`), `1012` on a role change (it reconnects with the new role). The
  reconcile after every upgrade also closes any socket whose actor D1 no longer backs (gone, or another role),
  which covers an upgrade the Worker authenticated just before a change landed. What is left is RFC 0004
  "Session revocation".

## Schedules

First slice of on-call (Phase 2), in `packages/schema` (`schedules.ts`, `zoned.ts`), stored in `WorkspaceDO`. It
says who is on call; it does not change who is paged yet (RFC 0006 "Who is paged" keeps the interim rule until
escalation policies exist).

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
- **Limits.** 50 schedules per workspace, 100 overrides not yet ended per schedule; an override that ended over 30
  days ago is deleted when the next one is added to its schedule (`schedule.override_removed`, `expired`), so the
  table stays small. Deleting a schedule deletes its overrides.

## Alert → incident flow

1. Alert arrives (monitor or webhook) → normalized to `AlertEvent { source, fingerprint, status: firing|resolved, labels, payload }`.
   First slice (RFC 0007): monitor alerts live in `WorkspaceDO` (`alerts`, deduplicated per monitor) and open an
   incident directly until `AlertGroupDO` and alert routes exist.
2. `AlertGroupDO(fingerprint)` deduplicates within a window.
3. `AlertRoute` rules (evaluated in order) decide: ignore, attach to an open incident, or create a new incident with a type/severity and an escalation policy.
4. Creating a page starts an escalation run on the `IncidentDO` (alarm per level timeout).

## Escalation run

- Level N notifies its targets (resolving schedules to the on-call user _at that moment_).
- Any target acks (`incident.ack`; until escalation runs exist the ack is stored on the incident and reopening clears it, spike S6) → run stops. Timeout → level N+1. Last level exhausted → repeat policy (configurable) and flag "unacknowledged".
- Every notification attempt and delivery receipt is recorded (debuggable: "why didn't I get paged?").

## Tenancy and access control

- **Workspace = Better Auth organization** (`organization` plugin). Users can belong to many workspaces and switch
  between them; invitations, membership and the active workspace come from Better Auth.
- **Teams** use the plugin's teams support (on-call schedules and service ownership point at teams).
- **Roles** are defined with Better Auth access control (`createAccessControl`) in `packages/schema`, so the same
  permission table is used by the API, the sync engine (mutation RBAC) and the UI (hide what you cannot do):

| Role        | Typical permissions                                                                    |
| ----------- | -------------------------------------------------------------------------------------- |
| `owner`     | Everything, including billing/deletion and transferring ownership                      |
| `admin`     | Manage members, integrations, monitors, schedules, policies                            |
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
- **System actors** (RFC 0004 "Server-side writes") carry a role like members and pass the same check. Monitors run
  as `{ kind: "system", id: "sys_monitors", role: "admin" }` (`MONITOR_ACTOR`); incidents they open are declared by
  `sys_monitors`. Their server-only mutations (`monitor.report`) are never reachable from a socket, so the role
  grants no member anything.
- Workspace-defined custom roles can come later via Better Auth dynamic access control.
- Every DO key is prefixed by the organization id; a shard never serves data of another workspace.

## Storage sketch

DO SQLite tables mirror the entities they own (RFC 0002). Every table row carries `version` (monotonic per DO)
for the sync protocol (RFC 0004). D1 holds the Better Auth tables (users, sessions, organizations, members, teams, invitations), `devices`,
and projection tables `incident_index`, `search_documents`.

Exact columns are defined in code (`packages/schema`) rather than duplicated here.

## Identifiers

ULIDs, prefixed by type (`inc_…`, `svc_…`, `usr_…`) for readable logs and URLs. Better Auth's rows use them too
(`advanced.database.generateId`): `usr_` users, `ses_` sessions, `acc_` accounts, `ver_` verifications, `ws_`
workspaces (organizations), `mem_` members, `inv_` invitations. A workspace id names its shard. Incidents also get a short
human number per workspace (`INC-142`), assigned by `WorkspaceDO`.
