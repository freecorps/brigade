import { formatDateTime } from "@freecorps/brigade-i18n";
import { mutationErrorReason } from "@freecorps/brigade-i18n/incident";
import {
  aiDraftsEnabled,
  can,
  canDraftPostmortem,
  draftRunning,
  isBlankPostmortem,
  POSTMORTEM_SECTION_MAX,
  POSTMORTEM_TOTAL_MAX,
  postmortemLayout,
  POSTMORTEM_REVISIONS_KEPT,
  restoredSections,
  type IncidentRow,
  type PostmortemRow,
  type PostmortemSections,
  type PostmortemTemplateSection,
} from "@freecorps/brigade-schema";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { cn } from "cn";
import {
  FileTextIcon,
  HistoryIcon,
  LoaderCircleIcon,
  PencilIcon,
  RotateCcwIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { useNow } from "@/components/incidents-card";
import { usePreferences } from "@/components/preferences";
import { FORM, Refusal, TEXTAREA } from "@/components/services-card";
import { useMember } from "@/components/session";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import {
  loadRevisions,
  postmortemText,
  requestDraft,
  useFeatures,
  type PostmortemRevision,
} from "@/lib/follow-ups";
import { onlyStarters, sectionName, starterSections } from "@/lib/postmortem-templates";
import { people, personName, type People } from "@/lib/timeline";

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
/** A section shows how much room is left once it is this close to the cap. */
const COUNT_FROM = POSTMORTEM_SECTION_MAX - 300;
/** The whole document shows how much room is left once it is this close to its cap. */
const TOTAL_FROM = POSTMORTEM_TOTAL_MAX - 1000;
type Layout = readonly PostmortemTemplateSection[];
/** Why the last save was refused as a conflict: a teammate's save, or a new template for a postmortem not yet made. */
type Conflict = "saved" | "template" | null;
const keysOf = (layout: Layout) => layout.map((section) => section.key).join(",");

/** Why an AI draft request was refused, worded. */
function refusalText(code: string): string {
  if (
    code === "limit_reached" ||
    code === "conflict" ||
    code === "ai_unavailable" ||
    code === "ai_disabled"
  ) {
    return postmortemText(`ai_refused_${code}`);
  }
  return postmortemText("ai_refused_other", { reason: mutationErrorReason(code) });
}

/**
 * The incident's postmortem (RFC 0013): plain-text sections, read here and edited in place by responders and up. Its
 * sections are its own once it exists (the template it was made with), else the template its type takes now; a new
 * one starts from the template's starter text. A save names the revision its editor opened, as the server confirmed it (its number and `updatedAt`); when
 * someone else saved since, it is refused and the editor keeps the text, so nothing is lost and nothing is overwritten
 * unseen. An editor never opens on a row holding an unconfirmed change, and saves one at a time: a base is never this
 * client's own optimistic revision. With Workers AI set up, "Draft with AI" asks for a
 * first draft while the document is empty (or still an unreviewed AI draft), unless an owner turned AI drafts off for
 * the workspace; it arrives through sync, marked as an AI draft until a member saves it. Its revision history (the
 * last few revisions, kept by the shard) lists who saved each and when; restoring one opens it in the editor, and
 * saving it is a save like any other.
 */
export function PostmortemCard({ incident }: { incident: IncidentRow }) {
  const member = useMember();
  const { locale } = usePreferences();
  const editable = can(member.role, "incident:update");
  const features = useFeatures();
  const query = useQuery("incident.postmortem", { id: incident.id });
  const members = useQuery("members.all", {});
  const tokens = useQuery("apiToken.all", {});
  const templates = useQuery("postmortemTemplates.all", {});
  const workspace = useQuery("workspace.current", {});
  const save = useMutation("postmortem.save");
  const row: PostmortemRow | undefined = query.rows[0];
  const layout = postmortemLayout(
    row,
    (id) => templates.rows.find((one) => one.id === id),
    incident,
  );
  const now = useNow(5_000);
  const [editing, setEditing] = useState<{
    base: Base;
    layout: Layout;
    sections: Record<string, string>;
    /** The kept revision whose text the editor opened with, to restore it. */
    restoring?: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<Conflict>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const running = draftRunning(row, now);
  const blank = isBlankPostmortem(row);
  const who = people(member.userId, members.rows, tokens.rows);

  // Whether `row` is the server's: not while it holds a change the server has not answered yet. A postmortem not yet
  // made also waits for the templates, which say its sections.
  const confirmed = !query.pending && (row !== undefined || templates.status === "ready");
  const open = (from?: PostmortemRevision) => {
    if (!confirmed) return;
    setEditing({
      base: baseOf(row),
      layout,
      sections: from
        ? (restoredSections(from, layout) as Record<string, string>)
        : blank
          ? starterSections(layout)
          : Object.fromEntries(layout.map(({ key }) => [key, row?.sections[key] ?? ""])),
      ...(from && { restoring: from.revision }),
    });
  };
  const startEditing = () => {
    setConflict(null);
    setRefused(null);
    open();
  };
  const onSave = (written: Record<string, string>) => {
    if (!editing || saving) return;
    setRefused(null);
    // Only the editor's own sections, every one of them: the shard refuses any other set.
    const sections: PostmortemSections = Object.fromEntries(
      editing.layout.map(({ key }) => [key, written[key] ?? ""]),
    );
    const unchanged =
      row !== undefined &&
      row.ai === null &&
      row.revision === editing.base.revision &&
      row.updatedAt === editing.base.updatedAt &&
      editing.layout.every(({ key }) => row.sections[key] === sections[key]!.trim());
    // A blank postmortem holding only the template's starter text: nobody wrote anything yet.
    if (unchanged || (blank && onlyStarters(sections, editing.layout))) {
      setEditing(null);
      return;
    }
    setSaving(true);
    void save({
      id: incident.id,
      sections,
      baseRevision: editing.base.revision,
      baseUpdatedAt: editing.base.updatedAt,
    }).then((outcome) => {
      setSaving(false);
      if (outcome.ok) {
        setEditing(null);
        setConflict(null);
        return;
      }
      // Unchanged text never reaches the shard (above), so a conflict is someone else's save since this edit began,
      // or, for a postmortem not yet made, its template changing.
      if (outcome.error.code === "conflict") {
        setConflict(
          editing.base.revision === 0 && keysOf(layout) !== keysOf(editing.layout)
            ? "template"
            : "saved",
        );
        return;
      }
      setRefused(
        postmortemText("save_failed", { reason: mutationErrorReason(outcome.error.code) }),
      );
    });
  };
  const onDraft = () => {
    setRefused(null);
    setAsking(true);
    void requestDraft(member.workspaceId, incident.id, locale).then((result) => {
      setAsking(false);
      if (!result.ok) setRefused(refusalText(result.error));
    });
  };

  const showDraft =
    features.ai &&
    aiDraftsEnabled(workspace.rows[0]) &&
    editable &&
    editing === null &&
    !running &&
    canDraftPostmortem(row);
  const failed = row?.draft?.status === "failed" ? row.draft.reason : null;
  // A pending draft past its time was lost: it reads as failed.
  const lost = row?.draft?.status === "pending" && !running;

  const history =
    row && row.revision > 0 ? (
      <RevisionHistory
        workspaceId={member.workspaceId}
        incidentId={incident.id}
        current={row.revision}
        layout={layout}
        who={who}
        canRestore={editable && confirmed && !running}
        onRestore={(revision) => {
          setConflict(null);
          setRefused(null);
          open(revision);
        }}
      />
    ) : null;

  return (
    <Card aria-labelledby="postmortem-title">
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle id="postmortem-title">{postmortemText("title")}</CardTitle>
          {editable && editing === null ? (
            <div className="flex flex-wrap gap-2">
              {showDraft ? (
                <Button variant="outline" onClick={onDraft} disabled={asking}>
                  {asking ? (
                    <LoaderCircleIcon
                      aria-hidden
                      className="animate-spin motion-reduce:animate-none"
                    />
                  ) : (
                    <SparklesIcon aria-hidden />
                  )}
                  {postmortemText(row?.ai ? "ai_redraft" : "ai_draft")}
                </Button>
              ) : null}
              {!running ? (
                <Button
                  variant={blank ? "default" : "outline"}
                  onClick={startEditing}
                  disabled={!confirmed}
                >
                  {blank ? <FileTextIcon aria-hidden /> : <PencilIcon aria-hidden />}
                  {postmortemText(blank ? "start" : "edit")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{postmortemText("description")}</p>
        {showDraft && blank ? (
          <p className="text-xs text-muted-foreground">{postmortemText("ai_hint")}</p>
        ) : null}
      </div>
      <CardContent className="flex flex-col gap-4 text-sm">
        {refused ? <Refusal text={refused} onDismiss={() => setRefused(null)} /> : null}
        {running ? (
          <p role="status" className="flex items-center gap-2 font-medium">
            <LoaderCircleIcon
              aria-hidden
              className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
            />
            {postmortemText("ai_pending")}
          </p>
        ) : failed || lost ? (
          <p className="flex items-start gap-2 text-muted-foreground">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {postmortemText(`ai_failed_${failed ?? "timeout"}`)}
          </p>
        ) : null}
        {row?.ai && editing === null ? (
          <div
            role="note"
            className="flex items-start gap-2 rounded-md border border-amber-600/30 bg-amber-500/10 p-3 text-amber-900 dark:text-amber-200"
          >
            <SparklesIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="font-semibold">{postmortemText("ai_marker")}</p>
              <p className="text-xs">{postmortemText("ai_marker_hint")}</p>
            </div>
          </div>
        ) : null}
        {editing ? (
          <Editor
            initial={editing.sections}
            layout={editing.layout}
            restoring={editing.restoring}
            conflict={conflict}
            saving={saving}
            canReload={confirmed}
            onReload={() => {
              setConflict(null);
              open();
            }}
            onCancel={() => {
              setEditing(null);
              setConflict(null);
            }}
            onSave={onSave}
            key={`${editing.base.revision}:${editing.base.updatedAt}:${keysOf(editing.layout)}:${editing.restoring ?? ""}`}
          />
        ) : blank ? (
          <>
            <p className="text-muted-foreground">
              {postmortemText("empty")}
              {editable ? null : ` ${postmortemText("read_only")}`}
            </p>
            {/* Emptied after it was written: the history is how its text comes back. */}
            {history}
          </>
        ) : row ? (
          <>
            <dl className="flex flex-col gap-4">
              {layout.map((section) => (
                <div key={section.key} className="flex flex-col gap-1">
                  <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase [overflow-wrap:anywhere]">
                    {sectionName(section)}
                  </dt>
                  <dd
                    className={cn(
                      "whitespace-pre-wrap [overflow-wrap:anywhere]",
                      !row.sections[section.key] && "text-muted-foreground italic",
                    )}
                  >
                    {row.sections[section.key] || postmortemText("section_empty")}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground tabular-nums">
              {postmortemText("updated", {
                count: row.revision,
                time: formatDateTime(row.updatedAt, locale, TIME_ZONE),
                name: personName(row.updatedBy, who),
              })}
            </p>
            {history}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** What a save is written over: a confirmed revision and when the server wrote it (0 and 0: none yet). */
type Base = { revision: number; updatedAt: number };
const baseOf = (row: PostmortemRow | undefined): Base =>
  row && row.revision > 0
    ? { revision: row.revision, updatedAt: row.updatedAt }
    : { revision: 0, updatedAt: 0 };

function Editor({
  initial,
  layout,
  restoring,
  conflict,
  saving,
  canReload,
  onReload,
  onCancel,
  onSave,
}: {
  initial: Record<string, string>;
  layout: Layout;
  restoring?: number;
  conflict: Conflict;
  saving: boolean;
  canReload: boolean;
  onReload: () => void;
  onCancel: () => void;
  onSave: (sections: Record<string, string>) => void;
}) {
  const [sections, setSections] = useState(initial);
  const id = useId();
  const total = layout.reduce((sum, { key }) => sum + (sections[key] ?? "").trim().length, 0);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(sections);
  };
  return (
    <form className={FORM} onSubmit={submit}>
      {restoring !== undefined ? (
        <p role="status" className="flex items-start gap-2 text-muted-foreground">
          <HistoryIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {postmortemText("restoring", { count: restoring })}
        </p>
      ) : null}
      {conflict ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-destructive">
          <p className="flex items-start gap-2">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {postmortemText(conflict === "template" ? "template_changed" : "conflict")}
          </p>
          <Button type="button" variant="outline" onClick={onReload} disabled={!canReload}>
            {postmortemText("reload")}
          </Button>
        </div>
      ) : null}
      {layout.map((section, index) => {
        const value = sections[section.key] ?? "";
        const left = POSTMORTEM_SECTION_MAX - value.length;
        const hint = section.hint.trim();
        return (
          <div key={section.key} className="flex min-w-0 flex-col gap-1.5">
            <label
              htmlFor={`${id}-${section.key}`}
              className="text-sm font-medium [overflow-wrap:anywhere]"
            >
              {sectionName(section)}
            </label>
            {hint ? (
              <p
                id={`${id}-${section.key}-hint`}
                className="text-sm whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]"
              >
                {hint}
              </p>
            ) : null}
            <textarea
              id={`${id}-${section.key}`}
              aria-describedby={hint ? `${id}-${section.key}-hint` : undefined}
              className={cn(
                TEXTAREA,
                section.key === "timeline" || section.key === "summary" ? "min-h-28" : "",
              )}
              value={value}
              maxLength={POSTMORTEM_SECTION_MAX}
              // oxlint-disable-next-line jsx-a11y/no-autofocus -- the editor opens on a click to type in it
              autoFocus={index === 0}
              onChange={(event) =>
                setSections((current) => ({ ...current, [section.key]: event.target.value }))
              }
            />
            {value.length >= COUNT_FROM ? (
              <p
                className={cn(
                  "self-end text-xs tabular-nums",
                  left < 0 ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {postmortemText("chars", { count: left })}
              </p>
            ) : null}
          </div>
        );
      })}
      {total >= TOTAL_FROM ? (
        <p
          role="status"
          className={cn(
            "text-sm tabular-nums",
            total > POSTMORTEM_TOTAL_MAX ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {postmortemText("total", { count: POSTMORTEM_TOTAL_MAX - total })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? (
            <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
          ) : null}
          {postmortemText("save")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {postmortemText("cancel")}
        </Button>
      </div>
    </form>
  );
}

type Loaded =
  | { state: "loading" }
  | { state: "failed"; error: string }
  | { state: "ready"; revisions: PostmortemRevision[] };

/**
 * The postmortem's kept revisions (RFC 0013 "Revision history"), shown on demand: each with who saved it and when,
 * its text when opened, and, for those who edit, Restore, which opens that text in the editor over the current
 * revision. They are read over HTTP, not synced, and read again whenever a new revision lands while it is open.
 */
function RevisionHistory({
  workspaceId,
  incidentId,
  current,
  layout,
  who,
  canRestore,
  onRestore,
}: {
  workspaceId: string;
  incidentId: string;
  current: number;
  layout: Layout;
  who: People;
  canRestore: boolean;
  onRestore: (revision: PostmortemRevision) => void;
}) {
  const [shown, setShown] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const listId = useId();
  useEffect(() => {
    if (!shown) return;
    let live = true;
    setLoaded((previous) => (previous.state === "ready" ? previous : { state: "loading" }));
    void loadRevisions(workspaceId, incidentId).then((result) => {
      if (!live) return;
      setLoaded(
        result.ok
          ? { state: "ready", revisions: result.revisions }
          : { state: "failed", error: result.error },
      );
    });
    return () => {
      live = false;
    };
  }, [shown, workspaceId, incidentId, current]);
  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="ghost"
        className="self-start"
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        onClick={() => setShown((open) => !open)}
      >
        <HistoryIcon aria-hidden />
        {postmortemText(shown ? "history_hide" : "history")}
      </Button>
      {shown ? (
        <div id={listId} className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {postmortemText("history_note", { count: POSTMORTEM_REVISIONS_KEPT })}
          </p>
          {loaded.state === "loading" ? (
            <p role="status" className="text-muted-foreground">
              {postmortemText("history_loading")}
            </p>
          ) : loaded.state === "failed" ? (
            <p role="alert" className="text-destructive">
              {postmortemText("history_failed", { reason: mutationErrorReason(loaded.error) })}
            </p>
          ) : (
            <ol className="flex flex-col divide-y rounded-md border">
              {loaded.revisions.map((revision) => (
                <RevisionItem
                  key={revision.revision}
                  revision={revision}
                  current={revision.revision === current}
                  layout={layout}
                  who={who}
                  canRestore={canRestore}
                  onRestore={onRestore}
                />
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RevisionItem({
  revision,
  current,
  layout,
  who,
  canRestore,
  onRestore,
}: {
  revision: PostmortemRevision;
  current: boolean;
  layout: Layout;
  who: People;
  canRestore: boolean;
  onRestore: (revision: PostmortemRevision) => void;
}) {
  const { locale } = usePreferences();
  return (
    <li>
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          <span className="font-medium tabular-nums">
            {postmortemText("revision", { count: revision.revision })}
          </span>
          {current ? <Badge variant="secondary">{postmortemText("revision_current")}</Badge> : null}
          {revision.ai ? (
            <Badge variant="outline">
              <SparklesIcon aria-hidden />
              {postmortemText("revision_ai")}
            </Badge>
          ) : null}
          <span className="min-w-0 text-xs text-muted-foreground tabular-nums [overflow-wrap:anywhere]">
            {postmortemText("revision_meta", {
              time: formatDateTime(revision.savedAt, locale, TIME_ZONE),
              name: personName(revision.savedBy, who),
            })}
          </span>
        </summary>
        <div className="flex flex-col gap-3 border-t bg-muted/30 px-3 py-3">
          <dl className="flex flex-col gap-3">
            {layout.map((section) => {
              const text = revision.sections[section.key];
              return (
                <div key={section.key} className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium text-muted-foreground [overflow-wrap:anywhere]">
                    {sectionName(section)}
                  </dt>
                  <dd
                    className={cn(
                      "whitespace-pre-wrap [overflow-wrap:anywhere]",
                      !text && "text-muted-foreground italic",
                    )}
                  >
                    {text || postmortemText("section_empty")}
                  </dd>
                </div>
              );
            })}
          </dl>
          {canRestore && !current ? (
            <Button
              variant="outline"
              className="self-start"
              aria-label={postmortemText("restore_label", { count: revision.revision })}
              onClick={() => onRestore(revision)}
            >
              <RotateCcwIcon aria-hidden />
              {postmortemText("restore")}
            </Button>
          ) : null}
        </div>
      </details>
    </li>
  );
}
