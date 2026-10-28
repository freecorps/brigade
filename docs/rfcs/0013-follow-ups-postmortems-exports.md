# RFC 0013 — Follow-ups, postmortems and exports

- Status: Draft

What an incident leaves behind once it is over (RFC 0001 goal 6, RFC 0003 `FollowUp` and `Postmortem`): action
items with an owner and a due date, a postmortem document with a first draft from Workers AI, and a way to take the
incidents out of Brigade as a file. None of it is on a paging path. The code: `packages/schema/src/followups.ts`,
`postmortems.ts` and `exports.ts`; `apps/api/src/postmortem.ts` and `exports.ts`; and the dashboard's Follow-ups and
Postmortem cards on the incident page, the overview's Open follow-ups and Export incidents cards and the Postmortem
templates part of its Incident settings card, and `/follow-ups`.

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

## Reminders

- **What.** Once a day, each member who owns open follow-ups due that day or overdue gets one email listing them
  (soonest due first, at most 20, the rest counted), each with its incident, a link to `/follow-ups`, and how to turn
  reminders off, with a link to the dashboard's Email card (`/#email`). In the member's language (`user.locale`), plain
  text and escaped HTML like every email (RFC 0005 "Email"). A due date is a calendar day, so "today" is the member's
  own.
- **When.** At 09:00 (`REMINDER_HOUR`) on the member's clock: the time zone their devices send
  (`member.setTimeZone`, kept on their `member_settings` row, synced like their call choice; the dashboard and the app
  send the device's own when it differs from the one kept, so the last device used wins), else UTC. The row is synced
  to every member, so every member can see every other member's time zone (RFC 0003 "A member's own settings").
  The hour stays 09:00 (decided, Q24; a member's own hour may come later). A follow-up stops being reminded once it
  is 14 days overdue (`REMINDER_OVERDUE_DAYS`, decided, Q24): its last reminder is the day it is 13 days overdue, on
  the member's calendar, and the email lists only the ones still reminded.
- **How.** The shard's alarm (after every page it fires and the drain) asks who is due (`remindersDue`, one pass
  over the follow-ups) and runs the server-only `followUp.remind` for each, at most 50 a run
  (`REMINDERS_PER_RUN`; the alarm comes back a minute later for the rest). It writes the day in a server-only ledger
  (`follow_up_reminders`, one row per member: at most one reminder a day) and emits `follow_up.reminder_due`
  (`userId`, `date`, `count`) through the outbox. Only members are reminded: follow-ups a removed member still owns
  remind nobody. The alarm wakes for the next one due (`nextReminderAt`), kept by the shard and read again only after
  a change to follow-ups, members or member settings, or a run of reminders, so a page, an acknowledgement or an
  escalation never pays for reminders (tested). The queue consumer (`src/notify-reminder.ts`) asks the shard for the
  email (`planReminder`: what is still due, read then, claimed in the email notifier's ledger as
  `reminder:<member>:<day>`), reads the verified address and language from D1, and sends with the same retries (30 s
  to 4 minutes, 5 attempts). A failure past them is only logged: a reminder has no incident timeline.
- **Caps of their own.** At most 200 reminders a day per workspace (`REMINDER_WORKSPACE_DAILY_CAP`) and 2 a day per
  user (`REMINDER_USER_DAILY_CAP`); over either, the reminder is dropped and logged. They are separate from the caps
  on the emails about pages (RFC 0005 "Email", "Abuse"): reminders never count toward those and never spend them, so
  200 reminders at 09:00 can never drop a later "a page reached nobody" or missed-page email (tested).
- **Opting out.** `member.setEmail` (`followUpReminders`, RFC 0005 "Email") from the dashboard's Email card or the
  app's account settings; on by default. A reminder already asked for is not sent once turned off, nor when
  everything it would list was done meanwhile.
- **Never a paging path.** It runs after the alarm's pages, its email goes through the email path only (tested: it
  never reaches the relay), and nothing pages from it.

## Postmortems

- **Row** (`postmortems`, synced, keyed by the incident id): plain-text sections by key, each up to 3000 characters
  (multi-line, the text rules), and at most 21,000 in all (`POSTMORTEM_TOTAL_MAX`, what seven full sections held), so
  a save, with JSON escapes, stays inside RFC 0004's client frame limit however many sections it has (tested). Which
  sections, in which order, is its `layout`, taken from its template when the row is made (below); a row without one
  (every postmortem from before templates, and any made with no template) has the seven built-in sections, `summary`,
  `impact`, `timeline`, `rootCause`, `wentWell`, `wentPoorly` and `followUps`. A save or a draft must give exactly
  the layout's keys. Plain text, not Markdown: the dashboard renders it as written, and nothing in it can turn into
  markup.
