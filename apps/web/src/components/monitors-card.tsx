import { m, type Locale } from "@freecorps/brigade-i18n";
import {
  can,
  formatIncidentNumber,
  monitorAlerting,
  type MonitorCheck,
  type MonitorRow,
} from "@freecorps/brigade-schema";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { Link, useRouter } from "@tanstack/react-router";
import { cn } from "cn";
import {
  CheckIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CirclePauseIcon,
  CloudOffIcon,
  CopyIcon,
  OctagonAlertIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
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
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  CONFIRM_DESTRUCTIVE,
  MonitorForm,
  type DiscardPrompt,
  type MonitorFormMode,
} from "@/components/monitor-form";
import { usePreferences } from "@/components/preferences";
import { useMember } from "@/components/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/ui/field";
import { formatAge, queryErrorReason } from "@/lib/incidents";
import {
  checkErrorReason,
  formatLatency,
  formatSeconds,
  monitorActions,
  monitorBadge,
  monitorRefusal,
  newHeartbeat,
  sourceChips,
  type CheckedDraft,
  type CheckedEdit,
  type MonitorAction,
  type MonitorBadge,
  type SourceChip,
} from "@/lib/monitors";
import type { MutationOutcome } from "@freecorps/brigade-sync";

/** Down is the only solid fill, like SEV1: it is what pages people. No data is a warning, never "up". */
const BADGES: Record<
  MonitorBadge,
  { variant: "sev1" | "sev3" | "resolved" | "declined" | "outline"; icon: LucideIcon }
> = {
  down: { variant: "sev1", icon: OctagonAlertIcon },
  unknown: { variant: "sev3", icon: CloudOffIcon },
  up: { variant: "resolved", icon: CircleCheckIcon },
  pending: { variant: "outline", icon: CircleDashedIcon },
  paused: { variant: "declined", icon: CirclePauseIcon },
};

/**
 * The workspace's monitors, live from its shard (`useQuery("monitors.all")`): status, the last result from each
 * region with the colo it really ran from and why it failed, and for owners and admins the create form, editing
 * and deleting (confirmed, in the edit form), and pause (confirmed) and resume. One form is open at a time:
 * opening another while the open one has changes asks first whether to discard them.
 */
