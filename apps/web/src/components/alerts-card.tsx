import { formatAge } from "@freecorps/brigade-i18n/incident";
import { m, type Locale } from "@freecorps/brigade-i18n";
import {
  ALERT_ROUTE_NAME_MAX,
  ALERT_SEVERITIES,
  ALERT_SOURCE_KINDS,
  ALERT_LABEL_KEY_MAX,
  ALERT_SOURCE_NAME_MAX,
  applyMapping,
  pickRoute,
  can,
  namesMonitor,
  ROUTE_ALL_MONITORS,
  ROUTE_ALL_SOURCES,
  formatIncidentNumber,
  MAX_ALERT_ROUTES,
  MAX_ALERT_SOURCES,
  MAX_INCIDENT_SERVICES,
  MAX_SEVERITY_RULES,
  parseTemplate,
  SEVERITIES,
  SEVERITY_VALUE_MAX,
  TITLE_TEMPLATE_MAX,
  type AlertMapping,
  type AlertRouteRow,
  type AlertSeverity,
  type AlertSourceKind,
  type AlertSourceRow,
  type EscalationPolicyRow,
  type IncidentTypeRow,
  type IncidentRow,
  type MonitorRow,
  type RouteAction,
  type RouteMatch,
  type Severity,
  type ServiceRow,
  type SeverityField,
  type SeverityMapping,
  type SourceAlertRow,
} from "@freecorps/brigade-schema";
import { useMutation, useQuery, useSyncClient } from "@freecorps/brigade-sync/react";
import { Link } from "@tanstack/react-router";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  PlusIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CONFIRM_DESTRUCTIVE } from "@/components/monitor-form";
import { usePreferences } from "@/components/preferences";
import { useMember } from "@/components/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Field, FormError } from "@/components/ui/field";
import {
  alertsText as say,
  DATADOG_PAYLOAD,
  formatLabels,
  genericExample,
  headerNameProblem,
  newAlertSourceUrl,
  parseLabels,
  sha256Hex,
  signing,
  type AlertsPart,
} from "@/lib/alerts";

const SELECT = "field w-full min-w-0 px-3 focus-visible:ring-3 focus-visible:ring-ring";
/** How many recent alerts the card lists; the shard keeps more. */
const RECENT_SHOWN = 15;

/** A new source as the form sends it: the URL is made by the card (`newAlertSourceUrl`), never by the shard. */
export type NewSource = {
  name: string;
  kind: AlertSourceKind;
  header: { name: string; value: string } | null;
  signingSecret: string | null;
};
export type RouteDraft = { name: string; match: RouteMatch; action: RouteAction };
/** A URL to show once: a new source's, or a source's new one (`rotated`). */
export type ShownUrl = {
  url: string;
  kind: AlertSourceKind;
  name: string;
  header: string | null;
  signed: boolean;
  rotated: boolean;
};

/**
 * Alert sources and routes (RFC 0005 "Alert sources"): the sources' secret URLs, the routes that decide what an alert
 * does, and the alerts that came in lately with what Brigade did with each. Owners and admins change them.
 */
export function AlertsCard() {
  const [attempt, setAttempt] = useState(0);
  return <AlertsLive key={attempt} onRetry={() => setAttempt((count) => count + 1)} />;
}

function AlertsLive({ onRetry }: { onRetry: () => void }) {
  const { role, workspaceId } = useMember();
  const { locale } = usePreferences();
  const client = useSyncClient();
  const sources = useQuery("alertSources.all", {});
  const routes = useQuery("alertRoutes.all", {});
  const recent = useQuery("sourceAlerts.recent", {});
  const policies = useQuery("escalationPolicies.all", {});
  const types = useQuery("incidentTypes.all", {});
  const services = useQuery("services.all", {});
  const incidents = useQuery("incidents.active", {});
  const monitors = useQuery("monitors.all", {});
  const create = useMutation("alertSource.create");
  const rotate = useMutation("alertSource.rotate");
  const remove = useMutation("alertSource.delete");
  const setMapping = useMutation("alertSource.setMapping");
  const createRoute = useMutation("alertRoute.create");
  const updateRoute = useMutation("alertRoute.update");
  const moveRoute = useMutation("alertRoute.move");
  const deleteRoute = useMutation("alertRoute.delete");
  const origin = window.location.origin;
  // Every list the card shows: an empty one that is still loading, or failed, must not read as "none".
  const all = [sources, routes, recent, policies, types, services, incidents, monitors];
  return (
    <AlertsPanel
      sources={sources.rows}
      routes={routes.rows}
      recent={recent.rows}
      policies={policies.rows}
      types={types.rows}
      services={services.rows}
      incidents={incidents.rows}
      monitors={monitors.rows}
      loading={all.some((query) => query.status === "loading")}
      failed={all.some((query) => query.status === "error")}
      manage={can(role, "alert:manage")}
      locale={locale}
      now={Date.now()}
      onCreate={async (source) => {
        const id = client.newId("src");
        const { tokenHash, url } = await newAlertSourceUrl(origin, workspaceId, id);
        const result = await create({
          id,
          name: source.name,
          kind: source.kind,
          tokenHash,
          auth: source.header
            ? { headerName: source.header.name, headerHash: await sha256Hex(source.header.value) }
            : null,
          signingSecret: source.signingSecret,
        });
        return result.ok ? url : null;
      }}
      onRotate={async (id) => {
        const { tokenHash, url } = await newAlertSourceUrl(origin, workspaceId, id);
        return (await rotate({ id, tokenHash })).ok ? url : null;
      }}
      onDelete={async (id) => (await remove({ id })).ok}
      onSetMapping={async (id, mapping) => (await setMapping({ id, mapping })).ok}
      onCreateRoute={async (draft) => (await createRoute({ id: client.newId("rte"), ...draft })).ok}
      onUpdateRoute={async (id, draft) => (await updateRoute({ id, ...draft })).ok}
      onMoveRoute={async (id, position) => (await moveRoute({ id, position })).ok}
      onDeleteRoute={async (id) => (await deleteRoute({ id })).ok}
      onRetry={onRetry}
    />
  );
}

