import { m } from "@freecorps/brigade-i18n";
import {
  can,
  COMPONENT_GROUP_MAX,
  COMPONENT_NAME_MAX,
  COMPONENT_STATUSES,
  isStatusSlug,
  MAX_COMPONENTS,
  STATUS_LOCALES,
  STATUS_PAGE_TITLE_MAX,
  type ComponentStatus,
  type StatusComponentRow,
  type StatusLocale,
  type StatusPageRow,
} from "@freecorps/brigade-schema";
import { useMutation, useQuery, useSyncClient } from "@freecorps/brigade-sync/react";
import { ExternalLinkIcon, PlusIcon, RotateCwIcon } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { CONFIRM_DESTRUCTIVE } from "@/components/monitor-form";
import { useMember } from "@/components/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Field, FormError } from "@/components/ui/field";
import {
  normalizeSlug,
  saveErrorPart,
  saveStatusPage,
  statusCardText as say,
  statusText,
  statusUrl,
  type StatusSettings,
} from "@/lib/status-page";

const SELECT =
  "h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring";

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
  return (
    <StatusPagePanel
      page={page.rows[0] ?? null}
      components={components.rows}
      loading={page.status === "loading"}
      failed={page.status === "error"}
      manage={can(role, "status:manage")}
      origin={window.location.origin}
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
              <p className="text-sm text-muted-foreground">
                {say(manage ? "not_set_up" : "manage_only")}
              </p>
            ) : null}
            {page ? <Components {...props} /> : null}
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

function Components({ components, manage, onCreate, onUpdate, onDelete }: PanelProps) {
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
      </div>
      {components.length === 0 ? (
        <p className="text-sm text-muted-foreground">{say("components_empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {components.map((component) => (
            <ComponentRow
              key={component.id}
              component={component}
              manage={manage}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
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
}: Pick<PanelProps, "manage" | "onUpdate" | "onDelete"> & { component: StatusComponentRow }) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [name, setName] = useState(component.name);
  const [group, setGroup] = useState(component.group ?? "");
  const [status, setStatus] = useState<ComponentStatus>(component.status);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const statusId = useId();

  if (mode === "view") {
    return (
      <li className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium [overflow-wrap:anywhere]">{component.name}</span>
          <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {component.group ?? say("ungrouped")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ComponentChip status={component.status} />
          {manage ? (
            <Button
              variant="ghost"
              onClick={() => {
                setName(component.name);
                setGroup(component.group ?? "");
                setStatus(component.status);
                setFailed(null);
                setMode("edit");
              }}
            >
              {say("edit")}
            </Button>
          ) : null}
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
          if (next.name === "") return;
          if (
            next.name === component.name &&
            next.group === component.group &&
            next.status === component.status
          ) {
            setMode("view");
            return;
          }
          setBusy(true);
          void onUpdate(next).then((ok) => {
            setBusy(false);
            if (ok) setMode("view");
            else setFailed("save_failed");
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
