import { formatDateTime, m, type Locale } from "@freecorps/brigade-i18n";
import { incidentStatusLabels } from "@freecorps/brigade-i18n/labels";
import {
  formatIncidentNumber,
  SEVERITIES,
  type IncidentRow,
  type IncidentStatus,
  type Severity,
} from "@freecorps/brigade-schema";
import { Link, useRouter } from "@tanstack/react-router";
import { cn } from "cn";
import { ChevronDownIcon, ClockIcon, CloudUploadIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { SeverityBadge, STATUS_ICONS, StatusBadge } from "@/components/incident-badges";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatAge, nextStatuses, rememberOpened } from "@/lib/incidents";

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The row's columns from `md`: number, title, severity, status. The incidents card names them with the same grid. */
export const INCIDENT_COLUMNS =
  "md:grid-cols-[--spacing(20)_minmax(0,1fr)_--spacing(38)_--spacing(38)]";

/** A badge whose value the shard has not confirmed yet: a dashed outline marks which field is pending. */
const UNSAVED = "rounded-sm outline-1 outline-offset-2 outline-current outline-dashed";

/**
 * One incident. Phones stack number and time, the title, then the two menus; from `md` the number, title,
 * severity and status sit in fixed columns so the badges line up down the list.
 */
export function IncidentItem({
  row,
  arrived = false,
  pending,
  online,
  locale,
  now,
  notices,
  editable = true,
  onStatus,
  onSeverity,
}: {
  row: IncidentRow;
  /** Arrived while the list was on screen: it settles in rather than appearing. */
  arrived?: boolean;
  /** Which of its changes the shard has not confirmed yet. */
  pending: { any: boolean; status: boolean; severity: boolean };
  online: boolean;
  locale: Locale;
  now: number;
  /** Refused changes to this incident, shown in the row so nothing above the list moves. */
  notices: ReactNode;
  /** False for viewers: the badges are shown, not menus. */
  editable?: boolean;
  onStatus: (row: IncidentRow, next: IncidentStatus) => void;
  onSeverity: (row: IncidentRow, next: Severity) => void;
}) {
  const number = formatIncidentNumber(row.number);
  // The shard's clock can be a little ahead of the last tick: never say "in 3 seconds".
  const declared = formatAge(Math.min(row.declaredAt, now), now, locale);
  const PendingIcon = online ? CloudUploadIcon : ClockIcon;
  return (
    // `id` and `tabIndex`: a monitor's "Open INC-n" link scrolls here and focuses the row.
    <li
      id={`incident-${row.id}`}
      tabIndex={-1}
      data-incident={row.id}
      className={cn(
        // The title's link is stretched over the row (as on the services list); the two menus sit above it.
        "relative scroll-mt-4 outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors duration-150 ease-out has-[a[data-incident-link]:hover]:bg-muted/50 has-[a[data-incident-link]:focus-visible]:ring-3 has-[a[data-incident-link]:focus-visible]:ring-ring has-[a[data-incident-link]:focus-visible]:ring-inset sm:px-6",
        INCIDENT_COLUMNS,
        "md:items-start",
        arrived && "enter",
      )}
    >
      {/* Not numbered until the shard has it: a glyph and a short word, never wrapped. */}
      <div className="whitespace-nowrap md:row-span-2">
        {number ? (
          <span className="font-mono text-[0.8125rem] leading-5 text-muted-foreground">
            {number}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-sm border border-dashed border-muted-foreground/60 px-1 text-xs leading-5 text-muted-foreground">
            <PendingIcon aria-hidden className="size-3 shrink-0" />
            {online ? m.incident_unnumbered_saving() : m.incident_unnumbered_not_sent()}
          </span>
        )}
      </div>
      {/* Pieces wrap whole, never mid-phrase. Below md the pending word always takes its own line, so the row's
          height changes when a change starts or settles, never when the connection flaps. */}
      <p className="flex flex-wrap justify-end gap-x-1 text-right text-xs text-muted-foreground md:col-start-2 md:row-start-2 md:justify-start md:text-left">
        <time
          className="whitespace-nowrap"
          dateTime={new Date(row.declaredAt).toISOString()}
          title={formatDateTime(row.declaredAt, locale, TIME_ZONE)}
        >
          {m.incident_declared({ time: declared })}
        </time>
        {number && pending.any ? (
          <span className="whitespace-nowrap max-md:basis-full">
            <span aria-hidden className="max-md:hidden">
              ·{" "}
            </span>
            {online ? m.incident_change_saving() : m.incident_change_queued()}
          </span>
        ) : null}
      </p>
      <h3 className="col-span-2 font-semibold [overflow-wrap:anywhere] md:col-span-1 md:col-start-2 md:row-start-1">
        {/* The incident's page needs its number: an incident the shard has not numbered yet is not a link. */}
        {row.number === null ? (
          row.title
        ) : (
          <IncidentTitleLink number={row.number} title={row.title} />
        )}
      </h3>
      {/* Phones: both menus on one line, and -mb-2 trims the space under the 44px triggers without shrinking
          them. From md the wrapper dissolves and each menu fills its own column, badge at the start and chevron at
          the end, so the chevrons line up down the list whatever each badge's width. */}
      <div className="col-span-2 -mb-2 -ml-1.5 flex flex-wrap items-center gap-1 max-[374px]:-ml-1 md:contents">
        <div className="relative z-10 md:col-start-3 md:row-span-2 md:row-start-1 md:self-center md:[&>button]:w-full md:[&>button]:justify-between">
          <SeverityMenu
            severity={row.severity}
            pending={pending.severity}
            disabled={!editable}
            onChange={(next) => onSeverity(row, next)}
          />
        </div>
        <div className="relative z-10 md:col-start-4 md:row-span-2 md:row-start-1 md:self-center md:[&>button]:w-full md:[&>button]:justify-between">
          <StatusMenu
            status={row.status}
            pending={pending.status}
            trigger={row.id}
            disabled={!editable}
            onChange={(next) => onStatus(row, next)}
          />
        </div>
      </div>
      {notices ? <div className="relative z-10 col-span-full mt-2">{notices}</div> : null}
    </li>
  );
}

