import { formatNumber, getLocale, m } from "@freecorps/brigade-i18n";
import {
  can,
  COMPONENT_GROUP_MAX,
  COMPONENT_NAME_MAX,
  COMPONENT_STATUSES,
  isStatusSlug,
  MAX_COMPONENT_MONITORS,
  MAX_COMPONENT_SERVICES,
  MAX_COMPONENTS,
  STATUS_LOCALES,
  STATUS_PAGE_TITLE_MAX,
  componentOrder,
  statusFollowKey,
  type ComponentStatus,
  type StatusComponentRow,
  type StatusLocale,
  type StatusPageRow,
} from "@freecorps/brigade-schema";
import { useMutation, useQuery, useSyncClient } from "@freecorps/brigade-sync/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DownloadIcon,
  ExternalLinkIcon,
  PlusIcon,
  RotateCwIcon,
} from "lucide-react";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { CONFIRM_DESTRUCTIVE } from "@/components/monitor-form";
import { useMember } from "@/components/session";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Field, FormError } from "@/components/ui/field";
import {
  componentBlocks,
  loadSubscriberCounts,
  moveComponent,
  moveGroup,
  normalizeSlug,
  removeSubscriber,
  subscribersExportUrl,
  subscribersText,
  type SubscriberCounts,
  saveErrorPart,
  saveStatusPage,
  servicesToLink,
  statusCardText as say,
  statusText,
  statusUrl,
  type StatusSettings,
} from "@/lib/status-page";

const SELECT = "field w-full min-w-0 px-3 focus-visible:ring-3 focus-visible:ring-ring";

const LANGUAGE_NAMES: Record<StatusLocale, () => string> = {
  en: () => m.language_name_en(),
  "pt-BR": () => m.language_name_pt_br(),
};

/** A component status as a badge, coloured like the public page (green, then SEV3, SEV2, SEV1). */
const CHIP = {
  operational: "resolved",
  degraded: "sev3",
  partial_outage: "sev2",
  major_outage: "sev1",
} as const satisfies Record<ComponentStatus, string>;

export function ComponentChip({ status }: { status: ComponentStatus }) {
  return <Badge variant={CHIP[status]}>{statusText(`component_${status}`)}</Badge>;
}

/**
 * The workspace's public status page (RFC 0012): its settings (saved through the API, which claims the address) and
 * its components (live from the shard). Owners and admins change them; everyone else reads them.
 */
export function StatusPageCard() {
  const [attempt, setAttempt] = useState(0);
  return <StatusPageLive key={attempt} onRetry={() => setAttempt((count) => count + 1)} />;
}

function StatusPageLive({ onRetry }: { onRetry: () => void }) {
  const { role, workspaceId } = useMember();
  const client = useSyncClient();
  const page = useQuery("statusPage.config", {});
  const components = useQuery("statusComponents.all", {});
  const create = useMutation("statusComponent.create");
  const update = useMutation("statusComponent.update");
  const remove = useMutation("statusComponent.delete");
  const link = useMutation("statusComponent.linkMonitors");
  const reorder = useMutation("statusComponent.reorder");
  const linkServices = useMutation("statusComponent.linkServices");
  const manage = can(role, "status:manage");
  // Monitors are only offered to link to those who manage the page (`monitor:read` covers every role).
  const monitors = useQuery("monitors.all", {});
  const services = useQuery("services.all", {});
  return (
    <StatusPagePanel
      page={page.rows[0] ?? null}
      components={components.rows}
      loading={page.status === "loading"}
      failed={page.status === "error"}
      manage={manage}
      origin={window.location.origin}
      monitors={monitors.rows.map((row) => ({ id: row.id, name: row.name }))}
      onLink={async (id, monitorIds) => (await link({ id, monitorIds })).ok}
      services={
        services.status === "ready"
          ? services.rows.map((row) => ({ id: row.id, name: row.name }))
          : undefined
      }
      onLinkServices={async (id, serviceIds) => (await linkServices({ id, serviceIds })).ok}
      onReorder={async (ids) => (await reorder({ ids })).ok}
      subscribers={
        manage
          ? {
              load: () => loadSubscriberCounts(workspaceId),
              remove: (email) => removeSubscriber(workspaceId, email),
              exportUrl: subscribersExportUrl(workspaceId),
            }
          : undefined
      }
      onSave={(settings) => saveStatusPage(workspaceId, settings)}
      onCreate={async (name, group) => (await create({ id: client.newId("cmp"), name, group })).ok}
      onUpdate={async (row) => (await update(row)).ok}
      onDelete={async (id) => (await remove({ id })).ok}
      onRetry={onRetry}
    />
  );
}