- **Versioning: last writer wins, with a conflict check.** `postmortem.save` (`incident:update`) sends the whole
  document with `baseRevision` and `baseUpdatedAt`, the revision the editor opened and when the server wrote it (0
  and 0 for none). A save over any other revision, or the same number written at another time, is refused
  (`conflict`): someone else saved meanwhile. The time matters because a client applies its own save optimistically:
  its view then holds the next revision number too, stamped with its own clock, and a second save queued on it must
  not pass as written over a teammate's. The dashboard opens the editor only on a row the server confirmed (no
  unconfirmed change in it) and saves one at a time. The dashboard keeps the editor's text and offers to load the
  latest version, so nothing is lost and nothing is overwritten unseen. Each save adds one to `revision`.
- **Revision history (decided, Q24).** The last 20 revisions of each postmortem (`POSTMORTEM_REVISIONS_KEPT`) are
  kept in the server-only `postmortem_revisions` table (not synced, so a save does not copy the document to every
  client), one row per save or AI draft (`<incident>:<revision>`, its text, when, by whom, and whether the AI wrote
  it), written by `postmortem.save` and `postmortem.writeDraft` in the same transaction, which drop the one 20
  before it (one read, no scan). `GET /workspaces/:id/incidents/:incidentId/postmortem/revisions` (`incident:read`,
  so every member, or an API token with that scope) answers them newest first. The incident page's Postmortem card
  lists them on demand ("Revision history"), with who saved each and when and the text when opened; responders and
  up restore one: its text opens in the editor over the current revision, and saving it is a `postmortem.save` with
  the same conflict check, so it is a revision of its own and can be undone. The outbox still never carries the
  text.
- **Timeline and events.** The first save is a `postmortem` entry (`started`); later saves are edits of a document,
  not incident changes, and only emit `postmortem.saved` (`incidentId`, `revision`, `characters`). **No event carries
  the text**: notifiers and logs never see the document.

## Templates

- **What.** A template is the sections a new postmortem starts with, in order: any of the seven built-in sections
  (each may be renamed, up to 60 characters; an empty title keeps its own translated name) and up to three custom
  ones (`custom1` to `custom3`, a title required), at most ten in all, each with a **hint** (up to 300 characters:
  shown under the section's name in the editor, and given to the AI draft) and **starter text** (up to 1000: what the
  editor of a new postmortem starts with). Table `postmortem_templates` (synced, `postmortemTemplates.all`,
  `catalog:read`), keyed by an incident type's id, or `default` for the workspace's own.
- **Who.** Owners and admins (`catalog:manage`): `postmortemTemplate.set` (the whole template; unchanged is a
  `conflict`) and `postmortemTemplate.reset` (takes it out). Events `postmortem_template.updated` (`id`, `typeId`,
  `sections`, `custom`: counts, never the text) and `postmortem_template.reset`. Deleting a type deletes its template.
- **Which one.** An incident takes its type's template, else the `default` one, else the seven built-in sections
  (`templateFor`). With no template set anywhere, nothing changes from before.
- **A snapshot, decided once.** The template is copied into the postmortem's `layout` when its row is made: its
  first save, or the first AI draft asked for. From then on the postmortem keeps those sections: editing or resetting
  the template, deleting the type, or changing the incident's type (`incident.setType`) never rewrites one. A
  document already being written in another layout cannot be moved without losing or inventing sections, and the
  type is often set late, after someone started writing. **Decided (Q24):** a postmortem nobody wrote in yet (every
  section empty or still its starter text, `isUnwrittenPostmortem`; e.g. the row a failed draft made) follows its
  incident's new type's template when `incident.setType` changes it (`followNewType`, in the same mutation), and its
  `updatedAt` moves, so an editor opened on the old sections is refused (`conflict`) and offered the new ones; not
  while an AI draft is being written. One with text keeps its sections, and so does one saved before and emptied
  since (`revision > 0`): its kept revisions hold text under the old sections, which a restore would otherwise drop.
  An emptied postmortem still shows its revision history, so that text can be restored from the dashboard. Before the row exists, the editor follows the template the
  incident would take now; if it changed while someone was writing the first version, the save is refused
  (`conflict`) and the editor keeps the text and offers to load the new sections, as for a teammate's save.
