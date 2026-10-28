import { m } from "@freecorps/brigade-i18n";
import {
  can,
  type EscalationPolicyRow,
  type EscalationTarget,
  type MemberRow,
  type OverrideRow,
  type ScheduleRow,
} from "@freecorps/brigade-schema";
import type { MutationOutcome } from "@freecorps/brigade-sync";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { cn } from "cn";
import {
  CalendarClockIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CONFIRM_DESTRUCTIVE } from "@/components/monitor-form";
import { useMember } from "@/components/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Field, FormError } from "@/components/ui/field";
import {
  canAddLevel,
  canAddPolicy,
  checkPolicy,
  draftFromPolicy,
  draftTargets,
  emptyPolicy,
  escalationText,
  MAX_LEVEL_TARGETS,
  MAX_POLICY_REPEAT,
  newLevel,
  newPolicyId,
  onCallNow,
  policyRefusal,
  POLICY_NAME_MAX,
  targetLabel,
  timeoutKind,
  type CheckedPolicy,
  type LevelDraft,
  type PolicyDraft,
  type PolicyErrors,
  MIN_SEVERITY_CHOICES,
  minSeverityChoice,
  minSeverityOf,
  type MinSeverityChoice,
} from "@/lib/escalation";
import { queryErrorReason } from "@/lib/incidents";
import { memberLabel, rotationChoices } from "@/lib/oncall";

const SELECT =
  "field w-full min-w-0 px-3 focus-visible:ring-3 focus-visible:ring-ring aria-invalid:border-destructive";
const LABEL = "text-xs font-medium text-muted-foreground";
/** Levels a policy shows before "Show all N levels". */
const LEVELS_SHOWN = 3;
/** Forms run edge to edge on phones (the card's padding is room enough) and as a box from `sm` up. */
const FORM =
  "-mx-4 flex min-w-0 flex-col gap-4 border-y bg-muted/40 px-4 py-4 sm:mx-0 sm:rounded-md sm:border";

/**
 * The workspace's escalation policies, live from its shard (`escalationPolicies.all`): each level's schedules (with
 * who is on call now) and people, its timeout, the repeats, and which policy is the default every page uses
 * (RFC 0006 "Who is paged"). Owners and admins create, edit, delete and pick the default; everyone else reads.
 */
