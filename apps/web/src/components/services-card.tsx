import { m } from "@freecorps/brigade-i18n";
import {
  can,
  CATALOG_DESCRIPTION_MAX,
  MAX_SERVICE_OWNERS,
  SERVICE_TIERS,
  type EscalationPolicyRow,
  type EscalationTarget,
  type IncidentRow,
  type MemberRow,
  type ScheduleRow,
  type ServiceRow,
  type ServiceTier,
} from "@freecorps/brigade-schema";
import type { MutationOutcome } from "@freecorps/brigade-sync";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  CalendarClockIcon,
  ChevronRightIcon,
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
  canAddService,
  catalogRefusal,
  catalogText,
  checkService,
  emptyService,
  liveOwners,
  newServiceId,
  ownerLabel,
  SERVICE_NAME_MAX,
  type CheckedService,
  type ServiceDraft,
} from "@/lib/catalog";
import { queryErrorReason } from "@/lib/incidents";
import { rotationChoices } from "@/lib/oncall";

export const SELECT =
  "h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring aria-invalid:border-destructive";
export const TEXTAREA =
  "min-h-20 w-full min-w-0 resize-y rounded-md border border-input bg-card px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring aria-invalid:border-destructive";
export const LABEL = "text-xs font-medium tracking-wide text-muted-foreground uppercase";
/** Forms run edge to edge on phones (the card's padding is room enough) and as a box from `sm` up. */
export const FORM =
  "-mx-4 flex min-w-0 flex-col gap-4 border-y bg-muted/40 px-4 py-4 sm:mx-0 sm:rounded-md sm:border";

/** The tiers' badge tones: tier 1 is the loud one, like SEV1. */
const TIER_VARIANTS = {
  tier1: "destructive",
  tier2: "secondary",
  tier3: "outline",
} as const satisfies Record<ServiceTier, "destructive" | "secondary" | "outline">;

export function TierBadge({ tier }: { tier: ServiceTier }) {
  return <Badge variant={TIER_VARIANTS[tier]}>{m.catalog_tier({ tier })}</Badge>;
}

/** Active incidents that name `serviceId`. */
export const naming = (incidents: readonly IncidentRow[], serviceId: string) =>
  incidents.filter((row) => row.serviceIds?.includes(serviceId));

/**
 * The workspace's services, live from its shard (`services.all`), most critical first: each one's tier, owners and
 * how many active incidents name it, linking to its page. Owners and admins add them here; editing is on the page.
 */
