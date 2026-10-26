import { formatDateTime, formatRelativeTime, m, type Locale } from "@freecorps/brigade-i18n";
import { formatAge, personName, type People } from "@freecorps/brigade-i18n/incident";
import type { Escalation } from "@freecorps/brigade-schema";
import { BellRingIcon, CircleCheckIcon, TimerOffIcon, UsersRoundIcon } from "lucide-react";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { escalationText, nextStep } from "@/lib/escalation";

const LABEL = "text-xs font-medium tracking-wide text-muted-foreground uppercase";

const clock = (at: number, locale: Locale, timeZone: string) =>
  formatDateTime(at, locale, timeZone, { timeStyle: "short" });

/**
 * An incident's escalation run (RFC 0003 "Escalation run"), live with the incident's row: the policy, every level
 * paged and whom, and while it runs what fires next and when. Nothing shows for an incident no policy paged.
 */
export function EscalationProgress({
  run,
  who,
  locale,
  timeZone,
  now,
}: {
  run: Escalation;
  who: People;
  locale: Locale;
  timeZone: string;
  now: number;
}) {
  const running = run.status === "running";
  const next = running ? nextStep(run) : null;
  const ended = run.endedAt ?? run.startedAt;
  const StatusIcon =
    run.status === "running"
      ? BellRingIcon
      : run.status === "exhausted"
        ? TimerOffIcon
        : CircleCheckIcon;
  return (
    <Card aria-labelledby="escalation-progress-title">
      <CardTitle id="escalation-progress-title" className="px-4 sm:px-6">
        {escalationText("*")}
      </CardTitle>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p
            className={
              run.status === "exhausted"
                ? "flex items-start gap-2 font-medium text-amber-700 dark:text-amber-400"
                : "flex items-start gap-2 font-medium"
            }
          >
            <StatusIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0">
              {m.escalation_progress({
                part: run.status,
                time: formatAge(ended, now, locale),
                level: "",
              })}
            </span>
          </p>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {escalationText("policy_named", { name: run.policyName })}
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
          </div>
        ) : null}
        <ol className="flex flex-col gap-3 text-sm">
          {run.pages.map((page, index) => {
            const names = page.userIds.map((id) => personName(id, who));
            return (
              <li key={`${page.round}:${page.level ?? "all"}:${index}`} className="flex gap-3">
                <span
                  aria-hidden
                  className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums"
                >
                  {page.level ?? <UsersRoundIcon className="size-3.5" />}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
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
                      {names.length > 0 ? names.join(", ") : escalationText("nobody_reached")}
                    </p>
                  ) : null}
                  <time
                    className="text-xs text-muted-foreground tabular-nums"
                    dateTime={new Date(page.at).toISOString()}
                    title={formatDateTime(page.at, locale, timeZone)}
                  >
                    {escalationText("paged_at", {
                      time: `${clock(page.at, locale, timeZone)} · ${formatAge(page.at, now, locale)}`,
                    })}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