type PanelProps = {
  sources: readonly AlertSourceRow[];
  routes: readonly AlertRouteRow[];
  recent: readonly SourceAlertRow[];
  policies: readonly EscalationPolicyRow[];
  /** The catalog a route may declare its incidents with (RFC 0003 "Incident types", "Service catalog"). */
  types: readonly IncidentTypeRow[];
  services: readonly ServiceRow[];
  incidents: readonly IncidentRow[];
  /** What a route may name besides sources (RFC 0007 "Monitor alerts through the routes"). */
  monitors: readonly MonitorRow[];
  loading: boolean;
  failed: boolean;
  manage: boolean;
  locale: Locale;
  now: number;
  /** Resolves to the new URL, or null when the shard refused. */
  onCreate: (source: NewSource) => Promise<string | null>;
  onRotate: (id: string) => Promise<string | null>;
  onDelete: (id: string) => Promise<boolean>;
  /** A source's title and severity mapping; null: the sender's own again. */
  onSetMapping: (id: string, mapping: AlertMapping | null) => Promise<boolean>;
  onCreateRoute: (draft: RouteDraft) => Promise<boolean>;
  onUpdateRoute: (id: string, draft: RouteDraft) => Promise<boolean>;
  onMoveRoute: (id: string, position: number) => Promise<boolean>;
  onDeleteRoute: (id: string) => Promise<boolean>;
  onRetry: () => void;
  /** Screenshots and tests open the URL panel without creating anything. */
  initialShown?: ShownUrl | null;
};