export function MonitorsCard() {
  const { locale } = usePreferences();
  const { workspaceId, userId, role } = useMember();
  // Owners and admins; everyone else reads.
  const manage = can(role, "monitor:manage");
  const { rows, status, error } = useQuery("monitors.all", {});
  const createHttp = useMutation("monitor.createHttp");
  const createHeartbeat = useMutation("monitor.createHeartbeat");
  const updateHttp = useMutation("monitor.updateHttp");
  const updateHeartbeat = useMutation("monitor.updateHeartbeat");
  const setPaused = useMutation("monitor.setPaused");
  const remove = useMutation("monitor.delete");
  const [adding, setAdding] = useState(false);
  /** The monitor whose edit form is open. */
  const [editing, setEditing] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  /** The form asked for while the open one has changes, waiting on its discard prompt. */
  const [pending, setPending] = useState<Opening | null>(null);
  /** Whether the open form's draft differs from what it opened with. */
  const changed = useRef(false);
  const onChanged = useCallback((value: boolean) => {
    changed.current = value;
  }, []);
  /** The heartbeat URL, shown once after its monitor was created (only its hash is stored). */
  const [ping, setPing] = useState<{ url: string; interval: number } | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  /** Set when the form closes, so focus goes back to "Add monitor" once it is mounted again. */
  const restoreFocus = useRef(false);
  const now = useNow(20_000);
  const listRef = useStableFocus(rows);

  useEffect(() => {
    if (adding || !restoreFocus.current) return;
    restoreFocus.current = false;
    // The heartbeat panel takes focus itself (its Copy button).
    if (!ping) addRef.current?.focus();
  }, [adding, ping]);

  const report = (name: string) => (outcome: MutationOutcome) => {
    if (!outcome.ok) {
      setRefused(m.monitor_change_failed({ name, reason: monitorRefusal(outcome.error.code) }));
    }
    return outcome.ok;
  };
  const close = () => {
    restoreFocus.current = true;
    changed.current = false;
    setPending(null);
    setAdding(false);
  };
  /** Opens the create form or a monitor's edit form, closing the other one. */
  const open = (target: Opening) => {
    setRefused(null);
    changed.current = false;
    setPending(null);
    setAdding(target.kind === "add");
    setEditing(target.kind === "edit" ? target.id : null);
  };
  /** Opens `target`, unless the open form has changes: then that form asks first. */
  const ask = (target: Opening) => {
    if (changed.current && (adding || editing !== null)) setPending(target);
    else open(target);
  };
  const discard: DiscardPrompt | null = pending
    ? { onDiscard: () => open(pending), onKeep: () => setPending(null) }
    : null;
  const onCreate = async (checked: Extract<CheckedDraft, { ok: true }>) => {
    setRefused(null);
    if (checked.kind === "http") {
      void createHttp(checked.args).then(report(checked.args.name));
      close();
      return true;
    }
    let heartbeat: Awaited<ReturnType<typeof newHeartbeat>>;
    try {
      heartbeat = await newHeartbeat(window.location.origin, workspaceId, checked.args.id);
    } catch {
      // No WebCrypto (an insecure context): say so, and keep the draft.
      setRefused(
        m.monitor_change_failed({ name: checked.args.name, reason: m.sync_error_internal() }),
      );
      return false;
    }
    void createHeartbeat({ ...checked.args, tokenHash: heartbeat.tokenHash }).then((outcome) => {
      // A refused monitor's URL would never work: take it back.
      if (!report(checked.args.name)(outcome)) setPing(null);
    });
    setPing({ url: heartbeat.url, interval: checked.args.intervalSeconds });
    close();
    return true;
  };
  const onPause = (row: MonitorRow) => {
    setRefused(null);
    void setPaused({ id: row.id, paused: !row.paused }).then(report(row.name));
  };
  /** Focus goes back to the row's Edit button once the form is gone. */
  const closeEdit = (id: string) => {
    changed.current = false;
    setPending(null);
    setEditing(null);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-monitor="${id}"] [data-action="edit"]`)?.focus(),
    );
  };
  const onEdit = (row: MonitorRow) => ask({ kind: "edit", id: row.id });
  /**
   * The form closes as the edit is sent, before the shard answers. A refusal that only a race can cause (someone
   * deleted it, `not_found`; or made the same change first, `conflict`) is said above the list, and the draft is
   * gone: what was typed is not kept to try again.
   */
  const onSave = (row: MonitorRow, checked: Extract<CheckedEdit, { ok: true }>) => {
    setRefused(null);
    const sent = checked.kind === "http" ? updateHttp(checked.args) : updateHeartbeat(checked.args);
    void sent.then(report(row.name));
    closeEdit(row.id);
  };
  const onDelete = (row: MonitorRow) => {
    setRefused(null);
    void remove({ id: row.id }).then(report(row.name));
    changed.current = false;
    setPending(null);
    setEditing(null);
    // The row is gone: focus goes to the card's own action.
    requestAnimationFrame(() => addRef.current?.focus());
  };
  const editMode = (row: MonitorRow): MonitorFormMode => ({
    kind: "edit",
    row,
    onSave: (checked) => onSave(row, checked),
    onDelete: () => onDelete(row),
  });

  // The monitor being edited was deleted elsewhere: its form went with its row, so focus goes to the card's action.
  const editedGone =
    editing !== null && status === "ready" && !rows.some((row) => row.id === editing);
  useEffect(() => {
    if (!editedGone) return;
    changed.current = false;
    setPending(null);
    setEditing(null);
    requestAnimationFrame(() => addRef.current?.focus());
  }, [editedGone]);

  const down = rows.filter(monitorAlerting).length;
  const loading = status !== "ready" && status !== "error";
  return (
    <Card
      aria-labelledby="monitors-title"
      className={cn((rows.length > 0 || loading) && "overflow-hidden pb-0 sm:pb-0")}
    >
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <CardTitle id="monitors-title" className="truncate">
            {m.monitors_title()}
          </CardTitle>
          {manage && !adding ? (
            <Button ref={addRef} variant="outline" onClick={() => ask({ kind: "add" })}>
              <PlusIcon aria-hidden />
              {m.monitor_add()}
            </Button>
          ) : null}
        </div>
        <div className="flex h-6 items-center gap-2 text-sm whitespace-nowrap text-muted-foreground tabular-nums">
          {status === "ready" ? (
            rows.length > 0 ? (
              <>
                <span>{m.monitors_count({ count: rows.length })}</span>
                {down > 0 ? (
                  <Badge variant="sev1">
                    <OctagonAlertIcon aria-hidden />
                    {m.monitors_down_count({ count: down })}
                  </Badge>
                ) : null}
              </>
            ) : null
          ) : status === "error" ? null : (
            <span aria-hidden className="block h-4 w-24 rounded-sm bg-muted" />
          )}
        </div>
      </div>

      <CardContent className="flex flex-col gap-5">
        {adding ? (
          <MonitorForm
            mode={{ kind: "create", onCreate }}
            onCancel={close}
            onChanged={onChanged}
            discard={discard}
          />
        ) : null}
        {ping ? (
          <PingUrl
            {...ping}
            locale={locale}
            onDismiss={() => {
              setPing(null);
              requestAnimationFrame(() => addRef.current?.focus());
            }}
          />
        ) : null}
        {refused ? (
          <DismissableError onDismiss={() => setRefused(null)}>{refused}</DismissableError>
        ) : null}
        {status === "error" ? <FormError>{queryErrorReason(error?.code)}</FormError> : null}

        {rows.length > 0 ? (
          <ul
            ref={listRef}
            aria-labelledby="monitors-title"
            className="-mx-4 divide-y border-t sm:-mx-6"
          >
            {rows.map((row) => (
              <MonitorItem
                key={row.id}
                row={row}
                locale={locale}
                now={now}
                userId={userId}
                actions={monitorActions(role, row)}
                onPause={onPause}
                onEdit={onEdit}
                edit={
                  editing === row.id ? (
                    <MonitorForm
                      mode={editMode(row)}
                      onCancel={() => closeEdit(row.id)}
                      onChanged={onChanged}
                      discard={discard}
                    />
                  ) : null
                }
              />
            ))}
          </ul>
        ) : loading ? (
          <ul aria-hidden className="-mx-4 divide-y border-t sm:-mx-6">
            {[0, 1, 2].map((index) => (
              <MonitorItemSkeleton key={index} />
            ))}
          </ul>
        ) : status === "ready" && !adding ? (
          <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
            {m.monitors_empty()}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** A form to open: the create form, or a monitor's edit form. */
type Opening = { kind: "add" } | { kind: "edit"; id: string };

const ROW_GRID =
  "relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-4 py-3 sm:px-6 md:grid-cols-[--spacing(28)_minmax(0,1fr)_minmax(0,18rem)_--spacing(30)] md:has-[[data-action]]:grid-cols-[--spacing(28)_minmax(0,1fr)_minmax(0,18rem)_--spacing(48)]";

/**
 * One monitor. Phones stack the badge and name, the target, then the results; from `md` the badge, name and
 * results sit in columns so the badges line up down the list.
 */
function MonitorItem({
  row,
  locale,
  now,
  userId,
  actions,
  onPause,
  onEdit,
  edit,
}: {
  row: MonitorRow;
  locale: Locale;
  now: number;
  userId: string;
  /** What this member may do here (`monitorActions`): none for responders and viewers. */
  actions: readonly MonitorAction[];
  onPause: (row: MonitorRow) => void;
  onEdit: (row: MonitorRow) => void;
  /** The open edit form, drawn in place of the row's content. */
  edit: ReactNode;
}) {
  const nameId = useId();
  const promptId = useId();
  const badge = monitorBadge(row);
  const { variant, icon: Icon } = BADGES[badge];
  // A down monitor whose probes went silent is "No data" but keeps its alert and incident: still shown as one.
  const alerting = monitorAlerting(row);
  const [confirming, setConfirming] = useState(false);
  const pauseRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);
  const cancel = () => {
    setConfirming(false);
    // The Pause button stays mounted while the prompt is open.
    pauseRef.current?.focus();
  };
  // A pause prompt left open does not come back once the edit form closes.
  if (edit && confirming) setConfirming(false);
  if (edit) {
    return (
      <li data-monitor={row.id} className="px-4 py-3 sm:px-6">
        {edit}
      </li>
    );
  }
  const latest = row.checks.reduce<MonitorCheck | undefined>(
    (last, check) => (last && last.at >= check.at ? last : check),
    undefined,
  );
  const line =
    row.paused && row.pausedAt !== null
      ? m.monitor_last_result({
          state: row.pausedBy === userId ? "paused_you" : "paused_other",
          when: formatAge(Math.min(row.pausedAt, now), now, locale),
        })
      : latest && !row.paused
        ? m.monitor_last_result({
            state: "report",
            when: formatAge(Math.min(latest.at, now), now, locale),
          })
        : null;
  return (
    <li
      data-monitor={row.id}
      className={cn(
        ROW_GRID,
        alerting && "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-sev1",
      )}
    >
      <div className="col-start-1 row-start-1 flex flex-wrap items-center gap-2 md:col-auto md:flex-col md:items-start">
        <Badge variant={variant}>
          <Icon aria-hidden />
          {m.monitor_status({ status: badge })}
        </Badge>
        {alerting && row.incidentId ? <IncidentLink id={row.incidentId} /> : null}
      </div>
      <div className="col-span-2 row-start-2 flex min-w-0 flex-col gap-0.5 md:col-span-1 md:row-start-1">
        <p
          id={nameId}
          className="line-clamp-2 font-medium [overflow-wrap:anywhere]"
          title={row.name}
        >
          {row.name}
        </p>
        {row.kind === "http" ? (
          // A summary the size of one line; opening it shows the whole URL, so it is reachable on touch too.
          <details className="group text-sm text-muted-foreground">
            <summary className="flex cursor-pointer list-none items-center gap-1 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <span className="shrink-0 font-medium">{row.method}</span>
              <span className="min-w-0 truncate group-open:hidden">{row.url}</span>
            </summary>
            <p className="mt-0.5 font-mono text-xs [overflow-wrap:anywhere] select-text">
              {row.url}
            </p>
          </details>
        ) : (
          <p className="text-sm text-muted-foreground">
            {m.monitor_heartbeat_every({ interval: formatSeconds(row.intervalSeconds, locale) })}
          </p>
        )}
      </div>
      <div className="col-span-2 row-start-3 flex min-w-0 flex-col gap-1 text-sm md:col-span-1 md:row-start-1">
        {row.paused ? null : (
          <ul className="flex flex-wrap gap-1.5">
            {sourceChips(row, now).map((chip) => (
              <CheckChip key={chip.source} chip={chip} row={row} locale={locale} />
            ))}
          </ul>
        )}
        {line ? <p className="text-muted-foreground">{line}</p> : null}
      </div>
      {actions.length > 0 ? (
        <div className="col-start-2 row-start-1 flex gap-1 justify-self-end md:col-auto">
          {actions.includes("edit") ? (
            <Button
              variant="ghost"
              data-action="edit"
              aria-describedby={nameId}
              onClick={() => onEdit(row)}
            >
              <PencilIcon aria-hidden />
              {m.monitor_edit({ part: "action", name: "" })}
            </Button>
          ) : null}
          {actions.includes("resume") ? (
            <Button
              variant="ghost"
              data-action="pause"
              aria-describedby={nameId}
              onClick={() => onPause(row)}
            >
              <PlayIcon aria-hidden />
              {m.monitor_pause_action({ action: "resume" })}
            </Button>
          ) : (
            <Button
              ref={pauseRef}
              variant="ghost"
              data-action="pause"
              aria-describedby={nameId}
              aria-expanded={confirming}
              onClick={() => setConfirming(true)}
            >
              <PauseIcon aria-hidden />
              {m.monitor_pause_action({ action: "pause" })}
            </Button>
          )}
        </div>
      ) : null}
      {confirming && actions.includes("pause") ? (
        // Pausing stops the checks and resolves a firing alert, so it asks first. Inline, next to the row it is about.
        <div
          role="group"
          aria-labelledby={promptId}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
          className="col-span-full flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-muted px-3 py-2 text-sm"
        >
          <p id={promptId} className="min-w-0 flex-1 basis-48">
            {m.monitor_pause_action({ action: alerting ? "prompt_alert" : "prompt" })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              ref={confirmRef}
              variant="destructive"
              className={CONFIRM_DESTRUCTIVE}
              aria-describedby={nameId}
              onClick={() => {
                setConfirming(false);
                onPause(row);
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLElement>(`[data-monitor="${row.id}"] [data-action="pause"]`)
                    ?.focus(),
                );
              }}
            >
              <PauseIcon aria-hidden />
              {m.monitor_pause_action({ action: "pause" })}
            </Button>
            <Button variant="ghost" onClick={cancel}>
              {m.declare_cancel()}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** A placeholder row with the real row's grid and heights, so the list does not jump when the data arrives. */
function MonitorItemSkeleton() {
  return (
    <li aria-hidden className={ROW_GRID}>
      <span className="col-start-1 row-start-1 block h-6 w-20 rounded-sm bg-muted md:col-auto" />
      <div className="col-span-2 row-start-2 flex flex-col gap-1.5 md:col-span-1 md:row-start-1">
        <span className="my-0.5 block h-4 w-40 max-w-full rounded-sm bg-muted" />
        <span className="my-0.5 block h-3 w-56 max-w-full rounded-sm bg-muted" />
      </div>
      <div className="col-span-2 row-start-3 flex gap-1.5 md:col-span-1 md:row-start-1">
        <span className="block h-6 w-28 rounded-sm bg-muted" />
        <span className="block h-6 w-28 rounded-sm bg-muted" />
      </div>
    </li>
  );
}

const INCIDENT_LINK =
  "inline-flex min-h-6 items-center rounded-sm text-sm font-medium whitespace-nowrap text-primary underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring";

/**
 * The incident an alerting monitor opened: its page once the shard has numbered it (`/incidents/<n>`), until then
 * its row in the incident list.
 */
function IncidentLink({ id }: { id: string }) {
  const { rows } = useQuery("incident.byId", { id });
  const router = useRouter({ warn: false }) as ReturnType<typeof useRouter> | null;
  const numbered = rows[0]?.number ?? null;
  const number = formatIncidentNumber(numbered);
  if (numbered !== null) {
    const text = m.monitor_incident_link({ has: "yes", number: number ?? "" });
    // A plain link where the card renders without a router (its own tests).
    return router ? (
      <Link to="/incidents/$number" params={{ number: String(numbered) }} className={INCIDENT_LINK}>
        {text}
      </Link>
    ) : (
      <a href={`/incidents/${numbered}`} className={INCIDENT_LINK}>
        {text}
      </a>
    );
  }
  return (
    <a
      href={`#incident-${id}`}
      onClick={(event) => {
        const target = document.getElementById(`incident-${id}`);
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({ block: "center" });
        target.focus({ preventScroll: true });
      }}
      className={INCIDENT_LINK}
    >
      {m.monitor_incident_link({ has: "no", number: "" })}
    </a>
  );
}

