import { formatDateTime, formatRelativeTime, m, type Locale } from "@freecorps/brigade-i18n";
import { incidentStatusLabels } from "@freecorps/brigade-i18n/labels";
import {
  formatIncidentNumber,
  SEVERITIES,
  type IncidentRow,
  type IncidentStatus,
  type Severity,
} from "@freecorps/brigade-schema";
import { cn } from "cn";
import { ChevronDownIcon, ClockIcon, CloudUploadIcon } from "lucide-react";
import type { ReactNode } from "react";
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
import { nextStatuses } from "@/lib/incidents";

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** A badge whose value the shard has not confirmed yet: a dashed outline marks which field is pending. */
const UNSAVED = "rounded-sm outline-1 outline-offset-2 outline-current outline-dashed";

/**
 * One incident. Phones stack number and time, the title, then the two menus; from `md` the number, title,
 * severity and status sit in fixed columns so the badges line up down the list.
 */
export function IncidentItem({
  row,
  pending,
  online,
  locale,
  now,
  notices,
  onStatus,
  onSeverity,
}: {
  row: IncidentRow;
  /** Which of its changes the shard has not confirmed yet. */
  pending: { any: boolean; status: boolean; severity: boolean };
  online: boolean;
  locale: Locale;
  now: number;
  /** Refused changes to this incident, shown in the row so nothing above the list moves. */
  notices: ReactNode;
  onStatus: (row: IncidentRow, next: IncidentStatus) => void;
  onSeverity: (row: IncidentRow, next: Severity) => void;
}) {
  const number = formatIncidentNumber(row.number);
  // The shard's clock can be a little ahead of the last tick: never say "in 3 seconds".
  const declared = formatRelativeTime(Math.min(row.declaredAt, now), locale, now);
  const PendingIcon = online ? CloudUploadIcon : ClockIcon;
  return (
    <li
      data-incident={row.id}
      aria-busy={pending.any || number === null}
      className={cn(
        "relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-6",
        "md:grid-cols-[--spacing(24)_minmax(0,1fr)_--spacing(40)_--spacing(40)] md:items-start",
        row.severity === "sev1" &&
          "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-sev1",
      )}
    >
      {/* Not numbered until the shard has it: a glyph and a short word, never wrapped. */}
      <div className="whitespace-nowrap md:row-span-2">
        {number ? (
          <span className="font-mono text-sm font-medium text-muted-foreground tabular-nums">
            {number}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-sm border border-dashed px-1 text-xs leading-5 text-muted-foreground">
            <PendingIcon aria-hidden className="size-3 shrink-0" />
            {online ? m.incident_sending() : m.incident_not_sent()}
          </span>
        )}
      </div>
      {/* Pieces wrap whole, never mid-phrase. */}
      <p className="flex flex-wrap justify-end gap-x-1 text-xs text-muted-foreground md:col-start-2 md:row-start-2 md:justify-start">
        <time
          className="whitespace-nowrap"
          dateTime={new Date(row.declaredAt).toISOString()}
          title={formatDateTime(row.declaredAt, locale, TIME_ZONE)}
        >
          {m.incident_declared({ time: declared })}
        </time>
        {number && pending.any ? (
          <span className="whitespace-nowrap">
            · {online ? m.incident_saving() : m.incident_queued()}
          </span>
        ) : null}
      </p>
      <h3 className="col-span-2 font-semibold [overflow-wrap:anywhere] md:col-span-1 md:col-start-2 md:row-start-1">
        {row.title}
      </h3>
      {/* Phones: both menus on one line, and -mb-2 trims the space under the 44px triggers without shrinking
          them. From md the wrapper dissolves and each menu takes its own column, centred on the row. */}
      <div className="col-span-2 -mb-2 -ml-1.5 flex flex-wrap items-center gap-1 md:contents">
        <div className="md:col-start-3 md:row-span-2 md:row-start-1 md:self-center">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" className="gap-1 px-1.5" />}>
              <span className="sr-only">{m.incident_severity_label()}: </span>
              <span className={cn("inline-flex", pending.severity && UNSAVED)}>
                <SeverityBadge severity={row.severity} />
              </span>
              <ChevronDownIcon aria-hidden className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuGroup>
                <DropdownMenuLabel>{m.incident_severity_label()}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={row.severity}
                  // Base UI also reports a click on the checked item; that would be a refused no-op.
                  onValueChange={(value: Severity) => {
                    if (value !== row.severity) onSeverity(row, value);
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
        </div>
        <div className="md:col-start-4 md:row-span-2 md:row-start-1 md:self-center">
          <DropdownMenu>
            <DropdownMenuTrigger
              data-status-trigger={row.id}
              render={<Button variant="ghost" className="gap-1 px-1.5" />}
            >
              <span className="sr-only">{m.incident_status_label()}: </span>
              <span className={cn("inline-flex", pending.status && UNSAVED)}>
                <StatusBadge status={row.status} />
              </span>
              <ChevronDownIcon aria-hidden className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuGroup>
                <DropdownMenuLabel>{m.incident_status_label()}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={row.status}
                  onValueChange={(value: IncidentStatus) => {
                    if (value !== row.status) onStatus(row, value);
                  }}
                >
                  {/* The current status (checked), then only the moves the lifecycle allows. */}
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
      </div>
      {notices ? <div className="col-span-full mt-2">{notices}</div> : null}
    </li>
  );
}
