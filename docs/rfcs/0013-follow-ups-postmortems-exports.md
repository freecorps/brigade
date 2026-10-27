# RFC 0013 — Follow-ups, postmortems and exports

- Status: Draft

What an incident leaves behind once it is over (RFC 0001 goal 6, RFC 0003 `FollowUp` and `Postmortem`): action
items with an owner and a due date, a postmortem document with a first draft from Workers AI, and a way to take the
incidents out of Brigade as a file. None of it is on a paging path. The code: `packages/schema/src/followups.ts`,
`postmortems.ts` and `exports.ts`; `apps/api/src/postmortem.ts` and `exports.ts`; and the dashboard's Follow-ups and
Postmortem cards on the incident page, the overview's Open follow-ups and Export incidents cards, and `/follow-ups`.

## Shape

```
Dashboard ──sync: followUp.*, postmortem.save────────────────────────────────────────────▶ WorkspaceDO

Dashboard ──POST /api/workspaces/:id/incidents/:inc/postmortem/draft──▶ api Worker ─▶ WorkspaceDO
            postmortem.requestDraft (as the member) + what the model may read ◀──────────┘
          ◀── 202 at once
            waitUntil: Workers AI (AI binding) ─▶ WorkspaceDO postmortem.writeDraft / failDraft (as sys_ai)

Dashboard ──POST /api/workspaces/:id/exports──▶ api Worker ─▶ WorkspaceDO buildExport (JSON in parts)
                                                 ─▶ R2 EXPORTS workspaces/<id>/exports/<exp>.json (streamed)
                                                 ─▶ WorkspaceDO export.record (as the member)
Dashboard ──GET  /api/workspaces/:id/exports/:exp──▶ api Worker ─▶ R2 get ─▶ streamed as an attachment
```

Everything lives in `WorkspaceDO`, like the catalog (RFC 0003), until `IncidentDO` takes incidents over. Every
change is a named mutation with RBAC and an outbox event (RFC 0004, RFC 0005).

## Follow-ups

- **Row** (`follow_ups`, synced): a title (1 to 200, the title rules with joiners), an **owner** (a member who is not
  a viewer, or nobody), a **due date** (`YYYY-MM-DD`, 2000 to 2099, a real calendar day), an optional **link** (the
  link field's rule: `http(s)`, up to 1000), and `open` or `done` (with when and by whom). It also keeps the
  incident's number and title as they were when it was added (titles never change), so the workspace-wide list names
  the incident without holding every resolved incident.
- **Mutations** (`incident:update`, so responders, admins and owners; viewers read): `followUp.create`, `.update`
  (title, owner, due date and link at once; no change is a `conflict`), `.setStatus` (`open`/`done`) and `.delete`.
  Each appends a `follow_up` timeline entry (`added`, `edited`, `done`, `reopened`, `removed`, with the title then)
  and emits `follow_up.created`, `.updated`, `.completed`, `.reopened` or `.deleted` (the id, incident, title, owner,
  due date and status). Only a new owner is checked: one who stays need not still qualify.
- **Members leaving.** A member removed or made a viewer is taken off every **open** follow-up they own in the same
  transaction (`follow_up.updated`, `reason: member_removed`, wherever `dropFromSchedules` runs); done ones keep them,
  as the record of who did it. One the shard has no copy of reads as "Former member".
- **Overdue** (`isOverdue`): open, with a due date before the reader's own calendar day. A due date is a calendar
  day, not an instant, so it is never shifted by a time zone; it turns overdue the day after.
- **Caps**: 50 per incident (done ones count; remove one to add more) and 500 open per workspace (reopening counts
  too), both `limit_reached`. The open list (`followUps.open`, soonest due first, no due date last) is what every
  client may hold; `incident.followUps` is one incident's, in the order added.
- **Not yet**: syncing with an issue tracker (the link is typed by hand), reminders before a due date, the mobile
  app (it reads the timeline entries only).

## Postmortems

- **Row** (`postmortems`, synced, keyed by the incident id): seven plain-text sections, `summary`, `impact`,
  `timeline`, `rootCause`, `wentWell`, `wentPoorly` and `followUps`, each up to 3000 characters (multi-line, the text
  rules). Seven of them, with JSON escapes, stay inside RFC 0004's client frame limit. Plain text, not Markdown: the
  dashboard renders it as written, and nothing in it can turn into markup.
- **Versioning: last writer wins, with a conflict check.** `postmortem.save` (`incident:update`) sends the whole
  document with `baseRevision` and `baseUpdatedAt`, the revision the editor opened and when the server wrote it (0
  and 0 for none). A save over any other revision, or the same number written at another time, is refused
  (`conflict`): someone else saved meanwhile. The time matters because a client applies its own save optimistically:
  its view then holds the next revision number too, stamped with its own clock, and a second save queued on it must
  not pass as written over a teammate's. The dashboard opens the editor only on a row the server confirmed (no
  unconfirmed change in it) and saves one at a time. The dashboard keeps the editor's text and offers to load the
  latest version, so nothing is lost and nothing is overwritten unseen. Each save adds one to `revision`. Keeping the
  last N revisions was the alternative. It would make every save copy the document (up to 21k characters) into a
  synced table for a restore nobody asked for yet. The outbox does not keep text either (below), so history waits on
  a real need (`docs/open-questions.md` Q24).
