import { formatDateTime, formatNumber, m, type Locale } from "@freecorps/brigade-i18n";
import {
  can,
  formatIncidentNumber,
  INCIDENT_ROLES,
  isActive,
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
  BellRingIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CirclePlusIcon,
  GaugeIcon,
  HeartPulseIcon,
  LoaderCircleIcon,
  MessageSquareTextIcon,
  MailWarningIcon,
  PhoneMissedIcon,
  SendIcon,
  TimerOffIcon,
  UserRoundIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { STATUS_ICONS } from "@/components/incident-badges";
import { SeverityMenu, StatusMenu } from "@/components/incident-item";
import { ANNOUNCE_MS, useNow } from "@/components/incidents-card";
import { EscalationProgress } from "@/components/escalation-progress";
import { usePreferences } from "@/components/preferences";
import { PagingCard, WhyPagedView, type PagingData } from "@/components/why-paged";
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
  mutationErrorReason,
  noticeFor,
  noticeText,
  queryErrorReason,
  type Notice,
  type NoticeTarget,
} from "@/lib/incidents";
import { usePageTitle } from "@/lib/page-title";
import {
  assignable,
  bodyParts,
  checkUpdate,
  entryTime,
  itemText,
  pagesFailedNames,
  people,
  personName,
  timelineItems,
  UPDATE_COUNT_FROM,
  updateLength,
  type People,
  type TimelineItem,
  type UpdateProblem,
} from "@/lib/timeline";

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const MAX_NOTICES = 5;
/** Characters of another member's update read out when it arrives; the rest is on the timeline. */
const ANNOUNCE_CHARS = 280;
/** More new updates from others than this at once (a resume) are announced as one count. */
const ANNOUNCE_BATCH = 3;

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
export function IncidentPage({ number, why }: { number: number | null; why?: string }) {
  usePreferences();
  return number === null ? <NotFound /> : <ByNumber number={number} why={why} />;
}

function ByNumber({ number, why }: { number: number; why?: string }) {
  const { rows, status, error } = useQuery("incident.byNumber", { number });
  const row = rows[0];
  if (row) return <Incident row={row} why={why} />;
  if (status === "error") return <LoadFailed code={error?.code} />;
  if (status === "ready") return <NotFound />;
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
  usePageTitle(m.incident_page({ part: "not_found_title" }));
  return (
    <Problem
      title={m.incident_page({ part: "not_found_title" })}
      text={m.incident_page({ part: "not_found" })}
    />
  );
}

/** The shard refused the query or failed: not the same as there being no such incident. */
function LoadFailed({ code }: { code: string | undefined }) {
  usePageTitle(m.incident_page({ part: "load_failed_title" }));
  return (
    <Problem title={m.incident_page({ part: "load_failed_title" })} text={queryErrorReason(code)} />
  );
}

function Problem({ title, text }: { title: string; text: string }) {
  return (
    <Shell>
      <h1 className="text-2xl font-semibold text-balance">{title}</h1>
      <p className="flex items-start gap-3 rounded-md bg-muted p-4 text-sm font-medium">
        <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        {text}
      </p>
    </Shell>
  );
}

/** Busy keys: `status`, `severity`, `update`, `role/<role>`. */
type Busy = ReadonlyMap<string, number>;