export function EscalationCard() {
  const { role } = useMember();
  const manage = can(role, "escalation:manage");
  const policies = useQuery("escalationPolicies.all", {});
  const schedules = useQuery("schedules.all", {});
  const overrides = useQuery("overrides.all", {});
  const members = useQuery("members.all", {});
  const create = useMutation("escalation.createPolicy");
  const update = useMutation("escalation.updatePolicy");
  const remove = useMutation("escalation.deletePolicy");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const now = useNow(30_000);

  const report = (name: string) => (outcome: MutationOutcome) => {
    if (!outcome.ok) {
      setRefused(
        escalationText("change_failed", { name, reason: policyRefusal(outcome.error.code) }),
      );
    }
  };
  const focusRow = (id: string) =>
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-policy="${id}"] [data-action="edit"]`)?.focus(),
    );

  const rows = policies.rows;
  const status = policies.status;
  const loading = status !== "ready" && status !== "error";
  const hasDefault = rows.some((row) => row.isDefault);
  const loaded = schedules.status === "ready" && members.status === "ready";
  const formProps = {
    schedules: schedules.rows,
    members: members.rows,
    loaded,
    currentDefault: rows.find((row) => row.isDefault) ?? null,
  };
  return (
    <Card
      aria-labelledby="escalation-title"
      className={cn(rows.length > 0 && "overflow-hidden pb-0 sm:pb-0")}
    >
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <CardTitle id="escalation-title" className="truncate">
            {escalationText("title")}
          </CardTitle>
          {manage && !adding ? (
            <Button
              ref={addRef}
              variant="outline"
              disabled={!canAddPolicy(rows.length)}
              onClick={() => {
                setRefused(null);
                setEditing(null);
                setAdding(true);
              }}
            >
              <PlusIcon aria-hidden />
              {m.escalation_action({ action: "add_policy" })}
            </Button>
          ) : null}
        </div>
        {loading || rows.length > 0 ? (
          <div className="flex h-6 items-center text-sm text-muted-foreground tabular-nums">
            {loading ? (
              <span aria-hidden className="block h-4 w-24 rounded-sm bg-muted" />
            ) : (
              <span>{m.escalation_count({ kind: "policies", count: rows.length })}</span>
            )}
          </div>
        ) : null}
      </div>

      <CardContent className="flex flex-col gap-5">
        {status === "ready" && rows.length > 0 ? (
          hasDefault ? (
            <p className="text-sm text-muted-foreground">{escalationText("default_note")}</p>
          ) : (
            <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
              <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0">{escalationText("no_default")}</span>
            </p>
          )
        ) : null}
        {adding ? (
          <PolicyForm
            initial={emptyPolicy(now, hasDefault)}
            {...formProps}
            onCancel={() => {
              setAdding(false);
              requestAnimationFrame(() => addRef.current?.focus());
            }}
            onSubmit={(draft) => {
              const checked = checkPolicy(newPolicyId(Date.now()), draft);
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
          <FormError>{queryErrorReason(policies.error?.code)}</FormError>
        ) : null}

        {rows.length > 0 ? (
          <ul aria-labelledby="escalation-title" className="-mx-4 divide-y border-t sm:-mx-6">
            {rows.map((row) => (
              <li
                key={row.id}
                data-policy={row.id}
                className="flex flex-col gap-4 px-4 py-4 sm:px-6"
              >
                {editing === row.id ? (
                  <PolicyForm
                    initial={draftFromPolicy(row)}
                    editing={row}
                    {...formProps}
                    onCancel={() => {
                      setEditing(null);
                      focusRow(row.id);
                    }}
                    onDelete={() => {
                      setRefused(null);
                      void remove({ id: row.id }).then(report(row.name));
                      setEditing(null);
                      requestAnimationFrame(() => addRef.current?.focus());
                    }}
                    onSubmit={(draft) => {
                      const checked = checkPolicy(row.id, draft);
                      if (!checked.ok) return checked;
                      setRefused(null);
                      void update(checked.args).then(report(checked.args.name));
                      setEditing(null);
                      focusRow(row.id);
                      return checked;
                    }}
                  />
                ) : (
                  <PolicyItem
                    row={row}
                    schedules={schedules.rows}
                    overrides={overrides.rows}
                    members={members.rows}
                    now={now}
                    manage={manage}
                    onEdit={() => {
                      setRefused(null);
                      setAdding(false);
                      setEditing(row.id);
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        ) : loading ? (
          <div aria-hidden className="-mx-4 divide-y border-t sm:-mx-6">
            <div className="flex flex-col gap-3 px-4 py-4 sm:px-6">
              <span className="block h-5 w-40 rounded-sm bg-muted" />
              <span className="block h-12 w-full max-w-md rounded-sm bg-muted" />
            </div>
          </div>
        ) : status === "ready" && !adding ? (
          <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
            {escalationText("empty")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PolicyItem({
  row,
  schedules,
  overrides,
  members,
  now,
  manage,
  onEdit,
}: {
  row: EscalationPolicyRow;
  schedules: readonly ScheduleRow[];
  overrides: readonly OverrideRow[];
  members: readonly MemberRow[];
  now: number;
  manage: boolean;
  onEdit: () => void;
}) {
  const nameId = useId();
  const listId = useId();
  const [all, setAll] = useState(false);
  const shown = all ? row.levels : row.levels.slice(0, LEVELS_SHOWN);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-56 flex-wrap items-center gap-2">
          <h3 id={nameId} className="min-w-0 font-medium [overflow-wrap:anywhere]">
            {row.name}
          </h3>
          {row.isDefault ? (
            <Badge variant="secondary" className="shrink-0">
              {escalationText("default_badge")}
            </Badge>
          ) : null}
        </div>
        {manage ? (
          <Button
            variant="outline"
            data-action="edit"
            aria-label={m.escalation_action_on({ action: "edit", name: row.name })}
            onClick={onEdit}
          >
            <PencilIcon aria-hidden />
            {m.escalation_action({ action: "edit" })}
          </Button>
        ) : null}
      </div>
      <ol id={listId} aria-labelledby={nameId} className="flex flex-col gap-3 text-sm">
        {shown.map((level, index) => (
          <li key={level.id} className="flex gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums"
            >
              {index + 1}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <p className="sr-only">{escalationText("level", { level: String(index + 1) })}</p>
              {level.targets.length === 0 ? (
                <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
                  <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0">{escalationText("level_empty")}</span>
                </p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {level.targets.map((target) => (
                    <li key={`${target.kind}:${target.id}`} className="min-w-0">
                      <TargetChip
                        target={target}
                        schedules={schedules}
                        overrides={overrides}
                        members={members}
                        now={now}
                      />
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground tabular-nums">
                {m.escalation_count({
                  kind: timeoutKind(index, row.levels.length, row.repeat),
                  count: level.timeoutMinutes,
                })}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {row.levels.length > LEVELS_SHOWN ? (
        <Button
          variant="ghost"
          className="-ml-2 self-start px-2 text-muted-foreground"
          aria-expanded={all}
          aria-controls={listId}
          onClick={() => setAll((current) => !current)}
        >
          {all
            ? m.escalation_action({ action: "show_fewer" })
            : m.escalation_count({ kind: "show_levels", count: row.levels.length })}
        </Button>
      ) : null}
      <p className="text-sm text-muted-foreground tabular-nums">
        {m.escalation_count({ kind: "repeat", count: row.repeat })}
      </p>
      {minSeverityChoice(row.minSeverity ?? null) !== "every" ? (
        <p className="text-sm text-muted-foreground">
          {m.escalation_min_severity({
            choice: `summary_${minSeverityChoice(row.minSeverity ?? null)}`,
          })}
        </p>
      ) : null}
    </>
  );
}

function TargetChip({
  target,
  schedules,
  overrides,
  members,
  now,
}: {
  target: EscalationTarget;
  schedules: readonly ScheduleRow[];
  overrides: readonly OverrideRow[];
  members: readonly MemberRow[];
  now: number;
}) {
  const label = targetLabel(target, schedules, members);
  const Icon = target.kind === "schedule" ? CalendarClockIcon : UserRoundIcon;
  const onCall = target.kind === "schedule" ? onCallNow(target, schedules, overrides, now) : null;
  const gap =
    target.kind === "schedule" && onCall === null && schedules.some((row) => row.id === target.id);
  return (
    <span className="inline-flex max-w-full items-start gap-1.5 rounded-md border px-2 py-1">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-col">
        <span className="font-medium [overflow-wrap:anywhere]">
          <span className="sr-only">{escalationText(`target_${target.kind}`)}: </span>
          {label}
        </span>
        {onCall !== null ? (
          <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {escalationText("on_call", { name: memberLabel(members, onCall) })}
          </span>
        ) : gap ? (
          <span className="text-xs text-amber-700 dark:text-amber-400">{m.oncall_nobody()}</span>
        ) : null}
      </span>
    </span>
  );
}

function PolicyForm({
  initial,
  editing,
  loaded,
  schedules,
  members,
  currentDefault,
  onCancel,
  onSubmit,
  onDelete,
}: {
  initial: PolicyDraft;
  editing?: EscalationPolicyRow;
  /** The workspace's default policy as saved, if any: the form says when this one would replace it or drop it. */
  currentDefault: EscalationPolicyRow | null;
  /** Whether the schedules and members are the shard's whole lists yet (so what is gone can be dropped). */
  loaded: boolean;
  schedules: readonly ScheduleRow[];
  members: readonly MemberRow[];
  onCancel: () => void;
  onSubmit: (draft: PolicyDraft) => CheckedPolicy;
  onDelete?: () => void;
}) {
  // A deleted schedule or a member who left, still in a level, would make every save fail: dropped once, at open.
  const [opened, setOpened] = useState(() =>
    loaded && editing
      ? draftTargets(initial, schedules, members)
      : { draft: initial, dropped: false },
  );
  const [draft, setDraft] = useState(opened.draft);
  // Opened before schedules and members had loaded: drop stale targets once they have, so saving doesn't fail.
  const checked = useRef(loaded);
  useEffect(() => {
    if (checked.current || !loaded || !editing) return;
    checked.current = true;
    const next = draftTargets(draft, schedules, members);
    if (!next.dropped) return;
    setOpened(next);
    setDraft(next.draft);
  }, [loaded, editing, draft, schedules, members]);
  const [errors, setErrors] = useState<PolicyErrors | null>(null);
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();
  const repeatId = useId();
  const defaultId = useId();
  const minSeverityId = useId();
  const minSeverityHintId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const addLevelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  /** Focus after a change that removes the focused control: once React has drawn the change. */
  const focusLater = (find: () => HTMLElement | null | undefined) =>
    requestAnimationFrame(() => find()?.focus());
  const levelControl = (id: string, control: "add" | "remove") =>
    formRef.current?.querySelector<HTMLElement>(`[data-level="${id}"] [data-control="${control}"]`);
  const closeConfirm = () => {
    setConfirming(false);
    focusLater(() => deleteRef.current);
  };
  const replaces =
    draft.isDefault && currentDefault !== null && currentDefault.id !== editing?.id
      ? currentDefault
      : null;
  const dropsDefault = editing?.isDefault === true && !draft.isDefault;
  const people = rotationChoices(members);
  const setLevel = (index: number, patch: Partial<LevelDraft>) =>
    setDraft((current) => ({
      ...current,
      levels: current.levels.map((level, i) => (i === index ? { ...level, ...patch } : level)),
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
      ref={formRef}
      aria-labelledby={titleId}
      noValidate
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !(event.target instanceof HTMLSelectElement)) onCancel();
      }}
      className={FORM}
    >
      <h3 id={titleId} className="font-medium [overflow-wrap:anywhere]">
        {editing
          ? m.escalation_action_on({ action: "edit", name: editing.name })
          : m.escalation_action({ action: "add_policy" })}
      </h3>
      <Field
        ref={nameRef}
        label={m.escalation_field({ field: "name", form: "label" })}
        value={draft.name}
        maxLength={POLICY_NAME_MAX}
        autoComplete="off"
        error={errors?.name ? m.escalation_field({ field: "name", form: "invalid" }) : undefined}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
      />
      <p className="text-sm text-muted-foreground">{escalationText("hint")}</p>
      {opened.dropped ? (
        <p
          role="status"
          className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400"
        >
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{escalationText("dropped")}</span>
        </p>
      ) : null}
      <ol className="flex flex-col gap-3">
        {draft.levels.map((level, index) => (
          <LevelFields
            key={level.id}
            level={level}
            index={index}
            errors={errors?.levels[index]}
            last={index === draft.levels.length - 1 && draft.repeat === 0}
            schedules={schedules}
            people={people}
            members={members}
            removable={draft.levels.length > 1}
            onChange={(patch) => setLevel(index, patch)}
            onRemoved={(next) => focusLater(() => next ?? levelControl(level.id, "add"))}
            onRemove={() => {
              const neighbour = draft.levels[index + 1] ?? draft.levels[index - 1];
              setDraft((current) => ({
                ...current,
                levels: current.levels.filter((_, i) => i !== index),
              }));
              // Its own controls go with it: the neighbour's remove button (gone when one level is left), else
              // "Add a level".
              focusLater(
                () =>
                  (neighbour && levelControl(neighbour.id, "remove")) ??
                  addLevelRef.current ??
                  nameRef.current,
              );
            }}
          />
        ))}
      </ol>
      {canAddLevel(draft.levels.length) ? (
        <Button
          ref={addLevelRef}
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => {
            const added = newLevel(Date.now());
            setDraft((current) => ({ ...current, levels: [...current.levels, added] }));
            focusLater(() => levelControl(added.id, "add"));
          }}
        >
          <PlusIcon aria-hidden />
          {m.escalation_action({ action: "add_level" })}
        </Button>
      ) : null}
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={repeatId} className="text-sm font-medium">
            {m.escalation_field({ field: "repeat", form: "label" })}
          </label>
          <select
            id={repeatId}
            className={SELECT}
            value={draft.repeat}
            onChange={(event) => setDraft({ ...draft, repeat: Number(event.target.value) })}
          >
            {Array.from({ length: MAX_POLICY_REPEAT + 1 }, (_, count) => (
              <option key={count} value={count}>
                {m.escalation_count({ kind: "repeat_choice", count })}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={minSeverityId} className="text-sm font-medium">
            {m.escalation_field({ field: "min_severity", form: "label" })}
          </label>
          <select
            id={minSeverityId}
            className={SELECT}
            aria-describedby={minSeverityHintId}
            value={minSeverityChoice(draft.minSeverity)}
            onChange={(event) =>
              setDraft({
                ...draft,
                minSeverity: minSeverityOf(event.target.value as MinSeverityChoice),
              })
            }
          >
            {MIN_SEVERITY_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {m.escalation_min_severity({ choice })}
              </option>
            ))}
          </select>
          <p id={minSeverityHintId} className="text-sm text-muted-foreground">
            {m.escalation_field({ field: "min_severity", form: "hint" })}
          </p>
        </div>
        <label
          htmlFor={defaultId}
          className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium"
        >
          <input
            id={defaultId}
            type="checkbox"
            className="size-5 shrink-0 accent-primary"
            checked={draft.isDefault}
            onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })}
          />
          <span className="min-w-0">{m.escalation_field({ field: "default", form: "label" })}</span>
        </label>
      </div>
      {replaces ? (
        <p role="status" className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {escalationText("replaces_default", { name: replaces.name })}
        </p>
      ) : dropsDefault ? (
        <p
          role="status"
          className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400"
        >
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{escalationText("no_default")}</span>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit">
          {m.escalation_action({ action: editing ? "save" : "create" })}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {m.escalation_action({ action: "cancel" })}
        </Button>
        {editing && onDelete ? (
          <Button
            ref={deleteRef}
            type="button"
            variant="ghost"
            className="ml-auto text-destructive"
            hidden={confirming}
            onClick={() => setConfirming(true)}
          >
            <Trash2Icon aria-hidden />
            {m.escalation_action({ action: "delete_policy" })}
          </Button>
        ) : null}
      </div>
      {editing && onDelete && confirming ? (
        <div
          role="alertdialog"
          aria-label={m.escalation_action({ action: "delete_policy" })}
          className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            // Only the confirmation closes: the form's own Escape (close the editor) must not see it.
            event.stopPropagation();
            event.preventDefault();
            closeConfirm();
          }}
        >
          <p className="font-medium [overflow-wrap:anywhere]">
            {escalationText("delete_confirm", { name: editing.name })}
          </p>
          {editing.isDefault ? <p>{escalationText("delete_default")}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              className={CONFIRM_DESTRUCTIVE}
              autoFocus
              onClick={onDelete}
            >
              {m.escalation_action({ action: "delete" })}
            </Button>
            <Button type="button" variant="outline" onClick={closeConfirm}>
              {m.escalation_action({ action: "cancel" })}
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

function LevelFields({
  level,
  index,
  last,
  errors,
  schedules,
  people,
  members,
  removable,
  onChange,
  onRemove,
  onRemoved,
}: {
  level: LevelDraft;
  index: number;
  /** The last level, with no repeat: its timeout is how long before everyone who can respond is paged. */
  last: boolean;
  errors?: { timeout: boolean; targets: boolean };
  schedules: readonly ScheduleRow[];
  people: readonly MemberRow[];
  members: readonly MemberRow[];
  removable: boolean;
  onChange: (patch: Partial<LevelDraft>) => void;
  onRemove: () => void;
  /** A target chip went: focus moves to `next` (the neighbouring chip's remove button), else the level's picker. */
  onRemoved: (next: HTMLElement | null) => void;
}) {
  const headingId = useId();
  const addId = useId();
  const errorId = useId();
  const levelName = escalationText("level", { level: String(index + 1) });
  const has = (kind: string, id: string) =>
    level.targets.some((target) => target.kind === kind && target.id === id);
  const full = level.targets.length >= MAX_LEVEL_TARGETS;
  return (
    <li
      data-level={level.id}
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-3 rounded-md border bg-card p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 id={headingId} className="text-sm font-semibold">
          {levelName}
        </h4>
        {removable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-control="remove"
            aria-label={m.escalation_action_on({ action: "remove_level", name: levelName })}
            onClick={onRemove}
          >
            <Trash2Icon aria-hidden />
          </Button>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className={LABEL}>{m.escalation_field({ field: "targets", form: "label" })}</p>
        {level.targets.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {level.targets.map((target, targetIndex) => {
              const label = targetLabel(target, schedules, members);
              const Icon = target.kind === "schedule" ? CalendarClockIcon : UserRoundIcon;
              return (
                <li
                  key={`${target.kind}:${target.id}`}
                  className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-2 text-sm"
                >
                  <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    // Above the next chip, so its focus ring is not drawn under it.
                    className="relative shrink-0 focus-visible:z-10"
                    data-target-index={targetIndex}
                    aria-label={m.escalation_action_on({ action: "remove_target", name: label })}
                    onClick={(event) => {
                      const list = event.currentTarget.closest("ul");
                      onChange({
                        targets: level.targets.filter(
                          (one) => !(one.kind === target.kind && one.id === target.id),
                        ),
                      });
                      // The chip that takes this one's place, or the one before it when it was the last.
                      onRemoved(
                        list?.querySelector<HTMLElement>(
                          `[data-target-index="${targetIndex < level.targets.length - 1 ? targetIndex + 1 : targetIndex - 1}"]`,
                        ) ?? null,
                      );
                    }}
                  >
                    <XIcon aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <label htmlFor={addId} className="sr-only">
          {m.escalation_field({ field: "add_target", form: "label" })}
        </label>
        <select
          id={addId}
          data-control="add"
          className={SELECT}
          value=""
          disabled={full}
          aria-invalid={errors?.targets ? true : undefined}
          aria-describedby={errors?.targets ? errorId : undefined}
          onChange={(event) => {
            const [kind, id] = event.target.value.split("|") as [EscalationTarget["kind"], string];
            if (id) onChange({ targets: [...level.targets, { kind, id }] });
          }}
        >
          <option value="">{m.escalation_field({ field: "add_target", form: "label" })}</option>
          {schedules.length > 0 ? (
            <optgroup label={escalationText("group_schedules")}>
              {schedules
                .filter((row) => !has("schedule", row.id))
                .map((row) => (
                  <option key={row.id} value={`schedule|${row.id}`}>
                    {row.name}
                  </option>
                ))}
            </optgroup>
          ) : null}
          <optgroup label={escalationText("group_people")}>
            {people
              .filter((row) => !has("member", row.id))
              .map((row) => (
                <option key={row.id} value={`member|${row.id}`}>
                  {row.name ?? m.oncall_unnamed()}
                </option>
              ))}
          </optgroup>
        </select>
        {errors?.targets ? (
          <p id={errorId} className="text-sm text-destructive">
            {m.escalation_field({ field: "targets", form: "invalid" })}
          </p>
        ) : level.targets.length === 0 ? (
          <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0">{escalationText("level_empty_draft")}</span>
          </p>
        ) : null}
      </div>
      <Field
        className="sm:max-w-64"
        label={m.escalation_field({ field: last ? "timeout_last" : "timeout", form: "label" })}
        inputMode="numeric"
        value={level.timeout}
        error={
          errors?.timeout ? m.escalation_field({ field: "timeout", form: "invalid" }) : undefined
        }
        onChange={(event) => onChange({ timeout: event.target.value })}
      />
    </li>
  );
}

function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