type ComponentEdit = Pick<StatusComponentRow, "id" | "name" | "group" | "status">;

type PanelProps = {
  page: StatusPageRow | null;
  components: readonly StatusComponentRow[];
  loading: boolean;
  failed: boolean;
  manage: boolean;
  origin: string;
  onSave: (settings: StatusSettings) => Promise<{ ok: true } | { ok: false; error: string }>;
  onCreate: (name: string, group: string | null) => Promise<boolean>;
  onUpdate: (row: ComponentEdit) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onRetry: () => void;
  /** The workspace's monitors a component's uptime bar may come from. */
  monitors?: readonly { id: string; name: string }[];
  onLink?: (id: string, monitorIds: string[]) => Promise<boolean>;
  /**
   * The workspace's services a component may stand for (RFC 0012 "Services"); undefined until they load, and no
   * component is edited before, so a save never takes off links the form could not show.
   */
  services?: readonly { id: string; name: string }[];
  onLinkServices?: (id: string, serviceIds: string[]) => Promise<boolean>;
  /** Every component's id in its new order (`statusComponent.reorder`). */
  onReorder?: (ids: string[]) => Promise<boolean>;
  /** Owners and admins only: the page's email subscribers. */
  subscribers?: SubscribersApi;
};

export type SubscribersApi = {
  load: () => Promise<SubscriberCounts | null>;
  remove: (email: string) => Promise<"removed" | "not_found" | "failed">;
  exportUrl: string;
};

