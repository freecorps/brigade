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
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
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
  noticeText,
  queryErrorReason,
  syncView,
  type Notice,
  type NoticePlace,
  type NoticeTarget,
  type SyncView,
} from "@/lib/incidents";

const DEV_COMMAND = "vp run dev";

/** How long an announcement stays in the live region: long enough to be read, then cleared. */
const ANNOUNCE_MS = 5000;

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
  // Set only when a notice is added, and cleared once read: a dismiss or a re-render never repeats it, and the
  // same failure twice is read twice (a new key re-mounts the text).
  const [announcement, setAnnouncement] = useState<Notice | null>(null);
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
          setNotices((current) => [...current, notice].slice(-5));
          setAnnouncement(notice);
        }
        return notice;
      });
    },
    [],
  );
  useEffect(() => {
    if (!announcement) return;
    const timer = setTimeout(() => setAnnouncement(null), ANNOUNCE_MS);
    return () => clearTimeout(timer);
  }, [announcement]);

  const target = (row: IncidentRow, kind: "status" | "severity", to: string): NoticeTarget => ({
    kind,
    incidentId: row.id,
    number: row.number,
    title: row.title,
    to: to as IncidentStatus | Severity,
  });

  // A status that takes a row off the list hands focus to the next row's status menu, else the previous one's,
  // else the heading, instead of dropping it on <body>. It waits for that row to actually leave: a change the
  // client refuses up front (too many pending, closed) never removes it, and is forgotten when it resolves.
  const leaving = useRef<{ id: string; next: string | null } | null>(null);
  const onStatus = (row: IncidentRow, next: IncidentStatus) => {
    if (!isActive(next)) {
      const index = rows.findIndex((r) => r.id === row.id);
      leaving.current = { id: row.id, next: (rows[index + 1] ?? rows[index - 1])?.id ?? null };
    }
    void track(setStatus({ id: row.id, status: next }), target(row, "status", next), "status").then(
      () => {
        if (leaving.current?.id === row.id) leaving.current = null;
      },
    );
  };
  const onSeverity = (row: IncidentRow, next: Severity) =>
    void track(
      setSeverity({ id: row.id, severity: next }),
      target(row, "severity", next),
      "severity",
    );
  const onDeclare = (args: { id: string; title: string; severity: Severity }) =>
    track(declare(args), { kind: "declare", incidentId: args.id, number: null, title: args.title });

  const cardRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const statusTrigger = (id: string) =>
    cardRef.current?.querySelector<HTMLElement>(`[data-status-trigger="${id}"]`) ?? null;
  useLayoutEffect(() => {
    const pending = leaving.current;
    if (!pending || rows.some((row) => row.id === pending.id)) return;
    leaving.current = null;
    // After the menu has closed and tried to give focus back to its trigger, which is gone.
    requestAnimationFrame(() => {
      ((pending.next ? statusTrigger(pending.next) : null) ?? headingRef.current)?.focus();
    });
  }, [rows]);

  // Dismissing a notice moves focus to the next notice's dismiss button, else the previous one, else that
  // incident's status menu, else the heading. Never the declare title: on a phone that opens the keyboard.
  const dismiss = (notice: Notice, button: HTMLElement) => {
    const all = [...(cardRef.current?.querySelectorAll<HTMLElement>("[data-dismiss]") ?? [])];
    const index = all.indexOf(button);
    const neighbour = all[index + 1] ?? all[index - 1];
    flushSync(() => setNotices((current) => current.filter((item) => item.key !== notice.key)));
    const next =
      (neighbour?.isConnected ? neighbour : null) ??
      statusTrigger(notice.incidentId) ??
      headingRef.current;
    next?.focus();
  };

  const listed = new Set(rows.map((row) => row.id));
  const renderNotices = (items: Notice[], place: NoticePlace) =>
    items.length === 0 ? null : (
      <ul className="flex flex-col gap-2">
        {items.map((notice) => (
          <NoticeItem
            key={notice.key}
            notice={notice}
            place={place}
            onDismiss={(button) => dismiss(notice, button)}
          />
        ))}
      </ul>
    );

  const now = useNow(30_000);
  const sev1 = rows.filter((row) => row.severity === "sev1").length;
  const pill = <ConnectionPill view={view} />;

  return (
    <Card
      ref={cardRef}
      aria-labelledby="incidents-title"
      // Rows run to the card's edges (the SEV1 rule included), so the card clips them to its corners.
      className={cn((rows.length > 0 || view === "connecting") && "overflow-hidden pb-0 sm:pb-0")}
    >
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <CardTitle id="incidents-title" ref={headingRef} tabIndex={-1} className="outline-none">
            {m.incidents_title()}
          </CardTitle>
          <div className="max-sm:hidden">{pill}</div>
        </div>
        {/* A reserved line: nothing above the form moves as the count, the SEV1 badge or (on phones) the
            connection state change. The count yields first when space runs out. */}
        <div className="flex h-6 items-center gap-2 text-sm text-muted-foreground tabular-nums">
          {status === "ready" ? (
            <>
              <span className="min-w-0 truncate">
                {m.incidents_active_count({ count: rows.length })}
              </span>
              {sev1 > 0 ? (
                <Badge variant="sev1">
                  <OctagonAlertIcon aria-hidden />
                  {m.incidents_sev1_count({ count: sev1 })}
                </Badge>
              ) : null}
            </>
          ) : view === "connecting" ? (
            <span aria-hidden className="block h-4 w-32 rounded-sm bg-muted" />
          ) : null}
          <div className="ml-auto shrink-0 sm:hidden">{pill}</div>
        </div>
      </div>

      <CardContent className="flex flex-col gap-5">
        <DeclareForm onDeclare={onDeclare} />

        <StatePanel view={view} errorCode={error?.code} />

        {/* Read out once per new notice, wherever it is drawn. */}
        <div aria-live="assertive" aria-atomic="true" className="sr-only" data-announcer="">
          {announcement ? (
            <span key={announcement.key}>
              {noticeText(announcement, listed.has(announcement.incidentId) ? "row" : "card")}
            </span>
          ) : null}
        </div>
        {renderNotices(
          notices.filter((notice) => !listed.has(notice.incidentId)),
          "card",
        )}

        {view === "connecting" ? (
          <ul aria-hidden className="-mx-4 divide-y border-t sm:-mx-6">
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
        ) : null}
      </CardContent>
    </Card>
  );
}

