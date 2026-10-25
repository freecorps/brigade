import { m } from "@freecorps/brigade-i18n";
import {
  isActive,
  type IncidentRow,
  type IncidentStatus,
  type Severity,
} from "@freecorps/brigade-schema";
import type { MutationOutcome } from "@freecorps/brigade-sync";
import { useConnectionState, useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { cn } from "cn";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  LoaderCircleIcon,
  OctagonAlertIcon,
  RefreshCwIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { DeclareForm } from "@/components/declare-form";
import { IncidentItem } from "@/components/incident-item";
import { usePreferences } from "@/components/preferences";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import {
  adjustBusy,
  nextFailed,
  noticeFor,
  noticeText,
  queryErrorReason,
  syncView,
  type Notice,
  type NoticeTarget,
  type SyncView,
} from "@/lib/incidents";

const DEV_COMMAND = "vp run dev";

/**
 * The workspace's active incidents, live from its shard (`useQuery("incidents.active")`), with declare and the
 * status and severity menus. Changes show at once (optimistic) and settle when the shard confirms them; a refused
 * one rolls back on its own and leaves a notice saying why, in its row when the row is listed.
 */
export function IncidentsCard() {
  const { locale } = usePreferences();
  const { rows, status, error } = useQuery("incidents.active", {});
  const connection = useConnectionState();
  const [failed, setFailed] = useState(false);
  const latched = nextFailed(failed, status, connection);
  if (latched !== failed) setFailed(latched);
  const view = syncView(status, connection, latched);

  const declare = useMutation("incident.declare");
  const setStatus = useMutation("incident.setStatus");
  const setSeverity = useMutation("incident.setSeverity");

  // Kept here, not in the rows: a refused move to Resolved brings back a row that had left the list.
  const [notices, setNotices] = useState<Notice[]>([]);
  const [busy, setBusy] = useState<ReadonlyMap<string, number>>(new Map());
  const nextKey = useRef(0);
  const track = useCallback((outcome: Promise<MutationOutcome>, target: NoticeTarget) => {
    setBusy((current) => adjustBusy(current, target.incidentId, 1));
    return outcome.then((result) => {
      setBusy((current) => adjustBusy(current, target.incidentId, -1));
      const notice = noticeFor(result, target, `n${nextKey.current++}`);
      if (notice) setNotices((current) => [...current, notice].slice(-5));
      return result;
    });
  }, []);

  const changeTarget = (row: IncidentRow): NoticeTarget => ({
    kind: "change",
    incidentId: row.id,
    number: row.number,
    title: row.title,
  });

  // A status that takes the row off the list hands focus to the next row's status menu, else the previous one's,
  // else the list heading, instead of dropping it on <body>.
  const focusAfter = useRef<string | null>(null);
  const onStatus = (row: IncidentRow, next: IncidentStatus) => {
    if (!isActive(next)) {
      const index = rows.findIndex((r) => r.id === row.id);
      focusAfter.current = (rows[index + 1] ?? rows[index - 1])?.id ?? "";
    }
    void track(setStatus({ id: row.id, status: next }), changeTarget(row));
  };
  const onSeverity = (row: IncidentRow, next: Severity) =>
    void track(setSeverity({ id: row.id, severity: next }), changeTarget(row));
  const onDeclare = (args: { id: string; title: string; severity: Severity }) =>
    track(declare(args), { kind: "declare", incidentId: args.id, number: null, title: args.title });

  const cardRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    focusAfter.current = null;
    // After the menu has closed and tried to give focus back to the trigger that is gone.
    requestAnimationFrame(() => {
      const trigger = target
        ? cardRef.current?.querySelector<HTMLElement>(`[data-status-trigger="${target}"]`)
        : null;
      (trigger ?? headingRef.current)?.focus();
    });
  }, [rows]);

  // Below md the form starts collapsed behind one button.
  const titleRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const focusTitle = () => {
    flushSync(() => setExpanded(true));
    titleRef.current?.focus();
  };

  // Dismissing a notice moves focus to the next notice's dismiss button, else to the title field.
  const dismiss = (key: string, button: HTMLElement) => {
    const all = [...(cardRef.current?.querySelectorAll<HTMLElement>("[data-dismiss]") ?? [])];
    const next = all[all.indexOf(button) + 1];
    flushSync(() => setNotices((current) => current.filter((notice) => notice.key !== key)));
    if (next?.isConnected) next.focus();
    else focusTitle();
  };

  const listed = new Set(rows.map((row) => row.id));
  const renderNotices = (items: Notice[]) =>
    items.length === 0 ? null : (
      <ul className="flex flex-col gap-2">
        {items.map((notice) => (
          <li
            key={notice.key}
            className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 py-1 pr-1 pl-3 text-sm"
          >
            <CircleAlertIcon aria-hidden className="mt-2.5 size-4 shrink-0 text-destructive" />
            <p className="min-w-0 flex-1 py-2 font-normal [overflow-wrap:anywhere]">
              {noticeText(notice)}
            </p>
            <Button
              variant="ghost"
              size="icon"
              data-dismiss=""
              aria-label={m.dismiss()}
              onClick={(event) => dismiss(notice.key, event.currentTarget)}
            >
              <XIcon aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    );

  const now = useNow(30_000);
  const sev1 = rows.filter((row) => row.severity === "sev1").length;
  const latest = notices.at(-1);

  return (
    <Card
      ref={cardRef}
      aria-labelledby="incidents-title"
      // Rows run to the card's edges (the SEV1 rule included), so the card clips them to its corners.
      className={cn(rows.length > 0 && "overflow-hidden pb-0 sm:pb-0")}
    >
      {/* Wraps instead of squeezing the title: a long connection label drops below it. */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 sm:px-6">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle id="incidents-title" ref={headingRef} tabIndex={-1} className="outline-none">
            {m.incidents_title()}
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
            {status === "ready" && rows.length > 0 ? (
              <>
                <span>{m.incidents_active_count({ count: rows.length })}</span>
                {sev1 > 0 ? (
                  <Badge variant="sev1">
                    <OctagonAlertIcon aria-hidden />
                    {m.incidents_sev1_count({ count: sev1 })}
                  </Badge>
                ) : null}
              </>
            ) : view === "connecting" ? (
              <span aria-hidden className="my-0.5 block h-4 w-32 rounded-sm bg-muted" />
            ) : null}
          </CardDescription>
        </div>
        <ConnectionPill view={view} />
      </div>

      <CardContent className="flex flex-col gap-5">
        <DeclareForm
          onDeclare={onDeclare}
          titleRef={titleRef}
          expanded={expanded}
          onExpand={focusTitle}
        />

        <StatePanel view={view} errorCode={error?.code} />

        {/* Read out once, whatever row or place a notice is drawn in. */}
        <div aria-live="assertive" aria-atomic="true" className="sr-only">
          {latest ? noticeText(latest) : null}
        </div>
        {renderNotices(notices.filter((notice) => !listed.has(notice.incidentId)))}

        {view === "connecting" ? (
          <ul aria-hidden className="-mx-4 divide-y border-y sm:-mx-6">
            {[0, 1, 2].map((index) => (
              <li key={index} className="flex flex-col gap-2 px-4 py-4 sm:px-6">
                <span className="block h-4 w-16 rounded-sm bg-muted" />
                <span className="block h-5 w-3/4 max-w-md rounded-sm bg-muted" />
              </li>
            ))}
          </ul>
        ) : status === "ready" && rows.length === 0 ? (
          <p className="flex items-center gap-3 rounded-md bg-muted p-4 text-sm font-medium">
            <CircleCheckIcon
              aria-hidden
              className="size-5 shrink-0 text-status-resolved-foreground"
            />
            {m.incidents_all_clear()}
          </p>
        ) : rows.length > 0 ? (
          <ul aria-labelledby="incidents-title" className="-mx-4 divide-y border-t sm:-mx-6">
            {rows.map((row) => (
              <IncidentItem
                key={row.id}
                row={row}
                pending={row.number === null || busy.has(row.id)}
                online={connection === "open"}
                locale={locale}
                now={now}
                notices={renderNotices(notices.filter((notice) => notice.incidentId === row.id))}
                onStatus={onStatus}
                onSeverity={onSeverity}
              />
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Under the form: why the list is stale or missing, and what happens next. */
function StatePanel({ view, errorCode }: { view: SyncView; errorCode: string | undefined }) {
  if (view === "reconnecting") {
    return <p className="text-sm text-muted-foreground">{m.sync_reconnecting_hint()}</p>;
  }
  if (view === "unavailable") {
    return (
      <div className="flex flex-col items-start gap-3 rounded-md bg-muted p-4 text-sm">
        {import.meta.env.DEV ? (
          <>
            <p>{m.sync_unavailable_hint()}</p>
            <code className="rounded-sm bg-card px-2 py-1 text-foreground">{DEV_COMMAND}</code>
            <p className="text-muted-foreground">{m.sync_retrying()}</p>
          </>
        ) : (
          <p>{m.sync_offline_hint()}</p>
        )}
      </div>
    );
  }
  if (view === "refused") {
    // The client never asks again for a refused subscription on its own: a reload starts it over.
    return (
      <div className="flex flex-col items-start gap-3 rounded-md bg-muted p-4 text-sm">
        <p>{m.sync_refused_hint({ reason: queryErrorReason(errorCode) })}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          <RefreshCwIcon aria-hidden />
          {m.reload()}
        </Button>
      </div>
    );
  }
  return null;
}

const PILLS: Record<
  SyncView,
  { icon: LucideIcon; text: () => string; tone: string; spin?: boolean }
> = {
  live: { icon: CircleCheckIcon, text: m.sync_live, tone: "text-primary" },
  connecting: {
    icon: LoaderCircleIcon,
    text: m.sync_connecting,
    tone: "text-muted-foreground",
    spin: true,
  },
  reconnecting: {
    icon: RefreshCwIcon,
    text: m.sync_reconnecting,
    tone: "text-muted-foreground",
    spin: true,
  },
  unavailable: { icon: CircleAlertIcon, text: m.sync_unavailable, tone: "text-destructive" },
  refused: { icon: CircleAlertIcon, text: m.sync_refused, tone: "text-destructive" },
};

/** Calm by design: a word and a small glyph, never a banner, since a reconnect usually fixes itself. */
function ConnectionPill({ view }: { view: SyncView }) {
  const { icon: Icon, text, tone, spin } = PILLS[view];
  return (
    <p role="status" className="inline-flex min-h-6 items-center gap-2 text-sm font-medium">
      {view === "live" ? (
        <span aria-hidden className="size-2 rounded-full bg-primary" />
      ) : (
        <Icon
          aria-hidden
          className={cn("size-4 shrink-0", tone, spin && "animate-spin motion-reduce:animate-none")}
        />
      )}
      <span className={view === "live" ? undefined : tone}>{text()}</span>
    </p>
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
