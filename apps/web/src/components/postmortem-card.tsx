import { formatDateTime } from "@freecorps/brigade-i18n";
import { mutationErrorReason } from "@freecorps/brigade-i18n/incident";
import {
  can,
  canDraftPostmortem,
  draftRunning,
  isBlankPostmortem,
  POSTMORTEM_SECTION_MAX,
  POSTMORTEM_TOTAL_MAX,
  postmortemLayout,
  type IncidentRow,
  type PostmortemRow,
  type PostmortemSections,
  type PostmortemTemplateSection,
} from "@freecorps/brigade-schema";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { cn } from "cn";
import {
  FileTextIcon,
  LoaderCircleIcon,
  PencilIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { useNow } from "@/components/incidents-card";
import { usePreferences } from "@/components/preferences";
import { FORM, Refusal, TEXTAREA } from "@/components/services-card";
import { useMember } from "@/components/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { postmortemText, requestDraft, useFeatures } from "@/lib/follow-ups";
import { onlyStarters, sectionName, starterSections } from "@/lib/postmortem-templates";
import { people, personName } from "@/lib/timeline";

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
  if (code === "limit_reached" || code === "conflict" || code === "ai_unavailable") {
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
 * first draft while the document is empty (or still an unreviewed AI draft); it arrives through sync, marked as an AI
 * draft until a member saves it.
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
  const open = () => {
    if (!confirmed) return;
    setEditing({
      base: baseOf(row),
      layout,
      sections: blank
        ? starterSections(layout)
        : Object.fromEntries(layout.map(({ key }) => [key, row?.sections[key] ?? ""])),
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
    features.ai && editable && editing === null && !running && canDraftPostmortem(row);
  const failed = row?.draft?.status === "failed" ? row.draft.reason : null;
  // A pending draft past its time was lost: it reads as failed.
  const lost = row?.draft?.status === "pending" && !running;

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
            key={`${editing.base.revision}:${editing.base.updatedAt}:${keysOf(editing.layout)}`}
          />
        ) : blank ? (
          <p className="text-muted-foreground">
            {postmortemText("empty")}
            {editable ? null : ` ${postmortemText("read_only")}`}
          </p>
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
  conflict,
  saving,
  canReload,
  onReload,
  onCancel,
  onSave,
}: {
  initial: Record<string, string>;
  layout: Layout;
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
