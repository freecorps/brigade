import { m, type Locale } from "@freecorps/brigade-i18n";
import { can } from "@freecorps/brigade-schema";
import { useQuery } from "@freecorps/brigade-sync/react";
import { Link } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";
import { useId } from "react";
import { usePreferences } from "@/components/preferences";
import { useMember } from "@/components/session";
import { scheduleAnchor, scheduleGaps, type ScheduleGap } from "@/lib/oncall";

/** Schedules listed by name before "+N more": a notice that runs past a screen stops being read. */
export const GAPS_SHOWN = 5;

/**
 * The overview's warning about schedules with a layer that has nobody in it (RFC 0003 "Schedules", Q20): usually a
 * member who left was its last, and nobody is on call there unless another layer covers it. Each links to its row in
 * the On-call card, on the On call page. Says nothing while every layer has someone, or while the schedules load.
 */
export function OnCallGapsNotice() {
  const { locale } = usePreferences();
  const { role } = useMember();
  const schedules = useQuery("schedules.all", {});
  if (schedules.status !== "ready") return null;
  return (
    <OnCallGapsView
      gaps={scheduleGaps(schedules.rows)}
      manage={can(role, "schedule:manage")}
      locale={locale}
    />
  );
}

export function OnCallGapsView({
  gaps,
  manage,
  locale,
}: {
  gaps: readonly ScheduleGap[];
  manage: boolean;
  locale: Locale;
}) {
  const titleId = useId();
  if (gaps.length === 0) return null;
  const list = new Intl.ListFormat(locale, { type: "conjunction" });
  const more = gaps.length - GAPS_SHOWN;
  return (
    <section
      aria-labelledby={titleId}
      className="flex items-start gap-3 rounded-md border border-amber-600/40 bg-card p-4 text-sm"
    >
      <TriangleAlertIcon
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="font-medium">
            {m.oncall_gaps_title({ count: gaps.length })}
          </h2>
          <p className="max-w-prose text-pretty text-muted-foreground">
            {m.oncall_gaps_hint({ part: manage ? "manage" : "ask" })}
          </p>
        </div>
        <ul className="flex flex-col gap-2">
          {gaps.slice(0, GAPS_SHOWN).map((gap) => (
            <li key={gap.id} className="flex min-w-0 flex-col gap-0.5">
              <Link
                to="/on-call"
                hash={scheduleAnchor(gap.id)}
                className="self-start font-medium underline underline-offset-4 [overflow-wrap:anywhere] hover:no-underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
              >
                {gap.name}
              </Link>
              <span className="text-muted-foreground [overflow-wrap:anywhere]">
                {m.oncall_gaps_layers({ layers: list.format(gap.layers) })}
              </span>
            </li>
          ))}
        </ul>
        {more > 0 ? (
          <Link
            to="/on-call"
            hash="oncall"
            className="self-start text-muted-foreground tabular-nums underline underline-offset-4 hover:no-underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
          >
            {m.oncall_more({ count: more })}
          </Link>
        ) : null}
      </div>
    </section>
  );
}