function Incident({ row, why }: { row: IncidentRow; why?: string }) {
  const { locale } = usePreferences();
  const member = useMember();
  const connection = useConnectionState();
  const online = connection === "open";
  const number = formatIncidentNumber(row.number) ?? "";
  usePageTitle(`${number} ${row.title}`);
  const editable = can(member.role, "incident:update");

  const members = useQuery("members.all", {});
  const who = people(member.userId, members.rows);
  const timeline = useQuery("incident.timeline", { id: row.id });
  // What the escalation card forecasts the next level from (whoever is on call now).
  const schedules = useQuery("schedules.all", {});
  const overrides = useQuery("overrides.all", {});
  // What each page did on each phone, and the phones members have (RFC 0006 "Delivery receipts").
  const deliveries = useQuery("incident.deliveries", { id: row.id });
  const devices = useQuery("devices.all", {});

  const setStatus = useMutation("incident.setStatus");
  const setSeverity = useMutation("incident.setSeverity");
  const postUpdate = useMutation("incident.postUpdate");
  const assignRole = useMutation("incident.assignRole");
  const acknowledge = useMutation("incident.ack");

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
  const [ackRefused, setAckRefused] = useState<string | null>(null);
  // Optimistic like every change here: the row says who acknowledged at once; a refusal puts it back and says why.
  const onAck = () => {
    setAckRefused(null);
    setBusy((current) => adjustBusy(current, ["ack"], 1));
    void acknowledge({ id: row.id }).then((outcome) => {
      setBusy((current) => adjustBusy(current, ["ack"], -1));
      if (outcome.ok) return;
      setAckRefused(
        outcome.error.code === "conflict"
          ? m.incident_ack({ part: "already", name: "", time: "", reason: "" })
          : m.incident_ack({
              part: "failed",
              name: "",
              time: "",
              reason: mutationErrorReason(outcome.error.code),
            }),
      );
    });
  };
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
  const saving = busy.has("status") || busy.has("severity") || busy.has("ack");
  const acked = row.acknowledgedAt != null && row.acknowledgedBy != null;
  const canAck = can(member.role, "incident:ack") && isActive(row.status) && !acked;
  const escalating = row.escalation?.status === "running" && !acked;
  const paging: PagingData = {
    incident: row,
    members: members.rows,
    devices: devices.rows,
    deliveries: deliveries.rows,
    timeline: timeline.rows,
    schedules: schedules.rows,
    now,
  };

  // Every query the explanation reads must have loaded: empty lists while they fill would read as "no phone".
  const feeds = [members, timeline, schedules, deliveries, devices];
  const pagingFailed = feeds.find((feed) => feed.status === "error");
  const pagingReady = feeds.every((feed) => feed.status === "ready");

  if (why !== undefined && row.number !== null) {
    if (pagingFailed) return <LoadFailed code={pagingFailed.error?.code} />;
    if (!pagingReady) return <Loading />;
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <WhyPagedView
          data={paging}
          who={who}
          userId={why}
          number={row.number}
          title={`${number} ${row.title}`}
          locale={locale}
          timeZone={TIME_ZONE}
          now={now}
        />
      </div>
    );
  }

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
        {canAck ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button onClick={onAck} className="max-sm:w-full">
              <BellOffIcon aria-hidden />
              {m.incident_ack({ part: "action", name: "", time: "", reason: "" })}
            </Button>
            <p className="text-sm text-muted-foreground">
              {m.incident_ack({ part: "hint", name: "", time: "", reason: "" })}
            </p>
          </div>
        ) : acked ? (
          <p className="flex items-start gap-2 text-sm font-medium">
            <BellOffIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {m.incident_ack({
                part: "by",
                name: personName(row.acknowledgedBy!, who),
                time: formatAge(Math.min(row.acknowledgedAt!, now), now, locale),
                reason: "",
              })}
            </span>
          </p>
        ) : null}
        {ackRefused ? (
          <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
            <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0">{ackRefused}</span>
          </p>
        ) : null}
        {noticesFor(["status", "severity"])}
        {editable ? null : (
          <p className="text-sm text-muted-foreground">{m.incident_page({ part: "read_only" })}</p>
        )}
      </header>

      {/* The timeline comes first in the page (and in tab order), the roles beside it from md. Phones show the roles
          above it (short, and what responders look for first); keyboards are rare there. */}
      <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_--spacing(80)]">
        <Card aria-labelledby="timeline-title">
          <CardTitle id="timeline-title" className="px-4 sm:px-6">
            {m.incident_page({ part: "timeline" })}
          </CardTitle>
          <CardContent className="flex flex-col gap-5">
            {editable ? (
              <UpdateForm
                incidentId={row.id}
                locale={locale}
                pending={busy.has("update")}
                onPost={onPost}
              />
            ) : null}
            {noticesFor(["update"])}
            <Timeline
              rows={timeline.rows}
              ready={timeline.status === "ready"}
              who={who}
              locale={locale}
              now={now}
            />
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-6 max-md:order-first">
          {/* While a run is on, the escalation and who it paged come first on wide screens, the roles after. */}
          <Card aria-labelledby="roles-title" className={cn(row.escalation && "md:order-last")}>
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
          {row.escalation ? (
            // While it is escalating, phones show it above the roles: "Level 2 in 59 seconds" is what matters then.
            <div className={cn("min-w-0", escalating && "max-md:order-first")}>
              <EscalationProgress
                run={row.escalation}
                incident={row}
                who={who}
                members={members.rows}
                schedules={schedules.rows}
                overrides={overrides.rows}
                timeline={timeline.rows}
                locale={locale}
                timeZone={TIME_ZONE}
                now={now}
              />
            </div>
          ) : null}
          {row.number !== null && pagingReady ? (
            <PagingCard data={paging} who={who} number={row.number} />
          ) : null}
        </div>
      </div>
    </Shell>
  );
}

