import { m, type Locale } from "@freecorps/brigade-i18n";
import {
  can,
  LAYER_NAME_MAX,
  MAX_SHIFT_COUNT,
  nextHandoffs,
  SCHEDULE_NAME_MAX,
  type MemberRow,
  type OnCallSegment,
  type OverrideRow,
  type ScheduleRow,
} from "@freecorps/brigade-schema";
import type { MutationOutcome } from "@freecorps/brigade-sync";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { cn } from "cn";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarClockIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { CONFIRM_DESTRUCTIVE } from "@/components/monitor-form";
import { usePreferences } from "@/components/preferences";
import { useMember } from "@/components/session";
import { TimeZonePicker } from "@/components/time-zone-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Field, FormError } from "@/components/ui/field";
import { queryErrorReason } from "@/lib/incidents";
import {
  browserTimeZone,
  canAddLayer,
  canAddMember,
  canAddSchedule,
  checkOverride,
  checkSchedule,
  draftFromSchedule,
  draftMembers,
  emptyOverride,
  emptySchedule,
  fromLocalInput,
  fromNow,
  handoffTime,
  hiddenLayers,
  layerName,
  layerNow,
  layerRhythm,
  MAX_LAYER_MEMBERS,
  memberLabel,
  newLayer,
  newOverrideId,
  newScheduleId,
  offsetLabel,
  ROTATION_SHOWN,
  ROTATION_UNITS,
  rotationChoices,
  rotationFrom,
  scheduleRefusal,
  text,
  UPCOMING_MS,
  UPCOMING_SHOWN,
  viewerTime,
  withTimeZone,
  zoneLabel,
  type CheckedSchedule,
  type LayerDraft,
  type OverrideDraft,
  type RotationUnit,
  type ScheduleDraft,
  type ScheduleErrors,
} from "@/lib/oncall";

const SELECT =
  "h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring aria-invalid:border-destructive";
const LABEL = "text-xs font-medium tracking-wide text-muted-foreground uppercase";
/** Forms run edge to edge on phones (the card's padding is room enough) and as a box from `sm` up. */
const FORM =
  "-mx-4 flex min-w-0 flex-col gap-4 border-y bg-muted/40 px-4 py-4 sm:mx-0 sm:rounded-md sm:border";

/**
 * The workspace's on-call schedules, live from its shard (`schedules.all`, `overrides.all`): who is on call now and
 * the next handoffs, each in the schedule's own time zone (and the viewer's, when that reads differently), its
 * layers and upcoming overrides. Owners and admins create, edit and delete schedules and add anyone's override;
 * responders add and remove their own overrides. Nothing here pages anyone yet (RFC 0006 "Who is paged").
 */
