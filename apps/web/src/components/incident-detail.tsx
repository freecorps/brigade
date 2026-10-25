import { formatDateTime, m, type Locale } from "@freecorps/brigade-i18n";
import {
  can,
  formatIncidentNumber,
  INCIDENT_ROLES,
  UPDATE_BODY_MAX,
  type IncidentRole,
  type IncidentRow,
  type IncidentStatus,
  type MemberRow,
  type Severity,
  type TimelineRow,
} from "@freecorps/brigade-schema";
import type { MutationOutcome } from "@freecorps/brigade-sync";
import { useConnectionState, useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ArrowLeftIcon,
  BellOffIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CirclePlusIcon,
  GaugeIcon,
  HeartPulseIcon,
  LoaderCircleIcon,
  MessageSquareTextIcon,
  SendIcon,
  UserRoundIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { STATUS_ICONS } from "@/components/incident-badges";
import { SeverityMenu, StatusMenu } from "@/components/incident-item";
import { useNow } from "@/components/incidents-card";
import { usePreferences } from "@/components/preferences";
import { useMember } from "@/components/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  adjustBusy,
  formatAge,
  noticeFor,
  noticeText,
  type Notice,
  type NoticeTarget,
} from "@/lib/incidents";
import { usePageTitle } from "@/lib/page-title";
import {
  assignable,
  checkUpdate,
  entryText,
  people,
  personName,
  type People,
} from "@/lib/timeline";

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const MAX_NOTICES = 5;

/** `/incidents/12` → 12; anything else (zero, signs, leading zeros, too long) is no incident. */
export function parseIncidentNumber(raw: string): number | null {
  if (!/^[1-9][0-9]{0,15}$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}

/**
 * One incident by its number (RFC 0003): title, severity and status (changed from here too), its roles, and its
 * timeline with the written updates, newest first. Everything is live from the workspace shard, and every change
 * shows at once and settles when the shard confirms it, like the incident list.
 */
export function IncidentPage({ number }: { number: number | null }) {
  usePreferences();
  return number === null ? <NotFound /> : <ByNumber number={number} />;
}

function ByNumber({ number }: { number: number }) {
  const { rows, status } = useQuery("incident.byNumber", { number });
  const row = rows[0];
  if (row) return <Incident row={row} />;
  if (status === "ready" || status === "error") return <NotFound />;
  return <Loading />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <Link
        to="/"
        className="-ml-1 inline-flex min-h-11 items-center gap-2 self-start rounded-md px-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        {m.incident_page({ part: "back" })}
      </Link>
      {children}
    </div>
  );
}

function Loading() {
  usePageTitle(m.incident_page({ part: "*" }));
  return (
    <Shell>
      <p role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
        <LoaderCircleIcon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
        {m.incident_page({ part: "loading" })}
      </p>
    </Shell>
  );
}

function NotFound() {
  usePageTitle(m.incident_page({ part: "*" }));
  return (
    <Shell>
      <p className="flex items-start gap-3 rounded-md bg-muted p-4 text-sm font-medium">
        <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        {m.incident_page({ part: "not_found" })}
      </p>
    </Shell>
  );
}

/** Busy keys: `status`, `severity`, `update`, `role/<role>`. */
type Busy = ReadonlyMap<string, number>;

