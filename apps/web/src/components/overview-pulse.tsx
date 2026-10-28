// The overview's pulse: the three figures the first screen leads with (active incidents, monitors, follow-ups), a
// compact read of every monitor's recent checks, and the last day of alerts. Counted in src/lib/pulse.ts from rows
// the shard already syncs; drawn with the bklit charts (src/components/charts), which animate in on their own and
// keep only the fade under reduced motion.
import { formatNumber, m } from "@freecorps/brigade-i18n";
import { severityLabels } from "@freecorps/brigade-i18n/labels";
import type { MonitorRow, Severity } from "@freecorps/brigade-schema";
import { useQuery } from "@freecorps/brigade-sync/react";
import NumberFlow, { useIsSupported } from "@number-flow/react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";
import { useMemo } from "react";
import { Bar } from "@/components/charts/bar";
import { BarChart } from "@/components/charts/bar-chart";
import { BarXAxis } from "@/components/charts/bar-x-axis";
import { Ring } from "@/components/charts/ring";
import { RingChart } from "@/components/charts/ring-chart";
import { AreaSparkline } from "@/components/charts/sparkline";
import { ChartTooltip } from "@/components/charts/tooltip";
import { useNow } from "@/components/incidents-card";
import { usePreferences } from "@/components/preferences";
import { Card, CARD_X, CardHeader, CardList } from "@/components/ui/card";
import { localDate } from "@/lib/follow-ups";
import { formatLatency, monitorBadge, type MonitorBadge } from "@/lib/monitors";
import {
  alertsByHour,
  incidentsBySeverity,
  latencySeries,
  latestLatencies,
  monitorsByState,
  MONITOR_STATES,
  recentUpShare,
} from "@/lib/pulse";

const say = (part: string, inputs: { count?: string; total?: string; share?: string } = {}) =>
  m.overview_pulse({ part, count: "", total: "", share: "", ...inputs });

/** Each severity's chart colour: the badge fills, the same marks the incident rows carry. */
const SEVERITY_COLORS: Record<Severity, string> = {
  sev1: "var(--color-sev1)",
  sev2: "var(--color-sev2-foreground)",
  sev3: "var(--color-sev3-foreground)",
  sev4: "var(--color-sev4-foreground)",
};

/** Each monitor state's colour, as the monitors page's badges: red down, amber no data, green up, grey otherwise. */
const STATE_COLORS: Record<MonitorBadge, string> = {
  down: "var(--color-sev1)",
  unknown: "var(--color-sev3-foreground)",
  pending: "var(--color-muted-foreground)",
  up: "var(--color-status-resolved-foreground)",
  paused: "var(--color-status-declined-foreground)",
};

/**
 * The three figures, in one card split by rules: a figure that counts on screen (NumberFlow), what it means in a line,
 * and a ring for its parts. Each cell opens its section. Phones stack them.
 */
export function PulseStrip() {
  const { locale } = usePreferences();
  const incidents = useQuery("incidents.active", {});
  const monitors = useQuery("monitors.all", {});
  const followUps = useQuery("followUps.open", {});
  const now = useNow(60_000);
  const today = localDate(now);

  const bySeverity = incidentsBySeverity(incidents.rows);
  const byState = monitorsByState(monitors.rows);
  const watched = monitors.rows.length - byState.paused;
  const overdue = followUps.rows.filter(
    (row) => row.dueDate !== null && row.dueDate < today,
  ).length;

  return (
    <Card aria-label={m.nav({ part: "overview" })} className="gap-0 py-0 sm:py-0">
      <ul className="grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
        <PulseCell
          to="/incidents"
          link={say("incidents_link")}
          label={say("incidents_label")}
          value={incidents.status === "ready" ? incidents.rows.length : null}
          note={
            incidents.status !== "ready"
              ? null
              : incidents.rows.length === 0
                ? say("incidents_clear")
                : bySeverity
                    .filter((part) => part.count > 0)
                    .map(
                      (part) =>
                        `${formatNumber(part.count, locale)} ${part.severity.toUpperCase()}`,
                    )
                    .join(" · ")
          }
          tone={bySeverity[0]!.count > 0 ? "text-destructive" : undefined}
          rings={bySeverity.map((part) => ({
            label: severityLabels[part.severity](),
            value: part.count,
            maxValue: Math.max(incidents.rows.length, 1),
            color: SEVERITY_COLORS[part.severity],
          }))}
        />
        <PulseCell
          to="/monitors"
          link={say("monitors_link")}
          label={say("monitors_label")}
          value={monitors.status === "ready" ? byState.up : null}
          suffix={
            monitors.status === "ready" && watched > 0
              ? `/${formatNumber(watched, locale)}`
              : undefined
          }
          note={
            monitors.status !== "ready"
              ? null
              : monitors.rows.length === 0
                ? say("monitors_none")
                : say("monitors_up", {
                    count: formatNumber(byState.up, locale),
                    total: formatNumber(watched, locale),
                  })
          }
          tone={byState.down > 0 ? "text-destructive" : undefined}
          rings={(["up", "down", "unknown"] as const).map((state) => ({
            label: m.monitor_status({ status: state }),
            value: byState[state],
            maxValue: Math.max(watched, 1),
            color: STATE_COLORS[state],
          }))}
        />
        <PulseCell
          to="/follow-ups"
          link={say("follow_link")}
          label={say("follow_label")}
          value={followUps.status === "ready" ? followUps.rows.length : null}
          note={
            followUps.status !== "ready"
              ? null
              : overdue > 0
                ? say("follow_overdue", { count: formatNumber(overdue, locale) })
                : say("follow_none")
          }
          tone={overdue > 0 ? "text-destructive" : undefined}
          rings={[
            {
              label: say("follow_overdue", { count: "" }).replace(/[:\s]+$/, ""),
              value: overdue,
              maxValue: Math.max(followUps.rows.length, 1),
              color: "var(--color-destructive)",
            },
            {
              label: say("follow_label"),
              value: followUps.rows.length - overdue,
              maxValue: Math.max(followUps.rows.length, 1),
              color: "var(--color-chart-1)",
            },
          ]}
        />
      </ul>
    </Card>
  );
}