- **Starter text** fills a new postmortem's editor only: a save that changes nothing but the starter text is not
  sent, so a postmortem that only holds it stays blank (and an AI draft may still be asked for).
- **The editor** (dashboard, Incident settings, "Postmortem templates"): the default and each type, the sections in
  order (move up and down, rename, hint, starter text, remove, add a built-in left out or a custom one), with a
  preview of what a new postmortem's editor shows. The incident page's Postmortem card shows and edits the
  postmortem's own sections, by their titles, with their hints.
- **Not yet**: sharing one template between types; changing the sections of a postmortem someone wrote in.

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
  services, custom fields and role holders; the timeline's changes in plain English (updates included as they read
  now, "edited later" when edited, each cut to 1500 characters; removed ones left out); and the follow-ups. Members appear **by name** (every member already sees those names on the
  incident page). **Never** an email address, a device, a push token or a delivery: those tables are not read, and
  timeline entries about pages, emails and Slack are left out. A long timeline keeps its first ten entries and as much
  of its end as fits, dropping from the middle. Only the first 50 and the last 2,000 entries are read at all, and each
  is measured once, so a timeline of any length costs the shard about the same. The data stays in the Cloudflare account that runs Brigade.
- **Its sections** are the postmortem's own (its `layout`; for a new one, the template it takes as the draft makes the
  row): the prompt lists each key with its title and hint (a built-in without either reads as its own name and what
  it asks for), the model must answer exactly those keys (`response_format`), and the share of `POSTMORTEM_TOTAL_MAX`
  each may use. Titles and hints are given as data, as the team's words about the sections.
- **Language**: the status page's language when the workspace has one (the closest thing to a workspace language
  today), else the asker's dashboard language. Decided (Q24), still to build: the workspace locale (RFC 0008, Q15)
  once it exists. The prompt asks for a blameless draft that only uses facts from the
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
- **Turned off per workspace (decided, Q24).** Owners turn AI drafts off (and on) for their workspace with
  `workspace.setAiDrafts` (`workspace:manage` and the owner role, so also an API token an owner made with that scope,
  as for `monitor.setCap`; event `workspace.ai_drafts_changed`, kept on the
  `workspace` row as `aiDrafts`, absent meaning on), from the Incident settings card's "Postmortem templates" part,
  shown to owners and admins on a server with the binding (admins see it, unchangeable). Off, "Draft with AI" is
  hidden, `postmortem.requestDraft` refuses (`forbidden`), and the route answers 403 `ai_disabled` before the
  model is asked or the daily limit counts. A draft already being written still lands.
- **Without the binding** the route answers 503 `ai_unavailable` and the button is hidden (`GET /features`).
  Enabling it is apps/api/README.md "Postmortem drafts".

## Exports

- **Who and what.** Owners and admins (`data:export`, a new permission; kept to them, decided in Q24) export one incident from its page, or the
  incidents declared in a range of UTC days (both ends included, up to 366 days, at most 500 incidents, at most
  25 MiB; more is refused, 413, to be split). The file (`buildExport`, format `brigade.export` version 1) holds, per
  incident, the incident row (without its escalation run's internals), its whole timeline, its written updates (the text as it reads now, with `edited`, or `removed` and no text; an edited, not removed,
  update's timeline entry keeps `edited.previous`, the text its last edit replaced), what
  the status page published, its follow-ups and its postmortem (its `sections` in the postmortem's own order, and
  `layout`, the keys with their titles, null for a built-in under its own name), plus the workspace's name and the members' ids and
  names, so the ids in it read. **Never** an email address, a device, a token or a delivery receipt.
- **Building it never holds the shard.** The shard (which also fires escalations) writes the file one incident at a
  time as UTF-8 parts, counting bytes as it goes: past 25 MiB it stops and answers `too_large` without ever holding
  the whole text, and it yields every 256 KiB so alarms and requests run in between. The Worker streams the parts
  into R2 (`FixedLengthStream`); the file is never one string anywhere.
  One build runs at a time per shard (a second answers 429 `rate_limited` before taking a slot), so parallel exports
  can't outgrow the isolate's memory. Since it yields, the file is not one snapshot of the workspace: each incident
  is read again when it is reached, so its row, timeline and postmortem agree with each other, but two incidents may
  be read a moment apart. A single huge incident is still built in one go.
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

The mobile app's follow-ups and postmortem screens; push notifications for follow-ups due; publishing a postmortem to the status page; issue-tracker sync; the AI draft in the workspace locale (waits for Q15).