function Incident({ row }: { row: IncidentRow }) {
  const { locale } = usePreferences();
  const member = useMember();
  const connection = useConnectionState();
  const online = connection === "open";
  const number = formatIncidentNumber(row.number) ?? "";
  usePageTitle(`${number} ${row.title}`);
  const editable = can(member.role, "incident:update");

  const members = useQuery("members.all", {});
  const who = people(member.userId, members.rows);

  const setStatus = useMutation("incident.setStatus");
  const setSeverity = useMutation("incident.setSeverity");
  const postUpdate = useMutation("incident.postUpdate");
  const assignRole = useMutation("incident.assignRole");

  const [busy, setBusy] = useState<Busy>(new Map());
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextKey = useRef(0);
  const track = useCallback(
    (outcome: Promise<MutationOutcome>, target: NoticeTarget, key: string) => {
      setBusy((current) => adjustBusy(current, [key], 1));
      return outcome.then((result) => {
        setBusy((current) => adjustBusy(current, [key], -1));
        const notice = noticeFor(result, target, `n${nextKey.current++}`);
        if (notice) setNotices((current) => [...current, notice].slice(-MAX_NOTICES));
        return notice;
      });
    },
    [],
  );
  const base = { incidentId: row.id, number: row.number, title: row.title };
  const onStatus = (next: IncidentStatus) =>
    void track(
      setStatus({ id: row.id, status: next }),
      { ...base, kind: "status", to: next },
      "status",
    );
  const onSeverity = (next: Severity) =>
    void track(
      setSeverity({ id: row.id, severity: next }),
      { ...base, kind: "severity", to: next },
      "severity",
    );
  const onAssign = (role: IncidentRole, userId: string | null) =>
    void track(
      assignRole({ id: row.id, role, userId }),
      { ...base, kind: "role", role },
      `role/${role}`,
    );
  const onPost = (body: string) =>
    track(postUpdate({ id: row.id, body }), { ...base, kind: "update" }, "update");
  const dismiss = (key: string) =>
    setNotices((current) => current.filter((notice) => notice.key !== key));
  const noticesFor = (kinds: Notice["kind"][]) => (
    <NoticeList
      notices={notices.filter((notice) => kinds.includes(notice.kind))}
      onDismiss={dismiss}
    />
  );

  const now = useNow(20_000);
  const declared = formatAge(Math.min(row.declaredAt, now), now, locale);
  const saving = busy.has("status") || busy.has("severity");

  return (
    <Shell>
      <header className="flex flex-col gap-3">
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground tabular-nums">
          <span className="font-medium whitespace-nowrap">{number}</span>
          <span aria-hidden>·</span>
          <time
            className="whitespace-nowrap"
            dateTime={new Date(row.declaredAt).toISOString()}
            title={formatDateTime(row.declaredAt, locale, TIME_ZONE)}
          >
            {m.incident_declared({ time: declared })}
          </time>
          {saving ? (
            <span className="whitespace-nowrap">
              <span aria-hidden>· </span>
              {online ? m.incident_change_saving() : m.incident_change_queued()}
            </span>
          ) : null}
        </p>
        <h1 className="text-2xl font-semibold text-balance [overflow-wrap:anywhere]">
          {row.title}
        </h1>
        <div className="-ml-1.5 flex flex-wrap items-center gap-1">
          <SeverityMenu
            severity={row.severity}
            pending={busy.has("severity")}
            disabled={!editable}
            onChange={onSeverity}
          />
          <StatusMenu
            status={row.status}
            pending={busy.has("status")}
            disabled={!editable}
            onChange={onStatus}
          />
        </div>
        {noticesFor(["status", "severity"])}
        {editable ? null : (
          <p className="text-sm text-muted-foreground">{m.incident_page({ part: "read_only" })}</p>
        )}
      </header>

      {/* Phones: roles above the timeline (short, and what responders look for first); from md a side column. */}
      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_--spacing(80)]">
        <Card aria-labelledby="roles-title" className="md:order-2">
          <CardTitle id="roles-title" className="px-4 sm:px-6">
            {m.incident_page({ part: "roles" })}
          </CardTitle>
          <CardContent className="flex flex-col gap-4">
            <ul className="flex flex-col gap-3">
              {INCIDENT_ROLES.map((role) => (
                <RoleRow
                  key={role}
                  role={role}
                  holder={row.roles?.[role] ?? null}
                  who={who}
                  members={assignable(members.rows)}
                  pending={busy.has(`role/${role}`)}
                  editable={editable}
                  onAssign={onAssign}
                />
              ))}
            </ul>
            {members.status === "ready" && assignable(members.rows).length <= 1 ? (
              <p className="text-xs text-muted-foreground">
                {m.incident_page({ part: "no_members" })}
              </p>
            ) : null}
            {noticesFor(["role"])}
          </CardContent>
        </Card>

        <Card aria-labelledby="timeline-title" className="md:order-1">
          <CardTitle id="timeline-title" className="px-4 sm:px-6">
            {m.incident_page({ part: "timeline" })}
          </CardTitle>
          <CardContent className="flex flex-col gap-5">
            {editable ? (
              <UpdateForm incidentId={row.id} pending={busy.has("update")} onPost={onPost} />
            ) : null}
            {noticesFor(["update"])}
            <Timeline incidentId={row.id} who={who} locale={locale} now={now} />
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}