const MARK = /([nt])(.*?)/g;

/** A refused change: its text (number kept on one line, a long title truncated) and a dismiss button. */
function NoticeItem({
  notice,
  place,
  onDismiss,
}: {
  notice: Notice;
  place: NoticePlace;
  onDismiss: (button: HTMLElement) => void;
}) {
  const textId = useId();
  const text = noticeText(notice, place, (part, value) =>
    part === "number" ? `n${value}` : `t${value}`,
  );
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(MARK)) {
    parts.push(text.slice(last, match.index));
    parts.push(
      match[1] === "n" ? (
        <span key={match.index} className="whitespace-nowrap">
          {match[2]}
        </span>
      ) : (
        <span key={match.index} className="inline-block max-w-48 truncate align-bottom">
          {match[2]}
        </span>
      ),
    );
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return (
    <li className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 py-1 pr-1 pl-3 text-sm">
      <CircleAlertIcon aria-hidden className="mt-2.5 size-4 shrink-0 text-destructive" />
      <p id={textId} className="min-w-0 flex-1 py-2 font-normal [overflow-wrap:anywhere]">
        {parts}
      </p>
      <Button
        variant="ghost"
        size="icon"
        data-dismiss=""
        aria-label={m.dismiss()}
        aria-describedby={textId}
        onClick={(event) => onDismiss(event.currentTarget)}
      >
        <XIcon aria-hidden />
      </Button>
    </li>
  );
}

/**
 * Under the form: why the list is stale or missing. A failure gets an alert glyph and a destructive rule, so it
 * never reads like the calm "All clear"; only the passing reconnect hint stays quiet.
 */
function StatePanel({ view, errorCode }: { view: SyncView; errorCode: string | undefined }) {
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
    <p
      role="status"
      className="inline-flex h-6 items-center gap-2 text-sm font-medium whitespace-nowrap"
    >
      {view === "live" ? (
        <span aria-hidden className="size-2 rounded-full bg-primary" />
      ) : (
        <Icon
          aria-hidden
          className={cn("size-4 shrink-0", tone, spin && "animate-spin motion-reduce:animate-none")}
        />
      )}
      <span className={view === "live" ? "text-foreground" : tone}>{text()}</span>
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