export function ServicesCard() {
  const { role } = useMember();
  const manage = can(role, "catalog:manage");
  const services = useQuery("services.all", {});
  const incidents = useQuery("incidents.active", {});
  const schedules = useQuery("schedules.all", {});
  const members = useQuery("members.all", {});
  const policies = useQuery("escalationPolicies.all", {});
  const create = useMutation("service.create");
  const [adding, setAdding] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  const rows = services.rows;
  const status = services.status;
  const loading = status !== "ready" && status !== "error";
  const close = () => {
    setAdding(false);
    requestAnimationFrame(() => addRef.current?.focus());
  };
  return (
    <Card
      aria-labelledby="services-title"
      className={cn(rows.length > 0 && "overflow-hidden pb-0 sm:pb-0")}
    >
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <CardTitle id="services-title" className="truncate">
            {catalogText("services_title")}
          </CardTitle>
          {manage && !adding ? (
            <Button
              ref={addRef}
              variant="outline"
              disabled={!canAddService(rows.length)}
              onClick={() => {
                setRefused(null);
                setAdding(true);
              }}
            >
              <PlusIcon aria-hidden />
              {m.catalog_action({ action: "add_service" })}
            </Button>
          ) : null}
        </div>
        {loading || rows.length > 0 ? (
          <div className="flex h-6 items-center text-sm text-muted-foreground tabular-nums">
            {loading ? (
              <span aria-hidden className="block h-4 w-24 rounded-sm bg-muted" />
            ) : (
              <span>{m.catalog_count({ kind: "services", count: rows.length })}</span>
            )}
          </div>
        ) : null}
      </div>

      <CardContent className="flex flex-col gap-5">
        {adding ? (
          <ServiceForm
            initial={emptyService()}
            schedules={schedules.rows}
            members={members.rows}
            policies={policies.rows}
            loaded={schedules.status === "ready" && members.status === "ready"}
            onCancel={close}
            onSubmit={(draft) => {
              const checked = checkService(newServiceId(Date.now()), draft);
              if (!checked.ok) return checked;
              setRefused(null);
              void create(checked.args).then((outcome: MutationOutcome) => {
                if (!outcome.ok) setRefused(catalogRefusal(checked.args.name, outcome.error.code));
              });
              close();
              return checked;
            }}
          />
        ) : null}
        {refused ? <Refusal text={refused} onDismiss={() => setRefused(null)} /> : null}
        {status === "error" ? (
          <FormError>{queryErrorReason(services.error?.code)}</FormError>
        ) : null}

        {rows.length > 0 ? (
          <ul aria-labelledby="services-title" className="-mx-4 divide-y border-t sm:-mx-6">
            {rows.map((row) => (
              <li key={row.id}>
                <ServiceItem
                  row={row}
                  active={naming(incidents.rows, row.id).length}
                  schedules={schedules.rows}
                  members={members.rows}
                />
              </li>
            ))}
          </ul>
        ) : loading ? (
          <div aria-hidden className="-mx-4 divide-y border-t sm:-mx-6">
            <div className="flex flex-col gap-2 px-4 py-4 sm:px-6">
              <span className="block h-5 w-40 rounded-sm bg-muted" />
              <span className="block h-4 w-64 max-w-full rounded-sm bg-muted" />
            </div>
          </div>
        ) : status === "ready" && !adding ? (
          <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
            {catalogText("services_empty")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** One row: the whole row opens the service's page (the name is the link, stretched over the row). */
function ServiceItem({
  row,
  active,
  schedules,
  members,
}: {
  row: ServiceRow;
  active: number;
  schedules: readonly ScheduleRow[];
  members: readonly MemberRow[];
}) {
  const owners = row.owners.map((owner) => ownerLabel(owner, schedules, members));
  return (
    <div className="relative flex items-center gap-3 px-4 py-3.5 transition-colors duration-150 ease-out hover:bg-muted/50 has-focus-visible:bg-muted/50 sm:px-6">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to="/services/$id"
            params={{ id: row.id }}
            className="min-w-0 font-medium outline-none [overflow-wrap:anywhere] after:absolute after:inset-0 focus-visible:underline"
          >
            {row.name}
          </Link>
          <TierBadge tier={row.tier} />
          {active > 0 ? (
            <Badge variant="investigating" className="tabular-nums">
              {m.catalog_count({ kind: "active", count: active })}
            </Badge>
          ) : null}
        </div>
        <p
          className={cn(
            "line-clamp-2 text-sm [overflow-wrap:anywhere]",
            owners.length === 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
          )}
        >
          {owners.length === 0 ? catalogText("unowned") : owners.join(", ")}
        </p>
      </div>
      <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </div>
  );
}

export function Refusal({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-1">
      <div className="min-w-0 flex-1">
        <FormError>{text}</FormError>
      </div>
      <Button variant="ghost" size="icon" aria-label={m.dismiss()} onClick={onDismiss}>
        <XIcon aria-hidden />
      </Button>
    </div>
  );
}

/** Name, description, tier, owners and policy: the service editor, here and on the service's page. */
export function ServiceForm({
  initial,
  editing,
  loaded,
  schedules,
  members,
  policies,
  onCancel,
  onSubmit,
  onDelete,
}: {
  initial: ServiceDraft;
  editing?: ServiceRow;
  /** Whether the schedules and members are the shard's whole lists yet (so owners that are gone can be dropped). */
  loaded: boolean;
  schedules: readonly ScheduleRow[];
  members: readonly MemberRow[];
  policies: readonly EscalationPolicyRow[];
  onCancel: () => void;
  onSubmit: (draft: ServiceDraft) => CheckedService;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [dropped, setDropped] = useState(false);
  // An owner that is gone would make every save fail: dropped once the lists are in.
  const checked = useRef(false);
  useEffect(() => {
    if (checked.current || !loaded) return;
    checked.current = true;
    const live = liveOwners(draft.owners, schedules, members);
    if (!live.dropped) return;
    setDropped(true);
    setDraft((current) => ({ ...current, owners: live.owners }));
  }, [loaded, draft.owners, schedules, members]);
  const [errors, setErrors] = useState<{ name: boolean; description: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const descriptionErrorId = useId();
  const tierId = useId();
  const policyId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = onSubmit(draft);
    if (!result.ok) {
      setErrors(result.errors);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(`[aria-labelledby="${titleId}"] [aria-invalid="true"]`)
          ?.focus(),
      );
    }
  };
  const closeConfirm = () => {
    setConfirming(false);
    requestAnimationFrame(() => deleteRef.current?.focus());
  };
  return (
    <form
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
          ? m.catalog_action_on({ action: "edit", name: editing.name })
          : m.catalog_action({ action: "add_service" })}
      </h3>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
        <Field
          ref={nameRef}
          label={m.catalog_field({ field: "name", form: "label" })}
          value={draft.name}
          maxLength={SERVICE_NAME_MAX}
          autoComplete="off"
          error={errors?.name ? m.catalog_field({ field: "name", form: "invalid" }) : undefined}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={tierId} className="text-sm font-medium">
            {m.catalog_field({ field: "tier", form: "label" })}
          </label>
          <select
            id={tierId}
            className={SELECT}
            value={draft.tier}
            onChange={(event) => setDraft({ ...draft, tier: event.target.value as ServiceTier })}
          >
            {SERVICE_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {m.catalog_tier({ tier })}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Description
        id={descriptionId}
        errorId={descriptionErrorId}
        value={draft.description}
        invalid={errors?.description ?? false}
        onChange={(description) => setDraft({ ...draft, description })}
      />
      {dropped ? (
        <p
          role="status"
          className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400"
        >
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{catalogText("dropped")}</span>
        </p>
      ) : null}
      <OwnerPicker
        owners={draft.owners}
        schedules={schedules}
        members={members}
        onChange={(owners) => setDraft({ ...draft, owners })}
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={policyId} className="text-sm font-medium">
          {m.catalog_field({ field: "policy", form: "label" })}
        </label>
        <select
          id={policyId}
          className={cn(SELECT, "sm:max-w-sm")}
          value={draft.escalationPolicyId ?? ""}
          aria-describedby={`${policyId}-note`}
          onChange={(event) =>
            setDraft({ ...draft, escalationPolicyId: event.target.value || null })
          }
        >
          <option value="">{catalogText("option_none")}</option>
          {policies.map((policy) => (
            <option key={policy.id} value={policy.id}>
              {policy.name}
            </option>
          ))}
        </select>
        <p id={`${policyId}-note`} className="text-sm text-muted-foreground">
          {catalogText("policy_note")}
        </p>
      </div>
      <FormButtons
        editing={editing !== undefined}
        create={m.catalog_action({ action: "create_service" })}
        remove={onDelete ? m.catalog_action({ action: "delete_service" }) : undefined}
        confirm={editing ? catalogText("delete_service", { name: editing.name }) : ""}
        confirming={confirming}
        deleteRef={deleteRef}
        onCancel={onCancel}
        onAskDelete={() => setConfirming(true)}
        onCloseConfirm={closeConfirm}
        onDelete={onDelete}
      />
    </form>
  );
}

/** The optional multi-line description of a service, type or field. */
export function Description({
  id,
  errorId,
  value,
  invalid,
  onChange,
}: {
  id: string;
  errorId: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {m.catalog_field({ field: "description", form: "label" })}
      </label>
      <textarea
        id={id}
        className={TEXTAREA}
        rows={2}
        value={value}
        maxLength={CATALOG_DESCRIPTION_MAX}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {invalid ? (
        <p id={errorId} className="text-sm text-destructive">
          {m.catalog_field({ field: "description", form: "invalid" })}
        </p>
      ) : null}
    </div>
  );
}

/** Save or create, cancel, and delete behind an inline confirmation. */
export function FormButtons({
  editing,
  create,
  remove,
  confirm,
  confirming,
  deleteRef,
  onCancel,
  onAskDelete,
  onCloseConfirm,
  onDelete,
}: {
  editing: boolean;
  create: string;
  remove?: string;
  confirm: string;
  confirming: boolean;
  deleteRef: React.RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onAskDelete: () => void;
  onCloseConfirm: () => void;
  onDelete?: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit">{editing ? m.catalog_action({ action: "save" }) : create}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {m.catalog_action({ action: "cancel" })}
        </Button>
        {editing && onDelete && remove ? (
          <Button
            ref={deleteRef}
            type="button"
            variant="ghost"
            className="ml-auto text-destructive"
            hidden={confirming}
            onClick={onAskDelete}
          >
            <Trash2Icon aria-hidden />
            {remove}
          </Button>
        ) : null}
      </div>
      {editing && onDelete && confirming ? (
        <div
          role="alertdialog"
          aria-label={remove}
          className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            // Only the confirmation closes: the form's own Escape (close the editor) must not see it.
            event.stopPropagation();
            event.preventDefault();
            onCloseConfirm();
          }}
        >
          <p className="font-medium [overflow-wrap:anywhere]">{confirm}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              className={CONFIRM_DESTRUCTIVE}
              autoFocus
              onClick={onDelete}
            >
              {m.catalog_action({ action: "delete" })}
            </Button>
            <Button type="button" variant="outline" onClick={onCloseConfirm}>
              {m.catalog_action({ action: "cancel" })}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function OwnerPicker({
  owners,
  schedules,
  members,
  onChange,
}: {
  owners: EscalationTarget[];
  schedules: readonly ScheduleRow[];
  members: readonly MemberRow[];
  onChange: (owners: EscalationTarget[]) => void;
}) {
  const addId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const has = (kind: string, id: string) =>
    owners.some((owner) => owner.kind === kind && owner.id === id);
  const people = rotationChoices(members).filter((row) => !has("member", row.id));
  const open = schedules.filter((row) => !has("schedule", row.id));
  const full = owners.length >= MAX_SERVICE_OWNERS;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className={LABEL}>{m.catalog_field({ field: "owners", form: "label" })}</p>
      {owners.length > 0 ? (
        <ul ref={listRef} className="flex flex-wrap gap-1.5">
          {owners.map((owner, index) => {
            const label = ownerLabel(owner, schedules, members);
            const Icon = owner.kind === "schedule" ? CalendarClockIcon : UserRoundIcon;
            return (
              <li
                key={`${owner.kind}:${owner.id}`}
                className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border bg-card py-0.5 pr-0.5 pl-2 text-sm"
              >
                <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="relative shrink-0 focus-visible:z-10"
                  data-owner-index={index}
                  aria-label={m.catalog_action_on({ action: "remove", name: label })}
                  onClick={() => {
                    onChange(owners.filter((_, i) => i !== index));
                    // The chip that takes this one's place, else the one before, else the picker.
                    const next = index < owners.length - 1 ? index : index - 1;
                    requestAnimationFrame(() =>
                      (
                        listRef.current?.querySelector<HTMLElement>(
                          `[data-owner-index="${next}"]`,
                        ) ?? selectRef.current
                      )?.focus(),
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
        {m.catalog_field({ field: "add_owner", form: "label" })}
      </label>
      <select
        ref={selectRef}
        id={addId}
        className={cn(SELECT, "sm:max-w-sm")}
        value=""
        disabled={full}
        onChange={(event) => {
          const [kind, id] = event.target.value.split("|") as [EscalationTarget["kind"], string];
          if (id) onChange([...owners, { kind, id }]);
        }}
      >
        <option value="">{m.catalog_field({ field: "add_owner", form: "label" })}</option>
        {open.length > 0 ? (
          <optgroup label={catalogText("group_schedules")}>
            {open.map((row) => (
              <option key={row.id} value={`schedule|${row.id}`}>
                {row.name}
              </option>
            ))}
          </optgroup>
        ) : null}
        {people.length > 0 ? (
          <optgroup label={catalogText("group_people")}>
            {people.map((row) => (
              <option key={row.id} value={`member|${row.id}`}>
                {row.name ?? m.oncall_unnamed()}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </div>
  );
}
