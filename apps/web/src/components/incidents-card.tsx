import { formatDateTime, formatRelativeTime, m, type Locale } from "@freecorps/brigade-i18n";
import { incidentStatusLabels, severityLabels } from "@freecorps/brigade-i18n/labels";
import {
  formatIncidentNumber,
  INCIDENT_TITLE_MAX,
  SEVERITIES,
  type IncidentRow,
  type IncidentStatus,
  type Severity,
} from "@freecorps/brigade-schema";
import type { MutationOutcome } from "@freecorps/brigade-sync";
import { useConnectionState, useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { cn } from "cn";
import {
  ChevronDownIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { SeverityBadge, STATUS_ICONS, StatusBadge } from "@/components/incident-badges";
import { usePreferences } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { syncClient } from "@/sync-client";
import {
  mutationErrorReason,
  nextFailed,
  nextStatuses,
  syncView,
  type SyncView,
} from "@/lib/incidents";

const DEV_COMMAND = "vp run dev";

type Notice = { key: number; text: string };

/**
 * The workspace's active incidents, live from its shard (`useQuery("incidents.active")`), with declare and the
 * status and severity menus. Changes show at once (optimistic) and settle when the shard confirms them; a refused
 * one rolls back on its own and leaves a notice saying why.
 */
export function IncidentsCard() {
  const { locale } = usePreferences();
  const { rows, status } = useQuery("incidents.active", {});
  const connection = useConnectionState();
  const [failed, setFailed] = useState(false);
  const latched = nextFailed(failed, status, connection);
  if (latched !== failed) setFailed(latched);
  const view = syncView(status, connection, latched);

  const declare = useMutation("incident.declare");
  const setStatus = useMutation("incident.setStatus");
  const setSeverity = useMutation("incident.setSeverity");

  // Kept here, not in the rows: a refused move to resolved brings back a row that had left the list.
  const [notices, setNotices] = useState<Notice[]>([]);
  const [busy, setBusy] = useState<ReadonlyMap<string, number>>(new Map());
  const track = useCallback(
    (id: string, outcome: Promise<MutationOutcome>, fail: (reason: string) => string) => {
      const bump = (by: number) =>
        setBusy((current) => new Map(current).set(id, (current.get(id) ?? 0) + by));
      bump(1);
      void outcome.then((result) => {
        bump(-1);
        if (result.ok) return;
        const text = fail(mutationErrorReason(result.error.code));
        setNotices((current) => [...current, { key: Date.now() + Math.random(), text }].slice(-3));
      });
    },
    [],
  );

  const label = (row: IncidentRow) => formatIncidentNumber(row.number) ?? `“${row.title}”`;
  const onDeclare = (id: string, title: string, severity: Severity) =>
    track(id, declare({ id, title, severity }), (reason) =>
      m.incident_declare_failed({ title, reason }),
    );
  const onStatus = (row: IncidentRow, next: IncidentStatus) =>
    track(row.id, setStatus({ id: row.id, status: next }), (reason) =>
      m.incident_change_failed({ incident: label(row), reason }),
    );
  const onSeverity = (row: IncidentRow, next: Severity) =>
    track(row.id, setSeverity({ id: row.id, severity: next }), (reason) =>
      m.incident_change_failed({ incident: label(row), reason }),
    );

  const now = useNow(30_000);

  return (
    // Rows run to the card's edges (the SEV1 rule included), so the card clips them to its corners.
    <Card
      aria-labelledby="incidents-title"
      className={cn(rows.length > 0 && "overflow-hidden pb-0 sm:pb-0")}
    >
      {/* The connection state is a word, so it sits beside the title on phones too. */}
      <CardHeader className="grid-cols-[minmax(0,1fr)_auto] gap-x-4">
        <CardTitle id="incidents-title">{m.incidents_title()}</CardTitle>
        <CardDescription className="tabular-nums">
          {status === "ready" ? (
            m.incidents_active_count({ count: rows.length })
          ) : view === "connecting" ? (
            <span aria-hidden className="my-0.5 block h-4 w-32 rounded-sm bg-muted" />
          ) : null}
        </CardDescription>
        <CardAction className="col-start-2 row-span-2 row-start-1 mt-0 justify-self-end">
          <ConnectionPill view={view} />
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {view === "unavailable" ? (
          <div className="flex flex-col items-start gap-3 rounded-md bg-muted p-4 text-sm">
            <p>{m.sync_unavailable_hint()}</p>
            <code className="rounded-sm bg-card px-2 py-1 text-foreground">{DEV_COMMAND}</code>
            <p className="text-muted-foreground">{m.sync_retrying()}</p>
          </div>
        ) : (
          <DeclareForm onDeclare={onDeclare} />
        )}

        {notices.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {notices.map((notice) => (
              <li
                key={notice.key}
                role="alert"
                className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 py-1 pr-1 pl-3 text-sm"
              >
                <CircleAlertIcon aria-hidden className="mt-2.5 size-4 shrink-0 text-destructive" />
                <p className="min-w-0 flex-1 py-2 [overflow-wrap:anywhere]">{notice.text}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={m.dismiss()}
                  onClick={() =>
                    setNotices((current) => current.filter((item) => item.key !== notice.key))
                  }
                >
                  <XIcon aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        {view === "reconnecting" ? (
          <p className="text-sm text-muted-foreground">{m.sync_reconnecting_hint()}</p>
        ) : null}

        {view === "connecting" ? (
          <ul aria-hidden className="-mx-4 divide-y border-y sm:-mx-6">
            {[0, 1, 2].map((index) => (
              <li key={index} className="flex flex-col gap-2 px-4 py-4 sm:px-6">
                <span className="block h-4 w-16 rounded-sm bg-muted" />
                <span className="block h-5 w-3/4 max-w-md rounded-sm bg-muted" />
              </li>
            ))}
          </ul>
        ) : status === "ready" && rows.length === 0 ? (
          // The header already says "No active incidents": this only says what to do about it.
          <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            {m.incidents_empty_hint()}
          </p>
        ) : rows.length > 0 ? (
          <ul aria-labelledby="incidents-title" className="-mx-4 divide-y border-t sm:-mx-6">
            {rows.map((row) => (
              <IncidentItem
                key={row.id}
                row={row}
                pending={row.number === null || (busy.get(row.id) ?? 0) > 0}
                online={connection === "open"}
                locale={locale}
                now={now}
                onStatus={onStatus}
                onSeverity={onSeverity}
              />
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

const PILLS: Record<
  SyncView,
  { icon: LucideIcon; text: () => string; tone: string; spin?: boolean }
> = {
  live: { icon: CircleDashedIcon, text: m.sync_live, tone: "text-primary" },
  connecting: {
    icon: LoaderCircleIcon,
    text: m.sync_connecting,
    tone: "text-muted-foreground",
    spin: true,
  },
  reconnecting: {
    icon: RefreshCwIcon,
    text: m.sync_reconnecting,
    tone: "text-muted-foreground",
    spin: true,
  },
  unavailable: { icon: CircleAlertIcon, text: m.sync_unavailable, tone: "text-destructive" },
};

/** Calm by design: a word and a small glyph, never a banner, since a reconnect usually fixes itself. */
function ConnectionPill({ view }: { view: SyncView }) {
  const { icon: Icon, text, tone, spin } = PILLS[view];
  return (
    <p role="status" className="inline-flex min-h-6 items-center gap-2 text-sm font-medium">
      {view === "live" ? (
        <span aria-hidden className="size-2 rounded-full bg-primary" />
      ) : (
        <Icon
          aria-hidden
          className={cn("size-4 shrink-0", tone, spin && "animate-spin motion-reduce:animate-none")}
        />
      )}
      <span className={view === "live" ? undefined : tone}>{text()}</span>
    </p>
  );
}

function DeclareForm({
  onDeclare,
}: {
  onDeclare: (id: string, title: string, severity: Severity) => void;
}) {
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<Severity>("sev3");
  const titleId = useId();
  const severityId = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    onDeclare(syncClient.newId("inc"), trimmed, severity);
    setTitle("");
  };
  return (
    <form
      onSubmit={submit}
      aria-label={m.declare_heading()}
      className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={titleId} className="text-xs font-medium text-muted-foreground">
          {m.declare_title_label()}
        </label>
        <input
          id={titleId}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={INCIDENT_TITLE_MAX}
          placeholder={m.declare_title_placeholder()}
          autoComplete="off"
          enterKeyHint="send"
          // 16px: iOS zooms into smaller inputs.
          className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span id={severityId} className="text-xs font-medium text-muted-foreground">
          {m.declare_severity_label()}
        </span>
        {/* Native radios (arrow keys, form semantics) drawn as a segmented control. Each segment is a 44px target; the edge is an outline drawn over them, so it adds no height. */}
        <div
          role="radiogroup"
          aria-labelledby={severityId}
          className="grid grid-cols-4 overflow-hidden rounded-md bg-card outline-1 -outline-offset-1 outline-input"
        >
          {SEVERITIES.map((option) => (
            <label
              key={option}
              className={cn(
                "relative flex h-11 min-w-16 cursor-pointer items-center justify-center px-2 text-xs font-bold select-none has-focus-visible:ring-3 has-focus-visible:ring-ring has-focus-visible:ring-inset",
                option === severity
                  ? SEGMENT_TONES[option]
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <input
                type="radio"
                name="severity"
                value={option}
                checked={option === severity}
                onChange={() => setSeverity(option)}
                className="sr-only"
              />
              {option.toUpperCase()}
              <span className="sr-only"> {severityLabels[option]()}</span>
            </label>
          ))}
        </div>
      </div>
      <Button type="submit" disabled={!title.trim()} focusableWhenDisabled>
        {m.declare_submit()}
      </Button>
    </form>
  );
}

/** The selected segment takes its severity's badge colours. */
const SEGMENT_TONES: Record<Severity, string> = {
  sev1: "bg-sev1 text-sev1-foreground",
  sev2: "bg-sev2 text-sev2-foreground",
  sev3: "bg-sev3 text-sev3-foreground",
  sev4: "bg-sev4 text-sev4-foreground",
};

function IncidentItem({
  row,
  pending,
  online,
  locale,
  now,
  onStatus,
  onSeverity,
}: {
  row: IncidentRow;
  pending: boolean;
  online: boolean;
  locale: Locale;
  now: number;
  onStatus: (row: IncidentRow, next: IncidentStatus) => void;
  onSeverity: (row: IncidentRow, next: Severity) => void;
}) {
  const number = formatIncidentNumber(row.number);
  // The shard's clock can be a little ahead of the last tick: never say "in 3 seconds".
  const declared = formatRelativeTime(Math.min(row.declaredAt, now), locale, now);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <li
      aria-busy={pending}
      className={cn(
        "relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-6 md:grid-cols-[6.5rem_minmax(0,1fr)_auto]",
        row.severity === "sev1" &&
          "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-sev1",
      )}
    >
      <div className="md:row-span-2">
        {number ? (
          <span className="font-mono text-sm font-semibold tabular-nums">{number}</span>
        ) : (
          <span className="inline-flex rounded-sm border border-dashed px-1.5 py-0.5 text-xs leading-tight text-muted-foreground">
            {m.incident_unnumbered()}
          </span>
        )}
      </div>
      <p className="justify-self-end text-xs text-muted-foreground md:col-start-2 md:row-start-2 md:justify-self-start">
        <time
          dateTime={new Date(row.declaredAt).toISOString()}
          title={formatDateTime(row.declaredAt, locale, timeZone)}
        >
          {m.incident_declared({ time: declared })}
        </time>
        {pending ? (
          <span className="text-muted-foreground">
            {" · "}
            {online ? m.incident_saving() : m.incident_queued()}
          </span>
        ) : null}
      </p>
      <h3 className="col-span-2 font-medium [overflow-wrap:anywhere] md:col-span-1 md:col-start-2 md:row-start-1">
        {row.title}
      </h3>
      <div className="col-span-2 -ml-1.5 flex flex-wrap items-center gap-1 md:col-span-1 md:col-start-3 md:row-span-2 md:row-start-1 md:ml-0 md:justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" className="gap-1 px-1.5" />}>
            <span className="sr-only">{m.incident_severity_label()}: </span>
            <SeverityBadge severity={row.severity} />
            <ChevronDownIcon aria-hidden className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuLabel>{m.incident_severity_label()}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={row.severity}
                onValueChange={(value: Severity) => onSeverity(row, value)}
              >
                {SEVERITIES.map((option) => (
                  <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                    <span className="font-bold">{option.toUpperCase()}</span>
                    {severityLabels[option]()}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" className="gap-1 px-1.5" />}>
            <span className="sr-only">{m.incident_status_label()}: </span>
            <StatusBadge status={row.status} />
            <ChevronDownIcon aria-hidden className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuLabel>{m.incident_status_label()}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={row.status}
                onValueChange={(value: IncidentStatus) => onStatus(row, value)}
              >
                {/* The current status, then only the moves the lifecycle allows from it. */}
                {[row.status, ...nextStatuses(row.status)].map((option) => {
                  const Icon = STATUS_ICONS[option];
                  return (
                    <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                      <Icon aria-hidden className="text-muted-foreground" />
                      {incidentStatusLabels[option]()}
                    </DropdownMenuRadioItem>
                  );
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

/** Epoch ms, refreshed every `ms`, so relative times move on their own. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
