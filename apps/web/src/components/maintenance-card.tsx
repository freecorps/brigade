import { formatDateTime, getLocale, m } from "@freecorps/brigade-i18n";
import {
  can,
  MAINTENANCE_MAX_MS,
  MAX_OPEN_MAINTENANCE,
  PUBLIC_TITLE_MAX,
  type MaintenancePhase,
  type MaintenanceRow,
  type StatusComponentRow,
} from "@freecorps/brigade-schema";
import { useMutation, useQuery, useSyncClient } from "@freecorps/brigade-sync/react";
import { PlusIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { CONFIRM_DESTRUCTIVE } from "@/components/monitor-form";
import { useMember } from "@/components/session";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardSection } from "@/components/ui/card";
import { Field, FormError } from "@/components/ui/field";

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The card's text for `part` (packages/i18n `maintenance_card`). */
const say = (part: string, args: { name?: string; time?: string; until?: string } = {}) =>
  m.maintenance_card({
    part,
    name: args.name ?? "",
    time: args.time ?? "",
    until: args.until ?? "",
  });

const PHASE_BADGE = {
  scheduled: "outline",
  in_progress: "monitoring",
  completed: "secondary",
} as const satisfies Record<MaintenancePhase, string>;

/** `datetime-local`'s value for `at` in this browser's time zone. */
export function toLocalInput(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Epoch ms of a `datetime-local` value in this browser's time zone; NaN when empty or invalid. */
export function fromLocalInput(value: string): number {
  return value ? new Date(value).getTime() : Number.NaN;
}

/**
 * Scheduled maintenance on the status page (RFC 0012 "Scheduled maintenance"): planned windows, live from the shard.
 * Owners, admins and responders plan, change, end and call them off; everyone reads them.
 */
export function MaintenanceCard() {
  const { role } = useMember();
  const client = useSyncClient();
  const page = useQuery("statusPage.config", {});
  const windows = useQuery("maintenance.all", {});
  const components = useQuery("statusComponents.all", {});
  const schedule = useMutation("maintenance.schedule");
  const update = useMutation("maintenance.update");
  const end = useMutation("maintenance.end");
  const cancel = useMutation("maintenance.cancel");
  return (
    <MaintenancePanel
      ready={page.rows.length > 0}
      loading={page.status === "loading" || windows.status === "loading"}
      windows={windows.rows}
      components={components.rows}
      publish={can(role, "status:publish")}
      now={Date.now()}
      onSave={async (draft, id) =>
        id
          ? (await update({ ...draft, outage: draft.outage === true, id })).ok
          : (await schedule({ ...draft, outage: draft.outage === true, id: client.newId("mnt") }))
              .ok
      }
      onEnd={async (id) => (await end({ id })).ok}
      onCancel={async (id) => (await cancel({ id })).ok}
    />
  );
}

export type MaintenanceDraft = Pick<
  MaintenanceRow,
  "title" | "body" | "componentIds" | "startsAt" | "endsAt" | "outage"
>;

type PanelProps = {
  ready: boolean;
  loading: boolean;
  windows: readonly MaintenanceRow[];
  components: readonly StatusComponentRow[];
  publish: boolean;
  now: number;
  onSave: (draft: MaintenanceDraft, id?: string) => Promise<boolean>;
  onEnd: (id: string) => Promise<boolean>;
  onCancel: (id: string) => Promise<boolean>;
};

/** The card without the hooks (tested and screenshotted with made-up data). */
export function MaintenancePanel(props: PanelProps) {
  const { ready, loading, windows, publish } = props;
  const [adding, setAdding] = useState(false);
  const open = windows.filter((row) => row.phase !== "completed");
  const past = windows
    .filter((row) => row.phase === "completed")
    .sort((a, b) => b.endsAt - a.endsAt)
    .slice(0, 5);
  return (
    <Card aria-labelledby="maintenance-title">
      <CardHeader
        id="maintenance-title"
        title={say("title")}
        description={say("description")}
        action={
          ready && publish && !adding && open.length < MAX_OPEN_MAINTENANCE ? (
            <Button variant="outline" onClick={() => setAdding(true)}>
              <PlusIcon aria-hidden />
              {say("schedule")}
            </Button>
          ) : null
        }
      />
      <CardContent className="flex flex-col gap-4">
        {loading ? null : !ready ? (
          <Empty>{say("not_set_up")}</Empty>
        ) : (
          <>
            {adding ? <WindowForm {...props} onDone={() => setAdding(false)} /> : null}
            {open.length === 0 && !adding ? (
              <Empty>{say("empty")}</Empty>
            ) : (
              <ul className="flex flex-col divide-y rounded-md border empty:hidden">
                {open.map((row) => (
                  <WindowRow key={row.id} row={row} {...props} />
                ))}
              </ul>
            )}
            {open.length >= MAX_OPEN_MAINTENANCE ? (
              <p className="text-sm text-muted-foreground">{say("limit")}</p>
            ) : null}
            {past.length > 0 ? (
              <CardSection id="maintenance-past" title={say("past_title")}>
                <ul className="flex flex-col divide-y rounded-md border">
                  {past.map((row) => (
                    <WindowRow key={row.id} row={row} {...props} />
                  ))}
                </ul>
              </CardSection>
            ) : null}
            {!publish ? <p className="text-sm text-muted-foreground">{say("viewer")}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function range(row: Pick<MaintenanceRow, "startsAt" | "endsAt">): string {
  const locale = getLocale();
  return say("window", {
    time: formatDateTime(row.startsAt, locale, TIME_ZONE),
    until: formatDateTime(row.endsAt, locale, TIME_ZONE),
  });
}

function WindowRow({ row, ...props }: PanelProps & { row: MaintenanceRow }) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const titleId = useId();
  const names = row.componentIds.flatMap(
    (id) => props.components.find((component) => component.id === id)?.name ?? [],
  );
  if (mode === "edit") {
    return (
      <li className="px-3 py-3">
        <WindowForm {...props} row={row} onDone={() => setMode("view")} />
      </li>
    );
  }
  const act = (work: () => Promise<boolean>) => {
    setBusy(true);
    setFailed(false);
    void work().then((ok) => {
      setBusy(false);
      if (!ok) setFailed(true);
      else setMode("view");
    });
  };
  return (
    <li className="flex flex-col gap-2 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <span id={titleId} className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
          {row.title}
        </span>
        <span className="flex flex-wrap gap-1.5">
          {row.outage ? <Badge variant="sev1">{say("outage_badge")}</Badge> : null}
          <Badge variant={PHASE_BADGE[row.phase]}>{say(`phase_${row.phase}`)}</Badge>
        </span>
      </div>
      <p className="text-sm text-muted-foreground tabular-nums">{range(row)}</p>
      {names.length > 0 ? (
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{names.join(", ")}</p>
      ) : null}
      {mode === "confirm" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm [overflow-wrap:anywhere]">
            {say("call_off_confirm", { name: row.title })}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="destructive"
              className={CONFIRM_DESTRUCTIVE}
              disabled={busy}
              onClick={() => act(() => props.onCancel(row.id))}
            >
              {say("call_off")}
            </Button>
            <Button variant="outline" onClick={() => setMode("view")}>
              {say("keep")}
            </Button>
          </div>
        </div>
      ) : props.publish && row.phase !== "completed" ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" aria-describedby={titleId} onClick={() => setMode("edit")}>
            {say("edit")}
          </Button>
          {row.phase === "in_progress" ? (
            <Button
              variant="outline"

              disabled={busy}
              aria-describedby={titleId}
              onClick={() => act(() => props.onEnd(row.id))}
            >
              {say("end_now")}
            </Button>
          ) : null}
          <Button
            variant="ghost"

            className="text-destructive"
            aria-describedby={titleId}
            onClick={() => setMode("confirm")}
          >
            {say("call_off")}
          </Button>
        </div>
      ) : null}
      {failed ? <FormError>{say("failed")}</FormError> : null}
    </li>
  );
}

type Problem =
  | "title_required"
  | "body_required"
  | "times_required"
  | "ends_before"
  | "too_long"
  | "ended";

/** What the form refuses before the shard would, with the shard's own limits. */
export function checkDraft(draft: MaintenanceDraft, now: number): Problem | null {
  if (!draft.title) return "title_required";
  if (!draft.body) return "body_required";
  if (Number.isNaN(draft.startsAt) || Number.isNaN(draft.endsAt)) return "times_required";
  if (draft.endsAt <= draft.startsAt) return "ends_before";
  if (draft.endsAt - draft.startsAt > MAINTENANCE_MAX_MS) return "too_long";
  if (draft.endsAt <= now) return "ended";
  return null;
}

function WindowForm({
  row,
  components,
  now,
  onSave,
  onDone,
}: PanelProps & { row?: MaintenanceRow; onDone: () => void }) {
  const hour = 60 * 60 * 1000;
  const nextHour = Math.ceil(now / hour) * hour + hour;
  const [title, setTitle] = useState(row?.title ?? "");
  const [body, setBody] = useState(row?.body ?? "");
  const [chosen, setChosen] = useState<string[]>(row?.componentIds ?? []);
  const [outage, setOutage] = useState(row?.outage === true);
  const [starts, setStarts] = useState(toLocalInput(row?.startsAt ?? nextHour));
  const [ends, setEnds] = useState(toLocalInput(row?.endsAt ?? nextHour + hour));
  const [problem, setProblem] = useState<Problem | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const bodyId = useId();
  const startsId = useId();
  const endsId = useId();
  const hintId = useId();
  const outageHintId = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const draft: MaintenanceDraft = {
      title: title.trim(),
      body: body.trim(),
      componentIds: chosen,
      startsAt: fromLocalInput(starts),
      endsAt: fromLocalInput(ends),
      // Only components can be down: with none chosen the box is hidden, and a ticked one must not linger.
      outage: outage && chosen.length > 0,
    };
    const found = checkDraft(draft, Date.now());
    setProblem(found);
    if (found) return;
    setState("busy");
    void onSave(draft, row?.id).then((ok) => {
      if (ok) onDone();
      else setState("failed");
    });
  };
  const input =
    "field w-full min-w-0 px-3 focus-visible:ring-3 focus-visible:ring-ring aria-invalid:border-destructive";
  const timesWrong =
    problem === "times_required" ||
    problem === "ends_before" ||
    problem === "too_long" ||
    problem === "ended";
  return (
    <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
      <Field
        label={say("title_label")}
        value={title}
        maxLength={PUBLIC_TITLE_MAX}
        error={problem === "title_required" ? say("title_required") : undefined}
        onChange={(event) => setTitle(event.target.value)}
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={bodyId} className="text-sm font-medium">
          {say("body_label")}
        </label>
        <textarea
          id={bodyId}
          value={body}
          rows={3}
          aria-invalid={problem === "body_required" || undefined}
          onChange={(event) => setBody(event.target.value)}
          className="field h-auto field-sizing-content max-h-80 min-h-24 w-full min-w-0 resize-y px-3 py-2.5 focus-visible:ring-3 focus-visible:ring-ring aria-invalid:border-destructive"
        />
        {problem === "body_required" ? <FormError>{say("body_required")}</FormError> : null}
      </div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={startsId} className="text-sm font-medium">
            {say("starts_label")}
          </label>
          <input
            id={startsId}
            type="datetime-local"
            value={starts}
            aria-invalid={timesWrong || undefined}
            aria-describedby={hintId}
            onChange={(event) => setStarts(event.target.value)}
            className={input}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={endsId} className="text-sm font-medium">
            {say("ends_label")}
          </label>
          <input
            id={endsId}
            type="datetime-local"
            value={ends}
            aria-invalid={timesWrong || undefined}
            aria-describedby={hintId}
            onChange={(event) => setEnds(event.target.value)}
            className={input}
          />
        </div>
        <p id={hintId} className="text-sm text-muted-foreground sm:col-span-2">
          {say("times_hint", { name: TIME_ZONE })}
        </p>
        {timesWrong ? (
          <div className="sm:col-span-2">
            <FormError>{say(problem!)}</FormError>
          </div>
        ) : null}
      </div>
      {components.length > 0 ? (
        <fieldset className="flex min-w-0 flex-col gap-1">
          <legend className="mb-1.5 text-sm font-medium">{say("components_label")}</legend>
          {components.map((component) => (
            <label key={component.id} className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-primary"
                checked={chosen.includes(component.id)}
                onChange={(event) =>
                  setChosen((current) =>
                    event.target.checked
                      ? [...current, component.id]
                      : current.filter((id) => id !== component.id),
                  )
                }
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {component.group ? `${component.group} · ${component.name}` : component.name}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {components.length > 0 ? (
        <label className="flex min-h-11 items-start gap-3 border-t pt-4 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0 accent-primary"
            // Only components can be down: with none chosen it can't be ticked, rather than being dropped on save.
            checked={outage && chosen.length > 0}
            disabled={chosen.length === 0}
            aria-describedby={outageHintId}
            onChange={(event) => setOutage(event.target.checked)}
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium">{say("outage_label")}</span>
            <span id={outageHintId} className="text-muted-foreground">
              {say("outage_hint")}
            </span>
          </span>
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={state === "busy"}>
          {say(state === "busy" ? "saving" : row ? "update" : "save")}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          {say("cancel")}
        </Button>
      </div>
      {state === "failed" ? <FormError>{say("failed")}</FormError> : null}
    </form>
  );
}
