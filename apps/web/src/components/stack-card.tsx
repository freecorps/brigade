import { formatNumber, m, type Locale } from "@freecorps/brigade-i18n";
import { cn } from "cn";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { usePreferences } from "@/components/preferences";
import { useStackStatus } from "@/components/stack-status";
import { formatBytes, formatClock } from "@/lib/format";
import {
  CHECK_TIMEOUT_MS,
  DEMO_WORKSPACE,
  verdict,
  type CheckFailure,
  type CheckResult,
  type StackVerdict,
} from "@/lib/stack";

const DEV_COMMAND = "vp run dev";

// One spinner per check: the verdict's on the first load (nothing to show yet), the button's on a
// re-check (the last result stays, dimmed, until the new one lands). Under reduced motion the
// verdict shows a static icon instead of a frozen spinner; the button keeps its refresh icon.

export function StackCard() {
  const { locale } = usePreferences();
  const { report, checking, recheck } = useStackStatus();
  const state: StackVerdict | "checking" = report ? verdict(report) : "checking";
  const rechecking = checking && report !== undefined;
  const onRecheck = checking ? undefined : recheck;

  return (
    <Card aria-labelledby="stack-title" aria-busy={checking}>
      <CardHeader>
        <CardTitle id="stack-title">{m.stack_title()}</CardTitle>
        <CardDescription className="tabular-nums">
          {/* First load: the verdict already says it is checking. A re-check says so here, since
              the verdict below is the previous result. */}
          {!report ? (
            <Placeholder className="my-0.5 h-4 w-32" />
          ) : checking ? (
            m.stack_checking()
          ) : (
            m.stack_checked_at({ time: formatClock(report.checkedAt, locale) })
          )}
        </CardDescription>
        <CardAction>
          <CheckAgainButton onClick={onRecheck} busy={checking} spinning={rechecking} />
        </CardAction>
      </CardHeader>

      <CardContent
        data-stale={rechecking || undefined}
        className="flex flex-col gap-5 transition-opacity duration-(--brigade-duration-base) ease-out data-stale:opacity-60"
      >
        <Verdict state={state} />

        <ul className="grid overflow-hidden rounded-md border sm:grid-cols-2">
          <CheckRow
            label={m.stack_api_label()}
            route="GET /api/health"
            result={report?.health}
            okLabel={m.stack_reachable()}
            failLabel={m.stack_unreachable()}
            locale={locale}
            figures={[m.stack_round_trip()]}
          >
            {(health) => [formatMs(health.ms, locale)]}
          </CheckRow>
          <CheckRow
            label={m.stack_do_label()}
            route={`GET /api/workspaces/${DEMO_WORKSPACE}`}
            // With the API Worker down this check says nothing new: one fault, one red signal.
            result={state === "api-down" ? "skipped" : report?.workspace}
            okLabel={m.stack_answered()}
            failLabel={m.stack_no_answer()}
            locale={locale}
            figures={[m.stack_round_trip(), m.stack_tables(), m.stack_database_size()]}
            className="max-sm:border-t sm:border-l"
          >
            {(workspace) => [
              formatMs(workspace.ms, locale),
              formatNumber(workspace.data.tables, locale),
              formatBytes(workspace.data.databaseSize, locale),
            ]}
          </CheckRow>
        </ul>

        {state === "api-down" || state === "do-down" ? (
          <div className="flex flex-col items-start gap-3 rounded-md bg-muted p-4 text-sm">
            <p>{state === "api-down" ? m.stack_hint_start() : m.stack_hint_do()}</p>
            <code className="rounded-sm bg-card px-2 py-1 text-foreground">{DEV_COMMAND}</code>
            <CheckAgainButton onClick={onRecheck} busy={checking} spinning={false} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CheckAgainButton({
  onClick,
  busy,
  spinning,
}: {
  onClick: (() => void) | undefined;
  busy: boolean;
  spinning: boolean;
}) {
  return (
    <Button variant="outline" onClick={onClick} aria-disabled={busy || undefined}>
      <RefreshCwIcon
        aria-hidden
        className={cn(spinning && "animate-spin motion-reduce:animate-none")}
      />
      {m.stack_check_again()}
    </Button>
  );
}

const VERDICTS: Record<
  StackVerdict | "checking",
  { icon: LucideIcon; text: () => string; tone: string }
> = {
  checking: { icon: LoaderCircleIcon, text: m.stack_checking, tone: "text-muted-foreground" },
  ok: { icon: CircleCheckIcon, text: m.stack_ok, tone: "text-primary" },
  "api-down": { icon: CircleAlertIcon, text: m.stack_api_down, tone: "text-destructive" },
  "do-down": { icon: CircleAlertIcon, text: m.stack_do_down, tone: "text-destructive" },
};

function Verdict({ state }: { state: StackVerdict | "checking" }) {
  const { icon: Icon, text, tone } = VERDICTS[state];
  const iconClass = cn("mt-0.5 size-6 shrink-0 sm:mt-1", tone);
  return (
    <p role="status" className="flex items-start gap-3 text-xl font-semibold sm:text-2xl">
      {state === "checking" ? (
        <>
          <Icon aria-hidden className={cn(iconClass, "animate-spin motion-reduce:hidden")} />
          <CircleDashedIcon aria-hidden className={cn(iconClass, "motion-safe:hidden")} />
        </>
      ) : (
        <Icon aria-hidden className={iconClass} />
      )}
      <span className="min-w-0">{text()}</span>
    </p>
  );
}

function CheckRow<T>({
  label,
  route,
  result,
  okLabel,
  failLabel,
  locale,
  figures,
  className,
  children,
}: {
  label: string;
  route: string;
  /** undefined while loading; "skipped" when a check it depends on failed. */
  result: CheckResult<T> | "skipped" | undefined;
  okLabel: string;
  failLabel: string;
  locale: Locale;
  /** Figure labels, shown while loading too so nothing moves when the values land. */
  figures: string[];
  className?: string;
  children: (ok: Extract<CheckResult<T>, { ok: true }>) => string[];
}) {
  let marker: ReactNode;
  let body: ReactNode;
  if (result === undefined) {
    marker = <Placeholder className="h-5 w-24" />;
    body = <Figures labels={figures} />;
  } else if (result === "skipped") {
    marker = (
      <Marker icon={CircleMinusIcon} tone="text-muted-foreground" label={m.stack_not_checked()} />
    );
    body = <p className="text-sm text-muted-foreground">{m.stack_needs_api()}</p>;
  } else if (result.ok) {
    marker = <Marker icon={CircleCheckIcon} tone="text-primary" label={okLabel} />;
    body = <Figures labels={figures} values={children(result)} />;
  } else {
    marker = <Marker icon={CircleAlertIcon} tone="text-destructive" label={failLabel} />;
    body = <p className="text-sm">{failureText(result, locale)}</p>;
  }

  return (
    <li className={cn("flex min-w-0 flex-col gap-3 p-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h3 className="font-medium">{label}</h3>
        <p>{marker}</p>
      </div>
      <p className="text-xs text-muted-foreground">
        <code className="break-all">{route}</code>
      </p>
      {body}
    </li>
  );
}

function Marker({ icon: Icon, tone, label }: { icon: LucideIcon; tone: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-medium">
      <Icon aria-hidden className={cn("size-4", tone)} />
      {label}
    </span>
  );
}

/**
 * Labelled figures on the same grid in both cells, so the round trip lines up across them: two
 * columns until `lg` (a value never splits from its unit), three from there. Labels and values sit on
 * shared rows (subgrid), so a label that wraps never pushes its value out of line. Without values
 * each figure is a flat bar at the height of its value (text-xl, h-7).
 */
function Figures({ labels, values }: { labels: string[]; values?: string[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 lg:grid-cols-3">
      {labels.map((label, index) => (
        <div key={label} className="row-span-2 grid min-w-0 grid-rows-subgrid">
          <dt className="self-end text-xs text-muted-foreground">{label}</dt>
          <dd className="text-xl font-semibold whitespace-nowrap tabular-nums">
            {values ? values[index] : <Placeholder className="h-7 w-16" />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A flat bar at the size of the value it stands for, so nothing moves when the data lands. */
function Placeholder({ className }: { className: string }) {
  return <span aria-hidden className={cn("block max-w-full rounded-sm bg-muted", className)} />;
}

function formatMs(ms: number, locale: Locale): string {
  return formatNumber(ms, locale, { style: "unit", unit: "millisecond", unitDisplay: "short" });
}

function failureText(failure: CheckFailure, locale: Locale): string {
  switch (failure.reason) {
    case "network":
      return m.stack_error_network();
    case "unreachable":
      return m.stack_error_unreachable();
    case "timeout":
      return m.stack_error_timeout({ seconds: formatNumber(CHECK_TIMEOUT_MS / 1000, locale) });
    case "http":
      return m.stack_error_http({ status: String(failure.status) });
    case "invalid":
      return m.stack_error_invalid();
  }
}