function PulseCell({
  to,
  link,
  label,
  value,
  suffix,
  note,
  tone,
  rings,
}: {
  to: "/incidents" | "/monitors" | "/follow-ups";
  /** The link's accessible name: where it goes. */
  link: string;
  label: string;
  /** Null while it loads. */
  value: number | null;
  suffix?: string;
  note: string | null;
  /** The note's colour when it reports something wrong. */
  tone?: string;
  rings: { label: string; value: number; maxValue: number; color: string }[];
}) {
  return (
    <li className="relative">
      <Link
        to={to}
        aria-label={`${label}: ${link}`}
        className={cn(
          "group/pulse flex items-center gap-4 py-5 outline-none transition-colors duration-(--brigade-duration-fast) ease-out hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset",
          CARD_X,
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm text-muted-foreground">{label}</span>
          {value === null ? (
            <span aria-hidden className="my-1.5 block h-7 w-16 rounded-sm bg-muted" />
          ) : (
            <span className="flex items-baseline text-3xl leading-10 font-semibold tabular-nums">
              <Figure value={value} />
              {suffix ? (
                <span className="text-lg font-normal text-muted-foreground">{suffix}</span>
              ) : null}
            </span>
          )}
          <span className={cn("min-h-5 truncate text-sm text-muted-foreground", tone)}>{note}</span>
        </div>
        {/* Decorative: the figure and its note say the same in words. */}
        <div aria-hidden className="shrink-0">
          <RingChart
            data={rings}
            size={76}
            strokeWidth={6}
            ringGap={3}
            baseInnerRadius={value === null ? 18 : 38 - rings.length * 9}
          >
            {rings.map((ring, index) => (
              <Ring key={ring.label} index={index} color={ring.color} />
            ))}
          </RingChart>
        </div>
        <ChevronRightIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-(--brigade-duration-fast) ease-out group-hover/pulse:opacity-100 group-focus-visible/pulse:opacity-100"
        />
      </Link>
    </li>
  );
}

/** A figure that rolls to its new value (NumberFlow), or plain text where the browser cannot animate it. */
function Figure({ value }: { value: number }) {
  const { locale } = usePreferences();
  const supported = useIsSupported();
  return supported ? (
    <NumberFlow value={value} locales={locale} />
  ) : (
    <span>{formatNumber(value, locale)}</span>
  );
}

/** How many monitors the overview lists: the ones that need someone first, then the rest, up to this. */
const GLANCE_ROWS = 6;

/** Every monitor in a line: its state, its recent latency as a small area, the latest latency per region. */
export function MonitorsGlance() {
  const { locale } = usePreferences();
  const monitors = useQuery("monitors.all", {});
  if (monitors.status !== "ready" || monitors.rows.length === 0) return null;
  const order = (row: MonitorRow) => MONITOR_STATES.indexOf(monitorBadge(row));
  const rows = [...monitors.rows]
    .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
    .slice(0, GLANCE_ROWS);
  return (
    <Card aria-labelledby="monitors-glance-title">
      <CardHeader
        id="monitors-glance-title"
        title={say("glance_title")}
        count={formatNumber(monitors.rows.length, locale)}
        description={say("glance_description")}
        action={
          <Link
            to="/monitors"
            className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline pointer-fine:min-h-8"
          >
            {say("glance_all")}
            <ChevronRightIcon aria-hidden className="size-4" />
          </Link>
        }
      />
      <CardList>
        {rows.map((row) => (
          <GlanceRow key={row.id} row={row} />
        ))}
      </CardList>
    </Card>
  );
}

function GlanceRow({ row }: { row: MonitorRow }) {
  const { locale } = usePreferences();
  const badge = monitorBadge(row);
  const series = useMemo(() => latencySeries(row.history), [row.history]);
  const share = recentUpShare(row.history);
  const latest = latestLatencies(row);
  const average =
    latest.length === 0
      ? null
      : Math.round(latest.reduce((sum, check) => sum + check.latency, 0) / latest.length);
  const failing = latest.filter((check) => !check.up).length;
  const percent =
    share === null
      ? null
      : formatNumber(share / 100, locale, { style: "percent", maximumFractionDigits: 1 });
  // Up says it with its share alone; any other state leads with its name.
  const note =
    badge === "up" && percent !== null
      ? say("recent_up", { share: percent })
      : [m.monitor_status({ status: badge }), percent && say("recent_up", { share: percent })]
          .filter(Boolean)
          .join(" · ");
  return (
    <li
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 py-3 md:grid-cols-[--spacing(56)_minmax(0,1fr)_--spacing(24)]",
        CARD_X,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            badge === "down" && "animate-pulse motion-reduce:animate-none",
          )}
          style={{ backgroundColor: STATE_COLORS[badge] }}
        />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{row.name}</span>
          <span className="truncate text-xs text-muted-foreground">{note}</span>
        </div>
      </div>
      {/* The shape of the recent latencies; the row's figure says the latest in words. */}
      <div aria-hidden className="h-9 min-w-0 max-md:hidden">
        {series.length > 1 ? (
          <AreaSparkline
            data={series}
            dataKey="latency"
            height={36}
            color={
              STATE_COLORS[
                badge === "up" || badge === "down" || badge === "unknown" ? badge : "pending"
              ]
            }
            fillOpacity={0.18}
            strokeWidth={1.5}
            interactive={false}
          />
        ) : (
          <span className="flex h-full items-center text-xs text-muted-foreground">
            {say("no_history")}
          </span>
        )}
      </div>
      {/* The latest latency, averaged over the regions; each region's own is in the title. */}
      <p
        className="flex flex-col items-end text-right tabular-nums"
        title={latest
          .map((check) => `${check.source} ${formatLatency(check.latency, locale)}`)
          .join(" · ")}
      >
        <span className="font-medium">
          {average === null ? "—" : formatLatency(average, locale)}
        </span>
        <span className={cn("text-xs text-muted-foreground", failing > 0 && "text-destructive")}>
          {failing > 0
            ? say("regions_down", {
                count: formatNumber(failing, locale),
                total: formatNumber(latest.length, locale),
              })
            : say("regions", { count: formatNumber(latest.length, locale) })}
        </span>
      </p>
    </li>
  );
}