/** The card itself, without the hooks: what each state looks like (tested and screenshotted with made-up data). */
export function StatusPagePanel(props: PanelProps) {
  const { page, loading, failed, manage, origin, onRetry } = props;
  const [setUp, setSetUp] = useState(false);
  return (
    <Card aria-labelledby="status-page-title">
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <CardTitle id="status-page-title" className="truncate">
            {say("title")}
          </CardTitle>
          {manage && !page && !setUp && !loading && !failed ? (
            <Button variant="outline" onClick={() => setSetUp(true)}>
              {say("set_up")}
            </Button>
          ) : null}
        </div>
        <p className="max-w-prose text-sm text-muted-foreground">{say("description")}</p>
      </div>
      <CardContent className="flex flex-col gap-4">
        {loading ? null : failed ? (
          <div className="flex flex-col items-start gap-2">
            <FormError>{say("load_failed")}</FormError>
            <Button variant="outline" onClick={onRetry}>
              <RotateCwIcon aria-hidden />
              {say("retry")}
            </Button>
          </div>
        ) : (
          <>
            {page ? <Address page={page} origin={origin} /> : null}
            {manage && (page || setUp) ? (
              <Settings page={page} onSave={props.onSave} />
            ) : !page ? (
              <Empty>{say(manage ? "not_set_up" : "manage_only")}</Empty>
            ) : null}
            {page ? <Components {...props} /> : null}
            {page && props.subscribers ? (
              <Subscribers api={props.subscribers} components={props.components} />
            ) : null}
            {page && !manage ? (
              <p className="text-sm text-muted-foreground">{say("manage_only")}</p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Address({ page, origin }: { page: StatusPageRow; origin: string }) {
  const url = statusUrl(page.slug, origin);
  if (!page.enabled) return <p className="text-sm text-muted-foreground">{say("draft")}</p>;
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="min-w-0 [overflow-wrap:anywhere]">{say("live", { url })}</span>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
      >
        {say("open")}
        <ExternalLinkIcon aria-hidden className="size-3.5" />
      </a>
    </p>
  );
}

function Settings({ page, onSave }: Pick<PanelProps, "page" | "onSave">) {
  const [title, setTitle] = useState(page?.title ?? "");
  const [slug, setSlug] = useState(page?.slug ?? "");
  const [locale, setLocale] = useState<StatusLocale>(page?.locale ?? "en");
  const [enabled, setEnabled] = useState(page?.enabled ?? false);
  const [invalid, setInvalid] = useState<{ title?: boolean; slug?: boolean }>({});
  const [state, setState] = useState<"idle" | "saving" | "saved" | { error: string }>("idle");
  const languageId = useId();
  const enabledId = useId();
  // A change saved elsewhere (another member, another tab) arrives live: the form follows it.
  useEffect(() => {
    if (!page) return;
    setTitle(page.title);
    setSlug(page.slug);
    setLocale(page.locale);
    setEnabled(page.enabled);
  }, [page]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = { title: title.trim(), slug: normalizeSlug(slug), locale, enabled };
    const problems = {
      title: next.title === "" || next.title.length > STATUS_PAGE_TITLE_MAX,
      slug: !isStatusSlug(next.slug),
    };
    setInvalid(problems);
    if (problems.title || problems.slug) return;
    setState("saving");
    void onSave(next).then((result) =>
      setState(
        result.ok
          ? "saved"
          : result.error === "not_applied"
            ? { error: "not_applied" }
            : { error: saveErrorPart(result.error as Parameters<typeof saveErrorPart>[0]) },
      ),
    );
  };
  const touched = () => setState("idle");
  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]"
    >
      <Field
        label={say("title_label")}
        hint={say("title_hint")}
        error={invalid.title ? say("title_required") : undefined}
        value={title}
        maxLength={STATUS_PAGE_TITLE_MAX}
        onChange={(event) => {
          setTitle(event.target.value);
          setInvalid((current) => ({ ...current, title: false }));
          touched();
        }}
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={languageId} className="text-sm font-medium">
          {say("language_label")}
        </label>
        <select
          id={languageId}
          className={SELECT}
          value={locale}
          onChange={(event) => {
            setLocale(event.target.value as StatusLocale);
            touched();
          }}
        >
          {STATUS_LOCALES.map((value) => (
            <option key={value} value={value}>
              {LANGUAGE_NAMES[value]()}
            </option>
          ))}
        </select>
      </div>
      <Field
        className="sm:col-span-2"
        label={say("slug_label")}
        hint={`/status/${normalizeSlug(slug) || "…"} · ${say("slug_hint")}`}
        error={invalid.slug ? say("slug_invalid") : undefined}
        value={slug}
        maxLength={40}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        onChange={(event) => {
          setSlug(event.target.value);
          setInvalid((current) => ({ ...current, slug: false }));
          touched();
        }}
      />
      <div className="flex items-start gap-3 sm:col-span-2">
        <input
          id={enabledId}
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            setEnabled(event.target.checked);
            touched();
          }}
          className="mt-0.5 size-5 shrink-0 accent-primary"
        />
        <label htmlFor={enabledId} className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">{say("enabled_label")}</span>
          <span className="text-sm text-muted-foreground">{say("enabled_hint")}</span>
          <span className="text-sm text-muted-foreground">{say("cache_window")}</span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={state === "saving"}>
          {say(state === "saving" ? "saving" : "save")}
        </Button>
        <span role="status" className="text-sm text-muted-foreground">
          {state === "saved" ? say("saved") : ""}
        </span>
      </div>
      {typeof state === "object" ? (
        <div className="sm:col-span-2">
          {state.error === "not_applied" ? (
            <p role="status" className="text-sm text-muted-foreground">
              {say("not_applied")}
            </p>
          ) : (
            <FormError>{say(state.error)}</FormError>
          )}
        </div>
      ) : null}
    </form>
  );
}

/** Focuses the move button `key` once the list has moved, or `other` when `key` is now disabled (top or bottom). */
function refocus(key: string, other: string) {
  requestAnimationFrame(() => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("button[data-move]")];
    const find = (wanted: string) => buttons.find((node) => node.dataset.move === wanted);
    const target = find(key);
    (target && !target.disabled ? target : find(other))?.focus();
  });
}

/** Up and down for a component or a group: keyboard and screen reader first, no drag. Hidden when nothing can move. */
function MoveButtons({
  id,
  name,
  first,
  last,
  group,
  onMove,
}: {
  id: string;
  name: string;
  first: boolean;
  last: boolean;
  group?: boolean;
  onMove: (by: -1 | 1) => void;
}) {
  if (first && last) return null;
  const parts = group
    ? (["move_group_up", "move_group_down"] as const)
    : (["move_up", "move_down"] as const);
  return (
    <div className="flex shrink-0 items-center">
      {([-1, 1] as const).map((by) => (
        <Button
          key={by}
          variant="ghost"
          size="icon"
          // Muted without the fill: a filled arrow next to a plain one reads as the chosen one, not the unavailable.
          className="disabled:border-transparent disabled:bg-transparent disabled:text-muted-foreground/50"
          data-move={`${id}:${by}`}
          disabled={by === -1 ? first : last}
          aria-label={say(parts[by === -1 ? 0 : 1], { name })}
          title={say(parts[by === -1 ? 0 : 1], { name })}
          onClick={() => {
            onMove(by);
            refocus(`${id}:${by}`, `${id}:${-by}`);
          }}
        >
          {by === -1 ? <ArrowUpIcon aria-hidden /> : <ArrowDownIcon aria-hidden />}
        </Button>
      ))}
    </div>
  );
}

