import { m, type Locale } from "@freecorps/brigade-i18n";
import { can, type MonitorCheck, type MonitorRow } from "@freecorps/brigade-schema";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { cn } from "cn";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CirclePauseIcon,
  OctagonAlertIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { MonitorForm } from "@/components/monitor-form";
import { usePreferences } from "@/components/preferences";
import { useMember } from "@/components/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/ui/field";
import { formatAge, mutationErrorReason, queryErrorReason } from "@/lib/incidents";
import {
  formatLatency,
  formatSeconds,
  monitorBadge,
  newHeartbeat,
  type CheckedDraft,
  type MonitorBadge,
} from "@/lib/monitors";
import type { MutationOutcome } from "@freecorps/brigade-sync";

/** Down is the only solid fill, like SEV1: it is what pages people. */
const BADGES: Record<
  MonitorBadge,
  { variant: "sev1" | "resolved" | "declined" | "outline"; icon: LucideIcon }
> = {
  down: { variant: "sev1", icon: OctagonAlertIcon },
  up: { variant: "resolved", icon: CircleCheckIcon },
  pending: { variant: "outline", icon: CircleDashedIcon },
  paused: { variant: "declined", icon: CirclePauseIcon },
};

/**
 * The workspace's monitors, live from its shard (`useQuery("monitors.all")`): status, the last result from each
 * region with the colo it really ran from, and for owners and admins the create form and pause/resume.
 */
