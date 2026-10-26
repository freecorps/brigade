import { m, type Locale } from "@freecorps/brigade-i18n";
import {
  can,
  MAX_SHIFT_COUNT,
  nextHandoffs,
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
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CONFIRM_DESTRUCTIVE } from "@/components/monitor-form";
import { usePreferences } from "@/components/preferences";
import { useMember } from "@/components/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Field, FormError } from "@/components/ui/field";
import { queryErrorReason } from "@/lib/incidents";
import {
  canAddLayer,
  canAddSchedule,
  checkOverride,
  checkSchedule,
  draftFromSchedule,
  emptyOverride,
  emptySchedule,
  handoffTime,
  layerRhythm,
  memberLabel,
  newLayer,
  newOverrideId,
  newScheduleId,
  ROTATION_UNITS,
  rotationChoices,
  scheduleRefusal,
  timeZones,
  UPCOMING_MS,
  UPCOMING_SHOWN,
  type CheckedSchedule,
  type LayerDraft,
  type OverrideDraft,
  type RotationUnit,
  type ScheduleDraft,
  type ScheduleErrors,
} from "@/lib/oncall";

const SELECT =
  "h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring aria-invalid:border-destructive";

/**
 * The workspace's on-call schedules, live from its shard (`schedules.all`, `overrides.all`): who is on call now and
 * the next handoffs, each in the schedule's own time zone, its layers and upcoming overrides. Owners and admins
 * create, edit and delete schedules and add anyone's override; responders add and remove their own overrides.
 * Nothing here pages anyone yet (RFC 0006 "Who is paged").
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
              {m.oncall_schedule_add()}
            </Button>
          ) : null}
        </div>
        <div className="flex h-6 items-center text-sm text-muted-foreground tabular-nums">
          {status === "ready" ? (
            <span>{m.oncall_schedules_count({ count: rows.length })}</span>
          ) : status === "error" ? null : (
            <span aria-hidden className="block h-4 w-24 rounded-sm bg-muted" />
          )}
        </div>
      </div>

      <CardContent className="flex flex-col gap-5">
        <p className="text-sm text-muted-foreground">{m.oncall_not_paging()}</p>
        {adding ? (
          <ScheduleForm
            initial={emptySchedule(now)}
            members={members.rows}
            choices={choices}
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
                    editing={row}
                    members={members.rows}
                    choices={choices}
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
  userId: string;
  manage: boolean;
  canOverride: boolean;
  onEdit: () => void;
  onOverride: () => void;
  onRemoveOverride: (row: OverrideRow) => void;
  overrideForm: ReactNode;
}) {
  const nameId = useId();
  const segments = nextHandoffs(row, overrides, now, now + UPCOMING_MS, UPCOMING_SHOWN + 1);
  const [current, ...upcoming] = segments;
  const own = overrides
    .filter((item) => item.scheduleId === row.id && item.end > now)
    .sort((a, b) => a.start - b.start);
  const name = (id: string | null) => (id === null ? m.oncall_nobody() : memberLabel(members, id));
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
          <h3 id={nameId} className="font-medium [overflow-wrap:anywhere]">
            {row.name}
          </h3>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {m.oncall_time_zone({ zone: row.timeZone })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canOverride && !overrideForm ? (
            <Button
              variant="outline"
              data-action="override"
              aria-label={m.oncall_override_add_label({ name: row.name })}
              onClick={onOverride}
            >
              <CalendarClockIcon aria-hidden />
              {m.oncall_override_add()}
            </Button>
          ) : null}
          {manage ? (
            <Button
              variant="outline"
              data-action="edit"
              aria-label={m.oncall_edit_label({ name: row.name })}
              onClick={onEdit}
            >
              <PencilIcon aria-hidden />
              {m.oncall_edit()}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section
          aria-label={m.oncall_now()}
          className="flex min-w-0 flex-col gap-1.5 rounded-md bg-muted/50 p-3"
        >
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {m.oncall_now()}
          </p>
          {current && current.userId !== null ? (
            <>
              <p className="flex min-w-0 items-center gap-2 text-lg font-semibold">
                <UserRoundIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{name(current.userId)}</span>
                {current.source?.kind === "override" ? (
                  <Badge variant="outline">{m.oncall_override_badge()}</Badge>
                ) : null}
              </p>
              {current.end < now + UPCOMING_MS ? (
                <p className="text-sm text-muted-foreground tabular-nums">
                  {m.oncall_until({ time: handoffTime(current.end, row.timeZone, locale) })}
                </p>
              ) : null}
            </>
          ) : (
            <p className="flex items-center gap-2">
              <Badge variant="sev3">
                <TriangleAlertIcon aria-hidden />
                {m.oncall_nobody()}
              </Badge>
              {current && current.end < now + UPCOMING_MS ? (
                <span className="text-sm text-muted-foreground tabular-nums">
                  {m.oncall_until({ time: handoffTime(current.end, row.timeZone, locale) })}
                </span>
              ) : null}
            </p>
          )}
        </section>
        <section
          aria-label={m.oncall_upcoming()}
          className="flex min-w-0 flex-col gap-1.5 p-1 md:p-3"
        >
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {m.oncall_upcoming()}
          </p>
          {upcoming.length > 0 ? (
            <ol className="flex flex-col gap-1 text-sm">
              {upcoming.slice(0, UPCOMING_SHOWN).map((segment) => (
                <Handoff
                  key={segment.start}
                  segment={segment}
                  label={name(segment.userId)}
                  timeZone={row.timeZone}
                  locale={locale}
                />
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">{m.oncall_upcoming_none()}</p>
          )}
        </section>
      </div>

      <section aria-label={m.oncall_layers()} className="flex flex-col gap-2">
        <ol className="flex flex-col gap-2 text-sm">
          {row.layers.map((layer) => (
            <li key={layer.id} className="flex min-w-0 flex-col gap-0.5">
              <p className="min-w-0 [overflow-wrap:anywhere]">
                <span className="font-medium">{layer.name}</span>
                <span className="text-muted-foreground"> · {layerRhythm(layer, locale)}</span>
              </p>
              {layer.members.length > 0 ? (
                <p className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
                  {layer.members.map((id) => memberLabel(members, id)).join(" → ")}
                </p>
              ) : (
                <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
                  <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {m.oncall_layer_empty()}
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>

      {own.length > 0 ? (
        <section aria-label={m.oncall_overrides()} className="flex flex-col gap-1.5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {m.oncall_overrides()}
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {own.map((item) => {
              const who = memberLabel(members, item.userId);
              const removable = manage || (canOverride && item.userId === userId);
              return (
                <li key={item.id} className="flex min-h-11 items-center gap-2">
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    <span className="font-medium">{who}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {" "}
                      · {handoffTime(item.start, row.timeZone, locale)} –{" "}
                      {handoffTime(item.end, row.timeZone, locale)}
                    </span>
                  </span>
                  {removable ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={m.oncall_override_remove({ name: who })}
                      onClick={() => onRemoveOverride(item)}
                    >
                      <Trash2Icon aria-hidden />
                    </Button>
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

function Handoff({
  segment,
  label,
  timeZone,
  locale,
}: {
  segment: OnCallSegment;
  label: string;
  timeZone: string;
  locale: Locale;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-baseline gap-x-3">
      <span className="text-muted-foreground tabular-nums">
        {handoffTime(segment.start, timeZone, locale)}
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
  members,
  choices,
  onCancel,
  onSubmit,
  onDelete,
}: {
  initial: ScheduleDraft;
  editing?: ScheduleRow;
  members: readonly MemberRow[];
  choices: readonly MemberRow[];
  onCancel: () => void;
  onSubmit: (draft: ScheduleDraft) => CheckedSchedule;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<ScheduleErrors | null>(null);
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const zones = timeZones(draft.timeZone);
  const zoneId = useId();
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
        if (event.key === "Escape" && !(event.target instanceof HTMLSelectElement)) onCancel();
      }}
      className="flex min-w-0 flex-col gap-4 rounded-md border bg-muted/40 p-4"
    >
      <h3 id={titleId} className="font-medium [overflow-wrap:anywhere]">
        {editing ? m.oncall_form_edit() : m.oncall_form_new()}
      </h3>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field
          ref={nameRef}
          label={m.oncall_field_name()}
          value={draft.name}
          maxLength={160}
          autoComplete="off"
          error={errors?.name ? m.oncall_field_invalid({ field: "name" }) : undefined}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={zoneId} className="text-sm font-medium">
            {m.oncall_field_time_zone()}
          </label>
          <select
            id={zoneId}
            className={SELECT}
            value={draft.timeZone}
            aria-invalid={errors?.timeZone ? true : undefined}
            onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{m.oncall_layers_hint()}</p>
      {draft.layers.map((layer, index) => (
        <LayerFields
          key={layer.id}
          layer={layer}
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
              layers: [
                ...current.layers,
                newLayer(current.layers.length, current.timeZone, Date.now()),
              ],
            }))
          }
        >
          <PlusIcon aria-hidden />
          {m.oncall_layer_add()}
        </Button>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit">{editing ? m.oncall_save() : m.oncall_create()}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {m.oncall_cancel()}
        </Button>
        {editing && onDelete && !confirming ? (
          <Button
            type="button"
            variant="ghost"
            className="ml-auto text-destructive"
            onClick={() => setConfirming(true)}
          >
            <Trash2Icon aria-hidden />
            {m.oncall_delete()}
          </Button>
        ) : null}
      </div>
      {editing && onDelete && confirming ? (
        <div
          role="alertdialog"
          aria-label={m.oncall_delete()}
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
              {m.oncall_delete_yes()}
            </Button>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
              {m.oncall_cancel()}
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

function LayerFields({
  layer,
  errors,
  members,
  choices,
  removable,
  onChange,
  onRemove,
}: {
  layer: LayerDraft;
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
  const available = choices.filter((member) => !layer.members.includes(member.id));
  const move = (from: number, to: number) => {
    const next = [...layer.members];
    const [item] = next.splice(from, 1);
    if (item !== undefined) next.splice(to, 0, item);
    onChange({ members: next });
  };
  return (
    <fieldset className="flex min-w-0 flex-col gap-4 rounded-md border bg-card p-3 sm:p-4">
      <legend className="sr-only">{layer.name}</legend>
      <div className="flex items-end gap-2">
        <Field
          className="flex-1"
          label={m.oncall_field_layer_name()}
          value={layer.name}
          maxLength={120}
          autoComplete="off"
          error={errors?.name ? m.oncall_field_invalid({ field: "layer_name" }) : undefined}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        {removable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={m.oncall_layer_remove({ name: layer.name })}
            onClick={onRemove}
          >
            <Trash2Icon aria-hidden />
          </Button>
        ) : null}
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          type="date"
          label={m.oncall_field_start_date()}
          value={layer.startDate}
          min="2000-01-01"
          max="2099-12-31"
          error={errors?.startDate ? m.oncall_field_invalid({ field: "start_date" }) : undefined}
          onChange={(event) => onChange({ startDate: event.target.value })}
        />
        <Field
          type="time"
          label={m.oncall_field_handoff_time()}
          value={layer.handoffTime}
          error={
            errors?.handoffTime ? m.oncall_field_invalid({ field: "handoff_time" }) : undefined
          }
          onChange={(event) => onChange({ handoffTime: event.target.value })}
        />
        <Field
          inputMode="numeric"
          label={m.oncall_field_count()}
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
            {m.oncall_field_unit()}
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
      <div className="flex min-w-0 flex-col gap-1.5">
        <p id={membersId} className="text-sm font-medium">
          {m.oncall_field_members()}
        </p>
        {layer.members.length > 0 ? (
          <ol aria-labelledby={membersId} className="flex flex-col divide-y rounded-md border">
            {layer.members.map((id, index) => {
              const label = memberLabel(members, id);
              return (
                <li key={id} className="flex min-h-11 items-center gap-1 pl-3">
                  <span className="w-6 shrink-0 text-sm text-muted-foreground tabular-nums">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{label}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={index === 0}
                    aria-label={m.oncall_member_up({ name: label })}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowUpIcon aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={index === layer.members.length - 1}
                    aria-label={m.oncall_member_down({ name: label })}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDownIcon aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={m.oncall_member_remove({ name: label })}
                    onClick={() =>
                      onChange({ members: layer.members.filter((member) => member !== id) })
                    }
                  >
                    <XIcon aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ol>
        ) : null}
        {available.length > 0 ? (
          <>
            <label htmlFor={addId} className="sr-only">
              {m.oncall_member_add()}
            </label>
            <select
              id={addId}
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
        {errors?.members ? (
          <p id={membersErrorId} className="text-sm text-destructive">
            {m.oncall_field_invalid({ field: "members" })}
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
  onCancel,
  onSubmit,
}: {
  schedule: ScheduleRow;
  members: readonly MemberRow[];
  /** A responder covers only for themselves: their id, fixed. Null: anyone. */
  self: string | null;
  now: number;
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
  useEffect(() => {
    (self ? startRef.current : whoRef.current)?.focus();
  }, [self]);
  return (
    <form
      aria-labelledby={titleId}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const checked = checkOverride(schedule.id, schedule.timeZone, draft, Date.now());
        if (checked.ok) onSubmit(checked.args);
        else setErrors(checked.errors);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !(event.target instanceof HTMLSelectElement)) onCancel();
      }}
      className="flex min-w-0 flex-col gap-4 rounded-md border bg-muted/40 p-4"
    >
      <div className="flex flex-col gap-0.5">
        <h4 id={titleId} className="font-medium [overflow-wrap:anywhere]">
          {m.oncall_override_title({ name: schedule.name })}
        </h4>
        <p className="text-sm text-muted-foreground">
          {m.oncall_time_zone({ zone: schedule.timeZone })}
          {self ? ` · ${m.oncall_override_self()}` : ""}
        </p>
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-3">
        {self ? null : (
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={whoId} className="text-sm font-medium">
              {m.oncall_override_who()}
            </label>
            <select
              ref={whoRef}
              id={whoId}
              className={SELECT}
              value={draft.userId}
              aria-invalid={errors?.userId ? true : undefined}
              onChange={(event) => setDraft({ ...draft, userId: event.target.value })}
            >
              <option value="">{m.oncall_override_who()}</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name || m.oncall_unnamed()}
                </option>
              ))}
            </select>
            {errors?.userId ? (
              <p className="text-sm text-destructive">
                {m.oncall_field_invalid({ field: "user" })}
              </p>
            ) : null}
          </div>
        )}
        <Field
          ref={startRef}
          type="datetime-local"
          label={m.oncall_override_start()}
          value={draft.start}
          error={errors?.start ? m.oncall_field_invalid({ field: "start" }) : undefined}
          onChange={(event) => setDraft({ ...draft, start: event.target.value })}
        />
        <Field
          type="datetime-local"
          label={m.oncall_override_end()}
          value={draft.end}
          error={errors?.end ? m.oncall_field_invalid({ field: "end" }) : undefined}
          onChange={(event) => setDraft({ ...draft, end: event.target.value })}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit">{m.oncall_override_add()}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {m.oncall_cancel()}
        </Button>
      </div>
    </form>
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