/** The card itself, without the hooks: what each state looks like (tested and screenshotted with made-up data). */
export function AlertsPanel(props: PanelProps) {
  const { sources, loading, failed, manage, onRetry } = props;
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState<ShownUrl | null>(props.initialShown ?? null);
  const full = sources.length >= MAX_ALERT_SOURCES;
  return (
    <Card aria-labelledby="alerts-title">
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <CardTitle id="alerts-title" className="truncate">
            {say("title")}
          </CardTitle>
          {manage && !adding && !loading && !failed && !full ? (
            <Button variant="outline" onClick={() => setAdding(true)}>
              <PlusIcon aria-hidden />
              {say("add")}
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
            {shown ? (
              // Keyed by the URL: another source's URL is a new panel, not this one's "Copied".
              <UrlPanel key={shown.url} shown={shown} onDismiss={() => setShown(null)} />
            ) : null}
            {adding ? (
              <SourceForm
                onCancel={() => setAdding(false)}
                onCreate={async (source) => {
                  const url = await props.onCreate(source);
                  if (url === null) return false;
                  setAdding(false);
                  setShown({
                    url,
                    kind: source.kind,
                    name: source.name,
                    header: source.header?.name ?? null,
                    signed: source.signingSecret !== null,
                    rotated: false,
                  });
                  return true;
                }}
              />
            ) : null}
            <Sources {...props} onShown={setShown} />
            {manage && full ? (
              <p className="text-sm text-muted-foreground">
                {say("limit", { value: String(MAX_ALERT_SOURCES) })}
              </p>
            ) : null}
            {!manage ? <p className="text-sm text-muted-foreground">{say("manage_only")}</p> : null}
            <Routes {...props} />
            <Recent {...props} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Sources -----------------------------------------------------------------------------------------------------

function Sources(props: PanelProps & { onShown: (shown: ShownUrl) => void }) {
  const { sources } = props;
  if (sources.length === 0) {
    return (
      <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
        {say("sources_empty")}
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y rounded-md border">
      {sources.map((source) => (
        <SourceRow key={source.id} source={source} {...props} />
      ))}
    </ul>
  );
}

function SourceRow({
  source,
  recent,
  routes,
  policies,
  types,
  services,
  manage,
  locale,
  now,
  onRotate,
  onDelete,
  onSetMapping,
  onShown,
}: PanelProps & { source: AlertSourceRow; onShown: (shown: ShownUrl) => void }) {
  const [mode, setMode] = useState<"view" | "rotate" | "delete" | "map">("view");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<AlertsPart | null>(null);
  const nameId = useId();
  const meta = [
    source.lastReceivedAt === null
      ? say("never_received")
      : say("last_received", { value: formatAge(source.lastReceivedAt, now, locale) }),
    source.signed ? say("signed") : null,
    source.headerName ? say("header_checked", { name: source.headerName }) : null,
    source.mapping ? say("mapped") : null,
  ].filter((part): part is string => part !== null);
  return (
    <li className="flex flex-col gap-3 px-3 py-2.5">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span id={nameId} className="text-sm font-medium [overflow-wrap:anywhere]">
              {source.name}
            </span>
            <Badge variant="outline">{say(`kind_${source.kind}`)}</Badge>
          </span>
          <span className="text-xs text-muted-foreground">{meta.join(" · ")}</span>
        </div>
        {manage && mode === "view" ? (
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="ghost" aria-describedby={nameId} onClick={() => setMode("map")}>
              {say("mapping")}
            </Button>
            <Button
              variant="ghost"
              aria-describedby={nameId}
              onClick={() => {
                setFailed(null);
                setMode("rotate");
              }}
            >
              {say("rotate")}
            </Button>
            <Button
              variant="ghost"
              className="text-destructive"
              aria-describedby={nameId}
              onClick={() => {
                setFailed(null);
                setMode("delete");
              }}
            >
              {say("delete")}
            </Button>
          </div>
        ) : null}
      </div>
      {mode === "map" ? (
        <MappingForm
          source={source}
          routes={routes}
          catalog={{ policies, types, services }}
          latest={recent.find(
            (row) =>
              row.sourceId === source.id && row.reason !== "malformed" && row.reason !== "capacity",
          )}
          onCancel={() => setMode("view")}
          onSave={async (mapping) => {
            const ok = await onSetMapping(source.id, mapping);
            if (ok) setMode("view");
            return ok;
          }}
        />
      ) : mode !== "view" ? (
        <div className="flex flex-col gap-3 rounded-md bg-muted/50 p-3">
          <p className="text-sm [overflow-wrap:anywhere]">
            {mode === "rotate"
              ? say("rotate_confirm")
              : say("delete_confirm", { name: source.name })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={mode === "delete" ? "destructive" : "default"}
              className={mode === "delete" ? CONFIRM_DESTRUCTIVE : undefined}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                if (mode === "rotate") {
                  void onRotate(source.id).then((url) => {
                    setBusy(false);
                    if (url === null) return setFailed("rotate_failed");
                    setMode("view");
                    onShown({
                      url,
                      kind: source.kind,
                      name: source.name,
                      header: source.headerName,
                      signed: source.signed,
                      rotated: true,
                    });
                  });
                } else {
                  void onDelete(source.id).then((ok) => {
                    setBusy(false);
                    if (!ok) setFailed("delete_failed");
                  });
                }
              }}
            >
              {say(mode === "rotate" ? "rotate" : "delete")}
            </Button>
            <Button variant="outline" onClick={() => setMode("view")}>
              {say(mode === "rotate" ? "cancel" : "keep_source")}
            </Button>
          </div>
          {failed ? <FormError>{say(failed)}</FormError> : null}
        </div>
      ) : null}
    </li>
  );
}

type RuleDraft = { key: number; value: string; severity: AlertSeverity };

/**
 * A source's title template and severity map (RFC 0005 "Alert sources", "Mapping"), previewed on the latest alert it
 * sent as it was sent (`received`), so what the form says is what the next alert gets.
 */
function MappingForm({
  source,
  latest,
  routes,
  catalog,
  onSave,
  onCancel,
}: {
  source: AlertSourceRow;
  latest: SourceAlertRow | undefined;
  /** In the order they are tried, as `alertRoutes.all` sorts them. */
  routes: readonly AlertRouteRow[];
  catalog: Catalog;
  onSave: (mapping: AlertMapping | null) => Promise<boolean>;
  onCancel: () => void;
}) {
  const current = source.mapping ?? null;
  const [template, setTemplate] = useState(current?.titleTemplate ?? "");
  const [from, setFrom] = useState<SeverityField>(current?.severity?.from ?? "provider");
  const [label, setLabel] = useState(current?.severity?.label ?? "");
  const [rules, setRules] = useState<RuleDraft[]>(() =>
    (current?.severity?.rules ?? []).map((rule, key) => ({ key, ...rule })),
  );
  const nextKey = useRef(rules.length);
  const [fallback, setFallback] = useState<AlertSeverity | "">(current?.severity?.fallback ?? "");
  const [invalid, setInvalid] = useState<Record<string, AlertsPart>>({});
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const ids = { title: useId(), from: useId(), fallback: useId(), rules: useId() };
  const templateRef = useRef<HTMLInputElement>(null);

  const trimmed = template.trim();
  const parsed = trimmed === "" ? null : parseTemplate(trimmed);
  const filled = rules.filter((rule) => rule.value.trim() !== "");
  const severity: SeverityMapping | null =
    filled.length === 0 && fallback === ""
      ? null
      : {
          from,
          label: from === "label" ? label.trim().toLowerCase() || null : null,
          rules: filled.map(({ value, severity: to }) => ({ value: value.trim(), severity: to })),
          fallback: fallback === "" ? null : fallback,
        };
  // What the preview shows: the parts of the form that are valid now (a broken template previews the alert's own).
  const draft: AlertMapping = { titleTemplate: parsed?.ok ? trimmed : null, severity };
  const sent = latest
    ? (latest.received ?? {
        title: latest.title,
        severity: latest.severity,
        providerSeverity: null,
      })
    : undefined;
  const preview = sent
    ? applyMapping(draft, {
        dedupKey: latest!.dedupKey,
        title: sent.title,
        severity: sent.severity,
        status: "firing",
        link: null,
        labels: latest!.labels,
        ...(sent.providerSeverity !== null && { providerSeverity: sent.providerSeverity }),
      })
    : undefined;
  // Which route the mapped alert would take: a map that moves it onto a route that drops it silences the source.
  const picked = preview ? pickRoute(routes, source.id, preview, false) : undefined;
  const labelKeys = latest ? Object.keys(latest.labels).slice(0, 8) : [];

  const insert = (field: string) => {
    const input = templateRef.current;
    const start = input?.selectionStart ?? template.length;
    const end = input?.selectionEnd ?? template.length;
    const next = `${template.slice(0, start)}${field}${template.slice(end)}`;
    if (next.length > TITLE_TEMPLATE_MAX) return;
    setTemplate(next);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + field.length, start + field.length);
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problems: Record<string, AlertsPart> = {};
    if (parsed && !parsed.ok) problems.template = `template_${parsed.problem}`;
    if (severity && from === "label" && label.trim() === "") {
      problems.label = "severity_label_required";
    }
    const seen = new Set<string>();
    for (const rule of rules) {
      const value = rule.value.trim().toLowerCase();
      if (value === "") problems[`rule-${rule.key}`] = "rule_value_required";
      else if (seen.has(value)) problems[`rule-${rule.key}`] = "rule_duplicate";
      seen.add(value);
    }
    setInvalid(problems);
    if (Object.keys(problems).length > 0) return;
    setState("busy");
    const mapping = draft.titleTemplate === null && severity === null ? null : draft;
    void onSave(mapping).then((ok) => setState(ok ? "idle" : "failed"));
  };
  const error = (key: string) => {
    const part = invalid[key];
    return part ? say(part) : undefined;
  };
  const severityName = (value: AlertSeverity) => severityText(value);
  return (
    <form
      noValidate
      onSubmit={submit}
      aria-labelledby={ids.title}
      className="flex min-w-0 flex-col gap-4 rounded-md bg-muted/50 p-3"
    >
      <div className="flex flex-col gap-1">
        <p id={ids.title} className="text-sm font-medium [overflow-wrap:anywhere]">
          {say("mapping_title", { name: source.name })}
        </p>
        <p className="max-w-prose text-sm text-muted-foreground">{say("mapping_hint")}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <Field
          ref={templateRef}
          label={say("template_label")}
          hint={say("template_hint")}
          value={template}
          maxLength={TITLE_TEMPLATE_MAX}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          error={error("template")}
          onChange={(event) => setTemplate(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <span>{say("template_fields")}</span>
          {["{title}", "{severity}"].map((field) => (
            <FieldChip key={field} field={field} onInsert={insert} />
          ))}
          {labelKeys.length > 0 ? (
            labelKeys.map((key) => (
              <FieldChip key={key} field={`{labels.${key}}`} onInsert={insert} />
            ))
          ) : (
            <>
              <span>{say("template_any_label")}</span>
              <code className="rounded-sm bg-card px-1.5 py-0.5 font-mono text-xs">
                {"{labels.<key>}"}
              </code>
            </>
          )}
        </div>
      </div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={ids.from} className="text-sm font-medium">
            {say("severity_source")}
          </label>
          <select
            id={ids.from}
            className={SELECT}
            value={from}
            onChange={(event) => setFrom(event.target.value as SeverityField)}
          >
            <option value="provider">{say("severity_source_provider")}</option>
            <option value="label">{say("severity_source_label")}</option>
          </select>
        </div>
        {from === "label" ? (
          <Field
            label={say("severity_label_key")}
            value={label}
            maxLength={ALERT_LABEL_KEY_MAX}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            error={error("label")}
            onChange={(event) => setLabel(event.target.value)}
          />
        ) : null}
      </div>
      <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={ids.rules}>
        <legend className="mb-1.5 text-sm font-medium">{say("rules_title")}</legend>
        {rules.length === 0 ? (
          <p id={ids.rules} className="text-sm text-muted-foreground">
            {say("rules_empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rules.map((rule) => (
              <RuleRow
                key={rule.key}
                rule={rule}
                error={error(`rule-${rule.key}`)}
                severityName={severityName}
                onChange={(next) =>
                  setRules((list) => list.map((one) => (one.key === rule.key ? next : one)))
                }
                onRemove={() => setRules((list) => list.filter((one) => one.key !== rule.key))}
              />
            ))}
          </ul>
        )}
        {rules.length < MAX_SEVERITY_RULES ? (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() =>
              setRules((list) => [
                ...list,
                { key: nextKey.current++, value: "", severity: "critical" },
              ])
            }
          >
            <PlusIcon aria-hidden />
            {say("add_rule")}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            {say("rules_limit", { value: String(MAX_SEVERITY_RULES) })}
          </p>
        )}
      </fieldset>
      <div className="flex min-w-0 flex-col gap-1.5 sm:max-w-sm">
        <label htmlFor={ids.fallback} className="text-sm font-medium">
          {say("fallback_label")}
        </label>
        <select
          id={ids.fallback}
          className={SELECT}
          value={fallback}
          onChange={(event) => setFallback(event.target.value as AlertSeverity | "")}
        >
          <option value="">{say("fallback_keep")}</option>
          {ALERT_SEVERITIES.map((value) => (
            <option key={value} value={value}>
              {severityName(value)}
            </option>
          ))}
        </select>
      </div>
      <section className="flex min-w-0 flex-col gap-2 rounded-md border bg-card p-3 text-sm">
        <p className="font-medium">{say("preview_title")}</p>
        {sent && preview ? (
          <dl className="grid min-w-0 gap-x-3 gap-y-1.5 sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">{say("preview_sent")}</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere]">
              {sent.title}
              <span className="text-muted-foreground"> · {severityName(sent.severity)}</span>
              <span className="block text-xs text-muted-foreground">
                {sent.providerSeverity !== null
                  ? say("preview_sender_word", { value: sent.providerSeverity })
                  : say("preview_no_word")}
              </span>
            </dd>
            <dt className="text-muted-foreground">{say("preview_becomes")}</dt>
            <dd className="min-w-0 font-medium [overflow-wrap:anywhere]">
              {preview.title}
              <span className="font-normal text-muted-foreground">
                {" "}
                · {severityName(preview.severity)}
              </span>
            </dd>
            <dt className="text-muted-foreground">{say("preview_route")}</dt>
            <dd
              className={`min-w-0 [overflow-wrap:anywhere] ${picked?.action.kind === "drop" ? "text-destructive" : ""}`}
            >
              {picked?.route ? (
                <>
                  {picked.route.name}
                  <span className="block text-xs text-muted-foreground">
                    {actionText(picked.action, catalog)}
                  </span>
                </>
              ) : (
                say("preview_route_default")
              )}
            </dd>
          </dl>
        ) : (
          <p className="text-muted-foreground">{say("preview_empty")}</p>
        )}
      </section>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={state === "busy"}>
          {say(state === "busy" ? "saving" : "save")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {say("cancel")}
        </Button>
        {current ? (
          <Button
            type="button"
            variant="ghost"
            className="sm:ml-auto"
            disabled={state === "busy"}
            onClick={() => {
              setState("busy");
              void onSave(null).then((ok) => setState(ok ? "idle" : "failed"));
            }}
          >
            {say("mapping_reset")}
          </Button>
        ) : null}
      </div>
      {state === "failed" ? <FormError>{say("mapping_save_failed")}</FormError> : null}
    </form>
  );
}

/** A placeholder that, pressed, goes into the template where the cursor is. */
function FieldChip({ field, onInsert }: { field: string; onInsert: (field: string) => void }) {
  return (
    <button
      type="button"
      aria-label={say("template_insert", { name: field })}
      className="max-w-full rounded-sm bg-card px-1.5 py-0.5 font-mono text-xs text-foreground [overflow-wrap:anywhere] outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring"
      onClick={() => onInsert(field)}
    >
      {field}
    </button>
  );
}

function RuleRow({
  rule,
  error,
  severityName,
  onChange,
  onRemove,
}: {
  rule: RuleDraft;
  error: string | undefined;
  severityName: (value: AlertSeverity) => string;
  onChange: (rule: RuleDraft) => void;
  onRemove: () => void;
}) {
  const severityId = useId();
  return (
    <li className="grid min-w-0 grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[1fr_12rem_auto]">
      <Field
        className="col-span-2 sm:col-span-1"
        label={say("rule_value")}
        value={rule.value}
        maxLength={SEVERITY_VALUE_MAX}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        error={error}
        onChange={(event) => onChange({ ...rule, value: event.target.value })}
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={severityId} className="text-sm font-medium">
          {say("rule_severity")}
        </label>
        <select
          id={severityId}
          className={SELECT}
          value={rule.severity}
          onChange={(event) => onChange({ ...rule, severity: event.target.value as AlertSeverity })}
        >
          {ALERT_SEVERITIES.map((value) => (
            <option key={value} value={value}>
              {severityName(value)}
            </option>
          ))}
        </select>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 pointer-fine:size-9"
        aria-label={say("remove_rule", { name: rule.value.trim() || say("rule_value") })}
        onClick={onRemove}
      >
        <XIcon aria-hidden />
      </Button>
    </li>
  );
}

function SourceForm({
  onCreate,
  onCancel,
}: {
  onCreate: (source: NewSource) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AlertSourceKind>("grafana");
  const [headerName, setHeaderName] = useState("");
  const [headerValue, setHeaderValue] = useState("");
  const [secret, setSecret] = useState("");
  const [invalid, setInvalid] = useState<Record<string, AlertsPart>>({});
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const kindId = useId();
  const signs = signing(kind);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problems: Record<string, AlertsPart> = {};
    const trimmed = name.trim();
    if (trimmed === "") problems.name = "name_required";
    const header = headerName.trim();
    if (header !== "" && headerNameProblem(header)) problems.header = "header_invalid";
    if (header !== "" && headerValue === "") problems.headerValue = "header_value_required";
    const signingSecret = signs === "none" ? "" : secret.trim();
    if (signs === "required" && signingSecret === "") problems.secret = "secret_required";
    else if (signingSecret !== "" && !/^[\x21-\x7e]{8,256}$/.test(signingSecret)) {
      problems.secret = "secret_invalid";
    }
    setInvalid(problems);
    if (Object.keys(problems).length > 0) return;
    setState("busy");
    void onCreate({
      name: trimmed,
      kind,
      header: header === "" ? null : { name: header, value: headerValue },
      signingSecret: signingSecret === "" ? null : signingSecret,
    }).then((ok) => setState(ok ? "idle" : "failed"));
  };
  const error = (key: string) => {
    const part = invalid[key];
    return part ? say(part) : undefined;
  };
  return (
    <form
      noValidate
      onSubmit={submit}
      className="grid min-w-0 gap-4 rounded-md border p-3 sm:grid-cols-2 sm:p-4"
    >
      <Field
        label={say("name_label")}
        value={name}
        maxLength={ALERT_SOURCE_NAME_MAX}
        error={error("name")}
        autoFocus
        onChange={(event) => setName(event.target.value)}
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={kindId} className="text-sm font-medium">
          {say("kind_label")}
        </label>
        <select
          id={kindId}
          className={SELECT}
          value={kind}
          onChange={(event) => setKind(event.target.value as AlertSourceKind)}
        >
          {ALERT_SOURCE_KINDS.map((value) => (
            <option key={value} value={value}>
              {say(`kind_${value}`)}
            </option>
          ))}
        </select>
      </div>
      {signs !== "none" ? (
        <Field
          className="sm:col-span-2"
          type="password"
          autoComplete="off"
          label={say(kind === "sentry" ? "secret_label_sentry" : "secret_label_grafana")}
          hint={say(kind === "sentry" ? "secret_hint_sentry" : "secret_hint_grafana")}
          value={secret}
          error={error("secret")}
          onChange={(event) => setSecret(event.target.value)}
        />
      ) : null}
      <Field
        label={say("header_label")}
        hint={say("header_hint")}
        value={headerName}
        maxLength={64}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        error={error("header")}
        onChange={(event) => setHeaderName(event.target.value)}
      />
      <Field
        label={say("header_value_label")}
        type="password"
        autoComplete="off"
        value={headerValue}
        disabled={headerName.trim() === ""}
        error={error("headerValue")}
        onChange={(event) => setHeaderValue(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={state === "busy"}>
          {say(state === "busy" ? "creating" : "create")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {say("cancel")}
        </Button>
      </div>
      {state === "failed" ? (
        <div className="sm:col-span-2">
          <FormError>{say("create_failed")}</FormError>
        </div>
      ) : null}
    </form>
  );
}

/** What to paste where, per provider, under the URL. */
function Setup({ shown }: { shown: ShownUrl }) {
  const steps = [say(`setup_${shown.kind}`)];
  if (shown.kind === "grafana" && shown.signed) steps.push(say("setup_grafana_hmac"));
  if (shown.header) steps.push(say("setup_header", { name: shown.header }));
  const code =
    shown.kind === "datadog"
      ? DATADOG_PAYLOAD
      : shown.kind === "generic"
        ? genericExample(shown.url)
        : null;
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">{say("setup_title")}</p>
      {steps.map((step) => (
        <p key={step} className="max-w-prose text-muted-foreground">
          {step}
        </p>
      ))}
      {code ? (
        <pre className="overflow-x-auto rounded-md bg-card px-3 py-2 font-mono text-xs whitespace-pre-wrap [overflow-wrap:anywhere] select-all">
          {code}
        </pre>
      ) : null}
    </div>
  );
}

/** The URL, once: the shard keeps only its hash. Copy takes focus; closing before copying asks first. */
function UrlPanel({ shown, onDismiss }: { shown: ShownUrl; onDismiss: () => void }) {
  const textId = useId();
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);
  const copyRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => copyRef.current?.focus(), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown.url);
      setCopied(true);
      setAsking(false);
    } catch {
      // No clipboard (an insecure origin, a denied permission): select it for a manual copy.
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
      <div className="flex items-start gap-3">
        <p id={textId} className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">
          {shown.rotated ? say("url_rotated", { name: shown.name }) : say("url_once")}
        </p>
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
          value={shown.url}
          aria-labelledby={textId}
          onFocus={(event) => event.currentTarget.select()}
          className="field w-full min-w-0 px-3 font-mono focus-visible:ring-3 focus-visible:ring-ring sm:text-sm"
        />
        <Button ref={copyRef} onClick={() => void copy()}>
          {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          {say(copied ? "copied" : "copy")}
        </Button>
      </div>
      <span role="status" className="sr-only">
        {copied ? say("copied") : ""}
      </span>
      <Setup shown={shown} />
      {asking ? (
        <div className="flex flex-col gap-2 rounded-md bg-card p-3">
          <p className="font-medium">{say("close_prompt")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setAsking(false)}>
              {say("keep")}
            </Button>
            <Button variant="ghost" onClick={onDismiss}>
              {say("close")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---- Routes ------------------------------------------------------------------------------------------------------

const severityText = (severity: AlertSeverity) => say(`severity_${severity}`);

/**
 * A route's `sourceIds` from the editor's picks: no monitor and every source is the empty list, as before monitors;
 * with monitors, every source is said explicitly (`ROUTE_ALL_SOURCES`), so adding monitors never drops the sources.
 */
export function matchSourceIds(
  everySource: boolean,
  sources: readonly string[],
  monitors: readonly string[],
): string[] {
  if (everySource) return monitors.length > 0 ? [ROUTE_ALL_SOURCES, ...monitors] : [];
  return [...sources, ...monitors];
}

/** One line saying what a route matches. */
function matchText(
  match: RouteMatch,
  sources: readonly AlertSourceRow[],
  monitors: readonly MonitorRow[],
): string {
  const parts: string[] = [];
  if (match.sourceIds.length > 0) {
    parts.push(
      match.sourceIds
        .map((id) =>
          id === ROUTE_ALL_SOURCES
            ? say("every_source")
            : id === ROUTE_ALL_MONITORS
              ? say("every_monitor")
              : id.startsWith("mon_")
                ? (monitors.find((monitor) => monitor.id === id)?.name ?? say("deleted_monitor"))
                : (sources.find((source) => source.id === id)?.name ?? say("deleted_source")),
        )
        .join(", "),
    );
  }
  if (match.severities.length > 0) parts.push(match.severities.map(severityText).join(", "));
  if (match.labels.length > 0) parts.push(formatLabels(match.labels));
  return parts.length > 0 ? parts.join(" · ") : say("any_alert");
}

type Catalog = Pick<PanelProps, "policies" | "types" | "services">;

function actionText(action: RouteAction, catalog: Catalog): string {
  if (action.kind === "suppress" || action.kind === "drop") return say(`action_${action.kind}`);
  const severity = action.severity ? action.severity.toUpperCase() : say("severity_from_alert");
  const policy =
    action.policyId === null
      ? say("policy_default")
      : (catalog.policies.find((one) => one.id === action.policyId)?.name ?? say("policy_default"));
  const head =
    action.kind === "group" ? `${say("action_group")} (${action.groupBy})` : say("action_open");
  // A type or service deleted since is left out, as the declare leaves it out.
  const type = catalog.types.find((one) => one.id === action.typeId)?.name;
  const services = action.serviceIds
    .map((id) => catalog.services.find((one) => one.id === id)?.name)
    .filter((name): name is string => name !== undefined);
  return [head, severity, type, services.join(", ") || undefined, policy]
    .filter((part): part is string => part !== undefined)
    .join(" · ");
}

function Routes(props: PanelProps) {
  const { routes, manage, sources, monitors } = props;
  const [adding, setAdding] = useState(false);
  const full = routes.length >= MAX_ALERT_ROUTES;
  return (
    <section aria-labelledby="alert-routes-title" className="flex flex-col gap-3 border-t pt-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 id="alert-routes-title" className="text-sm font-semibold">
            {say("routes_title")}
          </h3>
          <p className="max-w-prose text-sm text-muted-foreground">{say("routes_hint")}</p>
        </div>
        {manage && !adding && !full ? (
          <Button variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden />
            {say("add_route")}
          </Button>
        ) : null}
      </div>
      {adding ? (
        <RouteForm
          route={null}
          sources={sources}
          monitors={monitors}
          catalog={props}
          onCancel={() => setAdding(false)}
          onSave={async (draft) => {
            const ok = await props.onCreateRoute(draft);
            if (ok) setAdding(false);
            return ok;
          }}
        />
      ) : null}
      <ol className="flex flex-col divide-y rounded-md border">
        {routes.map((route, index) => (
          <RouteRow key={route.id} route={route} index={index} {...props} />
        ))}
        <li className="flex flex-col gap-0.5 bg-muted/40 px-3 py-2.5">
          <span className="text-sm font-medium">{say("default_route")}</span>
          <span className="text-xs text-muted-foreground">{say("default_route_action")}</span>
        </li>
      </ol>
      {manage && full ? (
        <p className="text-sm text-muted-foreground">
          {say("route_limit", { value: String(MAX_ALERT_ROUTES) })}
        </p>
      ) : null}
    </section>
  );
}

function RouteRow({
  route,
  index,
  routes,
  sources,
  monitors,
  manage,
  onUpdateRoute,
  onMoveRoute,
  onDeleteRoute,
  ...props
}: PanelProps & { route: AlertRouteRow; index: number }) {
  const [editing, setEditing] = useState(false);
  const nameId = useId();
  if (editing) {
    return (
      <li className="p-3">
        <RouteForm
          route={route}
          sources={sources}
          monitors={monitors}
          catalog={props}
          onCancel={() => setEditing(false)}
          onDelete={async () => onDeleteRoute(route.id)}
          onSave={async (draft) => {
            const ok = await onUpdateRoute(route.id, draft);
            if (ok) setEditing(false);
            return ok;
          }}
        />
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={nameId} className="text-sm font-medium [overflow-wrap:anywhere]">
          {route.name}
        </span>
        <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {matchText(route.match, sources, monitors)}
        </span>
        <span className="text-xs [overflow-wrap:anywhere]">{actionText(route.action, props)}</span>
        {route.disabled ? (
          <span className="text-xs text-destructive [overflow-wrap:anywhere]">
            {say("route_disabled")}
          </span>
        ) : null}
      </div>
      {manage ? (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={say("move_up")}
            aria-describedby={nameId}
            disabled={index === 0}
            onClick={() => void onMoveRoute(route.id, index - 1)}
          >
            <ArrowUpIcon aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={say("move_down")}
            aria-describedby={nameId}
            disabled={index === routes.length - 1}
            onClick={() => void onMoveRoute(route.id, index + 1)}
          >
            <ArrowDownIcon aria-hidden />
          </Button>
          <Button variant="ghost" aria-describedby={nameId} onClick={() => setEditing(true)}>
            {say("edit")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

type ActionKind = RouteAction["kind"];

function RouteForm({
  route,
  sources,
  monitors,
  catalog,
  onSave,
  onCancel,
  onDelete,
}: {
  route: AlertRouteRow | null;
  sources: readonly AlertSourceRow[];
  monitors: readonly MonitorRow[];
  catalog: Catalog;
  onSave: (draft: RouteDraft) => Promise<boolean>;
  onCancel: () => void;
  onDelete?: () => Promise<boolean>;
}) {
  const action = route?.action;
  const [name, setName] = useState(route?.name ?? "");
  const saved = route?.match.sourceIds ?? [];
  // The route's sources and monitors are picked apart (`routeMatches`): every source is a choice of its own, so
  // naming monitors never changes which sources a route takes. An empty list (every route saved before monitors) is
  // every source.
  const [everySource, setEverySource] = useState(
    saved.includes(ROUTE_ALL_SOURCES) || saved.length === 0,
  );
  const [pickedSources, setPickedSources] = useState<string[]>(
    saved.filter((id) => id !== ROUTE_ALL_SOURCES && !namesMonitor(id)),
  );
  const [monitorIds, setMonitorIds] = useState<string[]>(saved.filter(namesMonitor));
  const [severities, setSeverities] = useState<AlertSeverity[]>(route?.match.severities ?? []);
  const [labels, setLabels] = useState(route ? formatLabels(route.match.labels) : "");
  const [kind, setKind] = useState<ActionKind>(action?.kind ?? "open");
  const [severity, setSeverity] = useState<Severity | "">(
    action && (action.kind === "open" || action.kind === "group") ? (action.severity ?? "") : "",
  );
  const [policyId, setPolicyId] = useState(
    action && (action.kind === "open" || action.kind === "group") ? (action.policyId ?? "") : "",
  );
  const [typeId, setTypeId] = useState(
    action && (action.kind === "open" || action.kind === "group") ? (action.typeId ?? "") : "",
  );
  const [serviceIds, setServiceIds] = useState<string[]>(
    action && (action.kind === "open" || action.kind === "group") ? action.serviceIds : [],
  );
  const [groupBy, setGroupBy] = useState(action?.kind === "group" ? action.groupBy : "");
  const [invalid, setInvalid] = useState<Record<string, AlertsPart>>({});
  const [state, setState] = useState<"idle" | "busy" | "failed" | "confirm">("idle");
  const ids = {
    action: useId(),
    severity: useId(),
    policy: useId(),
    type: useId(),
    sources: useId(),
    monitors: useId(),
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problems: Record<string, AlertsPart> = {};
    const parsed = parseLabels(labels);
    if (name.trim() === "") problems.name = "route_name_required";
    if (!parsed) problems.labels = "labels_invalid";
    if (kind === "group" && groupBy.trim() === "") problems.groupBy = "group_by_required";
    if (!everySource && pickedSources.length === 0 && monitorIds.length === 0) {
      problems.sources = "match_nothing";
    }
    setInvalid(problems);
    if (Object.keys(problems).length > 0 || !parsed) return;
    const paging = {
      severity: severity === "" ? null : severity,
      // A type deleted since the route was saved is dropped, as services are: the shard refuses a missing one.
      typeId: typeId !== "" && catalog.types.some((one) => one.id === typeId) ? typeId : null,
      // Services deleted since the route was saved are dropped when it is saved again.
      serviceIds: serviceIds.filter((id) => catalog.services.some((one) => one.id === id)),
      // Likewise a policy deleted while the form was open: the route falls back to the default policy.
      policyId:
        policyId !== "" && catalog.policies.some((one) => one.id === policyId) ? policyId : null,
    };
    const next: RouteAction =
      kind === "open"
        ? { kind, ...paging }
        : kind === "group"
          ? { kind, groupBy: groupBy.trim().toLowerCase(), ...paging }
          : { kind };
    setState("busy");
    void onSave({
      name: name.trim(),
      match: {
        sourceIds: matchSourceIds(everySource, pickedSources, monitorIds),
        severities,
        labels: parsed,
      },
      action: next,
    }).then((ok) => setState(ok ? "idle" : "failed"));
  };
  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((one) => one !== value) : [...list, value];
  const everyMonitor = monitorIds.includes(ROUTE_ALL_MONITORS);
  // A route that names monitors and no source takes no alert source at all (`routeMatches`).
  const monitorsOnly = !everySource && pickedSources.length === 0 && monitorIds.length > 0;
  // Monitors carry only the labels `monitor` and `kind`: grouping them by another puts them all in one incident.
  const groupKey = groupBy.trim().toLowerCase();
  const groupsMonitorsTogether =
    kind === "group" &&
    monitorIds.length > 0 &&
    groupKey !== "" &&
    groupKey !== "monitor" &&
    groupKey !== "kind";
  const error = (key: string) => {
    const part = invalid[key];
    return part ? say(part) : undefined;
  };
  const paging = kind === "open" || kind === "group";
  return (
    <form noValidate onSubmit={submit} className="grid min-w-0 gap-4 sm:grid-cols-2">
      <Field
        className="sm:col-span-2"
        label={say("route_name")}
        value={name}
        maxLength={ALERT_ROUTE_NAME_MAX}
        error={error("name")}
        autoFocus
        onChange={(event) => setName(event.target.value)}
      />
      <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={ids.sources}>
        <legend className="mb-1.5 text-sm font-medium">{say("match_sources")}</legend>
        <label className="flex min-h-6 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 shrink-0 accent-primary"
            checked={everySource}
            // Every source stands for the ones picked one by one: they are dropped, not kept hidden.
            onChange={() => {
              setEverySource(!everySource);
              setPickedSources([]);
            }}
          />
          {say("every_source")}
        </label>
        {everySource
          ? null
          : sources.map((source) => (
              <label key={source.id} className="flex min-h-6 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-primary"
                  checked={pickedSources.includes(source.id)}
                  onChange={() => setPickedSources((list) => toggle(list, source.id))}
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">{source.name}</span>
              </label>
            ))}
        {error("sources") ? (
          <p id={ids.sources} role="alert" className="text-sm text-destructive">
            {error("sources")}
          </p>
        ) : monitorsOnly ? (
          <p id={ids.sources} className="text-sm text-muted-foreground">
            {say("monitors_only")}
          </p>
        ) : null}
      </fieldset>
      <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={ids.monitors}>
        <legend className="mb-1.5 text-sm font-medium">{say("match_monitors")}</legend>
        <label className="flex min-h-6 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 shrink-0 accent-primary"
            checked={everyMonitor}
            onChange={() =>
              // Every monitor stands for the ones picked one by one: they are dropped, not kept hidden.
              setMonitorIds(everyMonitor ? [] : [ROUTE_ALL_MONITORS])
            }
          />
          {say("every_monitor")}
        </label>
        {everyMonitor || monitors.length === 0 ? null : (
          // A workspace may have 100 monitors (more where the operator allows): the list scrolls in place rather
          // than pushing the rest of the form away.
          <div className="-m-0.5 flex max-h-64 flex-col gap-2 overflow-y-auto p-0.5">
            {monitors.map((monitor) => (
              <label key={monitor.id} className="flex min-h-6 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-primary"
                  checked={monitorIds.includes(monitor.id)}
                  onChange={() => setMonitorIds((list) => toggle(list, monitor.id))}
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">{monitor.name}</span>
              </label>
            ))}
          </div>
        )}
        <p id={ids.monitors} className="text-sm text-muted-foreground">
          {monitors.length === 0 && !everyMonitor
            ? `${say("monitors_empty")} ${say("monitors_hint")}`
            : say("monitors_hint")}
        </p>
      </fieldset>
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">{say("match_severities")}</legend>
        {ALERT_SEVERITIES.map((value) => (
          <label key={value} className="flex min-h-6 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-primary"
              checked={severities.includes(value)}
              onChange={() => setSeverities((list) => toggle(list, value))}
            />
            {severityText(value)}
          </label>
        ))}
      </fieldset>
      <Field
        className="sm:col-span-2"
        label={say("match_labels")}
        hint={say("labels_hint")}
        value={labels}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        error={error("labels")}
        onChange={(event) => setLabels(event.target.value)}
      />
      <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
        <label htmlFor={ids.action} className="text-sm font-medium">
          {say("action_label")}
        </label>
        <select
          id={ids.action}
          className={SELECT}
          value={kind}
          onChange={(event) => setKind(event.target.value as ActionKind)}
        >
          {(["open", "group", "suppress", "drop"] as const).map((value) => (
            <option key={value} value={value}>
              {say(`action_${value}`)}
            </option>
          ))}
        </select>
      </div>
      {kind === "group" ? (
        <Field
          className="sm:col-span-2"
          label={say("group_by")}
          hint={say("group_by_hint")}
          value={groupBy}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          error={error("groupBy")}
          onChange={(event) => setGroupBy(event.target.value)}
        />
      ) : null}
      {groupsMonitorsTogether ? (
        // A warning, not an error: one incident for every monitor may be what the owner wants.
        <p
          role="status"
          className="text-sm text-muted-foreground [overflow-wrap:anywhere] sm:col-span-2"
        >
          {say("group_monitor_labels")}
        </p>
      ) : null}
      {paging ? (
        <>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={ids.severity} className="text-sm font-medium">
              {say("severity_label")}
            </label>
            <select
              id={ids.severity}
              className={SELECT}
              value={severity}
              onChange={(event) => setSeverity(event.target.value as Severity | "")}
            >
              <option value="">{say("severity_from_alert")}</option>
              {SEVERITIES.map((value) => (
                <option key={value} value={value}>
                  {value.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={ids.policy} className="text-sm font-medium">
              {say("policy_label")}
            </label>
            <select
              id={ids.policy}
              className={SELECT}
              value={policyId}
              onChange={(event) => setPolicyId(event.target.value)}
            >
              <option value="">{say("policy_default")}</option>
              {catalog.policies.map((policy) => (
                <option key={policy.id} value={policy.id}>
                  {policy.name}
                </option>
              ))}
            </select>
          </div>
          {catalog.types.length > 0 ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={ids.type} className="text-sm font-medium">
                {say("type_label")}
              </label>
              <select
                id={ids.type}
                className={SELECT}
                value={typeId}
                onChange={(event) => setTypeId(event.target.value)}
              >
                <option value="">{say("type_none")}</option>
                {catalog.types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {catalog.services.length > 0 ? (
            <fieldset className="flex min-w-0 flex-col gap-2 sm:col-span-2">
              <legend className="mb-1.5 text-sm font-medium">{say("services_label")}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {catalog.services.map((service) => (
                  <label key={service.id} className="flex min-h-6 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 accent-primary"
                      checked={serviceIds.includes(service.id)}
                      disabled={
                        !serviceIds.includes(service.id) &&
                        serviceIds.length >= MAX_INCIDENT_SERVICES
                      }
                      onChange={() => setServiceIds((list) => toggle(list, service.id))}
                    />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{service.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
        </>
      ) : null}
      {state === "confirm" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-3 sm:col-span-2">
          <Button
            type="button"
            variant="destructive"
            className={CONFIRM_DESTRUCTIVE}
            onClick={() => void onDelete?.().then((ok) => setState(ok ? "idle" : "failed"))}
          >
            {say("delete")}
          </Button>
          <Button type="button" variant="outline" onClick={() => setState("idle")}>
            {say("keep_source")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={state === "busy"}>
            {say(state === "busy" ? "saving" : "save")}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {say("cancel")}
          </Button>
          {onDelete ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive sm:ml-auto"
              onClick={() => setState("confirm")}
            >
              {say("delete")}
            </Button>
          ) : null}
        </div>
      )}
      {state === "failed" ? (
        <div className="sm:col-span-2">
          <FormError>{say("save_failed")}</FormError>
        </div>
      ) : null}
    </form>
  );
}

// ---- Recent alerts -----------------------------------------------------------------------------------------------

function Recent({ recent, sources, incidents, locale, now }: PanelProps) {
  const rows = recent.slice(0, RECENT_SHOWN);
  return (
    <section aria-labelledby="recent-alerts-title" className="flex flex-col gap-3 border-t pt-4">
      <h3 id="recent-alerts-title" className="text-sm font-semibold">
        {say("recent_title")}
      </h3>
      {rows.length === 0 ? (
        <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
          {say("recent_empty")}
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {rows.map((row) => (
            <RecentRow
              key={row.id}
              row={row}
              source={sources.find((source) => source.id === row.sourceId)}
              incident={incidents.find((incident) => incident.id === row.incidentId)}
              locale={locale}
              now={now}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentRow({
  row,
  source,
  incident,
  locale,
  now,
}: {
  row: SourceAlertRow;
  source: AlertSourceRow | undefined;
  incident: IncidentRow | undefined;
  locale: Locale;
  now: number;
}) {
  // The number kept on the alert names an incident that is over (`incidents.active` no longer holds it).
  const incidentNumber = incident?.number ?? row.incidentNumber ?? null;
  const number = formatIncidentNumber(incidentNumber);
  const target = number ?? say("an_incident");
  const outcome =
    row.outcome === "opened" || row.outcome === "grouped"
      ? say(`outcome_${row.outcome}`, { name: target })
      : say(`outcome_${row.outcome}`);
  const why =
    row.reason === "malformed"
      ? say("via_malformed")
      : row.reason === "capacity"
        ? say("via_capacity")
        : row.routeName !== null
          ? say("via_route", { name: row.routeName })
          : say("via_default");
  const meta = [
    source?.name ?? say("deleted_source"),
    formatAge(row.lastSeenAt, now, locale),
    row.repeats > 0 ? m.alerts_repeats({ count: row.repeats }) : null,
  ].filter((part): part is string => part !== null);
  return (
    <li className="flex flex-col gap-1 px-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <Badge variant={row.status === "firing" ? "sev2" : "resolved"}>
          {say(`status_${row.status}`)}
        </Badge>
        <span className="min-w-0 flex-1 text-sm font-medium [overflow-wrap:anywhere]">
          {row.title}
        </span>
        {row.link ? (
          <a
            href={row.link}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={say("source_link")}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
          >
            <ExternalLinkIcon aria-hidden className="size-3.5" />
          </a>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{meta.join(" · ")}</p>
      <p className="text-xs [overflow-wrap:anywhere]">
        {incidentNumber !== null ? (
          <Link
            to="/incidents/$number"
            params={{ number: String(incidentNumber) }}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {outcome}
          </Link>
        ) : (
          outcome
        )}
        <span className="text-muted-foreground"> · {why}</span>
      </p>
    </li>
  );
}