/** A role, who holds it, and (for those who may change it) a menu of the members who may hold it. */
function RoleRow({
  role,
  holder,
  who,
  members,
  pending,
  editable,
  onAssign,
}: {
  role: IncidentRole;
  holder: string | null;
  who: People;
  members: readonly MemberRow[];
  pending: boolean;
  editable: boolean;
  onAssign: (role: IncidentRole, userId: string | null) => void;
}) {
  const label = m.incident_role({ role });
  const name = holder === null ? m.incident_page({ part: "nobody" }) : personName(holder, who);
  // The holder stays listed even if the shard no longer counts them as assignable (a viewer now).
  const options =
    holder === null || members.some((option) => option.id === holder)
      ? members
      : [...members, { id: holder, name, role: "viewer" as const, updatedAt: 0 }];
  return (
    <li className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={!editable}
          render={
            <Button
              variant="ghost"
              className="-ml-2 h-auto min-h-11 max-w-full justify-start gap-2 px-2 py-1.5 text-left font-normal"
            />
          }
        >
          <span className="sr-only">{label}: </span>
          <UserRoundIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span
            className={cn(
              "min-w-0 [overflow-wrap:anywhere]",
              holder === null ? "text-muted-foreground" : "font-medium",
              pending && "rounded-sm outline-1 outline-offset-2 outline-current outline-dashed",
            )}
          >
            {name}
          </span>
          {editable ? (
            <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-w-[min(20rem,calc(100vw-2rem))]">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{label}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={holder ?? ""}
              onValueChange={(value: string) => {
                const next = value === "" ? null : value;
                if (next !== holder) onAssign(role, next);
              }}
            >
              <DropdownMenuRadioItem value="" closeOnClick>
                <span className="text-muted-foreground">{m.incident_page({ part: "nobody" })}</span>
              </DropdownMenuRadioItem>
              {options.map((option) => (
                <DropdownMenuRadioItem key={option.id} value={option.id} closeOnClick>
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {personName(option.id, who)}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/**
 * A text box and Post. Text the shard would refuse is caught here and stays; a refusal from the shard gives the
 * text back unless something new was typed. Ctrl+Enter (⌘+Enter) posts; Enter is a new line.
 */
function UpdateForm({
  incidentId,
  pending,
  onPost,
}: {
  incidentId: string;
  pending: boolean;
  onPost: (body: string) => Promise<Notice | undefined>;
}) {
  const [body, setBody] = useState("");
  const [invalid, setInvalid] = useState<{ reason: "empty" | "invalid"; attempt: number } | null>(
    null,
  );
  const fieldId = useId();
  const hintId = useId();
  const errorId = useId();
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const checked = checkUpdate(incidentId, body);
    if (!checked.ok) {
      setInvalid((current) => ({ reason: checked.reason, attempt: (current?.attempt ?? 0) + 1 }));
      ref.current?.focus();
      return;
    }
    setInvalid(null);
    const typed = body;
    setBody("");
    void onPost(checked.args.body).then((notice) => {
      if (notice?.reason === "invalid_args")
        setBody((current) => (current === "" ? typed : current));
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-xs font-medium text-muted-foreground">
        {m.incident_page({ part: "update_label" })}
      </label>
      <textarea
        ref={ref}
        id={fieldId}
        value={body}
        onChange={(event) => {
          setBody(event.target.value);
          if (invalid) setInvalid(null);
        }}
        onKeyDown={onKeyDown}
        rows={3}
        maxLength={UPDATE_BODY_MAX}
        placeholder={m.incident_page({ part: "update_placeholder" })}
        aria-invalid={invalid !== null}
        aria-describedby={invalid ? `${errorId} ${hintId}` : hintId}
        // 16px: iOS zooms into smaller inputs. Grows with the text up to a limit, then scrolls.
        className="field-sizing-content max-h-80 min-h-24 w-full min-w-0 resize-y rounded-md border border-input bg-card px-3 py-2.5 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive"
      />
      {invalid ? (
        <p
          key={invalid.attempt}
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-sm text-destructive"
        >
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {m.incident_page({
            part: invalid.reason === "empty" ? "update_empty" : "update_invalid",
          })}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p id={hintId} className="text-xs text-muted-foreground">
          {m.incident_page({ part: "update_hint" })}
        </p>
        <Button type="submit" className="max-sm:w-full">
          {pending ? (
            <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
          ) : (
            <SendIcon aria-hidden />
          )}
          {m.incident_page({ part: "post" })}
        </Button>
      </div>
    </form>
  );
}

const ENTRY_ICONS: Record<Exclude<TimelineRow["kind"], "status_changed">, LucideIcon> = {
  declared: CirclePlusIcon,
  severity_changed: GaugeIcon,
  acknowledged: BellOffIcon,
  role_assigned: UserRoundIcon,
  update: MessageSquareTextIcon,
  alert_resolved: HeartPulseIcon,
};

/** The incident's timeline, newest first: one line per change, and an update's text under its line. */
function Timeline({
  incidentId,
  who,
  locale,
  now,
}: {
  incidentId: string;
  who: People;
  locale: Locale;
  now: number;
}) {
  const { rows, status } = useQuery("incident.timeline", { id: incidentId });
  if (rows.length === 0) {
    return status === "ready" ? (
      <p className="text-sm text-muted-foreground">{m.incident_page({ part: "timeline_empty" })}</p>
    ) : null;
  }
  const entries = [...rows].reverse();
  return (
    <ol aria-labelledby="timeline-title" className="flex flex-col">
      {entries.map((entry, index) => {
        const Icon =
          entry.kind === "status_changed" ? STATUS_ICONS[entry.to] : ENTRY_ICONS[entry.kind];
        const last = index === entries.length - 1;
        return (
          <li key={entry.id} className="grid grid-cols-[--spacing(8)_minmax(0,1fr)] gap-x-3">
            {/* The rail: an icon per entry, joined by a line down to the next (older) one. */}
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full border bg-card",
                  entry.kind === "update" && "border-primary/40 text-primary",
                )}
              >
                <Icon aria-hidden className="size-4" />
              </span>
              {last ? null : <span aria-hidden className="w-px flex-1 bg-border" />}
            </div>
            <div className={cn("flex min-w-0 flex-col gap-1 pt-1.5", !last && "pb-5")}>
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="[overflow-wrap:anywhere]">{entryText(entry, who)}</span>
                <time
                  className="text-xs whitespace-nowrap text-muted-foreground"
                  dateTime={new Date(entry.at).toISOString()}
                  title={formatDateTime(entry.at, locale, TIME_ZONE)}
                >
                  {formatAge(Math.min(entry.at, now), now, locale)}
                </time>
              </p>
              {entry.kind === "update" ? (
                <p className="rounded-md bg-muted px-3 py-2 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {entry.body}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Refused changes, each read out once as it arrives and dismissable. */
function NoticeList({
  notices,
  onDismiss,
}: {
  notices: readonly Notice[];
  onDismiss: (key: string) => void;
}) {
  if (notices.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {notices.map((notice) => (
        <li
          key={notice.key}
          className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 py-1 pr-1 pl-3 text-sm"
        >
          <CircleAlertIcon aria-hidden className="mt-2.5 size-4 shrink-0 text-destructive" />
          <p role="alert" className="min-w-0 flex-1 py-2 [overflow-wrap:anywhere]">
            {noticeText(notice, "row")}
          </p>
          <Button
            variant="ghost"
            size="icon"
            aria-label={m.dismiss()}
            onClick={() => onDismiss(notice.key)}
          >
            <XIcon aria-hidden />
          </Button>
        </li>
      ))}
    </ul>
  );
}