/**
 * One source: where the last check really ran from (the colo, never the hint), how long it took, and why it
 * failed. A source with no fresh result reads as no data, and one that never reported as waiting.
 */
function CheckChip({ chip, row, locale }: { chip: SourceChip; row: MonitorRow; locale: Locale }) {
  const where =
    chip.source === "heartbeat"
      ? m.monitor_kind({ kind: "heartbeat" })
      : m.monitor_region({ region: chip.source });
  const base =
    "inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-sm border px-2 text-xs tabular-nums";
  if (chip.state !== "fresh") {
    const Icon = chip.state === "waiting" ? CircleDashedIcon : CloudOffIcon;
    return (
      <li className={cn(base, "border-dashed border-border text-muted-foreground")}>
        <Icon aria-hidden className="size-3 shrink-0" />
        <span className="whitespace-nowrap">{where}</span>
        <span className="whitespace-nowrap">
          {m.monitor_status({ status: chip.state === "waiting" ? "pending" : "unknown" })}
        </span>
      </li>
    );
  }
  const { check } = chip;
  return (
    <li
      className={cn(
        base,
        "flex-wrap",
        check.up ? "border-border text-muted-foreground" : "border-destructive/50 text-destructive",
      )}
    >
      {check.up ? (
        <CircleCheckIcon aria-hidden className="size-3 shrink-0 text-status-resolved-foreground" />
      ) : (
        <OctagonAlertIcon aria-hidden className="size-3 shrink-0" />
      )}
      <span className="whitespace-nowrap">{where}</span>
      {check.colo === null ? null : (
        <span className="font-medium text-foreground">{check.colo}</span>
      )}
      {check.up && check.latencyMs !== null ? (
        <span className="whitespace-nowrap">{formatLatency(check.latencyMs, locale)}</span>
      ) : null}
      {check.up ? null : (
        <span className="font-medium">
          {m.monitor_check_error({
            reason: checkErrorReason(check, row.expectedStatus),
            got: String(check.httpStatus ?? ""),
            expected: String(row.expectedStatus ?? ""),
          })}
        </span>
      )}
    </li>
  );
}

