import { formatDateTime, formatRelativeTime, m, type Locale } from "@freecorps/brigade-i18n";
import { formatAge, personName, severityName, type People } from "@freecorps/brigade-i18n/incident";
import type {
  Escalation,
  EscalationPage,
  IncidentRow,
  MemberRow,
  OverrideRow,
  ScheduleRow,
  TimelineRow,
} from "@freecorps/brigade-schema";
import {
  BellOffIcon,
  BellRingIcon,
  CalendarClockIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  TriangleAlertIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import {
  escalationText,
  everyoneWhoCanRespond,
  failedDeliveries,
  forecast,
  nextStep,
  runStatus,
  type Forecast,
  type RunStatus,
} from "@/lib/escalation";

const LABEL = "text-xs font-medium text-muted-foreground";
/** A page younger than this shows its clock time alone: "just now" next to it says nothing more. */
const FRESH_MS = 2 * 60_000;

const clock = (at: number, locale: Locale, timeZone: string) =>
  formatDateTime(at, locale, timeZone, { timeStyle: "short" });

/** The run's status line, worded. */
export function statusText(status: RunStatus, who: People, now: number, locale: Locale): string {
  switch (status.kind) {
    case "acknowledged":
      return m.incident_ack({
        part: "by",
        name: personName(status.by, who),
        time: formatAge(status.at, now, locale),
        reason: "",
      });
    case "running":
      return m.escalation_progress({ part: "running", time: "", level: "" });
    case "resolved":
      return m.escalation_progress({
        part: "resolved",
        time: formatAge(status.at, now, locale),
        level: "",
      });
    case "once":
      return m.escalation_progress({
        part: "once",
        time: "",
        level: severityName(status.minSeverity),
      });
    case "fallback": {
      const cause =
        status.reason === "unreachable" && status.later ? "unreachable_later" : status.reason;
      return m.escalation_progress({
        part: `fallback_${cause}${status.nobody ? "_nobody" : ""}`,
        time: "",
        level: "",
      });
    }
  }
}

/**
 * An incident's escalation run (RFC 0003 "Escalation run"), live with the incident's row: how it stands (an ack
 * first, whatever the run's status), while it runs what fires next, when and whom it would page now, then the
 * latest page and the earlier ones folded away, newest first. Each page says whom it reached, whose push failed and
 * whom it could not page. Nothing shows for an incident no policy paged.
 */
export function EscalationProgress({
  run,
  incident,
  who,
  members,
  schedules,
  overrides,
  timeline,
  locale,
  timeZone,
  now,
}: {
  run: Escalation;
  incident: Pick<IncidentRow, "acknowledgedAt" | "acknowledgedBy">;
  who: People;
  members: readonly MemberRow[];
  schedules: readonly ScheduleRow[];
  overrides: readonly OverrideRow[];
  timeline: readonly TimelineRow[];
  locale: Locale;
  timeZone: string;
  now: number;
}) {
  const status = runStatus(run, incident, members, timeline);
  const running = run.status === "running" && status.kind === "running";
  const next = running ? nextStep(run) : null;
  const StatusIcon =
    status.kind === "running"
      ? BellRingIcon
      : status.kind === "acknowledged"
        ? BellOffIcon
        : status.kind === "fallback"
          ? TriangleAlertIcon
          : CircleCheckIcon;
  const failed = failedDeliveries(run, timeline);
  // `pages` keeps the last few: the first page of the run is the one at index `paged - pages.length` from 0.
  const dropped = run.paged - run.pages.length;
  const rows = run.pages.map((page, index) => ({
    page,
    failed: failed[index] ?? new Set<string>(),
    first: dropped + index === 0,
  }));
  const latest = rows.at(-1);
  const earlier = rows.slice(0, -1).reverse();
  const rowProps = { run, who, members, locale, timeZone, now };
  return (
    <Card aria-labelledby="escalation-progress-title">
      <CardTitle id="escalation-progress-title" className="px-4 sm:px-6">
        {escalationText("*")}
      </CardTitle>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p
            className={
              status.kind === "fallback"
                ? "flex items-start gap-2 font-medium text-amber-700 dark:text-amber-400"
                : "flex items-start gap-2 font-medium"
            }
          >
            <StatusIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0">{statusText(status, who, now, locale)}</span>
          </p>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {/* Which policy, and why this one: picked when declared, the alert route, a service of the incident or the monitor that
                opened it names it, or the default. */}
            {run.picked
              ? escalationText("policy_picked", { name: run.policyName })
              : run.route
                ? escalationText("policy_route", { name: run.policyName, who: run.route.name })
                : run.service
                  ? escalationText("policy_service", {
                      name: run.policyName,
                      who: run.service.name,
                    })
                  : run.monitor
                    ? escalationText("policy_monitor", {
                        name: run.policyName,
                        who: run.monitor.name,
                      })
                    : escalationText("policy_default", { name: run.policyName })}
          </p>
        </div>
        {next && run.nextAt !== null ? (
          <div className="flex flex-col gap-0.5 rounded-md bg-muted/50 p-3">
            <p className={LABEL}>{escalationText("next_label")}</p>
            <p className="font-medium tabular-nums">
              {m.escalation_progress({
                part: `next_${next.kind}`,
                level: String(next.level),
                time: clock(run.nextAt, locale, timeZone),
              })}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {formatRelativeTime(run.nextAt, locale, now)}
            </p>
            <NextPeople items={forecast(run, schedules, overrides, now)} who={who} />
          </div>
        ) : null}
        {latest ? (
          <div className="flex flex-col gap-2">
            <p className={LABEL}>{escalationText("latest_label")}</p>
            <PageRow {...rowProps} {...latest} />
          </div>
        ) : null}
        {earlier.length > 0 ? (
          <details className="group text-sm">
            <summary className="-mx-1 flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-md px-1 font-medium text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon
                aria-hidden
                className="size-4 shrink-0 transition-transform duration-150 ease-out group-open:rotate-90 motion-reduce:transition-none"
              />
              {m.escalation_count({ kind: "earlier", count: earlier.length })}
            </summary>
            <ol className="flex flex-col gap-3 pt-2">
              {earlier.map((row, index) => (
                <li key={`${row.page.at}:${row.page.round}:${row.page.level ?? "all"}:${index}`}>
                  <PageRow {...rowProps} {...row} />
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Whom the next level would page if it fired now: a forecast (a schedule pages whoever is on call then). */
function NextPeople({ items, who }: { items: Forecast[]; who: People }) {
  if (items.length === 0) return null;
  const label = escalationText("forecast");
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <p aria-hidden className="text-xs text-muted-foreground">
        {label}
      </p>
      <ul aria-label={label} className="flex flex-wrap gap-1.5 text-sm">
        {items.map((item) => {
          const Icon = item.kind === "schedule" ? CalendarClockIcon : UserRoundIcon;
          const label =
            item.kind === "member"
              ? personName(item.id, who)
              : item.onCall === null
                ? escalationText("schedule_gap", {
                    name: item.name ?? escalationText("deleted_schedule"),
                  })
                : escalationText("schedule_now", {
                    name: item.name ?? escalationText("deleted_schedule"),
                    who: personName(item.onCall, who),
                  });
          const gap = item.kind === "schedule" && item.onCall === null;
          return (
            <li
              key={`${item.kind}:${item.id}`}
              className={
                gap
                  ? "inline-flex max-w-full items-start gap-1.5 rounded-md border border-amber-600/40 bg-card px-2 py-1 text-amber-700 dark:text-amber-400"
                  : "inline-flex max-w-full items-start gap-1.5 rounded-md border bg-card px-2 py-1"
              }
            >
              <Icon aria-hidden className="mt-0.5 size-4 shrink-0 opacity-70" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One page of the run: the level (or everyone), whom it reached, whose push failed, whom it could not page. */
function PageRow({
  page,
  failed,
  first,
  run,
  who,
  members,
  locale,
  timeZone,
  now,
}: {
  page: EscalationPage;
  failed: ReadonlySet<string>;
  /** The run's first page: whoever caused it counts as reached without a push. */
  first: boolean;
  run: Escalation;
  who: People;
  members: readonly MemberRow[];
  locale: Locale;
  timeZone: string;
  now: number;
}) {
  const [showNames, setShowNames] = useState(false);
  const namesId = useId();
  const reached = page.userIds.map((id) => {
    const name = personName(id, who);
    if (first && id === run.causedBy) {
      return id === who.self
        ? escalationText("declarer_you")
        : escalationText("declarer", { name });
    }
    return failed.has(id) ? m.escalation_miss({ reason: "failed", name }) : name;
  });
  const misses = page.missed.map((miss) =>
    m.escalation_miss({
      reason: miss.reason,
      name: miss.userId === null ? (miss.schedule ?? "") : personName(miss.userId, who),
    }),
  );
  const more = page.missedCount - page.missed.length;
  const everyone = page.level === null ? everyoneWhoCanRespond(members, run.causedBy) : [];
  const age = now - Math.min(page.at, now);
  const time = clock(page.at, locale, timeZone);
  return (
    <div className="flex gap-3 text-sm">
      <span
        aria-hidden
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums"
      >
        {page.level ?? <UsersRoundIcon className="size-3.5" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="font-medium">
          {page.level === null
            ? escalationText("everyone")
            : escalationText("level", {
                level: m.escalation_level_round({
                  level: String(page.level),
                  round: String(page.round),
                }),
              })}
        </p>
        {page.level !== null ? (
          <p className="text-muted-foreground [overflow-wrap:anywhere]">
            {reached.length > 0 ? reached.join(", ") : escalationText("nobody_reached")}
          </p>
        ) : everyone.length > 0 ? (
          <div className="flex flex-col items-start gap-1">
            <Button
              type="button"
              variant="ghost"
              className="-ml-2 h-auto min-h-11 pointer-fine:h-auto px-2 font-normal text-muted-foreground"
              aria-expanded={showNames}
              aria-controls={namesId}
              onClick={() => setShowNames((shown) => !shown)}
            >
              {m.incident_page({ part: showNames ? "hide_names" : "show_names" })}
            </Button>
            <p
              id={namesId}
              hidden={!showNames}
              className="text-muted-foreground [overflow-wrap:anywhere]"
            >
              {everyone.map((member) => personName(member.id, who)).join(", ")}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground">{escalationText("nobody_reached")}</p>
        )}
        {page.unreached !== undefined && page.level !== null ? (
          <p className="text-muted-foreground">
            {escalationText("early", { level: String(page.unreached) })}
          </p>
        ) : null}
        {misses.length > 0 ? (
          <p className="text-amber-700 [overflow-wrap:anywhere] dark:text-amber-400">
            {escalationText("missed")}: {misses.join(", ")}
            {more > 0 ? ` ${m.escalation_count({ kind: "more_missed", count: more })}` : null}
          </p>
        ) : null}
        <time
          className="text-xs text-muted-foreground tabular-nums"
          dateTime={new Date(page.at).toISOString()}
          title={formatDateTime(page.at, locale, timeZone)}
        >
          {escalationText("paged_at", {
            time: age < FRESH_MS ? time : `${time} · ${formatAge(page.at, now, locale)}`,
          })}
        </time>
      </div>
    </div>
  );
}
