import { formatDateTime, m, type Locale } from "@freecorps/brigade-i18n";
import { nextHandoffs, type MemberRow } from "@freecorps/brigade-schema";
import { useQuery } from "@freecorps/brigade-sync/react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ChevronRightIcon, LoaderCircleIcon } from "lucide-react";
import { useMemo } from "react";
import { useNow } from "@/components/incidents-card";
import { usePreferences } from "@/components/preferences";
import { initials } from "@/components/site-header";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FormError } from "@/components/ui/field";
import {
  COVER_LANES,
  COVER_MS,
  coverLane,
  coverTicks,
  memberTint,
  type CoverSegment,
} from "@/lib/cover";
import { queryErrorReason } from "@/lib/incidents";
import { browserTimeZone, memberLabel, UPCOMING_MS } from "@/lib/oncall";

// A member's pale tint (`memberTint`): the chart hues at a step that keeps the ink readable on top in both themes.
const TINTS = ["bg-chart-1/15", "bg-chart-2/15", "bg-chart-3/20", "bg-chart-4/15"] as const;

/** Who each schedule pages over the window, from the shard's schedules and overrides; worked out once a minute. */
function useCover() {
  const schedules = useQuery("schedules.all", {});
  const overrides = useQuery("overrides.all", {});
  const members = useQuery("members.all", {});
  const now = useNow(60_000);
  // Members too: until they load, every name would read "Unnamed member" for a moment.
  const status =
    schedules.status === "error" || overrides.status === "error" || members.status === "error"
      ? "error"
      : schedules.status === "ready" && overrides.status === "ready" && members.status === "ready"
        ? "ready"
        : "loading";
  const lanes = useMemo(
    () =>
      status === "ready"
        ? schedules.rows.map((row) => ({
            row,
            segments: coverLane(row, overrides.rows, now),
            // Who is on now and until their real handoff, looked for as far ahead as the On call page looks: the
            // window's edge is not a handoff, so a lane's first segment cannot say "until" on its own.
            current: nextHandoffs(row, overrides.rows, now, now + UPCOMING_MS, 1)[0],
          }))
        : [],
    [status, schedules.rows, overrides.rows, now],
  );
  return {
    status,
    error: (schedules.error ?? overrides.error ?? members.error)?.code,
    lanes,
    members: members.rows,
    now,
  } as const;
}