/** A refusal from the shard; it goes away when dismissed or on the next action. */
function DismissableError({ children, onDismiss }: { children: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-1">
      <div className="min-w-0 flex-1">
        <FormError>{children}</FormError>
      </div>
      <Button variant="ghost" size="icon" aria-label={m.dismiss()} onClick={onDismiss}>
        <XIcon aria-hidden />
      </Button>
    </div>
  );
}

/**
 * The heartbeat URL, once: the shard keeps only its hash, so it cannot be shown again. Copy is the first action
 * and takes focus; closing before copying asks first.
 */
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
  const hintId = useId();
  const [copied, setCopied] = useState(false);
  /** Set when the clipboard refused: the URL is selected for a manual copy, and the shortcut shown. */
  const [manual, setManual] = useState(false);
  const [asking, setAsking] = useState(false);
  const copyRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => copyRef.current?.focus(), []);
  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setManual(false);
      setAsking(false);
    } catch {
      // No clipboard (an insecure origin, a denied permission): select it for a manual copy instead. Focus
      // first, or the selection is not the one the shortcut copies.
      setManual(true);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
      <div className="flex items-start gap-3">
        <div id={textId} className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-semibold">{m.monitor_heartbeat({ part: "once", interval: "" })}</p>
          <p>{m.monitor_heartbeat({ part: "send", interval: formatSeconds(interval, locale) })}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="-mt-1.5 -mr-1.5"
          aria-label={m.dismiss()}
          aria-describedby={textId}
          onClick={() => (copied ? onDismiss() : setAsking(true))}
        >
          <XIcon aria-hidden />
        </Button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={inputRef}
          readOnly
          value={url}
          aria-labelledby={textId}
          aria-describedby={manual ? hintId : undefined}
          onFocus={(event) => event.currentTarget.select()}
          className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 font-mono text-base outline-none focus-visible:ring-3 focus-visible:ring-ring sm:text-sm"
        />
        <Button ref={copyRef} onClick={() => void copy()}>
          {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          {m.monitor_heartbeat({ part: copied ? "copied" : "copy", interval: "" })}
        </Button>
      </div>
      {/* Only the confirmation is announced; the panel itself is read when focus lands on Copy. */}
      <span role="status" className="sr-only">
        {copied ? m.monitor_heartbeat({ part: "copied", interval: "" }) : ""}
      </span>
      {manual ? (
        <p id={hintId} className="-mt-1 text-muted-foreground">
          {m.monitor_heartbeat({ part: isApple() ? "copy_key_apple" : "copy_key", interval: "" })}
        </p>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground">
          {m.monitor_heartbeat({ part: "try", interval: "" })}
        </p>
        <code className="block rounded-md bg-card px-3 py-2 font-mono text-xs [overflow-wrap:anywhere] select-all">
          curl -fsS -X POST {url}
        </code>
      </div>
      {asking ? (
        <div className="flex flex-col gap-2 rounded-md bg-card p-3">
          <p className="font-medium">
            {m.monitor_heartbeat({ part: "close_prompt", interval: "" })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button ref={keepRef} variant="outline" onClick={() => setAsking(false)}>
              {m.monitor_heartbeat({ part: "keep", interval: "" })}
            </Button>
            <Button variant="ghost" onClick={onDismiss}>
              {m.monitor_heartbeat({ part: "close", interval: "" })}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Whether the copy shortcut is ⌘C rather than Ctrl+C. */
function isApple(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
  );
}

/**
 * A ref for a list whose rows re-sort: React moves a row by re-inserting it, which drops focus from a button
 * inside it. React's commit already puts focus back on the element that had it; this is the fallback should that
 * ever not happen. The element focused in the list when a render starts is focused again once it commits, if focus
 * fell to the page itself (a click elsewhere moved it somewhere real, so that is left alone).
 */
function useStableFocus(rows: readonly unknown[]) {
  const listRef = useRef<HTMLUListElement>(null);
  const focused = useRef<HTMLElement | null>(null);
  // Read during render, before the commit moves any row.
  const active = typeof document === "undefined" ? null : document.activeElement;
  focused.current =
    active instanceof HTMLElement && listRef.current?.contains(active) ? active : null;
  useLayoutEffect(() => {
    const element = focused.current;
    if (element?.isConnected && document.activeElement === document.body) {
      element.focus({ preventScroll: true });
    }
  }, [rows]);
  return listRef;
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
