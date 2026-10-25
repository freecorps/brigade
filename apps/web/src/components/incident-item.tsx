import { formatDateTime, formatRelativeTime, m, type Locale } from "@freecorps/brigade-i18n";
import { incidentStatusLabels, severityLabels } from "@freecorps/brigade-i18n/labels";
import {
  formatIncidentNumber,
  SEVERITIES,
  type IncidentRow,
  type IncidentStatus,
  type Severity,
} from "@freecorps/brigade-schema";
import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
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
  pending: boolean;
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
  return (
    <li
      data-incident={row.id}
      aria-busy={pending}
      className={cn(
        "relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-6",
        "md:grid-cols-[--spacing(24)_minmax(0,1fr)_--spacing(40)_--spacing(40)]",
        row.severity === "sev1" &&
          "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-sev1",
      )}
    >
      <div className="md:row-span-2">
        {number ? (
          <span className="font-mono text-sm font-medium text-muted-foreground tabular-nums">
            {number}
          </span>
        ) : (
          <span className="inline-flex rounded-sm border border-dashed px-1.5 py-0.5 text-xs leading-tight text-muted-foreground">
            {m.incident_unnumbered()}
          </span>
        )}
      </div>
      <p className="justify-self-end text-xs text-muted-foreground md:col-start-2 md:row-start-2 md:justify-self-start">
        <time
          dateTime={new Date(row.declaredAt).toISOString()}
          title={formatDateTime(row.declaredAt, locale, TIME_ZONE)}
        >
          {m.incident_declared({ time: declared })}
        </time>
        {pending ? ` · ${online ? m.incident_saving() : m.incident_queued()}` : null}
      </p>
      <h3 className="col-span-2 font-semibold [overflow-wrap:anywhere] md:col-span-1 md:col-start-2 md:row-start-1">
        {row.title}
      </h3>
      {/* Phones: both menus on one line, and -mb-2 trims the space under the 44px triggers without shrinking
          them. From md the wrapper dissolves and each menu takes its own column. */}
      <div className="col-span-2 -mb-2 -ml-1.5 flex flex-wrap items-center gap-1 md:contents">
        <div className="md:col-start-3 md:row-span-2 md:row-start-1">
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
                  // Base UI also reports a click on the checked item; that would be a refused no-op.
                  onValueChange={(value: Severity) => {
                    if (value !== row.severity) onSeverity(row, value);
                  }}
                >
                  {SEVERITIES.map((option) => (
                    <DropdownMenuRadioItem
                      key={option}
                      value={option}
                      disabled={option === row.severity}
                      closeOnClick
                    >
                      <span className="font-bold">{option.toUpperCase()}</span>
                      {severityLabels[option]()}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="md:col-start-4 md:row-span-2 md:row-start-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              data-status-trigger={row.id}
              render={<Button variant="ghost" className="gap-1 px-1.5" />}
            >
              <span className="sr-only">{m.incident_status_label()}: </span>
              <StatusBadge status={row.status} />
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
                  {/* The current status, checked and inert, then only the moves the lifecycle allows. */}
                  {[row.status, ...nextStatuses(row.status)].map((option) => {
                    const Icon = STATUS_ICONS[option];
                    return (
                      <DropdownMenuRadioItem
                        key={option}
                        value={option}
                        disabled={option === row.status}
                        closeOnClick
                      >
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