/** A time on the viewer's clock: just the time inside the window, with the weekday past it ("Thu 09:00"). */
function clockTime(instant: number, now: number, zone: string, locale: Locale): string {
  return instant - now < COVER_MS
    ? formatDateTime(instant, locale, zone, { timeStyle: "short" })
    : formatDateTime(instant, locale, zone, {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function Avatar({ userId, name, className }: { userId: string; name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-foreground",
        TINTS[memberTint(userId)],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

function AllSchedules() {
  return (
    <Link
      to="/on-call"
      className="-mx-1 inline-flex min-h-11 items-center gap-0.5 rounded-md px-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring pointer-fine:min-h-8"
    >
      {m.overview_cover({ part: "all_schedules", name: "", from: "", to: "" })}
      <ChevronRightIcon aria-hidden className="size-4" />
    </Link>
  );
}

function Loading() {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircleIcon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
      {m.session_loading()}
    </p>
  );
}

/**
 * Who holds the pager now, schedule by schedule, and until when: the question the overview answers first during
 * an incident, beside the incidents it is about. A schedule with nobody on call says so in the destructive colour.
 */
export function OnCallNowCard() {
  const { locale } = usePreferences();
  const { status, error, lanes, members, now } = useCover();
  const zone = useMemo(browserTimeZone, []);
  const shown = lanes.slice(0, COVER_LANES);
  return (
    <Card
      aria-labelledby="oncall-now-title"
      // Its rows run to the card's edges and its foot, like the incidents beside it.
      className={cn("gap-4", shown.length > 0 && "overflow-hidden pb-0 sm:pb-0")}
    >
      <CardHeader className="sm:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
        <CardTitle id="oncall-now-title">
          {m.overview_cover({ part: "now_title", name: "", from: "", to: "" })}
        </CardTitle>
        {lanes.length > 0 ? (
          <CardAction className="max-sm:-mt-2">
            <AllSchedules />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {status === "loading" ? <Loading /> : null}
        {status === "error" ? <FormError>{queryErrorReason(error)}</FormError> : null}
        {status === "ready" && lanes.length === 0 ? (
          <div className="flex flex-col items-start gap-1 text-sm text-muted-foreground">
            <p>{m.oncall_empty()}</p>
            <Link
              to="/on-call"
              className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline pointer-fine:min-h-8"
            >
              {m.overview_cover({ part: "set_up", name: "", from: "", to: "" })}
            </Link>
          </div>
        ) : null}
        {shown.length > 0 ? (
          <ul className="-mx-4 divide-y border-t sm:-mx-6">
            {shown.map(({ row, current }) => {
              const name = current?.userId ? memberLabel(members, current.userId) : null;
              return (
                <li key={row.id} className="flex min-w-0 items-center gap-3 px-4 py-3 sm:px-6">
                  {current?.userId && name ? (
                    <Avatar userId={current.userId} name={name} className="size-8" />
                  ) : (
                    <span
                      aria-hidden
                      className="size-8 shrink-0 rounded-full border border-dashed border-destructive"
                    />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={cn(
                        "truncate text-sm font-medium",
                        name ? undefined : "text-destructive",
                      )}
                    >
                      {name ?? m.oncall_nobody()}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{row.name}</span>
                  </div>
                  {/* No handoff in the weeks ahead (one person, or nobody, for good): no "until". */}
                  {current && current.end < now + UPCOMING_MS ? (
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {m.oncall_until({ time: clockTime(current.end, now, zone, locale) })}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {lanes.length > shown.length ? (
          <p className="-mx-4 border-t px-4 py-3 text-sm text-muted-foreground sm:-mx-6 sm:px-6">
            {m.oncall_more({ count: lanes.length - shown.length })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * The overview's own element: each schedule's next 24 hours as a lane, the people as tinted bars and every stretch
 * with nobody on call hatched in the destructive colour, so a hole in tonight's cover shows before it pages nobody.
 * Nothing while there are no schedules: the On call now card says how to set one up.
 */
export function CoverStrip() {
  const { locale } = usePreferences();
  const { status, lanes, members, now } = useCover();
  const zone = useMemo(browserTimeZone, []);
  const ticks = useMemo(() => coverTicks(now, zone), [now, zone]);
  if (status !== "ready" || lanes.length === 0) return null;
  const shown = lanes.slice(0, COVER_LANES);
  const time = (instant: number) => clockTime(instant, now, zone, locale);
  return (
    <Card aria-labelledby="cover-title" className="gap-4">
      <CardHeader className="sm:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
        <CardTitle id="cover-title">
          {m.overview_cover({ part: "cover_title", name: "", from: "", to: "" })}
        </CardTitle>
        <CardDescription>
          {m.overview_cover({ part: "cover_description", name: "", from: "", to: "" })}
        </CardDescription>
        <CardAction className="max-sm:-mt-1">
          <AllSchedules />
        </CardAction>
      </CardHeader>
      <CardContent>
        {/* Label column, then the window. On phones the label sits over its lane, which takes the full width. */}
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
          <span aria-hidden className="max-sm:hidden" />
          <div aria-hidden className="relative h-5 text-xs text-muted-foreground tabular-nums">
            <span className="absolute left-0 font-medium text-primary">
              {m.overview_cover({ part: "now", name: "", from: "", to: "" })}
            </span>
            {ticks
              .filter((tick) => tick.left > 8 && tick.left < 94)
              .map((tick) => (
                <span
                  key={tick.at}
                  className="absolute -translate-x-1/2"
                  style={{ left: `${tick.left}%` }}
                >
                  {formatDateTime(tick.at, locale, zone, { timeStyle: "short" })}
                </span>
              ))}
          </div>
          {shown.map(({ row, segments }) => (
            <Lane
              key={row.id}
              name={row.name}
              segments={segments}
              members={members}
              ticks={ticks}
              time={time}
            />
          ))}
        </div>
        {lanes.length > shown.length ? (
          <p className="pt-3 text-sm text-muted-foreground">
            {m.oncall_more({ count: lanes.length - shown.length })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Lane({
  name,
  segments,
  members,
  ticks,
  time,
}: {
  name: string;
  segments: readonly CoverSegment[];
  members: readonly MemberRow[];
  ticks: readonly { at: number; left: number }[];
  time: (instant: number) => string;
}) {
  return (
    <>
      <span className="truncate pt-2 text-sm text-muted-foreground sm:py-2" title={name}>
        {name}
      </span>
      <div className="relative my-1 h-8 rounded-md bg-muted/60">
        {ticks.map((tick) => (
          <span
            key={tick.at}
            aria-hidden
            className="absolute inset-y-0 w-px bg-border"
            style={{ left: `${tick.left}%` }}
          />
        ))}
        {/* Now: the window's left edge, in the one hue. */}
        <span
          aria-hidden
          className="absolute -inset-y-1 left-0 z-10 w-0.5 rounded-full bg-primary"
        />
        {/* Read as a list of who is on call when; the bars are its picture. */}
        <ol aria-label={name} className="absolute inset-0">
          {segments.map((segment) => {
            const person = segment.userId ? memberLabel(members, segment.userId) : null;
            const label = m.overview_cover({
              part: "segment",
              name: person ?? m.oncall_nobody(),
              from: time(segment.start),
              to: time(segment.end),
            });
            return (
              <li
                key={segment.start}
                title={label}
                className={cn(
                  "absolute inset-y-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden rounded-[5px] px-1 text-xs font-medium whitespace-nowrap",
                  segment.userId
                    ? cn("text-foreground", TINTS[memberTint(segment.userId)])
                    : "bg-[repeating-linear-gradient(135deg,color-mix(in_oklab,var(--destructive)_35%,transparent)_0_1px,transparent_1px_6px)] px-2 text-destructive ring-1 ring-destructive ring-inset",
                )}
                // A hairline between neighbours, so two shifts of the same tint still read as two.
                style={{
                  left: `calc(${segment.left}% + 1px)`,
                  width: `calc(${segment.width}% - 2px)`,
                }}
              >
                <span className="sr-only">{label}</span>
                {segment.userId && person ? (
                  <Avatar
                    userId={segment.userId}
                    name={person}
                    className="size-5 bg-transparent text-[10px]"
                  />
                ) : null}
                <span aria-hidden className="truncate">
                  {person ?? m.oncall_nobody()}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}
