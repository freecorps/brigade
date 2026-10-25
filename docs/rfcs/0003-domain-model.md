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

## Alert → incident flow

1. Alert arrives (monitor or webhook) → normalized to `AlertEvent { source, fingerprint, status: firing|resolved, labels, payload }`.
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