// Stretched over the row, so the whole row opens the incident; the row's tint marks hover and focus.
const TITLE_LINK = "outline-none after:absolute after:inset-0";

/**
 * The title as a link to the incident's page. A client-side navigation inside the app; a plain link where the list
 * renders without a router (the card's own tests). Opening it remembers the incident, so coming back to the list
 * puts focus on this link again.
 */
function IncidentTitleLink({ number, title }: { number: number; title: string }) {
  const router = useRouter({ warn: false }) as ReturnType<typeof useRouter> | null;
  const props = {
    className: TITLE_LINK,
    "data-incident-link": number,
    // Only a plain click navigates this tab; a modified or middle click opens another and leaves this list here.
    onClick: (event: MouseEvent) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
        return;
      rememberOpened(number);
    },
  };
  if (!router) {
    return (
      <a href={`/incidents/${number}`} {...props}>
        {title}
      </a>
    );
  }
  return (
    <Link to="/incidents/$number" params={{ number: String(number) }} {...props}>
      {title}
    </Link>
  );
}

/**
 * The severity badge as a menu trigger; the dashed outline marks a change the shard has not confirmed. `disabled`
 * (a viewer): just the badge.
 */
export function SeverityMenu({
  severity,
  pending,
  disabled,
  onChange,
}: {
  severity: Severity;
  pending: boolean;
  disabled?: boolean;
  onChange: (next: Severity) => void;
}) {
  // Someone who may not change it (a viewer) gets the badge, not a control that does nothing.
  if (disabled) {
    return (
      <span className="inline-flex min-h-11 items-center px-1.5">
        <span className="sr-only">{m.incident_severity_label()}: </span>
        <SeverityBadge severity={severity} />
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="gap-1 px-1.5 max-[374px]:min-w-11 max-[374px]:gap-0.5 max-[374px]:px-1"
          />
        }
      >
        <span className="sr-only">{m.incident_severity_label()}: </span>
        <span className={cn("inline-flex", pending && UNSAVED)}>
          <SeverityBadge severity={severity} />
        </span>
        {/* Below 375px a smaller chevron and tighter spacing, so both menus usually fit one line at 320px. */}
        <ChevronDownIcon aria-hidden className="size-4 text-muted-foreground max-[374px]:size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{m.incident_severity_label()}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={severity}
            // Base UI also reports a click on the checked item; that would be a refused no-op.
            onValueChange={(value: Severity) => {
              if (value !== severity) onChange(value);
            }}
          >
            {SEVERITIES.map((option) => (
              <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                <SeverityBadge severity={option} />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The status badge as a menu trigger: the current status, then only the moves the lifecycle allows. `disabled` (a
 * viewer): just the badge.
 */
export function StatusMenu({
  status,
  pending,
  trigger,
  disabled,
  onChange,
}: {
  status: IncidentStatus;
  pending: boolean;
  /** `data-status-trigger`, which the list's focus keeping looks for. */
  trigger?: string;
  disabled?: boolean;
  onChange: (next: IncidentStatus) => void;
}) {
  if (disabled) {
    return (
      <span className="inline-flex min-h-11 items-center px-1.5">
        <span className="sr-only">{m.incident_status_label()}: </span>
        <StatusBadge status={status} />
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-status-trigger={trigger}
        render={
          <Button
            variant="ghost"
            className="gap-1 px-1.5 max-[374px]:min-w-11 max-[374px]:gap-0.5 max-[374px]:px-1"
          />
        }
      >
        <span className="sr-only">{m.incident_status_label()}: </span>
        <span className={cn("inline-flex", pending && UNSAVED)}>
          <StatusBadge status={status} />
        </span>
        <ChevronDownIcon aria-hidden className="size-4 text-muted-foreground max-[374px]:size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{m.incident_status_label()}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={status}
            onValueChange={(value: IncidentStatus) => {
              if (value !== status) onChange(value);
            }}
          >
            {[status, ...nextStatuses(status)].map((option) => {
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
  );
}

/**
 * A placeholder row with the real row's grid and heights (number and time, title, the two 44px menus), so the
 * list does not jump when the data arrives.
 */
export function IncidentItemSkeleton() {
  return (
    <li
      aria-hidden
      className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-6 md:grid-cols-[--spacing(20)_minmax(0,1fr)_--spacing(38)_--spacing(38)] md:items-start"
    >
      <span className="my-0.5 block h-4 w-12 rounded-sm bg-muted md:row-span-2" />
      <span className="my-0.5 block h-3 w-24 justify-self-end rounded-sm bg-muted md:col-start-2 md:row-start-2 md:justify-self-start" />
      <span className="col-span-2 my-0.5 block h-4 w-3/4 max-w-md rounded-sm bg-muted md:col-span-1 md:col-start-2 md:row-start-1" />
      <div className="col-span-2 -mb-2 flex h-11 items-center gap-3 md:contents">
        <span className="block h-6 w-28 rounded-sm bg-muted md:col-start-3 md:row-span-2 md:row-start-1 md:my-2.5 md:ml-1.5" />
        <span className="block h-6 w-28 rounded-sm bg-muted md:col-start-4 md:row-span-2 md:row-start-1 md:my-2.5 md:ml-1.5" />
      </div>
    </li>
  );
}