export function MonitorsCard() {
  const { locale } = usePreferences();
  const { workspaceId, role } = useMember();
  const manage = can(role, "monitor:manage");
  const { rows, status, error } = useQuery("monitors.all", {});
  const createHttp = useMutation("monitor.createHttp");
  const createHeartbeat = useMutation("monitor.createHeartbeat");
  const setPaused = useMutation("monitor.setPaused");
  const [adding, setAdding] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  /** The heartbeat URL, shown once after its monitor was created (only its hash is stored). */
  const [ping, setPing] = useState<{ url: string; interval: number } | null>(null);
  const now = useNow(20_000);

  const report = (name: string) => (outcome: MutationOutcome) => {
    if (!outcome.ok) {
      setRefused(
        m.monitor_change_failed({ name, reason: mutationErrorReason(outcome.error.code) }),
      );
    }
    return outcome.ok;
  };
  const onCreate = async (checked: Extract<CheckedDraft, { ok: true }>) => {
    setRefused(null);
    if (checked.kind === "http") {
      void createHttp(checked.args).then(report(checked.args.name));
      setAdding(false);
      return true;
    }
    const heartbeat = await newHeartbeat(window.location.origin, workspaceId, checked.args.id);
    void createHeartbeat({ ...checked.args, tokenHash: heartbeat.tokenHash }).then((outcome) => {
      // A refused monitor's URL would never work: take it back.
      if (!report(checked.args.name)(outcome)) setPing(null);
    });
    setPing({ url: heartbeat.url, interval: checked.args.intervalSeconds });
    setAdding(false);
    return true;
  };
  const onPause = (row: MonitorRow) =>
    void setPaused({ id: row.id, paused: !row.paused }).then(report(row.name));

  const down = rows.filter((row) => monitorBadge(row) === "down").length;
  return (
    <Card
      aria-labelledby="monitors-title"
      className={cn(rows.length > 0 && "overflow-hidden pb-0 sm:pb-0")}
    >
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <div className="flex min-h-6 items-center justify-between gap-4">
          <CardTitle id="monitors-title" className="truncate">
            {m.monitors_title()}
          </CardTitle>
          {manage && !adding ? (
            <Button variant="outline" onClick={() => setAdding(true)}>
              <PlusIcon aria-hidden />
              {m.monitor_add()}
            </Button>
          ) : null}
        </div>
        <div className="flex h-6 items-center gap-2 text-sm whitespace-nowrap text-muted-foreground tabular-nums">
          {status === "ready" ? (
            <>
              <span>{m.monitors_count({ count: rows.length })}</span>
              {down > 0 ? (
                <Badge variant="sev1">
                  <OctagonAlertIcon aria-hidden />
                  {m.monitors_down_count({ count: down })}
                </Badge>
              ) : null}
            </>
          ) : status === "error" ? null : (
            <span aria-hidden className="block h-4 w-24 rounded-sm bg-muted" />
          )}
        </div>
      </div>

      <CardContent className="flex flex-col gap-5">
        {adding ? <MonitorForm onCreate={onCreate} onCancel={() => setAdding(false)} /> : null}
        {ping ? <PingUrl {...ping} locale={locale} onDismiss={() => setPing(null)} /> : null}
        {refused ? <FormError>{refused}</FormError> : null}
        {status === "error" ? <FormError>{queryErrorReason(error?.code)}</FormError> : null}

        {rows.length > 0 ? (
          <ul aria-labelledby="monitors-title" className="-mx-4 divide-y border-t sm:-mx-6">
            {rows.map((row) => (
              <MonitorItem
                key={row.id}
                row={row}
                locale={locale}
                now={now}
                onPause={manage ? onPause : undefined}
              />
            ))}
          </ul>
        ) : status === "ready" ? (
          <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
            {m.monitors_empty()}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * One monitor. Phones stack the badge and name, the target, then the results; from `md` the badge, name and
 * results sit in columns so the badges line up down the list.
 */
function MonitorItem({
  row,
  locale,
  now,
  onPause,
}: {
  row: MonitorRow;
  locale: Locale;
  now: number;
  onPause?: (row: MonitorRow) => void;
}) {
  const nameId = useId();
  const badge = monitorBadge(row);
  const { variant, icon: Icon } = BADGES[badge];
  const latest = row.checks.reduce<MonitorCheck | undefined>(
    (last, check) => (last && last.at >= check.at ? last : check),
    undefined,
  );
  return (
    <li
      data-monitor={row.id}
      className={cn(
        "relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-4 py-3 sm:px-6",
        "md:grid-cols-[--spacing(28)_minmax(0,1fr)_minmax(0,16rem)_auto]",
        badge === "down" &&
          "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-sev1",
      )}
    >
      <div className="col-start-1 row-start-1 md:col-auto">
        <Badge variant={variant}>
          <Icon aria-hidden />
          {m.monitor_status({ status: badge })}
        </Badge>
      </div>
      <div className="col-span-2 row-start-2 flex min-w-0 flex-col gap-0.5 md:col-span-1 md:row-start-1">
        <p
          id={nameId}
          className="line-clamp-2 font-medium [overflow-wrap:anywhere]"
          title={row.name}
        >
          {row.name}
        </p>
        <p
          className="truncate text-sm text-muted-foreground"
          title={row.kind === "http" ? (row.url ?? undefined) : undefined}
        >
          {row.kind === "http" ? (
            <>
              <span className="font-medium">{row.method}</span> {row.url}
            </>
          ) : (
            m.monitor_heartbeat_every({ interval: formatSeconds(row.intervalSeconds, locale) })
          )}
        </p>
      </div>
      <div className="col-span-2 row-start-3 flex min-w-0 flex-col gap-1 text-sm md:col-span-1 md:row-start-1">
        {row.checks.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {row.checks.map((check) => (
              <CheckChip key={check.source} check={check} locale={locale} />
            ))}
          </ul>
        ) : null}
        {latest ? (
          <p className="text-muted-foreground">
            {m.monitor_last_result({
              kind: row.kind,
              when: formatAge(Math.min(latest.at, now), now, locale),
            })}
          </p>
        ) : null}
      </div>
      {onPause ? (
        <div className="col-start-2 row-start-1 justify-self-end md:col-auto">
          <Button variant="ghost" aria-describedby={nameId} onClick={() => onPause(row)}>
            {row.paused ? <PlayIcon aria-hidden /> : <PauseIcon aria-hidden />}
            {m.monitor_pause_action({ action: row.paused ? "resume" : "pause" })}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** One source's last result: where it really ran from (the colo, never the hint) and how long it took. */
function CheckChip({ check, locale }: { check: MonitorCheck; locale: Locale }) {
  const where =
    check.source === "heartbeat"
      ? m.monitor_kind({ kind: "heartbeat" })
      : m.monitor_region({ region: check.source });
  return (
    <li
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-sm border px-2 text-xs whitespace-nowrap tabular-nums",
        check.up ? "border-border text-muted-foreground" : "border-destructive/50 text-destructive",
      )}
    >
      {check.up ? (
        <CircleCheckIcon aria-hidden className="size-3 shrink-0 text-status-resolved-foreground" />
      ) : (
        <OctagonAlertIcon aria-hidden className="size-3 shrink-0" />
      )}
      <span>{where}</span>
      {check.colo === null ? null : (
        <span className="font-medium text-foreground">{check.colo}</span>
      )}
      {check.latencyMs === null ? null : <span>{formatLatency(check.latencyMs, locale)}</span>}
      {check.httpStatus === null || check.up ? null : <span>HTTP {check.httpStatus}</span>}
    </li>
  );
}

/** The heartbeat URL, once: the shard keeps only its hash, so it cannot be shown again. */
function PingUrl({
  url,
  interval,
  locale,
  onDismiss,
}: {
  url: string;
  interval: number;
  locale: Locale;
  onDismiss: () => void;
}) {
  const textId = useId();
  return (
    <div className="flex items-start gap-3 rounded-md border border-primary/40 bg-primary/5 py-1 pr-1 pl-3 text-sm">
      <div className="flex min-w-0 flex-1 flex-col gap-2 py-2">
        <p id={textId}>
          {m.monitor_heartbeat_ready({ interval: formatSeconds(interval, locale) })}
        </p>
        <input
          readOnly
          value={url}
          aria-labelledby={textId}
          onFocus={(event) => event.currentTarget.select()}
          className="h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 font-mono text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring"
        />
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={m.dismiss()}
        aria-describedby={textId}
        onClick={onDismiss}
      >
        <XIcon aria-hidden />
      </Button>
    </div>
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