/**
 * A role, who holds it, and (for those who may change it) a menu of the members who may hold it. Viewers get the
 * name as text. The trigger is named by the role's label and the holder, so the role is read once.
 */
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
  const labelId = useId();
  const nameId = useId();
  const label = m.incident_role({ role, form: "title" });
  const name = holder === null ? m.incident_page({ part: "nobody" }) : personName(holder, who);
  const nameClass = cn(
    "min-w-0 [overflow-wrap:anywhere]",
    holder === null ? "text-muted-foreground" : "font-medium",
  );
  if (!editable) {
    return (
      <li className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="flex items-start gap-2 py-1.5 text-sm">
          <UserRoundIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className={nameClass}>{name}</span>
        </span>
      </li>
    );
  }
  // The holder stays listed even if the shard no longer counts them as assignable (a viewer now).
  const options =
    holder === null || members.some((option) => option.id === holder)
      ? members
      : [...members, { id: holder, name, role: "viewer" as const, updatedAt: 0 }];
  return (
    // gap-2: the trigger's focus ring (3px past a 2px offset) clears the label.
    <li className="flex flex-col gap-2">
      <span id={labelId} className="text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-labelledby={`${labelId} ${nameId}`}
          render={
            // whitespace-normal: a long name wraps inside the trigger instead of pushing the chevron out.
            <Button
              variant="ghost"
              className="-ml-2 h-auto min-h-11 max-w-full justify-start gap-2 px-2 py-1.5 text-left font-normal whitespace-normal"
            />
          }
        >
          <UserRoundIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span
            id={nameId}
            className={cn(
              nameClass,
              pending && "rounded-sm outline-1 outline-offset-2 outline-current outline-dashed",
            )}
          >
            {name}
          </span>
          <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
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
  locale,
  pending,
  onPost,
}: {
  incidentId: string;
  locale: Locale;
  pending: boolean;
  onPost: (body: string) => Promise<Notice | undefined>;
}) {
  const [body, setBody] = useState("");
  const [invalid, setInvalid] = useState<{ reason: UpdateProblem; attempt: number } | null>(null);
  const fieldId = useId();
  const hintId = useId();
  const errorId = useId();
  const countId = useId();
  // No `maxLength`: it would cut a pasted update short without a word. The count shows near the limit instead,
  // and Post says it is too long.
  const length = updateLength(body);
  const counting = length >= UPDATE_COUNT_FROM;
  const over = length > UPDATE_BODY_MAX;
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
        placeholder={m.incident_page({ part: "update_placeholder" })}
        aria-invalid={invalid !== null}
        aria-describedby={[invalid && errorId, counting && countId, hintId]
          .filter(Boolean)
          .join(" ")}
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
          {invalid.reason === "long"
            ? m.auth_error_too_long({ max: formatNumber(UPDATE_BODY_MAX, locale) })
            : m.incident_page({
                part: invalid.reason === "empty" ? "update_empty" : "update_invalid",
              })}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p id={hintId} className="text-xs text-muted-foreground">
            {m.incident_page({ part: "update_hint" })}
          </p>
          {counting ? (
            <p
              id={countId}
              className={cn(
                "text-xs whitespace-nowrap tabular-nums",
                over ? "font-medium text-destructive" : "text-muted-foreground",
              )}
            >
              <span aria-hidden>
                {formatNumber(length, locale)} / {formatNumber(UPDATE_BODY_MAX, locale)}
              </span>
              <span className="sr-only">
                {m.incident_update_length({
                  count: formatNumber(length, locale),
                  max: formatNumber(UPDATE_BODY_MAX, locale),
                })}
              </span>
            </p>
          ) : null}
        </div>
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
  page_failed: PhoneMissedIcon,
  email_failed: MailWarningIcon,
  escalated: BellRingIcon,
  escalation_exhausted: TimerOffIcon,
};