function Components({
  components,
  manage,
  onCreate,
  onUpdate,
  onDelete,
  monitors = [],
  onLink,
  services,
  onLinkServices,
  onReorder,
}: PanelProps) {
  const [moved, setMoved] = useState<{ name: string } | { failed: true } | null>(null);
  const blocks = componentBlocks(components);
  const firstGroup = blocks[0]?.group === null ? 1 : 0;
  const canMove = manage && onReorder !== undefined;
  const move = (ids: string[] | null, name: string) => {
    if (!ids || !onReorder) return;
    // Said once the server took the order, never before: a refusal must not follow a "Moved".
    setMoved(null);
    void onReorder(ids).then((ok) => setMoved(ok ? { name } : { failed: true }));
  };
  return (
    <section
      aria-labelledby="status-components-title"
      className="flex flex-col gap-3 border-t pt-4"
    >
      <div className="flex flex-col gap-1">
        <h3 id="status-components-title" className="text-sm font-semibold">
          {say("components_title")}
        </h3>
        <p className="max-w-prose text-sm text-muted-foreground">{say("components_hint")}</p>
        {canMove && components.length > 1 ? (
          <p className="max-w-prose text-sm text-muted-foreground">{say("order_hint")}</p>
        ) : null}
      </div>
      {components.length === 0 ? (
        <Empty>{say("components_empty")}</Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {blocks.map((block, index) => (
            <div key={block.group ?? ""} className="flex min-w-0 flex-col gap-1.5">
              {block.group !== null ? (
                <div className="flex min-h-11 items-center justify-between gap-3">
                  <h4 className="min-w-0 text-xs font-semibold text-muted-foreground [overflow-wrap:anywhere]">
                    {block.group}
                  </h4>
                  {canMove ? (
                    <MoveButtons
                      id={`group:${block.group}`}
                      name={block.group}
                      group
                      first={index === firstGroup}
                      last={index === blocks.length - 1}
                      onMove={(by) => move(moveGroup(components, block.group!, by), block.group!)}
                    />
                  ) : null}
                </div>
              ) : null}
              <ul className="flex flex-col divide-y rounded-md border">
                {block.components.map((component, at) => (
                  <ComponentRow
                    key={component.id}
                    component={component}
                    manage={manage}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                    monitors={monitors}
                    onLink={onLink}
                    services={services}
                    onLinkServices={onLinkServices}
                    mover={
                      canMove ? (
                        <MoveButtons
                          id={component.id}
                          name={component.name}
                          first={at === 0}
                          last={at === block.components.length - 1}
                          onMove={(by) =>
                            move(moveComponent(components, component.id, by), component.name)
                          }
                        />
                      ) : null
                    }
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {moved && "name" in moved ? say("moved", { name: moved.name }) : ""}
      </p>
      {moved && "failed" in moved ? <FormError>{say("reorder_failed")}</FormError> : null}
      {manage ? (
        <AddComponent full={components.length >= MAX_COMPONENTS} onCreate={onCreate} />
      ) : null}
    </section>
  );
}

function ComponentRow({
  component,
  manage,
  onUpdate,
  onDelete,
  monitors = [],
  onLink,
  services,
  onLinkServices,
  mover,
}: Pick<
  PanelProps,
  "manage" | "onUpdate" | "onDelete" | "monitors" | "onLink" | "services" | "onLinkServices"
> & {
  component: StatusComponentRow;
  mover?: ReactNode;
}) {
  const linked = component.monitorIds ?? [];
  // A deleted service stays on the row until the next change; it is skipped wherever it is read.
  const serving = (component.serviceIds ?? []).filter(
    (id) => !services || services.some((service) => service.id === id),
  );
  const servicesLoading = onLinkServices !== undefined && services === undefined;
  const [chosen, setChosen] = useState<string[]>(linked);
  const [chosenServices, setChosenServices] = useState<string[]>(serving);
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [name, setName] = useState(component.name);
  const [group, setGroup] = useState(component.group ?? "");
  const [status, setStatus] = useState<ComponentStatus>(component.status);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [nameInvalid, setNameInvalid] = useState(false);
  const statusId = useId();
  const nameId = useId();
  const editId = useId();

  if (mode === "view") {
    return (
      <li className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2">
        <div className="flex min-w-0 flex-col">
          <span id={nameId} className="text-sm font-medium [overflow-wrap:anywhere]">
            {component.name}
          </span>
          {linked.length > 0 ? (
            <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {say("uptime_from", {
                name: linked
                  .map((id) => monitors.find((monitor) => monitor.id === id)?.name ?? "…")
                  .join(", "),
              })}
            </span>
          ) : null}
          {serving.length > 0 ? (
            <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {say("services_from", {
                name: serving
                  .map((id) => services?.find((service) => service.id === id)?.name ?? "…")
                  .join(", "),
              })}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ComponentChip status={component.status} />
          {manage ? (
            <Button
              variant="ghost"
              // "Edit API", not one "Edit" per row, in a screen reader's list of buttons.
              aria-labelledby={`${editId} ${nameId}`}
              disabled={servicesLoading}
              onClick={() => {
                setName(component.name);
                setGroup(component.group ?? "");
                setStatus(component.status);
                setChosen(linked);
                setChosenServices(serving);
                setFailed(null);
                setNameInvalid(false);
                setMode("edit");
              }}
            >
              <span id={editId}>{say("edit")}</span>
            </Button>
          ) : null}
          {mover}
        </div>
      </li>
    );
  }
  if (mode === "confirm") {
    return (
      <li className="flex flex-col gap-3 px-3 py-3">
        <p className="text-sm [overflow-wrap:anywhere]">
          {say("delete_confirm", { name: component.name })}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="destructive"
            className={CONFIRM_DESTRUCTIVE}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onDelete(component.id).then((ok) => {
                setBusy(false);
                if (!ok) setFailed("delete_failed");
              });
            }}
          >
            {say("delete")}
          </Button>
          <Button variant="outline" onClick={() => setMode("edit")}>
            {say("keep")}
          </Button>
        </div>
        {failed ? <FormError>{say(failed)}</FormError> : null}
      </li>
    );
  }
  return (
    <li className="px-3 py-3">
      <form
        noValidate
        className="grid min-w-0 gap-3 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          const next = { id: component.id, name: name.trim(), group: group.trim() || null, status };
          if (next.name === "") {
            setNameInvalid(true);
            return;
          }
          const fieldsChanged =
            next.name !== component.name ||
            next.group !== component.group ||
            next.status !== component.status;
          const monitorsChanged = chosen.join() !== linked.join();
          const serviceIds = servicesToLink(component.serviceIds ?? [], services, chosenServices);
          if (!fieldsChanged && !monitorsChanged && !serviceIds) {
            setMode("view");
            return;
          }
          setBusy(true);
          void (async () => {
            const ok =
              (!fieldsChanged || (await onUpdate(next))) &&
              (!monitorsChanged || !onLink || (await onLink(component.id, chosen))) &&
              (!serviceIds || !onLinkServices || (await onLinkServices(component.id, serviceIds)));
            setBusy(false);
            if (ok) setMode("view");
            else setFailed("save_failed");
          })();
        }}
      >
        <Field
          label={say("component_name")}
          value={name}
          maxLength={COMPONENT_NAME_MAX}
          error={nameInvalid ? say("component_name_required") : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setNameInvalid(false);
          }}
        />
        <Field
          label={say("component_group")}
          value={group}
          maxLength={COMPONENT_GROUP_MAX}
          onChange={(event) => setGroup(event.target.value)}
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={statusId} className="text-sm font-medium">
            {say("component_status")}
          </label>
          <select
            id={statusId}
            className={SELECT}
            value={status}
            onChange={(event) => setStatus(event.target.value as ComponentStatus)}
          >
            {COMPONENT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {statusText(`component_${value}`)}
              </option>
            ))}
          </select>
        </div>
        <p className="text-sm text-muted-foreground sm:col-span-3">
          {say("component_status_hint")}
        </p>
        {onLink ? (
          <fieldset className="flex min-w-0 flex-col gap-1 sm:col-span-3">
            <legend className="mb-1 text-sm font-medium">{say("uptime_label")}</legend>
            <p className="mb-1 text-sm text-muted-foreground">
              {say(monitors.length === 0 ? "uptime_no_monitors" : "uptime_hint")}
            </p>
            {monitors.map((monitor) => {
              const checked = chosen.includes(monitor.id);
              const full = !checked && chosen.length >= MAX_COMPONENT_MONITORS;
              return (
                <label key={monitor.id} className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-primary"
                    checked={checked}
                    disabled={full}
                    onChange={(event) =>
                      setChosen((current) =>
                        event.target.checked
                          ? [...current, monitor.id]
                          : current.filter((id) => id !== monitor.id),
                      )
                    }
                  />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{monitor.name}</span>
                </label>
              );
            })}
            {chosen.length >= MAX_COMPONENT_MONITORS ? (
              <p className="text-sm text-muted-foreground">{say("uptime_limit")}</p>
            ) : null}
          </fieldset>
        ) : null}
        {onLinkServices ? (
          <fieldset className="flex min-w-0 flex-col gap-1 sm:col-span-3">
            <legend className="mb-1 text-sm font-medium">{say("services_label")}</legend>
            <p className="mb-1 text-sm text-muted-foreground">
              {say((services ?? []).length === 0 ? "services_none" : "services_hint")}
            </p>
            {(services ?? []).map((service) => {
              const checked = chosenServices.includes(service.id);
              const full = !checked && chosenServices.length >= MAX_COMPONENT_SERVICES;
              return (
                <label key={service.id} className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 shrink-0 accent-primary"
                    checked={checked}
                    disabled={full}
                    onChange={(event) =>
                      setChosenServices((current) =>
                        event.target.checked
                          ? [...current, service.id]
                          : current.filter((id) => id !== service.id),
                      )
                    }
                  />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{service.name}</span>
                </label>
              );
            })}
            {chosenServices.length >= MAX_COMPONENT_SERVICES ? (
              <p className="text-sm text-muted-foreground">{say("services_limit")}</p>
            ) : null}
          </fieldset>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          <Button type="submit" disabled={busy}>
            {say(busy ? "saving" : "save")}
          </Button>
          <Button type="button" variant="outline" onClick={() => setMode("view")}>
            {say("cancel")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="text-destructive sm:ml-auto"
            onClick={() => {
              setFailed(null);
              setMode("confirm");
            }}
          >
            {say("delete")}
          </Button>
        </div>
        {failed ? (
          <div className="sm:col-span-3">
            <FormError>{say(failed)}</FormError>
          </div>
        ) : null}
      </form>
    </li>
  );
}

function AddComponent({ full, onCreate }: Pick<PanelProps, "onCreate"> & { full: boolean }) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [failed, setFailed] = useState(false);
  if (full) return <p className="text-sm text-muted-foreground">{say("limit")}</p>;
  return (
    <form
      noValidate
      className="grid min-w-0 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (trimmed === "") return;
        setFailed(false);
        // Cleared at once (the row shows optimistically), so the next name can be typed while the shard confirms;
        // a refused one comes back unless something else was typed meanwhile.
        setName("");
        void onCreate(trimmed, group.trim() || null).then((ok) => {
          if (ok) return;
          setFailed(true);
          setName((current) => (current === "" ? trimmed : current));
        });
      }}
    >
      <Field
        label={say("component_name")}
        value={name}
        maxLength={COMPONENT_NAME_MAX}
        onChange={(event) => setName(event.target.value)}
      />
      <Field
        label={say("component_group")}
        value={group}
        maxLength={COMPONENT_GROUP_MAX}
        onChange={(event) => setGroup(event.target.value)}
      />
      <Button type="submit" variant="outline" disabled={name.trim() === ""}>
        <PlusIcon aria-hidden />
        {say("add")}
      </Button>
      {failed ? (
        <div className="sm:col-span-3">
          <FormError>{say("add_failed")}</FormError>
        </div>
      ) : null}
    </form>
  );
}

/**
 * What confirmed subscribers follow (RFC 0012 "Following components"): everything, then each group and component in the
 * page's order with its count. Shown only once someone chose; keys of components that are gone are left out.
 */
function Following({
  counts,
  components,
}: {
  counts: SubscriberCounts;
  components: readonly StatusComponentRow[];
}) {
  const follows = counts.follows ?? {};
  if (Object.keys(follows).length === 0) return null;
  const text = subscribersText;
  const rows: { key: string; label: string; n: number; group?: boolean }[] = [
    { key: "everything", label: text("following_everything"), n: counts.everything ?? 0 },
  ];
  const groups = new Set<string>();
  for (const component of [...components].sort(componentOrder)) {
    if (component.group !== null && !groups.has(component.group)) {
      groups.add(component.group);
      const key = statusFollowKey("g", component.group);
      rows.push({
        key,
        label: text("following_group", { name: component.group }),
        n: follows[key] ?? 0,
        group: true,
      });
    }
    const key = statusFollowKey("c", component.id);
    rows.push({ key, label: component.name, n: follows[key] ?? 0 });
  }
  const shown = rows.filter((row) => row.n > 0);
  if (shown.length === 0) return null;
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h4 className="text-sm font-medium">{text("following_title")}</h4>
        <p className="max-w-prose text-sm text-muted-foreground">{text("following_hint")}</p>
      </div>
      <ul className="divide-y rounded-md border text-sm">
        {shown.map((row) => (
          <li key={row.key} className="flex min-h-10 items-center justify-between gap-4 px-3 py-2">
            <span className={`min-w-0 break-words ${row.group ? "font-medium" : ""}`}>
              {row.label}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatNumber(row.n, getLocale())}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The page's email subscribers (RFC 0012 "Email subscriptions"), owners and admins only: how many, the CSV export, and
 * removing one by address. Addresses are only ever in the export; the card shows counts.
 */
function Subscribers({
  api,
  components,
}: {
  api: SubscribersApi;
  components: readonly StatusComponentRow[];
}) {
  const [counts, setCounts] = useState<SubscriberCounts | null | "loading">("loading");
  const [attempt, setAttempt] = useState(0);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<
    "idle" | "busy" | { done: "removed"; email: string } | { error: "not_found" | "remove_failed" }
  >("idle");
  useEffect(() => {
    let live = true;
    setCounts("loading");
    void api.load().then((loaded) => {
      if (live) setCounts(loaded);
    });
    return () => {
      live = false;
    };
    // `api` is rebuilt every render; a retry or a removal reloads.
  }, [attempt]);
  const text = subscribersText;
  return (
    <section
      aria-labelledby="status-subscribers-title"
      className="flex flex-col gap-3 border-t pt-4"
    >
      <div className="flex flex-col gap-1">
        <h3 id="status-subscribers-title" className="text-sm font-semibold">
          {text("title")}
        </h3>
        <p className="max-w-prose text-sm text-muted-foreground">{text("hint")}</p>
      </div>
      {counts === "loading" ? (
        <p
          className="h-5 w-48 animate-pulse rounded bg-muted motion-reduce:animate-none"
          aria-hidden
        />
      ) : counts === null ? (
        <div className="flex flex-col items-start gap-2">
          <FormError>{text("load_failed")}</FormError>
          <Button variant="outline" onClick={() => setAttempt((count) => count + 1)}>
            <RotateCwIcon aria-hidden />
            {text("retry")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm tabular-nums">{text("count", counts)}</p>
          <a
            href={api.exportUrl}
            download
            className="inline-flex h-11 items-center gap-2 rounded-md border px-4 text-sm font-medium pointer-fine:h-9"
          >
            <DownloadIcon aria-hidden className="size-4" />
            {text("export")}
          </a>
          <Following counts={counts} components={components} />
        </div>
      )}
      <form
        noValidate
        className="grid min-w-0 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          const address = email.trim();
          if (!address) return;
          setState("busy");
          void api.remove(address).then((result) => {
            if (result === "removed") {
              setEmail("");
              setState({ done: "removed", email: address });
              setAttempt((count) => count + 1);
            } else setState({ error: result === "not_found" ? "not_found" : "remove_failed" });
          });
        }}
      >
        <Field
          label={text("remove_label")}
          hint={text("remove_hint")}
          type="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setState("idle");
          }}
        />
        <Button
          type="submit"
          variant="outline"
          className="sm:mb-7"
          disabled={state === "busy" || email.trim() === ""}
        >
          {text(state === "busy" ? "removing" : "remove")}
        </Button>
      </form>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {typeof state === "object" && "done" in state
          ? text("removed", { email: state.email })
          : ""}
      </p>
      {typeof state === "object" && "error" in state ? (
        <FormError>{text(state.error)}</FormError>
      ) : null}
    </section>
  );
}
