import { formatDateTime, formatNumber, m, type Locale } from "@freecorps/brigade-i18n";
import { roleLabel } from "@freecorps/brigade-i18n/incident";
import {
  can,
  formatIncidentNumber,
  incidentRoleList,
  isActive,
  missingRoles,
  PAGE_AGAIN_CONFLICTS,
  UPDATE_BODY_MAX,
  type IncidentRow,
  type IncidentStatus,
  type MemberRow,
  type Role,
  type RoleDefinition,
  type Severity,
  type TimelineRow,
} from "@freecorps/brigade-schema";
import type { MutationOutcome } from "@freecorps/brigade-sync";
import { useConnectionState, useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ArrowLeftIcon,
  BellCheckIcon,
  BellPlusIcon,
  BellOffIcon,
  BellRingIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleDotIcon,
  CirclePlusIcon,
  FileTextIcon,
  GaugeIcon,
  GlobeIcon,
  HeartPulseIcon,
  LayersIcon,
  ListTodoIcon,
  LoaderCircleIcon,
  MessageSquareTextIcon,
  MailWarningIcon,
  MessageSquareWarningIcon,
  PencilLineIcon,
  PhoneCallIcon,
  PhoneMissedIcon,
  SendIcon,
  SquarePenIcon,
  TagIcon,
  TimerOffIcon,
  TriangleAlertIcon,
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
import { IncidentDetailsCard } from "@/components/incident-details";
import { IncidentExportButton } from "@/components/export-card";
import { FollowUpsCard } from "@/components/follow-ups-card";
import { PostmortemCard } from "@/components/postmortem-card";
import { usePreferences } from "@/components/preferences";
import { StatusPublishCard } from "@/components/status-publish";
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
import { catalogText } from "@/lib/catalog";
import { usePageTitle } from "@/lib/page-title";
import {
  assignable,
  bodyParts,
  checkEdit,
  checkUpdate,
  entryTime,
  itemText,
  pageAgainEntries,
  pagesFailedNames,
  people,
  personName,
  timelineItems,
  UPDATE_COUNT_FROM,
  updateActions,
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
  // API tokens (RFC 0014) act too: their entries read "API token <name> (by Ana)".
  const tokens = useQuery("apiToken.all", {});
  const who = people(member.userId, members.rows, tokens.rows);
  const timeline = useQuery("incident.timeline", { id: row.id });
  // What the escalation card forecasts the next level from (whoever is on call now).
  const schedules = useQuery("schedules.all", {});
  const overrides = useQuery("overrides.all", {});
  // What each page did on each phone, and the phones members have (RFC 0006 "Delivery receipts").
  const deliveries = useQuery("incident.deliveries", { id: row.id });
  const devices = useQuery("devices.all", {});
  // Which pages ring each member as a call (RFC 0010), for the explanation's calls line.
  const memberSettings = useQuery("members.settings", {});
  // Which roles it lists, by its type (RFC 0003 "Role definitions"); `incident.assignRole` checks them on this client.
  const roleRows = useQuery("incidentRoles.all", {});
  const types = useQuery("incidentTypes.all", {});
  const roles = incidentRoleList(row, types.rows, roleRows.rows);
  const missing = new Set(missingRoles(row, types.rows, roleRows.rows).map((role) => role.id));

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
  const onAssign = (role: RoleDefinition, userId: string | null) =>
    void track(
      assignRole({ id: row.id, role: role.id, userId }),
      { ...base, kind: "role", role: role.id, roleName: role.name },
      `role/${role.id}`,
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
  // Owners and admins page a failed page again while the incident still waits for someone (RFC 0005 "Notifiers").
  const canPageAgain = can(member.role, "escalation:manage") && isActive(row.status) && !acked;
  const paging: PagingData = {
    incident: row,
    members: members.rows,
    devices: devices.rows,
    deliveries: deliveries.rows,
    timeline: timeline.rows,
    schedules: schedules.rows,
    // Optional: without them every member reads as the default choice of calls.
    settings: memberSettings.status === "ready" ? memberSettings.rows : undefined,
    now,
  };

  // Every query the explanation needs must have loaded: empty lists while they fill would read as "no phone". The
  // members' call choices are not needed: a failure there never hides why someone was or was not paged.
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
              pageAgain={canPageAgain ? row.id : undefined}
              incidentId={row.id}
              role={member.role}
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
                {roles.map((role) => (
                  <RoleRow
                    key={role.id}
                    role={role}
                    holder={row.roles?.[role.id] ?? null}
                    required={missing.has(role.id)}
                    who={who}
                    members={assignable(members.rows)}
                    pending={busy.has(`role/${role.id}`)}
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
          <StatusPublishCard incidentId={row.id} serviceIds={row.serviceIds} />
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
          <IncidentDetailsCard row={row} />
          <IncidentExportButton incident={row} />
        </div>
      </div>
      {/* What the incident leaves behind (RFC 0013): its follow-ups and its postmortem, full width under the rest. */}
      <FollowUpsCard incident={row} />
      <PostmortemCard incident={row} />
    </Shell>
  );
}

/**
 * A role, who holds it, and (for those who may change it) a menu of the members who may hold it. Viewers get the
 * name as text. The trigger is named by the role's label and the holder, so the role is read once. A role the type
 * requires is flagged while nobody holds it; what the role is responsible for folds out under it.
 */
function RoleRow({
  role,
  holder,
  required,
  who,
  members,
  pending,
  editable,
  onAssign,
}: {
  role: RoleDefinition;
  holder: string | null;
  required: boolean;
  who: People;
  members: readonly MemberRow[];
  pending: boolean;
  editable: boolean;
  onAssign: (role: RoleDefinition, userId: string | null) => void;
}) {
  const labelId = useId();
  const nameId = useId();
  const label = roleLabel(role.id, role.name);
  const name = holder === null ? m.incident_page({ part: "nobody" }) : personName(holder, who);
  const nameClass = cn(
    "min-w-0 [overflow-wrap:anywhere]",
    holder === null ? "text-muted-foreground" : "font-medium",
  );
  const heading = (id?: string) => (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span
        id={id}
        className="min-w-0 text-xs font-medium text-muted-foreground [overflow-wrap:anywhere]"
      >
        {label}
      </span>
      {required ? (
        <span className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
          <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0" />
          {catalogText("required_badge")}
        </span>
      ) : null}
    </span>
  );
  const about =
    role.description || role.checklist.length ? (
      <details className="group text-sm">
        <summary className="flex min-h-8 w-fit cursor-pointer items-center gap-1 text-xs text-muted-foreground select-none hover:text-foreground">
          <ChevronDownIcon
            aria-hidden
            className="size-3.5 -rotate-90 transition-transform duration-150 ease-out group-open:rotate-0 motion-reduce:transition-none"
          />
          {catalogText("responsibilities")}
        </summary>
        <div className="flex flex-col gap-1.5 pt-1 pb-1 pl-4.5">
          {role.description ? (
            <p className="whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
              {role.description}
            </p>
          ) : null}
          {role.checklist.length ? (
            <ul className="flex list-disc flex-col gap-1 pl-4 marker:text-muted-foreground">
              {role.checklist.map((item, index) => (
                <li key={index} className="[overflow-wrap:anywhere]">
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>
    ) : null;
  if (!editable) {
    return (
      <li className="flex flex-col gap-0.5">
        {heading()}
        <span className="flex items-start gap-2 py-1.5 text-sm">
          <UserRoundIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className={nameClass}>{name}</span>
        </span>
        {about}
      </li>
    );
  }
  // The holder stays listed even if the shard no longer counts them as assignable (a viewer now). A role taken out
  // of the workspace can only be taken off whoever holds it.
  const offered = role.removed ? [] : members;
  const options =
    holder === null || offered.some((option) => option.id === holder)
      ? offered
      : [...offered, { id: holder, name, role: "viewer" as const, updatedAt: 0 }];
  return (
    // gap-2: the trigger's focus ring (3px past a 2px offset) clears the label.
    <li className="flex flex-col gap-2">
      {heading(labelId)}
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
      {about}
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

/** An entry of a kind a newer shard wrote that this build does not know yet. */
const UNKNOWN_ENTRY_ICON: LucideIcon = CircleDotIcon;

const ENTRY_ICONS: Record<Exclude<TimelineRow["kind"], "status_changed">, LucideIcon> = {
  declared: CirclePlusIcon,
  severity_changed: GaugeIcon,
  acknowledged: BellOffIcon,
  role_assigned: UserRoundIcon,
  update: MessageSquareTextIcon,
  alert_resolved: HeartPulseIcon,
  alert_grouped: BellPlusIcon,
  alerts_resolved: BellCheckIcon,
  page_failed: PhoneMissedIcon,
  email_failed: MailWarningIcon,
  slack_failed: MessageSquareWarningIcon,
  status_published: GlobeIcon,
  status_corrected: PencilLineIcon,
  escalated: BellRingIcon,
  paged_again: PhoneCallIcon,
  escalation_exhausted: TimerOffIcon,
  type_changed: TagIcon,
  services_changed: LayersIcon,
  field_changed: SquarePenIcon,
  follow_up: ListTodoIcon,
  postmortem: FileTextIcon,
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
  pageAgain,
  incidentId,
  role,
}: {
  rows: readonly TimelineRow[];
  ready: boolean;
  who: People;
  locale: Locale;
  now: number;
  /** The incident's id when the member may page a failed page again; undefined offers nothing. */
  pageAgain?: string;
  incidentId: string;
  /** The member's role, for what they may do to an update (`updateActions`). */
  role: Role;
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
            (entry.kind === "status_changed"
              ? STATUS_ICONS[entry.to]
              : (ENTRY_ICONS as Partial<Record<string, LucideIcon>>)[entry.kind]) ??
            UNKNOWN_ENTRY_ICON;
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
                    ((entry.kind === "update" && !entry.removed) ||
                      entry.kind === "status_published" ||
                      entry.kind === "status_corrected") &&
                      "border-primary/40 text-primary",
                    (entry.kind === "page_failed" ||
                      entry.kind === "email_failed" ||
                      entry.kind === "slack_failed") &&
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
                  {entry.kind === "update" && entry.edited && !entry.removed ? (
                    <EditedMarker at={entry.edited.at} locale={locale} />
                  ) : null}
                </p>
                {entry.kind === "update" ? (
                  entry.removed ? null : (
                    <WrittenUpdate
                      incidentId={incidentId}
                      entry={entry}
                      actions={updateActions(entry, who.self, role)}
                      locale={locale}
                    />
                  )
                ) : entry.kind === "status_published" || entry.kind === "status_corrected" ? (
                  <UpdateBody body={entry.body} />
                ) : null}
                {item.kind === "pages_failed" ? <FailedNames item={item} who={who} /> : null}
                {pageAgain === undefined ? null : (
                  <PageAgain incidentId={pageAgain} entries={pageAgainEntries(item, rows)} />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/** "edited" after an update's time, with when on hover and for screen readers. */
function EditedMarker({ at, locale }: { at: number; locale: Locale }) {
  const when = m.incident_update_change({
    part: "edited_at",
    time: formatDateTime(at, locale, TIME_ZONE),
    reason: "",
  });
  return (
    <span className="text-xs text-muted-foreground" title={when}>
      <span aria-hidden>{m.incident_update_change({ part: "edited", time: "", reason: "" })}</span>
      <span className="sr-only">{when}</span>
    </span>
  );
}

type WrittenUpdateRow = Extract<TimelineRow, { kind: "update" }>;

/**
 * A written update's text, with Edit (its author) and Remove (its author, owners and admins) under it. Edit swaps the
 * text for a field in place; Remove asks first, inline. Both are optimistic: a refusal puts the text back and says
 * why. Editing never changes what was published on the status page.
 */
function WrittenUpdate({
  incidentId,
  entry,
  actions,
  locale,
}: {
  incidentId: string;
  entry: WrittenUpdateRow;
  actions: { edit: boolean; remove: boolean };
  locale: Locale;
}) {
  const editUpdate = useMutation("incident.editUpdate");
  const deleteUpdate = useMutation("incident.deleteUpdate");
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [draft, setDraft] = useState(entry.body);
  const [invalid, setInvalid] = useState<UpdateProblem | null>(null);
  const [pending, setPending] = useState<"edit" | "remove" | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const fieldId = useId();
  const noteId = useId();
  const errorId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const say = (part: string, reason = "") => m.incident_update_change({ part, time: "", reason });
  const refusal = (code: string, failed: "edit_failed" | "remove_failed") =>
    code === "conflict" && failed === "edit_failed"
      ? say("unchanged")
      : code === "conflict"
        ? say("gone")
        : say(failed, mutationErrorReason(code as Parameters<typeof mutationErrorReason>[0]));

  useEffect(() => {
    if (mode === "edit") field.current?.focus();
  }, [mode]);

  const startEdit = () => {
    setDraft(entry.body);
    setInvalid(null);
    setRefused(null);
    setMode("edit");
  };
  const close = () => {
    setMode("view");
    setInvalid(null);
    // Back to where the member was, so a keyboard does not land on the page's top.
    requestAnimationFrame(() => editButton.current?.focus());
  };
  const save = (event?: FormEvent) => {
    event?.preventDefault();
    if (draft === entry.body) return close();
    const checked = checkEdit(incidentId, entry.id, draft);
    if (!checked.ok) {
      setInvalid(checked.reason);
      field.current?.focus();
      return;
    }
    const typed = draft;
    setMode("view");
    setPending("edit");
    void editUpdate(checked.args).then((outcome) => {
      setPending(null);
      if (outcome.ok) return;
      setRefused(refusal(outcome.error.code, "edit_failed"));
      // The text stays to try again, unless the update is gone.
      if (outcome.error.code === "invalid_args") {
        setDraft(typed);
        setMode("edit");
      }
    });
  };
  const remove = () => {
    setMode("view");
    setPending("remove");
    setRefused(null);
    void deleteUpdate({ id: incidentId, entryId: entry.id }).then((outcome) => {
      setPending(null);
      if (!outcome.ok) setRefused(refusal(outcome.error.code, "remove_failed"));
    });
  };

  if (mode === "edit") {
    const length = updateLength(draft);
    return (
      <form onSubmit={save} noValidate className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="sr-only">
          {say("edit_label")}
        </label>
        <textarea
          ref={field}
          id={fieldId}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (invalid) setInvalid(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) save();
            if (event.key === "Escape") close();
          }}
          rows={3}
          aria-invalid={invalid !== null}
          aria-describedby={[invalid && errorId, noteId].filter(Boolean).join(" ")}
          className="field-sizing-content max-h-80 min-h-24 w-full min-w-0 resize-y rounded-md border border-input bg-card px-3 py-2.5 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive"
        />
        {invalid ? (
          <p
            id={errorId}
            role="alert"
            className="flex items-start gap-1.5 text-sm text-destructive"
          >
            <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {invalid === "long"
              ? m.auth_error_too_long({ max: formatNumber(UPDATE_BODY_MAX, locale) })
              : m.incident_page({
                  part: invalid === "empty" ? "update_empty" : "update_invalid",
                })}
          </p>
        ) : null}
        <p id={noteId} className="text-xs text-muted-foreground">
          {say("status_page_note")}
          {length >= UPDATE_COUNT_FROM ? (
            <span
              className={cn(
                "ml-2 whitespace-nowrap tabular-nums",
                length > UPDATE_BODY_MAX && "font-medium text-destructive",
              )}
            >
              {formatNumber(length, locale)} / {formatNumber(UPDATE_BODY_MAX, locale)}
            </span>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{say("save")}</Button>
          <Button type="button" variant="ghost" onClick={close}>
            {say("cancel")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className={cn("self-stretch", pending === "remove" && "opacity-60")}>
        <UpdateBody body={entry.body} />
      </div>
      {mode === "confirm" ? (
        <div
          role="group"
          aria-labelledby={`${fieldId}-confirm`}
          className="flex flex-col gap-2 self-stretch rounded-md border border-destructive/40 bg-destructive/5 p-3"
        >
          <p id={`${fieldId}-confirm`} className="text-sm font-medium">
            {say("remove_title")}
          </p>
          <p className="text-sm text-muted-foreground">{say("remove_body")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={remove}>
              {say("remove_confirm")}
            </Button>
            <Button
              variant="ghost"
              autoFocus
              onClick={() => {
                setMode("view");
              }}
            >
              {say("cancel")}
            </Button>
          </div>
        </div>
      ) : actions.edit || actions.remove ? (
        <div className="-ml-1 flex flex-wrap items-center gap-x-1">
          {actions.edit ? (
            <Button
              ref={editButton}
              variant="link"
              className="px-1"
              disabled={pending !== null}
              onClick={startEdit}
            >
              {pending === "edit" ? say("saving") : say("edit")}
            </Button>
          ) : null}
          {actions.remove ? (
            <Button
              variant="link"
              className="px-1 text-destructive"
              disabled={pending !== null}
              onClick={() => {
                setRefused(null);
                setMode("confirm");
              }}
            >
              {pending === "remove" ? say("removing") : say("remove")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {refused ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{refused}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * "Page again" under a failed page (`incident.pageAgain`): a new page to the members it missed, or to whoever the lost
 * page was for. Gone once the shard's `paged_again` entry lands; a refusal says why, next to the button.
 */
function PageAgain({ incidentId, entries }: { incidentId: string; entries: string[] }) {
  const pageAgain = useMutation("incident.pageAgain");
  const [pending, setPending] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  if (entries.length === 0) return null;
  const onClick = () => {
    setPending(true);
    setRefused(null);
    void pageAgain({ id: incidentId, entries }).then((outcome) => {
      setPending(false);
      if (outcome.ok) return;
      const conflict =
        outcome.error.code === "conflict" ? CONFLICT_PARTS[outcome.error.message] : undefined;
      setRefused(
        conflict !== undefined
          ? m.incident_page_again({ part: conflict, reason: "" })
          : m.incident_page_again({
              part: "failed",
              reason: mutationErrorReason(outcome.error.code),
            }),
      );
    });
  };
  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="outline" disabled={pending} onClick={onClick}>
        {pending ? (
          <LoaderCircleIcon aria-hidden className="animate-spin" />
        ) : (
          <PhoneCallIcon aria-hidden />
        )}
        {m.incident_page_again({ part: pending ? "pending" : "action", reason: "" })}
      </Button>
      {refused ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{refused}</span>
        </p>
      ) : null}
    </div>
  );
}

/** What each of `incident.pageAgain`'s refusals says (`PAGE_AGAIN_CONFLICTS`, its error messages). */
const CONFLICT_PARTS: Partial<Record<string, "already" | "acked" | "resolved">> = {
  [PAGE_AGAIN_CONFLICTS.answered]: "already",
  [PAGE_AGAIN_CONFLICTS.acknowledged]: "acked",
  [PAGE_AGAIN_CONFLICTS.inactive]: "resolved",
};

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