/** The last day of alerts from every alert source, an hour to a bar; nothing until a source exists. */
export function AlertsDay() {
  const { locale } = usePreferences();
  const sources = useQuery("alertSources.all", {});
  const alerts = useQuery("sourceAlerts.recent", {});
  const now = useNow(60_000);
  const hours = useMemo(() => alertsByHour(alerts.rows, now), [alerts.rows, now]);
  if (sources.status !== "ready" || sources.rows.length === 0) return null;
  const hourFormat = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  const data = hours.map((bucket) => ({
    label: hourFormat.format(bucket.hour),
    count: bucket.count,
  }));
  const total = hours.reduce((sum, bucket) => sum + bucket.count, 0);
  return (
    <Card aria-labelledby="alerts-day-title">
      <CardHeader
        id="alerts-day-title"
        title={say("alerts_title")}
        count={say("alerts_total", { count: formatNumber(total, locale) })}
        description={say("alerts_description")}
      />
      <div className={cn("h-40", CARD_X)}>
        <BarChart
          data={data}
          xDataKey="label"
          aspectRatio="auto"
          className="h-full"
          margin={{ top: 8, right: 0, bottom: 24, left: 0 }}
        >
          <Bar dataKey="count" fill="var(--color-chart-1)" lineCap={2} />
          <BarXAxis maxLabels={6} />
          <ChartTooltip
            showDatePill={false}
            rows={(point) => [
              {
                color: "var(--color-chart-1)",
                label: say("alerts_row"),
                value: formatNumber(Number(point.count), locale),
              },
            ]}
          />
        </BarChart>
      </div>
    </Card>
  );
}
