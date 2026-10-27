import { m } from "@freecorps/brigade-i18n";
import { mutationErrorReason } from "@freecorps/brigade-i18n/incident";
import {
  can,
  formatIncidentNumber,
  FOLLOW_UP_TITLE_MAX,
  isFieldLink,
  isOverdue,
  MAX_FOLLOW_UPS_PER_INCIDENT,
  type FollowUpRow,
  type IncidentRow,
  type MemberRow,
} from "@freecorps/brigade-schema";
import type { MutationOutcome } from "@freecorps/brigade-sync";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ArrowLeftIcon,
  CalendarClockIcon,
  CircleCheckIcon,
  CircleIcon,
  ExternalLinkIcon,
  ListTodoIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { useNow } from "@/components/incidents-card";
import { usePreferences } from "@/components/preferences";
import { FORM, Refusal, SELECT } from "@/components/services-card";
import { useMember } from "@/components/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import {
  followUpText,
  formatDueDate,
  linkProblem,
  localDate,
  newFollowUpId,
} from "@/lib/follow-ups";
import { queryErrorReason } from "@/lib/incidents";
import { usePageTitle } from "@/lib/page-title";
import { assignable } from "@/lib/timeline";

type Draft = { title: string; ownerId: string; dueDate: string; link: string };
const EMPTY: Draft = { title: "", ownerId: "", dueDate: "", link: "" };

const draftOf = (row: FollowUpRow): Draft => ({
  title: row.title,
  ownerId: row.ownerId ?? "",
  dueDate: row.dueDate ?? "",
  link: row.link ?? "",
});

const argsOf = (draft: Draft) => ({
  title: draft.title.trim(),
  ownerId: draft.ownerId || null,
  dueDate: draft.dueDate || null,
  link: draft.link.trim() || null,
});

/** The owner as a short label: the member's name, "Former member" for one the shard no longer has. */
function ownerName(ownerId: string, members: readonly MemberRow[]): string {
  const member = members.find((one) => one.id === ownerId);
  if (!member) return followUpText("owner_former");
  return member.name ?? m.incident_page({ part: "unnamed" });
}

/**
 * An incident's follow-ups (RFC 0013): what it leaves to do, each with an owner, a due date and an optional issue
 * link. Responders and up add, edit, complete and remove them; every change lands on the timeline. An open one past
 * its due date on the reader's calendar is flagged as overdue.
 */
