import { formatNumber, m, type Locale } from "@freecorps/brigade-i18n";
import { cn } from "cn";
import {
  CircleAlertIcon,
  CircleCheckIcon,
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

export function StackCard() {
  const { locale } = usePreferences();
  const { report, checking, recheck } = useStackStatus();
  const state: StackVerdict | "checking" = report ? verdict(report) : "checking";

  return (
    <Card aria-labelledby="stack-title" aria-busy={checking}>
      <CardHeader>
        <CardTitle id="stack-title">{m.stack_title()}</CardTitle>
        <CardDescription className="tabular-nums">
          {report ? (
            m.stack_checked_at({ time: formatClock(report.checkedAt, locale) })
          ) : (
            <Placeholder className="my-0.5 h-4 w-32" />
          )}
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            onClick={checking ? undefined : recheck}
            aria-disabled={checking || undefined}
          >
            <RefreshCwIcon
              aria-hidden
              className={cn(checking && "animate-spin motion-reduce:animate-none")}
            />
            <span className="max-sm:sr-only">{m.stack_check_again()}</span>
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <Verdict state={state} />

        <ul className="grid overflow-hidden rounded-md border sm:grid-cols-2">
          <CheckRow
            label={m.stack_api_label()}
            route="GET /api/health"
            result={report?.health}
            okLabel={m.stack_reachable()}
            failLabel={m.stack_unreachable()}
            locale={locale}
          >
            {(health) => (
              <Figure value={m.stack_latency({ ms: formatNumber(health.ms, locale) })} />
            )}
          </CheckRow>
          <CheckRow
            label={m.stack_do_label()}
            route={`GET /api/workspaces/${DEMO_WORKSPACE}`}
            result={report?.workspace}
            okLabel={m.stack_answered()}
            failLabel={m.stack_no_answer()}
            locale={locale}
            className="max-sm:border-t sm:border-l"
          >
            {(workspace) => (
              <div className="grid grid-cols-2 gap-4">
                <Figure
                  label={m.stack_tables()}
                  value={formatNumber(workspace.data.tables, locale)}
                  large
                />
                <Figure
                  label={m.stack_database_size()}
                  value={formatBytes(workspace.data.databaseSize, locale)}
                  large
                />
              </div>
            )}
          </CheckRow>
        </ul>

        {state === "api-down" || state === "do-down" ? (
          <div className="flex flex-col gap-2 rounded-md bg-muted p-4 text-sm">
            <p>{state === "api-down" ? m.stack_hint_start() : m.stack_hint_do()}</p>
            <p>
              <code className="rounded-sm bg-card px-2 py-1 text-foreground">{DEV_COMMAND}</code>
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
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
  return (
    <p role="status" className="flex items-start gap-3 text-xl font-semibold sm:text-2xl">
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-6 shrink-0 sm:mt-1",
          tone,
          state === "checking" && "animate-spin motion-reduce:animate-none",
        )}
      />
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
  className,
  children,
}: {
  label: string;
  route: string;
  result: CheckResult<T> | undefined;
  okLabel: string;
  failLabel: string;
  locale: Locale;
  className?: string;
  children: (ok: Extract<CheckResult<T>, { ok: true }>) => ReactNode;
}) {
  return (
    <li className={cn("flex min-w-0 flex-col gap-3 p-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h3 className="font-medium">{label}</h3>
        <p>
          {result === undefined ? (
            <Placeholder className="h-5 w-24" />
          ) : (
            <span className="inline-flex items-center gap-1.5 font-medium">
              {result.ok ? (
                <CircleCheckIcon aria-hidden className="size-4 text-primary" />
              ) : (
                <CircleAlertIcon aria-hidden className="size-4 text-destructive" />
              )}
              {result.ok ? okLabel : failLabel}
            </span>
          )}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        <code className="break-all">{route}</code>
      </p>
      <div>
        {result === undefined ? (
          <Placeholder className="h-7 w-40" />
        ) : result.ok ? (
          children(result)
        ) : (
          <p className="text-sm">{failureText(result, locale)}</p>
        )}
      </div>
    </li>
  );
}

function Figure({ label, value, large }: { label?: string; value: string; large?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {label ? <span className="text-xs text-muted-foreground">{label}</span> : null}
      <span className={cn("tabular-nums", large ? "text-xl font-semibold" : "text-sm")}>
        {value}
      </span>
    </div>
  );
}

/** A flat bar at the size of the value it stands for, so nothing moves when the data lands. */
function Placeholder({ className }: { className: string }) {
  return <span aria-hidden className={cn("block max-w-full rounded-sm bg-muted", className)} />;
}

function failureText(failure: CheckFailure, locale: Locale): string {
  switch (failure.reason) {
    case "network":
      return m.stack_error_network();
    case "timeout":
      return m.stack_error_timeout({ seconds: formatNumber(CHECK_TIMEOUT_MS / 1000, locale) });
    case "http":
      return m.stack_error_http({ status: String(failure.status) });
    case "invalid":
      return m.stack_error_invalid();
  }
}