export function OnCallCard() {
  const { locale } = usePreferences();
  const { userId, role } = useMember();
  const manage = can(role, "schedule:manage");
  const override = can(role, "schedule:override");
  const schedules = useQuery("schedules.all", {});
  const overrides = useQuery("overrides.all", {});
  const members = useQuery("members.all", {});
  const create = useMutation("schedule.create");
  const update = useMutation("schedule.update");
  const remove = useMutation("schedule.delete");
  const addOverride = useMutation("schedule.addOverride");
  const removeOverride = useMutation("schedule.removeOverride");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [overriding, setOverriding] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const now = useNow(30_000);
  const viewerZone = useMemo(browserTimeZone, []);

  const report = (name: string) => (outcome: MutationOutcome) => {
    if (!outcome.ok) {
      setRefused(m.oncall_change_failed({ name, reason: scheduleRefusal(outcome.error.code) }));
    }
  };
  const closeAll = () => {
    setAdding(false);
    setEditing(null);
    setOverriding(null);
  };
  const focusRow = (id: string, action: string) =>
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-schedule="${id}"] [data-action="${action}"]`)
        ?.focus(),
    );

  const rows = schedules.rows;
  const status = schedules.status;
  const loading = status !== "ready" && status !== "error";
  const choices = rotationChoices(members.rows);
  const usedZones = rows.map((row) => row.timeZone);
  return (
    <Card
      aria-labelledby="oncall-title"
      className={cn(rows.length > 0 && "overflow-hidden pb-0 sm:pb-0")}
    >
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <CardTitle id="oncall-title" className="truncate">
            {m.oncall_title()}
          </CardTitle>
          {manage && !adding ? (
            <Button
              ref={addRef}
              variant="outline"
              disabled={!canAddSchedule(rows.length)}
              onClick={() => {
                setRefused(null);
                closeAll();
                setAdding(true);
              }}
            >
              <PlusIcon aria-hidden />
              {m.oncall_action({ action: "add_schedule" })}
            </Button>
          ) : null}
        </div>
        {/* The empty state says "no schedules" already; the count is for when there are some. */}
        {loading || rows.length > 0 ? (
          <div className="flex h-6 items-center text-sm text-muted-foreground tabular-nums">
            {loading ? (
              <span aria-hidden className="block h-4 w-24 rounded-sm bg-muted" />
            ) : (
              <span>{m.oncall_schedules_count({ count: rows.length })}</span>
            )}
          </div>
        ) : null}
      </div>

      <CardContent className="flex flex-col gap-5">
        <p className="text-sm text-muted-foreground">{m.oncall_not_paging()}</p>
        {adding ? (
          <ScheduleForm
            initial={emptySchedule(now)}
            members={members.rows}
            choices={choices}
            viewerZone={viewerZone}
            usedZones={usedZones}
            onCancel={() => {
              setAdding(false);
              requestAnimationFrame(() => addRef.current?.focus());
            }}
            onSubmit={(draft) => {
              const checked = checkSchedule(newScheduleId(Date.now()), draft);
              if (!checked.ok) return checked;
              setRefused(null);
              void create(checked.args).then(report(checked.args.name));
              setAdding(false);
              requestAnimationFrame(() => addRef.current?.focus());
              return checked;
            }}
          />
        ) : null}
        {refused ? (
          <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1">
              <FormError>{refused}</FormError>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={m.dismiss()}
              onClick={() => setRefused(null)}
            >
              <XIcon aria-hidden />
            </Button>
          </div>
        ) : null}
        {status === "error" ? (
          <FormError>{queryErrorReason(schedules.error?.code)}</FormError>
        ) : null}

        {rows.length > 0 ? (
          <ul aria-labelledby="oncall-title" className="-mx-4 divide-y border-t sm:-mx-6">
            {rows.map((row) => (
              <li
                key={row.id}
                data-schedule={row.id}
                className="flex flex-col gap-4 px-4 py-4 sm:px-6"
              >
                {editing === row.id ? (
                  <ScheduleForm
                    initial={draftFromSchedule(row)}
                    // Only a loaded list can say someone is gone.
                    loaded={members.status === "ready"}
                    editing={row}
                    members={members.rows}
                    choices={choices}
                    viewerZone={viewerZone}
                    usedZones={usedZones}
                    onCancel={() => {
                      setEditing(null);
                      focusRow(row.id, "edit");
                    }}
                    onDelete={() => {
                      setRefused(null);
                      void remove({ id: row.id }).then(report(row.name));
                      setEditing(null);
                      requestAnimationFrame(() => addRef.current?.focus());
                    }}
                    onSubmit={(draft) => {
                      const checked = checkSchedule(row.id, draft);
                      if (!checked.ok) return checked;
                      setRefused(null);
                      void update(checked.args).then(report(checked.args.name));
                      setEditing(null);
                      focusRow(row.id, "edit");
                      return checked;
                    }}
                  />
                ) : (
                  <ScheduleItem
                    row={row}
                    overrides={overrides.rows}
                    members={members.rows}
                    locale={locale}
                    now={now}
                    viewerZone={viewerZone}
                    userId={userId}
                    manage={manage}
                    canOverride={override}
                    onEdit={() => {
                      setRefused(null);
                      closeAll();
                      setEditing(row.id);
                    }}
                    onOverride={() => {
                      setRefused(null);
                      closeAll();
                      setOverriding(row.id);
                    }}
                    onRemoveOverride={(target) => {
                      setRefused(null);
                      void removeOverride({ id: target.id }).then(report(row.name));
                    }}
                    overrideForm={
                      overriding === row.id ? (
                        <OverrideForm
                          schedule={row}
                          members={choices}
                          self={manage ? null : userId}
                          now={now}
                          locale={locale}
                          viewerZone={viewerZone}
                          onCancel={() => {
                            setOverriding(null);
                            focusRow(row.id, "override");
                          }}
                          onSubmit={(args) => {
                            setRefused(null);
                            void addOverride({ id: newOverrideId(Date.now()), ...args }).then(
                              report(row.name),
                            );
                            setOverriding(null);
                            focusRow(row.id, "override");
                          }}
                        />
                      ) : null
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        ) : loading ? (
          <div aria-hidden className="-mx-4 divide-y border-t sm:-mx-6">
            {[0, 1].map((index) => (
              <div key={index} className="flex flex-col gap-3 px-4 py-4 sm:px-6">
                <span className="block h-5 w-40 rounded-sm bg-muted" />
                <span className="block h-12 w-full max-w-md rounded-sm bg-muted" />
              </div>
            ))}
          </div>
        ) : status === "ready" && !adding ? (
          <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
            {m.oncall_empty()}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ScheduleItem({
  row,
  overrides,
  members,
  locale,
  now,
  viewerZone,
  userId,
  manage,
  canOverride,
  onEdit,
  onOverride,
  onRemoveOverride,
  overrideForm,
}: {
  row: ScheduleRow;
  overrides: readonly OverrideRow[];
  members: readonly MemberRow[];
  locale: Locale;
  now: number;
  viewerZone: string;
  userId: string;
  manage: boolean;
  canOverride: boolean;
  onEdit: () => void;
  onOverride: () => void;
  onRemoveOverride: (row: OverrideRow) => void;
  overrideForm: ReactNode;
}) {
  const nameId = useId();
  const layersId = useId();
  const overridesId = useId();
  const [confirming, setConfirming] = useState<string | null>(null);
  const segments = useHandoffs(row, overrides, now);
  const [current, ...upcoming] = segments;
  const cancelRemove = (id: string) => {
    setConfirming(null);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-override="${id}"] [data-action="remove-override"]`)
        ?.focus(),
    );
  };
  const own = overrides
    .filter((item) => item.scheduleId === row.id && item.end > now)
    .sort((a, b) => a.start - b.start);
  const name = (id: string | null) => (id === null ? m.oncall_nobody() : memberLabel(members, id));
  // Only a handoff ends the current stretch: alone, it ends where the list stopped looking, which is no time to show.
  const ends = current && segments.length > 1 ? current.end : null;
  const endsLocal = ends === null ? null : viewerTime(ends, row.timeZone, viewerZone, locale);
  const until =
    ends === null ? null : (
      <span className="flex flex-col text-sm text-muted-foreground tabular-nums">
        <span>{m.oncall_until({ time: handoffTime(ends, row.timeZone, locale) })}</span>
        <span className="text-xs">
          {endsLocal ? `${endsLocal} · ` : ""}
          {fromNow(ends, now, locale)}
        </span>
      </span>
    );
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
          <h3 id={nameId} className="font-medium [overflow-wrap:anywhere]">
            {row.name}
          </h3>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
            <ZoneLine timeZone={row.timeZone} now={now} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canOverride && !overrideForm ? (
            <Button
              variant="outline"
              data-action="override"
              aria-label={m.oncall_action_on({ action: "add_override", name: row.name })}
              onClick={onOverride}
            >
              <CalendarClockIcon aria-hidden />
              {m.oncall_action({ action: "add_override" })}
            </Button>
          ) : null}
          {manage ? (
            <Button
              variant="outline"
              data-action="edit"
              aria-label={m.oncall_action_on({ action: "edit", name: row.name })}
              onClick={onEdit}
            >
              <PencilIcon aria-hidden />
              {m.oncall_action({ action: "edit" })}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section
          aria-label={m.oncall_heading({ heading: "now" })}
          className="flex min-w-0 flex-col gap-1.5 rounded-md bg-muted/50 p-3"
        >
          <p className={LABEL}>{m.oncall_heading({ heading: "now" })}</p>
          {current && current.userId !== null ? (
            <>
              <p className="flex min-w-0 items-start gap-2 text-lg font-semibold">
                <UserRoundIcon aria-hidden className="mt-1 size-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{name(current.userId)}</span>
                {current.source?.kind === "override" ? (
                  <Badge variant="outline">{m.oncall_override_badge()}</Badge>
                ) : null}
              </p>
              {until}
            </>
          ) : (
            <>
              <p>
                <Badge variant="sev3">
                  <TriangleAlertIcon aria-hidden />
                  {m.oncall_nobody()}
                </Badge>
              </p>
              {until}
            </>
          )}
        </section>
        <section
          aria-label={m.oncall_heading({ heading: "upcoming" })}
          className="flex min-w-0 flex-col gap-1.5 p-1 md:p-3"
        >
          <p className={LABEL}>{m.oncall_heading({ heading: "upcoming" })}</p>
          {upcoming.length > 0 ? (
            <ol className="flex flex-col gap-2 text-sm sm:gap-1">
              {upcoming.slice(0, UPCOMING_SHOWN).map((segment) => (
                <Handoff
                  key={segment.start}
                  segment={segment}
                  label={name(segment.userId)}
                  timeZone={row.timeZone}
                  viewerZone={viewerZone}
                  locale={locale}
                />
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">{m.oncall_upcoming_none()}</p>
          )}
        </section>
      </div>

      <section aria-labelledby={layersId} className="flex flex-col gap-1.5">
        <h4 id={layersId} className={LABEL}>
          {m.oncall_heading({ heading: "layers" })}
        </h4>
        <ol className="flex flex-col gap-3 text-sm">
          {row.layers.map((layer, index) => (
            <LayerSummary
              key={layer.id}
              layer={layer}
              index={index}
              row={row}
              current={current}
              members={members}
              locale={locale}
              now={now}
            />
          ))}
        </ol>
      </section>

      {own.length > 0 ? (
        <section aria-labelledby={overridesId} className="flex flex-col gap-1.5">
          <h4 id={overridesId} className={LABEL}>
            {m.oncall_heading({ heading: "overrides" })}
          </h4>
          <ul className="flex flex-col gap-1 text-sm">
            {own.map((item, position) => {
              const who = memberLabel(members, item.userId);
              const removable = manage || (canOverride && item.userId === userId);
              const startLocal = viewerTime(item.start, row.timeZone, viewerZone, locale);
              const endLocal = viewerTime(item.end, row.timeZone, viewerZone, locale);
              return (
                <li
                  key={item.id}
                  data-override={item.id}
                  className="flex min-h-11 flex-col gap-2 py-1"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex min-w-0 flex-1 flex-col [overflow-wrap:anywhere]">
                      <span>
                        <span className="font-medium">{who}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {" "}
                          · {handoffTime(item.start, row.timeZone, locale)} –{" "}
                          {handoffTime(item.end, row.timeZone, locale)}
                        </span>
                      </span>
                      {startLocal && endLocal ? (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {startLocal} – {endLocal}
                        </span>
                      ) : null}
                    </span>
                    {removable && confirming !== item.id ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        data-action="remove-override"
                        aria-label={m.oncall_action_on({ action: "remove_override", name: who })}
                        onClick={() => setConfirming(item.id)}
                      >
                        <Trash2Icon aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                  {confirming === item.id ? (
                    <div
                      role="alertdialog"
                      aria-label={m.oncall_action_on({ action: "remove_override", name: who })}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 pl-3"
                      onKeyDown={(event) => {
                        // From either button: Escape is Cancel.
                        if (event.key !== "Escape") return;
                        event.stopPropagation();
                        cancelRemove(item.id);
                      }}
                    >
                      <p className="min-w-0 flex-1 basis-48 font-medium [overflow-wrap:anywhere]">
                        {text("remove_override", { name: who })}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="destructive"
                          className={CONFIRM_DESTRUCTIVE}
                          autoFocus
                          onClick={() => {
                            setConfirming(null);
                            onRemoveOverride(item);
                            // Focus the next override's remove (or the previous one's), else the card's own buttons.
                            const next = own[position + 1] ?? own[position - 1];
                            requestAnimationFrame(() => {
                              const scope = document.querySelector(`[data-schedule="${row.id}"]`);
                              const target =
                                (next &&
                                  scope?.querySelector<HTMLElement>(
                                    `[data-override="${next.id}"] [data-action="remove-override"]`,
                                  )) ||
                                scope?.querySelector<HTMLElement>(
                                  '[data-action="override"], [data-action="edit"]',
                                );
                              target?.focus();
                            });
                          }}
                        >
                          {m.oncall_action({ action: "remove" })}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => cancelRemove(item.id)}
                        >
                          {m.oncall_action({ action: "cancel" })}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {overrideForm}
    </>
  );
}

/**
 * `nextHandoffs` for the card, worked out again only when the schedule or its overrides change or the clock passes
 * the next handoff: the card ticks every 30 seconds and re-renders on every keystroke in a form, and a schedule's
 * handoffs stay the same in between.
 */
function useHandoffs(row: ScheduleRow, overrides: readonly OverrideRow[], now: number) {
  const work = () => ({
    row,
    overrides,
    segments: nextHandoffs(row, overrides, now, now + UPCOMING_MS, UPCOMING_SHOWN + 1),
  });
  const [cached, setCached] = useState(work);
  const first = cached.segments[0];
  if (cached.row !== row || cached.overrides !== overrides || (first && now >= first.end)) {
    // Storing what this render worked out (React's "information from previous renders" pattern).
    const fresh = work();
    setCached(fresh);
    return fresh.segments;
  }
  return cached.segments;
}

/** A layer on the dashboard: its rhythm, who it has now (and whether that is who is on call), its rotation. */
function LayerSummary({
  layer,
  index,
  row,
  current,
  members,
  locale,
  now,
}: {
  layer: ScheduleRow["layers"][number];
  index: number;
  row: ScheduleRow;
  current: OnCallSegment | undefined;
  members: readonly MemberRow[];
  locale: Locale;
  now: number;
}) {
  const state = layerNow(layer, row.timeZone, now, current);
  // Not started yet, but a later layer will have someone whenever it could: say so before it starts, too.
  const neverShown = state.state === "starts" && hiddenLayers(row.layers)[index];
  const order = rotationFrom(layer.members, "shift" in state ? state.shift : 0);
  const shown = order.slice(0, ROTATION_SHOWN);
  const rest = order.slice(ROTATION_SHOWN);
  const active = state.state === "active";
  return (
    <li className="flex min-w-0 flex-col gap-0.5">
      <p className="min-w-0 [overflow-wrap:anywhere]">
        <span className="font-medium">{layerName(layer, index)}</span>
        <span className="text-muted-foreground"> · {layerRhythm(layer, locale)}</span>
      </p>
      {state.state === "empty" ? (
        <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {m.oncall_layer_empty()}
        </p>
      ) : (
        <>
          <p
            className={cn(
              "min-w-0 [overflow-wrap:anywhere]",
              active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {state.state === "starts"
              ? m.oncall_layer_now({
                  state: "starts",
                  name: handoffTime(state.at, row.timeZone, locale),
                })
              : m.oncall_layer_now({
                  state: state.state,
                  name: memberLabel(members, state.userId),
                })}
          </p>
          {neverShown ? (
            <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
              <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              {text("layer_hidden")}
            </p>
          ) : null}
          {order.length > 1 ? (
            <div className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
              <p>{shown.map((id) => memberLabel(members, id)).join(" → ")}</p>
              {rest.length > 0 ? (
                <details className="group">
                  <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-sm text-foreground underline-offset-4 outline-none select-none focus-visible:ring-3 focus-visible:ring-ring sm:min-h-8 [&::-webkit-details-marker]:hidden [@media(hover:hover)]:hover:underline">
                    <ChevronRightIcon
                      aria-hidden
                      className="size-4 shrink-0 transition-transform duration-(--brigade-duration-fast) ease-out group-open:rotate-90 motion-reduce:transition-none"
                    />
                    {m.oncall_more({ count: rest.length })}
                  </summary>
                  <p>→ {rest.map((id) => memberLabel(members, id)).join(" → ")}</p>
                </details>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </li>
  );
}

function Handoff({
  segment,
  label,
  timeZone,
  viewerZone,
  locale,
}: {
  segment: OnCallSegment;
  label: string;
  timeZone: string;
  viewerZone: string;
  locale: Locale;
}) {
  const local = viewerTime(segment.start, timeZone, viewerZone, locale);
  return (
    // Phones stack the time over the name; wider screens put them side by side.
    <li className="flex flex-col sm:grid sm:grid-cols-[minmax(0,auto)_minmax(0,1fr)] sm:items-baseline sm:gap-x-3">
      <span className="flex flex-col text-muted-foreground tabular-nums">
        <span>{handoffTime(segment.start, timeZone, locale)}</span>
        {local ? <span className="text-xs">{local}</span> : null}
      </span>
      <span
        className={cn(
          "min-w-0 [overflow-wrap:anywhere]",
          segment.userId === null && "text-amber-700 dark:text-amber-400",
        )}
      >
        {label}
        {segment.source?.kind === "override" ? (
          <span className="text-muted-foreground"> · {m.oncall_override_badge()}</span>
        ) : null}
      </span>
    </li>
  );
}

// ---- Schedule form -------------------------------------------------------------------------------------------------

function ScheduleForm({
  initial,
  editing,
  loaded = false,
  members,
  choices,
  viewerZone,
  usedZones,
  onCancel,
  onSubmit,
  onDelete,
}: {
  initial: ScheduleDraft;
  editing?: ScheduleRow;
  /** Whether `members` is the shard's whole list yet (so people missing from it can be dropped). */
  loaded?: boolean;
  members: readonly MemberRow[];
  choices: readonly MemberRow[];
  viewerZone: string;
  usedZones: readonly string[];
  onCancel: () => void;
  onSubmit: (draft: ScheduleDraft) => CheckedSchedule;
  onDelete?: () => void;
}) {
  // Viewers and people who left, still in a layer, would make every save fail: dropped once, when it opens.
  const [opened] = useState(() =>
    loaded ? draftMembers(initial, members) : { draft: initial, dropped: false },
  );
  const [draft, setDraft] = useState(opened.draft);
  const [errors, setErrors] = useState<ScheduleErrors | null>(null);
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const zoneId = useId();
  const hidden = hiddenLayers(draft.layers);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  const setLayer = (index: number, patch: Partial<LayerDraft>) =>
    setDraft((current) => ({
      ...current,
      layers: current.layers.map((layer, i) => (i === index ? { ...layer, ...patch } : layer)),
    }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const checked = onSubmit(draft);
    if (!checked.ok) {
      setErrors(checked.errors);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(`[aria-labelledby="${titleId}"] [aria-invalid="true"]`)
          ?.focus(),
      );
    }
  };
  return (
    <form
      aria-labelledby={titleId}
      noValidate
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !keepsEscape(event)) onCancel();
      }}
      className={FORM}
    >
      <h3 id={titleId} className="font-medium [overflow-wrap:anywhere]">
        {editing
          ? m.oncall_action_on({ action: "edit", name: editing.name })
          : m.oncall_heading({ heading: "new" })}
      </h3>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field
          ref={nameRef}
          label={m.oncall_field({ field: "name" })}
          value={draft.name}
          maxLength={SCHEDULE_NAME_MAX}
          autoComplete="off"
          error={errors?.name ? m.oncall_field_invalid({ field: "name" }) : undefined}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={zoneId} className="text-sm font-medium">
            {m.oncall_field({ field: "time_zone" })}
          </label>
          <TimeZonePicker
            id={zoneId}
            value={draft.timeZone}
            viewerZone={viewerZone}
            used={[initial.timeZone, ...usedZones]}
            invalid={errors?.timeZone}
            onChange={(zone) =>
              setDraft((current) =>
                editing ? { ...current, timeZone: zone } : withTimeZone(current, zone, Date.now()),
              )
            }
          />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{m.oncall_layers_hint()}</p>
      {opened.dropped ? (
        <p
          role="status"
          className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400"
        >
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {text("dropped_members")}
        </p>
      ) : null}
      {draft.layers.map((layer, index) => (
        <LayerFields
          key={layer.id}
          layer={layer}
          index={index}
          hidden={hidden[index] ?? false}
          errors={errors?.layers[index]}
          members={members}
          choices={choices}
          removable={draft.layers.length > 1}
          onChange={(patch) => setLayer(index, patch)}
          onRemove={() =>
            setDraft((current) => ({
              ...current,
              layers: current.layers.filter((_, i) => i !== index),
            }))
          }
        />
      ))}
      {canAddLayer(draft.layers.length) ? (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() =>
            setDraft((current) => ({
              ...current,
              layers: [...current.layers, newLayer(current.timeZone, Date.now())],
            }))
          }
        >
          <PlusIcon aria-hidden />
          {m.oncall_action({ action: "add_layer" })}
        </Button>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit">
          {editing ? m.oncall_action({ action: "save" }) : m.oncall_action({ action: "create" })}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {m.oncall_action({ action: "cancel" })}
        </Button>
        {editing && onDelete && !confirming ? (
          <Button
            type="button"
            variant="ghost"
            className="ml-auto text-destructive"
            onClick={() => setConfirming(true)}
          >
            <Trash2Icon aria-hidden />
            {m.oncall_action({ action: "delete_schedule" })}
          </Button>
        ) : null}
      </div>
      {editing && onDelete && confirming ? (
        <div
          role="alertdialog"
          aria-label={m.oncall_action({ action: "delete_schedule" })}
          className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <p className="font-medium [overflow-wrap:anywhere]">
            {m.oncall_delete_confirm({ name: editing.name })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              className={CONFIRM_DESTRUCTIVE}
              autoFocus
              onClick={onDelete}
            >
              {m.oncall_action({ action: "delete" })}
            </Button>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
              {m.oncall_action({ action: "cancel" })}
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

/** Escape that a control handles itself (a native select, an open combobox) does not cancel the form. */
function keepsEscape(event: KeyboardEvent<HTMLElement>): boolean {
  const target = event.target as HTMLElement;
  return (
    target instanceof HTMLSelectElement ||
    (target.getAttribute("role") === "combobox" && target.getAttribute("aria-expanded") === "true")
  );
}

function LayerFields({
  layer,
  index: layerIndex,
  hidden,
  errors,
  members,
  choices,
  removable,
  onChange,
  onRemove,
}: {
  layer: LayerDraft;
  index: number;
  /** A later layer has someone at all times from this one's start. */
  hidden: boolean;
  errors: ScheduleErrors["layers"][number] | undefined;
  members: readonly MemberRow[];
  choices: readonly MemberRow[];
  removable: boolean;
  onChange: (patch: Partial<LayerDraft>) => void;
  onRemove: () => void;
}) {
  const unitId = useId();
  const addId = useId();
  const membersId = useId();
  const membersErrorId = useId();
  const peopleRef = useRef<HTMLDivElement>(null);
  const available = choices.filter((member) => !layer.members.includes(member.id));
  const name = layerName(layer, layerIndex);
  const count = layer.members.length;
  const focus = (selector: string) =>
    requestAnimationFrame(() => peopleRef.current?.querySelector<HTMLElement>(selector)?.focus());
  const rowSelector = (id: string, action: string) =>
    `[data-member="${CSS.escape(id)}"] [data-action="${action}"]`;
  /** Moves a person and keeps focus on them: on the arrow pressed, or the other one where it stops. */
  const move = (from: number, to: number, action: "up" | "down") => {
    const next = [...layer.members];
    const [item] = next.splice(from, 1);
    if (item === undefined) return;
    next.splice(to, 0, item);
    onChange({ members: next });
    const stuck = (action === "up" && to === 0) || (action === "down" && to === count - 1);
    focus(rowSelector(item, stuck ? (action === "up" ? "down" : "up") : action));
  };
  /** Removes a person and focuses the next row's remove (or the last one's), or "Add a person" when none is left. */
  const remove = (position: number) => {
    const id = layer.members[position];
    onChange({ members: layer.members.filter((member) => member !== id) });
    const after = layer.members[position + 1] ?? layer.members[position - 1];
    focus(after ? rowSelector(after, "remove") : '[data-action="add-member"]');
  };
  const keys = (event: KeyboardEvent<HTMLLIElement>, position: number) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    const up = event.key === "ArrowUp";
    const to = position + (up ? -1 : 1);
    if (to < 0 || to >= count) return;
    event.preventDefault();
    move(position, to, up ? "up" : "down");
  };
  return (
    <fieldset className="flex min-w-0 flex-col gap-4 rounded-md border bg-card p-3 sm:p-4">
      <legend className="sr-only">{name}</legend>
      <div className="flex items-end gap-2">
        <Field
          className="flex-1"
          label={m.oncall_field({ field: "layer_name" })}
          value={layer.name}
          placeholder={m.oncall_layer_name({ number: String(layerIndex + 1) })}
          maxLength={LAYER_NAME_MAX}
          autoComplete="off"
          error={errors?.name ? m.oncall_field_invalid({ field: "layer_name" }) : undefined}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        {removable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={m.oncall_action_on({ action: "remove_layer", name })}
            onClick={onRemove}
          >
            <Trash2Icon aria-hidden />
          </Button>
        ) : null}
      </div>
      {hidden ? (
        <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {text("layer_hidden")}
        </p>
      ) : null}
      <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          type="date"
          label={m.oncall_field({ field: "start_date" })}
          value={layer.startDate}
          min="2000-01-01"
          max="2099-12-31"
          error={errors?.startDate ? m.oncall_field_invalid({ field: "start_date" }) : undefined}
          onChange={(event) => onChange({ startDate: event.target.value })}
        />
        <Field
          type="time"
          label={m.oncall_field({ field: "handoff_time" })}
          value={layer.handoffTime}
          error={
            errors?.handoffTime ? m.oncall_field_invalid({ field: "handoff_time" }) : undefined
          }
          onChange={(event) => onChange({ handoffTime: event.target.value })}
        />
        <Field
          inputMode="numeric"
          label={m.oncall_field({ field: "count" })}
          value={layer.count}
          error={
            errors?.count
              ? m.oncall_count_invalid({ max: String(MAX_SHIFT_COUNT[layer.unit]) })
              : undefined
          }
          onChange={(event) => onChange({ count: event.target.value })}
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={unitId} className="text-sm font-medium">
            {m.oncall_field({ field: "unit" })}
          </label>
          <select
            id={unitId}
            className={SELECT}
            value={layer.unit}
            onChange={(event) => onChange({ unit: event.target.value as RotationUnit })}
          >
            {ROTATION_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {m.oncall_unit({ unit })}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div ref={peopleRef} className="flex min-w-0 flex-col gap-1.5">
        <p id={membersId} className="text-sm font-medium">
          {m.oncall_field({ field: "members" })}
        </p>
        {count > 0 ? (
          <ol aria-labelledby={membersId} className="flex flex-col divide-y rounded-md border">
            {layer.members.map((id, position) => {
              const label = memberLabel(members, id);
              return (
                // Phones put the name on its own line and the buttons under it, on the right.
                <li
                  key={id}
                  data-member={id}
                  onKeyDown={(event) => keys(event, position)}
                  className="flex flex-wrap items-center gap-x-1 py-1 pr-1 pl-3 sm:min-h-11 sm:flex-nowrap sm:py-0"
                >
                  <span className="w-6 shrink-0 text-sm text-muted-foreground tabular-nums">
                    {position + 1}
                  </span>
                  <span className="min-w-0 flex-1 basis-[calc(100%-2rem)] py-1.5 text-sm [overflow-wrap:anywhere] sm:basis-auto sm:py-0">
                    {label}
                  </span>
                  <span className="ml-auto flex shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      data-action="up"
                      aria-keyshortcuts="Alt+ArrowUp"
                      disabled={position === 0}
                      className="disabled:border-transparent disabled:bg-transparent disabled:opacity-40"
                      aria-label={m.oncall_action_on({ action: "up", name: label })}
                      onClick={() => move(position, position - 1, "up")}
                    >
                      <ArrowUpIcon aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      data-action="down"
                      aria-keyshortcuts="Alt+ArrowDown"
                      disabled={position === count - 1}
                      className="disabled:border-transparent disabled:bg-transparent disabled:opacity-40"
                      aria-label={m.oncall_action_on({ action: "down", name: label })}
                      onClick={() => move(position, position + 1, "down")}
                    >
                      <ArrowDownIcon aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      data-action="remove"
                      aria-label={m.oncall_action_on({ action: "remove_member", name: label })}
                      onClick={() => remove(position)}
                    >
                      <XIcon aria-hidden />
                    </Button>
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}
        {!canAddMember(count) ? (
          <p className="text-sm text-muted-foreground">
            {text("members_max", { max: String(MAX_LAYER_MEMBERS) })}
          </p>
        ) : available.length > 0 ? (
          <>
            <label htmlFor={addId} className="sr-only">
              {m.oncall_member_add()}
            </label>
            <select
              id={addId}
              data-action="add-member"
              className={SELECT}
              value=""
              aria-invalid={errors?.members ? true : undefined}
              aria-describedby={errors?.members ? membersErrorId : undefined}
              onChange={(event) => {
                if (event.target.value)
                  onChange({ members: [...layer.members, event.target.value] });
              }}
            >
              <option value="">{m.oncall_member_add()}</option>
              {available.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name || m.oncall_unnamed()}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {errors?.members && (errors.members === "too_many" || count === 0) ? (
          <p id={membersErrorId} className="flex items-start gap-1.5 text-sm text-destructive">
            <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {errors.members === "too_many"
              ? text("members_max", { max: String(MAX_LAYER_MEMBERS) })
              : m.oncall_field_invalid({ field: "members" })}
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}

// ---- Override form ------------------------------------------------------------------------------------------------

function OverrideForm({
  schedule,
  members,
  self,
  now,
  locale,
  viewerZone,
  onCancel,
  onSubmit,
}: {
  schedule: ScheduleRow;
  members: readonly MemberRow[];
  /** A responder covers only for themselves: their id, fixed. Null: anyone. */
  self: string | null;
  now: number;
  locale: Locale;
  viewerZone: string;
  onCancel: () => void;
  onSubmit: (args: { scheduleId: string; userId: string; start: number; end: number }) => void;
}) {
  const [draft, setDraft] = useState<OverrideDraft>(() =>
    emptyOverride(self ?? "", schedule.timeZone, now),
  );
  const [errors, setErrors] = useState<{ userId?: true; start?: true; end?: true } | null>(null);
  const titleId = useId();
  const whoId = useId();
  const whoRef = useRef<HTMLSelectElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    (self ? startRef.current : whoRef.current)?.focus();
  }, [self]);
  /** The field's time on the viewer's clock, when theirs reads differently. */
  const local = (value: string) => {
    const instant = fromLocalInput(value, schedule.timeZone);
    return instant === undefined
      ? undefined
      : (viewerTime(instant, schedule.timeZone, viewerZone, locale) ?? undefined);
  };
  return (
    <form
      aria-labelledby={titleId}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const checked = checkOverride(schedule.id, schedule.timeZone, draft, Date.now());
        if (checked.ok) {
          onSubmit(checked.args);
          return;
        }
        setErrors(checked.errors);
        // To the first field to fix, in the order they are laid out.
        const { userId, start } = checked.errors;
        (userId && !self ? whoRef : start ? startRef : endRef).current?.focus();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !keepsEscape(event)) onCancel();
      }}
      className={FORM}
    >
      <div className="flex flex-col gap-0.5">
        <h4 id={titleId} className="font-medium [overflow-wrap:anywhere]">
          {m.oncall_override_title({ name: schedule.name })}
        </h4>
        <p className="text-sm text-muted-foreground">
          <ZoneLine timeZone={schedule.timeZone} now={now} />
          {self ? ` · ${m.oncall_override_self()}` : ""}
        </p>
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-3">
        {self ? null : (
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={whoId} className="text-sm font-medium">
              {m.oncall_field({ field: "who" })}
            </label>
            <select
              ref={whoRef}
              id={whoId}
              className={SELECT}
              value={draft.userId}
              aria-invalid={errors?.userId ? true : undefined}
              onChange={(event) => setDraft({ ...draft, userId: event.target.value })}
            >
              <option value="">{text("choose_person")}</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name || m.oncall_unnamed()}
                </option>
              ))}
            </select>
            {errors?.userId ? (
              <p className="flex items-start gap-1.5 text-sm text-destructive">
                <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                {m.oncall_field_invalid({ field: "user" })}
              </p>
            ) : null}
          </div>
        )}
        <Field
          ref={startRef}
          type="datetime-local"
          label={m.oncall_field({ field: "start" })}
          value={draft.start}
          hint={local(draft.start)}
          error={errors?.start ? m.oncall_field_invalid({ field: "start" }) : undefined}
          onChange={(event) => setDraft({ ...draft, start: event.target.value })}
        />
        <Field
          ref={endRef}
          type="datetime-local"
          label={m.oncall_field({ field: "end" })}
          value={draft.end}
          hint={local(draft.end)}
          error={errors?.end ? m.oncall_field_invalid({ field: "end" }) : undefined}
          onChange={(event) => setDraft({ ...draft, end: event.target.value })}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit">{m.oncall_action({ action: "add_override" })}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {m.oncall_action({ action: "cancel" })}
        </Button>
      </div>
    </form>
  );
}

/** "Times in America/Sao Paulo (UTC-03:00)", the offset kept on one line (a narrow card would break it at "-"). */
function ZoneLine({ timeZone, now }: { timeZone: string; now: number }) {
  const offset = offsetLabel(timeZone, now);
  const line = m.oncall_time_zone({ zone: zoneLabel(timeZone), offset });
  const at = line.lastIndexOf(offset);
  if (at < 0) return line;
  return (
    <>
      {line.slice(0, at)}
      <span className="whitespace-nowrap">{offset}</span>
      {line.slice(at + offset.length)}
    </>
  );
}

/** Epoch ms, refreshed every `ms`, so "now" and the next handoffs move on their own. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