/**
 * The incident's timeline, newest first: one line per change, and an update's text under its line. Another
 * member's new update is read out politely as it arrives; the entries already there when the page opened, and the
 * member's own, are not.
 */
function Timeline({
  rows,
  ready,
  who,
  locale,
  now,
}: {
  rows: readonly TimelineRow[];
  ready: boolean;
  who: People;
  locale: Locale;
  now: number;
}) {
  const announcements = useAnnouncements(rows, ready, who);
  const announcer = (
    <div aria-live="polite" className="sr-only">
      {announcements.map(({ key, text }) => (
        <p key={key}>{text}</p>
      ))}
    </div>
  );
  if (rows.length === 0) {
    return ready ? (
      <p className="text-sm text-muted-foreground">{m.incident_page({ part: "timeline_empty" })}</p>
    ) : null;
  }
  // Pages one run could not send for the same reason are one line (a SEV1 can fail for most of the workspace).
  const items = timelineItems([...rows].reverse());
  return (
    <>
      {announcer}
      <ol aria-labelledby="timeline-title" className="flex flex-col">
        {items.map((item, index) => {
          const entry = item.kind === "entry" ? item.entry : item.entries[0];
          const Icon =
            entry.kind === "status_changed" ? STATUS_ICONS[entry.to] : ENTRY_ICONS[entry.kind];
          const last = index === items.length - 1;
          return (
            <li
              key={item.kind === "entry" ? entry.id : item.key}
              className="grid grid-cols-[--spacing(8)_minmax(0,1fr)] gap-x-3"
            >
              {/* The rail: an icon per entry, joined by a line down to the next (older) one. */}
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border bg-card",
                    entry.kind === "update" && "border-primary/40 text-primary",
                    (entry.kind === "page_failed" || entry.kind === "email_failed") &&
                      "border-destructive/50 text-destructive",
                  )}
                >
                  <Icon aria-hidden className="size-4" />
                </span>
                {last ? null : <span aria-hidden className="w-px flex-1 bg-border" />}
              </div>
              <div className={cn("flex min-w-0 flex-col gap-1 pt-1.5", !last && "pb-5")}>
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="[overflow-wrap:anywhere]">{itemText(item, who)}</span>
                  <time
                    className="text-xs whitespace-nowrap text-muted-foreground tabular-nums"
                    dateTime={new Date(entry.at).toISOString()}
                    title={formatDateTime(entry.at, locale, TIME_ZONE)}
                  >
                    {entryTime(entry.at, now, locale, TIME_ZONE)}
                  </time>
                </p>
                {entry.kind === "update" ? <UpdateBody body={entry.body} /> : null}
                {item.kind === "pages_failed" ? <FailedNames item={item} who={who} /> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** Who a group of failed pages was for, behind Show names. */
function FailedNames({
  item,
  who,
}: {
  item: Extract<TimelineItem, { kind: "pages_failed" }>;
  who: People;
}) {
  const id = useId();
  const { locale } = usePreferences();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-start gap-1">
      {/* Above the list, so closing a long one leaves the button where it was tapped. */}
      <Button
        variant="link"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className="-ml-1 px-1"
        onClick={() => setOpen((shown) => !shown)}
      >
        {m.incident_page({ part: open ? "hide_names" : "show_names" })}
      </Button>
      {/* A wrapped name hangs under its first line and names are spaced apart, so one never reads as two. */}
      {open ? (
        <ul id={id} className="space-y-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {pagesFailedNames(item, who, locale).map(({ id: key, name }) => (
            <li key={key} className="pl-4 -indent-4">
              {name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * What to read out of the timeline: another member's update that arrived after the first load, for
 * `ANNOUNCE_MS`. Entries are told apart by id and author, since the member's own entry can be renumbered when
 * someone else's lands under its number first.
 */
function useAnnouncements(rows: readonly TimelineRow[], ready: boolean, who: People) {
  const seen = useRef<Set<string> | null>(null);
  const [announcements, setAnnouncements] = useState<{ key: string; text: string; at: number }[]>(
    [],
  );
  useEffect(() => {
    if (!ready) return;
    const keys = rows.map((row) => `${row.id} ${row.actor}`);
    if (seen.current === null) {
      seen.current = new Set(keys);
      return;
    }
    const known = seen.current;
    const fresh = rows.filter((row, index) => !known.has(keys[index]!));
    for (const key of keys) known.add(key);
    const theirs = fresh.filter((row) => row.kind === "update" && row.actor !== who.self);
    if (theirs.length === 0) return;
    const at = Date.now();
    // A batch (a resume after a long gap) is one line, not a screen reader reading dozens of updates.
    if (theirs.length > ANNOUNCE_BATCH) {
      setAnnouncements((current) => [
        ...current,
        {
          key: theirs.map((row) => row.id).join(" "),
          at,
          text: m.incident_updates_announced({ count: theirs.length }),
        },
      ]);
      return;
    }
    setAnnouncements((current) => [
      ...current,
      ...theirs.map((row) => {
        // By code point, so an emoji is never cut in half.
        const chars = Array.from(row.kind === "update" ? row.body : "");
        const body =
          chars.length > ANNOUNCE_CHARS
            ? `${chars.slice(0, ANNOUNCE_CHARS).join("")}…`
            : chars.join("");
        return {
          key: `${row.id} ${row.actor}`,
          at,
          text: m.incident_update_announced({ actor: personName(row.actor, who), body }),
        };
      }),
    ]);
  }, [rows, ready, who]);
  useEffect(() => {
    const oldest = announcements[0];
    if (!oldest) return;
    const timer = setTimeout(
      () => setAnnouncements((current) => current.slice(1)),
      Math.max(0, oldest.at + ANNOUNCE_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [announcements]);
  return announcements;
}

/**
 * An update's text, with its links as links (opened in a new tab), clamped to 12 lines with Show more when it is
 * longer, so one long update does not push the rest of the timeline away.
 */
function UpdateBody({ body }: { body: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    const measure = () => setClamped(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [body, expanded]);
  return (
    <div className="flex flex-col items-start gap-1">
      {/* The padding sits outside the clamped text, so no part of line 13 shows under line 12. */}
      <div className="self-stretch rounded-md bg-muted px-3 py-2">
        <p
          ref={ref}
          id={id}
          className={cn(
            "whitespace-pre-wrap [overflow-wrap:anywhere]",
            !expanded && "line-clamp-12",
          )}
        >
          {bodyParts(body).map((part, index) =>
            "url" in part ? (
              <a
                key={index}
                href={part.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm text-primary underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring"
              >
                {part.url}
              </a>
            ) : (
              <Fragment key={index}>{part.text}</Fragment>
            ),
          )}
        </p>
      </div>
      {clamped || expanded ? (
        <Button
          variant="link"
          aria-expanded={expanded}
          aria-controls={id}
          className="-ml-1 px-1"
          onClick={() => setExpanded((open) => !open)}
        >
          {m.incident_page({ part: expanded ? "show_less" : "show_more" })}
        </Button>
      ) : null}
    </div>
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
