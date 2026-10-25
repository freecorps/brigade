import { formatDateTime, m } from "@freecorps/brigade-i18n";
import { CircleAlertIcon, CircleDashedIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { usePreferences } from "@/components/preferences";
import {
  fetchPagingHealth,
  PAGING_REFRESH_MS,
  pagingView,
  type DegradedReason,
  type PagingHealth,
  type PagingView,
} from "@/lib/paging-health";

const REASONS: Record<DegradedReason, () => string> = {
  no_beat: m.paging_reason_no_beat,
  pipeline_stalled: m.paging_reason_pipeline_stalled,
  pipeline_slow: m.paging_reason_pipeline_slow,
  relay_unauthorized: m.paging_reason_relay_unauthorized,
  relay_unreachable: m.paging_reason_relay_unreachable,
  relay_not_configured: m.paging_reason_relay_not_configured,
};

/**
 * The paging self-check's state, checked on load and every minute while the tab is visible, and again when it comes
 * back. Says nothing while all is well: a notice that is always there stops being read. `fetcher` is for the tests.
 */
export function PagingHealthNotice({ fetcher = fetch }: { fetcher?: typeof fetch }) {
  const [health, setHealth] = useState<PagingHealth | "unreachable">();
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setInterval> | undefined;
    const check = () =>
      void fetchPagingHealth(fetcher, controller.signal).then((next) => {
        if (!controller.signal.aborted) setHealth(next);
      });
    const poll = () => {
      clearInterval(timer);
      timer = undefined;
      if (document.visibilityState === "hidden") return;
      check();
      timer = setInterval(check, PAGING_REFRESH_MS);
    };
    poll();
    document.addEventListener("visibilitychange", poll);
    return () => {
      document.removeEventListener("visibilitychange", poll);
      clearInterval(timer);
      controller.abort();
    };
  }, [fetcher]);
  return <PagingHealthView view={pagingView(health)} />;
}

export function PagingHealthView({ view }: { view: PagingView }) {
  const { locale } = usePreferences();
  if (view.kind === "hidden") return null;
  if (view.kind === "unknown") {
    return (
      <section
        aria-label={m.paging_title()}
        className="flex items-start gap-3 rounded-md border p-4 text-sm text-muted-foreground"
      >
        <CircleDashedIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p className="min-w-0">{m.paging_unknown()}</p>
      </section>
    );
  }
  const title = view.kind === "degraded" ? m.paging_degraded() : m.paging_unreachable();
  return (
    <section
      role="alert"
      aria-label={m.paging_title()}
      className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm"
    >
      <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-medium">{title}</p>
        {view.kind === "degraded" ? (
          <>
            {view.reasons.map((reason) => (
              <p key={reason}>{REASONS[reason]()}</p>
            ))}
            {view.lastOkAt ? (
              <p className="text-muted-foreground tabular-nums">
                {m.paging_last_ok({
                  // With the date: a pipeline down since yesterday must not read like a minute ago.
                  time: formatDateTime(
                    view.lastOkAt,
                    locale,
                    Intl.DateTimeFormat().resolvedOptions().timeZone,
                    { dateStyle: "medium", timeStyle: "short" },
                  ),
                })}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