export function FollowUpsCard({ incident }: { incident: IncidentRow }) {
  const { role } = useMember();
  const { locale } = usePreferences();
  const editable = can(role, "incident:update");
  const followUps = useQuery("incident.followUps", { id: incident.id });
  const members = useQuery("members.all", {});
  const create = useMutation("followUp.create");
  const update = useMutation("followUp.update");
  const setStatus = useMutation("followUp.setStatus");
  const remove = useMutation("followUp.delete");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const now = useNow(60_000);
  const today = localDate(now);
  const report = (name: string) => (outcome: MutationOutcome) => {
    if (!outcome.ok) {
      setRefused(
        followUpText("change_failed", { name, reason: mutationErrorReason(outcome.error.code) }),
      );
    }
    return outcome;
  };
  const rows = followUps.rows;
  const done = rows.filter((row) => row.status === "done").length;
  const full = rows.length >= MAX_FOLLOW_UPS_PER_INCIDENT;
  const owners = assignable(members.rows);

  return (
    <Card aria-labelledby="follow-ups-title">
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <CardTitle id="follow-ups-title">{followUpText("title")}</CardTitle>
          {done > 0 ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {followUpText("done_count", { count: `${done}/${rows.length}` })}
            </span>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{followUpText("description")}</p>
      </div>
      <CardContent className="flex flex-col gap-4 text-sm">
        {refused ? <Refusal text={refused} onDismiss={() => setRefused(null)} /> : null}
        {followUps.status === "error" ? (
          <p className="text-muted-foreground">
            {followUpText("load_failed", { reason: queryErrorReason(followUps.error?.code) })}
          </p>
        ) : rows.length === 0 && followUps.status === "ready" && !adding ? (
          <p className="text-muted-foreground">{followUpText("empty")}</p>
        ) : null}
        {rows.length > 0 ? (
          <ul className="-mx-4 flex flex-col divide-y border-y sm:-mx-6">
            {rows.map((row) =>
              editing === row.id ? (
                <li key={row.id} className="px-4 py-3 sm:px-6">
                  <FollowUpForm
                    initial={draftOf(row)}
                    members={owners}
                    onCancel={() => setEditing(null)}
                    onSubmit={(draft) => {
                      setEditing(null);
                      void update({ id: row.id, ...argsOf(draft) }).then(report(row.title));
                    }}
                  />
                </li>
              ) : (
                <FollowUpItem
                  key={row.id}
                  row={row}
                  members={members.rows}
                  today={today}
                  locale={locale}
                  editable={editable}
                  onToggle={() =>
                    void setStatus({
                      id: row.id,
                      status: row.status === "open" ? "done" : "open",
                    }).then(report(row.title))
                  }
                  onEdit={() => setEditing(row.id)}
                  onDelete={() => {
                    if (window.confirm(followUpText("delete_confirm", { name: row.title }))) {
                      void remove({ id: row.id }).then(report(row.title));
                    }
                  }}
                />
              ),
            )}
          </ul>
        ) : null}
        {editable && adding ? (
          <FollowUpForm
            initial={EMPTY}
            members={owners}
            onCancel={() => setAdding(false)}
            onSubmit={(draft) => {
              setAdding(false);
              void create({
                id: newFollowUpId(Date.now()),
                incidentId: incident.id,
                ...argsOf(draft),
              }).then(report(draft.title.trim()));
            }}
          />
        ) : editable ? (
          full ? (
            <p className="text-muted-foreground">{followUpText("limit")}</p>
          ) : (
            <Button variant="outline" className="self-start" onClick={() => setAdding(true)}>
              <PlusIcon aria-hidden />
              {followUpText("add")}
            </Button>
          )
        ) : (
          <p className="text-xs text-muted-foreground">{followUpText("read_only")}</p>
        )}
      </CardContent>
    </Card>
  );
}

function FollowUpItem({
  row,
  members,
  today,
  locale,
  editable,
  onToggle,
  onEdit,
  onDelete,
  incidentLabel,
}: {
  row: FollowUpRow;
  members: readonly MemberRow[];
  today: string;
  locale: ReturnType<typeof usePreferences>["locale"];
  editable: boolean;
  onToggle?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /** On the workspace-wide list: the incident it belongs to, linked. */
  incidentLabel?: { number: number | null; title: string };
}) {
  const done = row.status === "done";
  const overdue = isOverdue(row, today);
  const link = row.link && isFieldLink(row.link) ? row.link : null;
  const StatusIcon = done ? CircleCheckIcon : CircleIcon;
  return (
    <li className="flex items-start gap-2 px-2 py-2 sm:px-4">
      {editable && onToggle ? (
        <Button
          variant="ghost"
          size="icon"
          aria-pressed={done}
          aria-label={followUpText(done ? "mark_open" : "mark_done", { name: row.title })}
          onClick={onToggle}
          className="shrink-0"
        >
          <StatusIcon
            aria-hidden
            className={cn("size-5", done ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}
          />
        </Button>
      ) : (
        <span className="flex size-11 shrink-0 items-center justify-center">
          <StatusIcon
            aria-hidden
            className={cn("size-5", done ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}
          />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-2.5">
        {incidentLabel && row.incidentId ? (
          <IncidentLink incidentId={row.incidentId} label={incidentLabel} />
        ) : null}
        <p
          className={cn(
            "font-medium [overflow-wrap:anywhere]",
            done && "text-muted-foreground line-through decoration-muted-foreground/60",
          )}
        >
          {row.title}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1">
            <UserRoundIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {row.ownerId ? ownerName(row.ownerId, members) : followUpText("no_owner")}
            </span>
          </span>
          {done && row.doneAt !== null ? (
            <span className="whitespace-nowrap">
              {followUpText("done_on", { date: formatDueDate(localDate(row.doneAt), locale) })}
            </span>
          ) : row.dueDate ? (
            overdue ? (
              <Badge variant="destructive" className="gap-1">
                <CalendarClockIcon aria-hidden className="size-3.5" />
                {followUpText("overdue", { date: formatDueDate(row.dueDate, locale) })}
              </Badge>
            ) : (
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <CalendarClockIcon aria-hidden className="size-3.5" />
                {followUpText("due_on", { date: formatDueDate(row.dueDate, locale) })}
              </span>
            )
          ) : null}
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex min-h-6 items-center gap-1 font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:underline"
            >
              <ExternalLinkIcon aria-hidden className="size-3.5" />
              {followUpText("open_link")}
            </a>
          ) : null}
        </p>
      </div>
      {editable && onEdit && onDelete ? (
        <div className="flex shrink-0">
          <Button
            variant="ghost"
            size="icon"
            aria-label={followUpText("edit", { name: row.title })}
            onClick={onEdit}
          >
            <PencilIcon aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={followUpText("delete", { name: row.title })}
            onClick={onDelete}
          >
            <Trash2Icon aria-hidden />
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function IncidentLink({
  incidentId,
  label,
}: {
  incidentId: string;
  label: { number: number | null; title: string };
}) {
  const text = `${formatIncidentNumber(label.number) ?? ""} ${label.title}`.trim();
  return label.number !== null ? (
    <Link
      to="/incidents/$number"
      params={{ number: String(label.number) }}
      className="line-clamp-1 text-xs font-medium text-muted-foreground outline-none [overflow-wrap:anywhere] hover:text-foreground hover:underline focus-visible:underline"
      data-incident={incidentId}
    >
      {text}
    </Link>
  ) : (
    <span className="line-clamp-1 text-xs text-muted-foreground">{text}</span>
  );
}

function FollowUpForm({
  initial,
  members,
  onCancel,
  onSubmit,
}: {
  initial: Draft;
  members: readonly MemberRow[];
  onCancel: () => void;
  onSubmit: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [tried, setTried] = useState(false);
  const ownerId = useId();
  const linkError = linkProblem(draft.link);
  const empty = draft.title.trim() === "";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (empty || linkError) return;
    onSubmit(draft);
  };
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  return (
    <form className={FORM} onSubmit={submit} noValidate>
      <Field
        label={followUpText("title_label")}
        placeholder={followUpText("title_placeholder")}
        value={draft.title}
        maxLength={FOLLOW_UP_TITLE_MAX}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the form opens on a click to type in it
        autoFocus
        required
        error={tried && empty ? followUpText("title_required") : undefined}
        onChange={(event) => set({ title: event.target.value })}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={ownerId} className="text-sm font-medium">
            {followUpText("owner_label")}
          </label>
          <select
            id={ownerId}
            className={SELECT}
            value={draft.ownerId}
            onChange={(event) => set({ ownerId: event.target.value })}
          >
            <option value="">{followUpText("no_owner")}</option>
            {/* An owner who left stays selectable while the follow-up still names them. */}
            {draft.ownerId && !members.some((one) => one.id === draft.ownerId) ? (
              <option value={draft.ownerId}>{followUpText("owner_former")}</option>
            ) : null}
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name ?? m.incident_page({ part: "unnamed" })}
              </option>
            ))}
          </select>
        </div>
        <Field
          type="date"
          label={followUpText("due_label")}
          value={draft.dueDate}
          min="2000-01-01"
          max="2099-12-31"
          onChange={(event) => set({ dueDate: event.target.value })}
        />
      </div>
      <Field
        type="url"
        inputMode="url"
        label={followUpText("link_label")}
        placeholder={followUpText("link_placeholder")}
        value={draft.link}
        error={tried ? linkError : undefined}
        onChange={(event) => set({ link: event.target.value })}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit">{followUpText("save")}</Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {followUpText("cancel")}
        </Button>
      </div>
    </form>
  );
}

/**
 * Every open follow-up in the workspace, soonest due first (RFC 0013), with the incident each belongs to. `limit`
 * shows the first few, for the overview's card, with a link to the full list; without it, all of them.
 */
export function OpenFollowUps({ limit }: { limit?: number }) {
  const { role, userId } = useMember();
  const { locale } = usePreferences();
  const editable = can(role, "incident:update");
  const open = useQuery("followUps.open", {});
  const members = useQuery("members.all", {});
  const setStatus = useMutation("followUp.setStatus");
  const [mine, setMine] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const now = useNow(60_000);
  const today = localDate(now);
  const rows = open.rows.filter((row) => !mine || row.ownerId === userId);
  const shown = limit === undefined ? rows : rows.slice(0, limit);
  const overdue = open.rows.filter((row) => isOverdue(row, today)).length;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {overdue > 0 ? (
          <Badge variant="destructive" className="tabular-nums">
            {followUpText("overdue_count", { count: overdue })}
          </Badge>
        ) : null}
        <label className="ml-auto inline-flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={mine}
            onChange={(event) => setMine(event.target.checked)}
          />
          {followUpText("mine")}
        </label>
      </div>
      {refused ? <Refusal text={refused} onDismiss={() => setRefused(null)} /> : null}
      {open.status === "error" ? (
        <p className="text-muted-foreground">
          {followUpText("load_failed", { reason: queryErrorReason(open.error?.code) })}
        </p>
      ) : open.status !== "ready" ? (
        <p className="text-muted-foreground">{followUpText("loading")}</p>
      ) : shown.length === 0 ? (
        <p className="flex items-start gap-2 text-muted-foreground">
          <ListTodoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {followUpText("open_empty")}
        </p>
      ) : (
        <ul className="-mx-4 flex flex-col divide-y border-y sm:-mx-6">
          {shown.map((row) => (
            <FollowUpItem
              key={row.id}
              row={row}
              members={members.rows}
              today={today}
              locale={locale}
              editable={editable}
              incidentLabel={{ number: row.incidentNumber, title: row.incidentTitle }}
              onToggle={() =>
                void setStatus({ id: row.id, status: "done" }).then((outcome) => {
                  if (!outcome.ok) {
                    setRefused(
                      followUpText("change_failed", {
                        name: row.title,
                        reason: mutationErrorReason(outcome.error.code),
                      }),
                    );
                  }
                })
              }
            />
          ))}
        </ul>
      )}
      {limit !== undefined && rows.length > 0 ? (
        <Link
          to="/follow-ups"
          className="inline-flex min-h-11 items-center self-start text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:underline"
        >
          {followUpText("open_link_all")}
          {rows.length > limit ? ` (${rows.length})` : ""}
        </Link>
      ) : null}
    </div>
  );
}

/** The overview's card: the soonest open follow-ups, hidden while there are none and none was ever added. */
export function OpenFollowUpsCard() {
  const open = useQuery("followUps.open", {});
  if (open.status === "ready" && open.rows.length === 0) return null;
  return (
    <Card aria-labelledby="open-follow-ups-title">
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <CardTitle id="open-follow-ups-title">{followUpText("open_title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{followUpText("open_description")}</p>
      </div>
      <CardContent>
        <OpenFollowUps limit={5} />
      </CardContent>
    </Card>
  );
}

/** `/follow-ups`: the workspace's open follow-ups, all of them. */
export function OpenFollowUpsPage() {
  usePreferences();
  usePageTitle(followUpText("open_title"));
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <Link
        to="/"
        className="-ml-1 inline-flex min-h-11 items-center gap-2 self-start rounded-md px-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        {followUpText("back")}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{followUpText("open_title")}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          {followUpText("open_description")}
        </p>
      </div>
      <Card>
        <CardContent>
          <OpenFollowUps />
        </CardContent>
      </Card>
    </div>
  );
}