- **Timeline and events.** The first save is a `postmortem` entry (`started`); later saves are edits of a document,
  not incident changes, and only emit `postmortem.saved` (`incidentId`, `revision`, `characters`). **No event carries
  the text**: notifiers and logs never see the document.

## Drafting with AI

- **Off the request path, never a paging path.** `POST /workspaces/:id/incidents/:incidentId/postmortem/draft`
  (responders and up; body `{ locale }`) checks the session and the member in D1, then has the shard run the
  server-only `postmortem.requestDraft` as the member: it marks a draft `pending` and emits
  `postmortem.draft_requested`. The Worker answers 202 at once and asks the model in `ctx.waitUntil`. The result is
  written through `postmortem.writeDraft` (or `postmortem.failDraft`), run as `sys_ai`, and reaches every client
  through sync. No Queue, no alarm and no paging code is involved: the events Queue and the shard's alarm never
  wait on a model.
- **Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`**, Meta's Llama 3.3 70B in FP8, the "fast" variant: a
  current general instruction model on Workers AI that writes Brazilian Portuguese well, with a 24k-token context
  and JSON output (`response_format: json_schema`, asking for the seven sections). It is chosen over the small 8B
  models for the quality of a document people will share, and over the larger reasoning models for speed: a draft has
  25 s. **Cost**: about $0.29 per million input tokens and $2.25 per million output tokens at the time of writing. A
  draft reads at most about 40k characters (~10k tokens; usually far less) and writes at most 2000 tokens, so it costs
  under one cent. With 20 drafts a day per workspace (below), that is at most about $0.20 a day per workspace. Workers
  AI's free daily allocation covers light use. Change the model in `AI_MODEL` (`apps/api/src/postmortem.ts`).
- **What the model reads** (`draftSource`): the incident's number, title, severity, status, declare time, type,
  services, custom fields and role holders; the timeline's changes in plain English (updates included, each cut to
  1500 characters); and the follow-ups. Members appear **by name** (every member already sees those names on the
  incident page). **Never** an email address, a device, a push token or a delivery: those tables are not read, and
  timeline entries about pages, emails and Slack are left out. A long timeline keeps its first ten entries and as much
  of its end as fits, dropping from the middle. Only the first 50 and the last 2,000 entries are read at all, and each
  is measured once, so a timeline of any length costs the shard about the same. The data stays in the Cloudflare account that runs Brigade.
- **Language**: the status page's language when the workspace has one (the closest thing to a workspace language
  today), else the asker's dashboard language. The prompt asks for a blameless draft that only uses facts from the
  data and says what is unknown.
- **Marked until reviewed.** A written draft sets `ai` on the row (the model, when, and who asked) and appends a
  `postmortem` entry (`ai_drafted`). The dashboard shows "AI draft — review before sharing" until a member saves the
  document, which clears it: saving means a member read it.
- **Never over a member's text.** A draft may be asked for only while the document is blank, or still holds an AI
  draft nobody saved (asking again replaces it). A member who saves while a draft is being written wins: the draft
  fails as `edited` and their text stays.
- **Limits and failures.** One draft at a time per incident (`conflict`). **20 drafts a day per workspace**
  (`AI_DRAFTS_PER_DAY`, `limit_reached`, answered 429), counted in the shard's server-only `ai_drafts` ledger. The
  Worker gives the model 25 s, inside `waitUntil`'s 30 s after the response. A model that times out, throws or
  answers no usable JSON fails the draft (`timeout`, `failed`). Text the shard's rules would refuse is cleaned first
  (hidden characters, the cap). A draft still pending after 2 minutes (`AI_DRAFT_STALE_MS`: the Worker was stopped
  before it could write a failure) reads as failed and may be asked for again; its late result is refused.
- **Without the binding** the route answers 503 `ai_unavailable` and the button is hidden (`GET /features`).
  Enabling it is apps/api/README.md "Postmortem drafts".

## Exports

- **Who and what.** Owners and admins (`data:export`, a new permission) export one incident from its page, or the
  incidents declared in a range of UTC days (both ends included, up to 366 days, at most 500 incidents, at most
  25 MiB; more is refused, 413, to be split). The file (`buildExport`, format `brigade.export` version 1) holds, per
  incident, the incident row (without its escalation run's internals), its whole timeline, its written updates, what
  the status page published, its follow-ups and its postmortem, plus the workspace's name and the members' ids and
  names, so the ids in it read. **Never** an email address, a device, a token or a delivery receipt.
- **Building it never holds the shard.** The shard (which also fires escalations) writes the file one incident at a
  time as UTF-8 parts, counting bytes as it goes: past 25 MiB it stops and answers `too_large` without ever holding
  the whole text, and it yields every 256 KiB so alarms and requests run in between. The Worker streams the parts
  into R2 (`FixedLengthStream`); the file is never one string anywhere.
- **Rate limit: 10 exports an hour per workspace** (`EXPORTS_PER_HOUR`, 429 `rate_limited`), counted in the shard's
  server-only `export_ledger` by `export.reserve` before anything is built, so a refused or too-large export counts
  too. The ledger write is bookkeeping, a `silent` mutation with no event.
- **Order.** The shard builds the file from its own rows; the Worker writes it to R2 (`EXPORTS`) at
  `workspaces/<workspace id>/exports/<exp_ULID>.json`, then the shard records it (`export.record`, server-only, as
  the member), which lists it (`exports`, synced, `exports.recent` for `data:export`) and emits `workspace.exported`
  (`id`, `scope`, `incidents`, `bytes`, `expiresAt`). If recording fails, the file is deleted and the answer is 503,
  so there is never a file without its event.
- **Download** (`GET /workspaces/:id/exports/:exportId`): owners and admins of that workspace only; the key is built
  from the route's workspace, so an id from another workspace is a 404. The object is streamed from R2 as an
  attachment (`private, no-store`). **The bucket is never public** and has no public URL.
- **Expiry: 7 days** (`EXPORT_TTL_MS`). Each object carries `expiresAt`. A download past it answers 410 and deletes
  it. The cron sweeps objects uploaded more than 7 days ago once an hour (at minute 17, beside the dead-man
  heartbeat and never in its way: a failed sweep is only logged), paging through `workspaces/` with R2's cursor, 1000
  a call, for at most 20 s; what it does not reach waits for the next hour. The bucket's lifecycle rule (delete after 8 days under `workspaces/`) is the
  backstop. The list in the shard keeps the 20 most recent and drops expired ones on the next export.
- **Without the binding** both routes answer 503 `exports_unavailable` and the dashboard hides exporting.
  Locally and in the tests, Miniflare simulates the bucket; setting up a deployed one is apps/api/README.md
  "Exports".
- **Not yet**: CSV, exporting other tables (monitors, schedules), scheduled exports, an import.

## Not in this slice

The mobile app's follow-ups and postmortem screens; reminders and notifications for follow-ups due; postmortem
templates per incident type; revision history; publishing a postmortem to the status page; issue-tracker sync.
