import { m } from "@freecorps/brigade-i18n";
import type { IncidentRow, IncidentStatus, Severity } from "@freecorps/brigade-schema";
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
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
} from "react";
import { DeclareForm } from "@/components/declare-form";
import { IncidentItem } from "@/components/incident-item";
import { usePreferences } from "@/components/preferences";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import {
  adjustBusy,
  nextFailed,
  noticeFor,
  noticeSubject,
  noticeText,
  queryErrorReason,
  syncView,
  type Notice,
  type NoticePlace,
  type NoticeTarget,
  type SyncView,
} from "@/lib/incidents";

const DEV_COMMAND = "vp run dev";

/** How long an announcement stays in the live region: long enough to be read, then removed. */
export const ANNOUNCE_MS = 5000;

/** At most this many refused-change notices are kept; the oldest goes first. */
const MAX_NOTICES = 5;

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
  // Each new notice is read once, in the card's wording, and leaves the live region after ANNOUNCE_MS: never
  // on a dismiss or a re-render, and refusals landing together are all read.
  const [announcements, setAnnouncements] = useState<Notice[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);
  const nextKey = useRef(0);
  const track = useCallback(
    (outcome: Promise<MutationOutcome>, target: NoticeTarget, field?: "status" | "severity") => {
      const keys = field
        ? [target.incidentId, `${target.incidentId}/${field}`]
        : [target.incidentId];
      setBusy((current) => adjustBusy(current, keys, 1));
      return outcome.then((result) => {
        setBusy((current) => adjustBusy(current, keys, -1));
        const notice = noticeFor(result, target, `n${nextKey.current++}`);
        if (notice) {
          setNotices((current) => [...current, notice].slice(-MAX_NOTICES));
          setAnnouncements((current) => [...current, notice]);
          const timer = setTimeout(() => {
            timers.current.delete(timer);
            setAnnouncements((current) => current.filter((item) => item.key !== notice.key));
          }, ANNOUNCE_MS);
          timers.current.add(timer);
        }
        return notice;
      });
    },
    [],
  );

  const target = (row: IncidentRow, kind: "status" | "severity", to: string): NoticeTarget => ({
    kind,
    incidentId: row.id,
    number: row.number,
    title: row.title,
    to: to as IncidentStatus | Severity,
  });
  const onStatus = (row: IncidentRow, next: IncidentStatus) => {
    // The closing menu gives focus back to this trigger, focused by a click or not (Safari does not focus
    // buttons on click): if the change takes the row away, its neighbour gets it instead.
    const trigger = cardRef.current?.querySelector<HTMLElement>(
      `[data-status-trigger="${row.id}"]`,
    );
    if (trigger) focused.current = { element: trigger, fallbacks: plan(trigger) };
    void track(setStatus({ id: row.id, status: next }), target(row, "status", next), "status");
  };
  const onSeverity = (row: IncidentRow, next: Severity) =>
    void track(
      setSeverity({ id: row.id, severity: next }),
      target(row, "severity", next),
      "severity",
    );
  // With the list refused nothing shows the optimistic row, so say the declare went out.
  const [sent, setSent] = useState<string | null>(null);
  const onDeclare = (args: { id: string; title: string; severity: Severity }) => {
    setSent(view === "refused" ? args.title : null);
    return track(declare(args), {
      kind: "declare",
      incidentId: args.id,
      number: null,
      title: args.title,
    });
  };

  // When the focused control leaves the page (its row resolved here or elsewhere, its notice dismissed or pushed
  // out by a newer one), focus moves to its neighbour instead of <body>: the next or previous notice, the row's
  // status menu, the next or previous row's, then the heading. The plan is taken while the control is still
  // there, and applied a frame later, after a closing menu has tried to give focus back to a trigger now gone.
  const cardRef = useRef<HTMLElement>(null);
  const focused = useRef<{ element: HTMLElement; fallbacks: string[] } | null>(null);
  const plan = (element: HTMLElement): string[] => {
    const root = cardRef.current;
    if (!root) return [];
    const fallbacks: string[] = [];
    const key = element.dataset.dismiss;
    if (key) {
      const keys = [...root.querySelectorAll<HTMLElement>("[data-dismiss]")].map(
        (button) => button.dataset.dismiss,
      );
      const index = keys.indexOf(key);
      for (const near of [keys[index + 1], keys[index - 1]]) {
        if (near) fallbacks.push(`[data-dismiss="${near}"]`);
      }
    }
    const row = element.closest<HTMLElement>("li[data-incident]")?.dataset.incident;
    if (row) {
      const ids = [...root.querySelectorAll<HTMLElement>("li[data-incident]")].map(
        (li) => li.dataset.incident,
      );
      const index = ids.indexOf(row);
      for (const near of [row, ids[index + 1], ids[index - 1]]) {
        if (near) fallbacks.push(`[data-status-trigger="${near}"]`);
      }
    }
    return [...fallbacks, "#incidents-title"];
  };
  const onFocus = (event: FocusEvent<HTMLElement>) => {
    const element = event.target;
    // React bubbles focus out of the menus' portals too; only controls drawn in the card count.
    if (element instanceof HTMLElement && cardRef.current?.contains(element)) {
      focused.current = { element, fallbacks: plan(element) };
    }
  };
  useLayoutEffect(() => {
    const last = focused.current;
    if (!last) return;
    if (last.element.isConnected) {
      last.fallbacks = plan(last.element);
      return;
    }
    focused.current = null;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      // Focus already somewhere on the card on purpose: leave it.
      if (
        active instanceof HTMLElement &&
        active.isConnected &&
        cardRef.current?.contains(active)
      ) {
        return;
      }
      for (const selector of last.fallbacks) {
        const next = cardRef.current?.querySelector<HTMLElement>(selector);
        if (next) return next.focus();
      }
    });
  });

  const dismiss = (key: string) =>
    setNotices((current) => current.filter((notice) => notice.key !== key));
  const listed = new Set(rows.map((row) => row.id));
  const renderNotices = (items: Notice[], place: NoticePlace) =>
    items.length === 0 ? null : (
      <ul className="flex flex-col gap-2">
        {items.map((notice) => (
          <NoticeItem
            key={notice.key}
            notice={notice}
            place={place}
            onDismiss={() => dismiss(notice.key)}
          />
        ))}
      </ul>
    );

  const now = useNow(20_000);
  const sev1 = rows.filter((row) => row.severity === "sev1").length;
  const cardNotices = renderNotices(
    notices.filter((notice) => !listed.has(notice.incidentId)),
    "card",
  );
  const hasPanel = view === "reconnecting" || view === "unavailable" || view === "refused";
  const trailing = cardNotices !== null || hasPanel;

  return (
    <Card
      ref={cardRef}
      onFocus={onFocus}
      aria-labelledby="incidents-title"
      // Rows run to the card's edges (the SEV1 rule included), so the card clips them to its corners.
      className={cn(rows.length > 0 && "overflow-hidden pb-0 sm:pb-0")}
    >
      {/* Two fixed lines: nothing below moves as the connection, the count or the SEV1 badge change. */}
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <div className="flex h-6 items-center justify-between gap-4">
          <CardTitle id="incidents-title" tabIndex={-1} className="truncate outline-none">
            {m.incidents_title()}
          </CardTitle>
          <ConnectionPill view={view} />
        </div>
        <div className="flex h-6 items-center gap-2 text-sm whitespace-nowrap text-muted-foreground tabular-nums">
          {status === "ready" ? (
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
            <span aria-hidden className="block h-4 w-32 rounded-sm bg-muted" />
          ) : (
            <span aria-hidden>—</span>
          )}
        </div>
      </div>

      <CardContent className="flex flex-col gap-5">
        <DeclareForm onDeclare={onDeclare} />

        {/* Read out once per new notice, in the card's wording, wherever it is drawn. */}
        <div aria-live="assertive" className="sr-only" data-announcer="">
          {announcements.map((notice) => (
            <p key={notice.key}>{noticeText(notice, "card")}</p>
          ))}
        </div>

        {rows.length > 0 ? (
          <ul aria-labelledby="incidents-title" className="-mx-4 divide-y border-t sm:-mx-6">
            {rows.map((row) => (
              <IncidentItem
                key={row.id}
                row={row}
                pending={{
                  any: busy.has(row.id),
                  status: busy.has(`${row.id}/status`),
                  severity: busy.has(`${row.id}/severity`),
                }}
                online={connection === "open"}
                locale={locale}
                now={now}
                notices={renderNotices(
                  notices.filter((notice) => notice.incidentId === row.id),
                  "row",
                )}
                onStatus={onStatus}
                onSeverity={onSeverity}
              />
            ))}
          </ul>
        ) : view === "connecting" ? (
          <ul aria-hidden className="-mx-4 -mb-5 divide-y border-t sm:-mx-6 sm:-mb-6">
            {[0, 1, 2].map((index) => (
              <li key={index} className="flex flex-col gap-2 px-4 py-4 sm:px-6">
                <span className="block h-4 w-16 rounded-sm bg-muted" />
                <span className="block h-5 w-3/4 max-w-md rounded-sm bg-muted" />
              </li>
            ))}
          </ul>
        ) : status === "ready" ? (
          <p className="flex items-center gap-3 rounded-md bg-muted p-4 text-sm font-medium">
            <CircleCheckIcon
              aria-hidden
              className="size-5 shrink-0 text-status-resolved-foreground"
            />
            {m.incidents_all_clear()}
          </p>
        ) : null}

        {/* After the list, so a connection flap or a new notice never pushes the rows down. */}
        {trailing ? (
          <div className={cn("flex flex-col gap-3", rows.length > 0 && "pb-5 sm:pb-6")}>
            {cardNotices}
            <StatePanel view={view} errorCode={error?.code} sent={sent} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * A refused change and its dismiss button. In the card it first says which incident (the number never broken,
 * the quoted title truncated with the full one on hover), then the change; in a row, only the change.
 */
function NoticeItem({
  notice,
  place,
  onDismiss,
}: {
  notice: Notice;
  place: NoticePlace;
  onDismiss: () => void;
}) {
  const textId = useId();
  const subject = place === "card" ? noticeSubject(notice) : null;
  return (
    <li className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 py-1 pr-1 pl-3 text-sm">
      <CircleAlertIcon aria-hidden className="mt-2.5 size-4 shrink-0 text-destructive" />
      <div id={textId} className="min-w-0 flex-1 py-2">
        {subject ? (
          <p className="flex min-w-0 gap-1 font-medium">
            {subject.number ? (
              <span className="shrink-0 tabular-nums">{subject.number}</span>
            ) : null}
            <span className="truncate" title={notice.title}>
              {subject.title}
            </span>
          </p>
        ) : null}
        <p className="[overflow-wrap:anywhere]">{noticeText(notice, "row")}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        data-dismiss={notice.key}
        aria-label={m.dismiss()}
        aria-describedby={textId}
        onClick={onDismiss}
      >
        <XIcon aria-hidden />
      </Button>
    </li>
  );
}

/**
 * Below the list: why it is stale or missing. A failure gets an alert glyph and a destructive rule, so it never
 * reads like the calm "All clear"; only the passing reconnect hint stays quiet.
 */
function StatePanel({
  view,
  errorCode,
  sent,
}: {
  view: SyncView;
  errorCode: string | undefined;
  sent: string | null;
}) {
  if (view === "reconnecting") {
    return <p className="text-sm text-muted-foreground">{m.sync_reconnecting_hint()}</p>;
  }
  if (view !== "unavailable" && view !== "refused") return null;
  return (
    <div className="flex items-start gap-3 rounded-md border-l-4 border-destructive bg-muted p-4 text-sm">
      <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="flex min-w-0 flex-col items-start gap-3">
        {view === "refused" ? (
          // The client never asks again for a refused subscription on its own: a reload starts it over.
          <>
            <p>{m.sync_refused_hint({ reason: queryErrorReason(errorCode) })}</p>
            {sent ? (
              <p role="status" className="text-muted-foreground [overflow-wrap:anywhere]">
                {m.declare_sent({ title: sent })}
              </p>
            ) : null}
            <Button variant="outline" onClick={() => window.location.reload()}>
              <RefreshCwIcon aria-hidden />
              {m.reload()}
            </Button>
          </>
        ) : import.meta.env.DEV ? (
          <>
            <p>{m.sync_unavailable_hint()}</p>
            <code className="rounded-sm bg-card px-2 py-1 text-foreground">{DEV_COMMAND}</code>
            <p className="text-muted-foreground">{m.sync_retrying()}</p>
          </>
        ) : (
          <p>{m.sync_offline_hint()}</p>
        )}
      </div>
    </div>
  );
}

const PILLS: Record<
  SyncView,
  { icon: LucideIcon; text: () => string; short?: () => string; tone: string; spin?: boolean }
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
  unavailable: {
    icon: CircleAlertIcon,
    text: m.sync_unavailable,
    short: m.sync_unavailable_short,
    tone: "text-destructive",
  },
  refused: { icon: CircleAlertIcon, text: m.sync_refused, tone: "text-destructive" },
};

/**
 * Calm by design: a word and a small glyph, never a banner, since a reconnect usually fixes itself. A flex box of
 * fixed height, so the dot and the icons give the line the same height. Phones get the short word where there is
 * one, so it fits beside the title at 320px.
 */
function ConnectionPill({ view }: { view: SyncView }) {
  const { icon: Icon, text, short, tone, spin } = PILLS[view];
  return (
    <p
      role="status"
      className="flex h-6 shrink-0 items-center gap-2 text-sm font-medium whitespace-nowrap"
    >
      {view === "live" ? (
        <span aria-hidden className="size-2 rounded-full bg-primary" />
      ) : (
        <Icon
          aria-hidden
          className={cn("size-4 shrink-0", tone, spin && "animate-spin motion-reduce:animate-none")}
        />
      )}
      <span className={view === "live" ? "text-foreground" : tone}>
        {short ? (
          <>
            <span className="sm:hidden">{short()}</span>
            <span className="max-sm:hidden">{text()}</span>
          </>
        ) : (
          text()
        )}
      </span>
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
