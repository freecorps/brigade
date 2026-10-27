import {
  can,
  componentsForServices,
  COMPONENT_STATUSES,
  PUBLIC_STATUSES,
  PUBLIC_TITLE_MAX,
  UPDATE_BODY_MAX,
  type ComponentStatus,
  type PublicStatus,
  type StatusComponentRow,
  type StatusIncidentRow,
} from "@freecorps/brigade-schema";
import { formatDateTime, getLocale } from "@freecorps/brigade-i18n";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { GlobeIcon, LoaderCircleIcon, RotateCwIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { useMember } from "@/components/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Field, FormError } from "@/components/ui/field";
import { statusCardText as say, statusText } from "@/lib/status-page";

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const SELECT =
  "h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring";

/** Public statuses wear the incident statuses' colours they correspond to. */
const PUBLIC_BADGE = {
  investigating: "investigating",
  identified: "fixing",
  monitoring: "monitoring",
  resolved: "resolved",
} as const satisfies Record<PublicStatus, string>;

export function PublicStatusBadge({ status }: { status: PublicStatus }) {
  return <Badge variant={PUBLIC_BADGE[status]}>{statusText(`public_${status}`)}</Badge>;
}

export type PublishArgs = {
  id: string;
  title: string;
  status: PublicStatus;
  impact: ComponentStatus;
  componentIds: string[];
  body: string;
};

/** A change to what is already on the page (RFC 0012 "Corrections"). */
export type Correction =
  | { kind: "edit"; updateId: string; body: string }
  | { kind: "remove"; updateId: string }
  | { kind: "withdraw" };

/**
 * What the status page says about this incident, a form to publish an update to it (RFC 0012 "Publishing"), and
 * corrections to what was published. Only what is written here reaches the public; the incident's title and timeline
 * never do.
 */
export function StatusPublishCard({
  incidentId,
  serviceIds = [],
}: {
  incidentId: string;
  /** The incident's services: their components start ticked on a first publish (RFC 0012 "Services"). */
  serviceIds?: readonly string[];
}) {
  // A new attempt remounts the queries, as the dashboard's Status page card does.
  const [attempt, setAttempt] = useState(0);
  return (
    <StatusPublishLive
      key={attempt}
      incidentId={incidentId}
      serviceIds={serviceIds}
      onRetry={() => setAttempt((count) => count + 1)}
    />
  );
}

function StatusPublishLive({
  incidentId,
  serviceIds,
  onRetry,
}: {
  incidentId: string;
  serviceIds: readonly string[];
  onRetry: () => void;
}) {
  const { role } = useMember();
  const page = useQuery("statusPage.config", {});
  const components = useQuery("statusComponents.all", {});
  const published = useQuery("statusIncident.byId", { id: incidentId });
  const publish = useMutation("incident.publishUpdate");
  const edit = useMutation("incident.editPublishedUpdate");
  const remove = useMutation("incident.removePublishedUpdate");
  const withdraw = useMutation("incident.unpublish");
  const feeds = [page, components, published];
  if (feeds.some((feed) => feed.status === "error")) {
    return (
      <Card aria-labelledby="status-publish-title">
        <CardTitle id="status-publish-title" className="flex items-center gap-2 px-4 sm:px-6">
          <GlobeIcon aria-hidden className="size-4 text-muted-foreground" />
          {say("publish_title")}
        </CardTitle>
        <CardContent className="flex flex-col items-start gap-2">
          <FormError>{say("load_failed")}</FormError>
          <Button variant="outline" onClick={onRetry}>
            <RotateCwIcon aria-hidden />
            {say("retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }
  // All three before the form can open: it starts from what was published and the components it touched, and a
  // publish from a half-loaded form would clear them.
  if (feeds.some((feed) => feed.status !== "ready")) return null;
  return (
    <StatusPublishPanel
      incidentId={incidentId}
      serviceIds={serviceIds}
      configured={page.rows.length > 0}
      components={components.rows}
      published={published.rows[0] ?? null}
      allowed={can(role, "status:publish")}
      onPublish={async (args) => (await publish(args)).ok}
      onCorrect={async (correction) => {
        const id = incidentId;
        if (correction.kind === "edit") {
          return (await edit({ id, updateId: correction.updateId, body: correction.body })).ok;
        }
        if (correction.kind === "remove") {
          return (await remove({ id, updateId: correction.updateId })).ok;
        }
        return (await withdraw({ id })).ok;
      }}
    />
  );
}

type PanelProps = {
  incidentId: string;
  /** The incident's services, for the components a first publish starts with. */
  serviceIds?: readonly string[];
  configured: boolean;
  components: readonly StatusComponentRow[];
  published: StatusIncidentRow | null;
  allowed: boolean;
  /** Resolves true once the shard took it (optimistic until then). */
  onPublish: (args: PublishArgs) => Promise<boolean>;
  /** Likewise, for a correction to what is already published. */
  onCorrect: (correction: Correction) => Promise<boolean>;
};

type Notice = "published" | "corrected" | "withdrawn";

/** The card without the hooks (tested and screenshotted with made-up data). */
export function StatusPublishPanel(props: PanelProps) {
  const { configured, published, allowed } = props;
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  return (
    <Card aria-labelledby="status-publish-title">
      <CardTitle id="status-publish-title" className="flex items-center gap-2 px-4 sm:px-6">
        <GlobeIcon aria-hidden className="size-4 text-muted-foreground" />
        {say("publish_title")}
      </CardTitle>
      <CardContent className="flex flex-col gap-3">
        {!configured ? (
          <p className="text-sm text-muted-foreground">{say("publish_not_set_up")}</p>
        ) : (
          <>
            {published ? (
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="text-sm font-medium [overflow-wrap:anywhere]">{published.title}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <PublicStatusBadge status={published.status} />
                  <span className="text-xs text-muted-foreground">
                    {statusText(`component_${published.impact}`)}
                  </span>
                </div>
                <PublishedUpdates
                  published={published}
                  allowed={allowed && !open}
                  onCorrect={props.onCorrect}
                  onDone={(done) => setNotice(done)}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{say("publish_none")}</p>
            )}
            <span role="status" className="text-sm text-muted-foreground">
              {notice && !open ? say(notice) : ""}
            </span>
            {!allowed ? (
              <p className="text-sm text-muted-foreground">{say("publish_viewer")}</p>
            ) : open ? (
              <PublishForm
                {...props}
                onDone={() => {
                  setNotice("published");
                  setOpen(false);
                }}
                onCancel={() => setOpen(false)}
              />
            ) : (
              <div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setNotice(null);
                    setOpen(true);
                  }}
                >
                  {say("publish_open")}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The updates on the page now, newest first, each correctable: its text edited, or removed while another is left;
 * and the whole incident taken off the page. Removing asks first and says how long caches may still show it.
 */
function PublishedUpdates({
  published,
  allowed,
  onCorrect,
  onDone,
}: {
  published: StatusIncidentRow;
  allowed: boolean;
  onCorrect: PanelProps["onCorrect"];
  onDone: (notice: Notice) => void;
}) {
  const [mode, setMode] = useState<
    { kind: "edit"; id: string } | { kind: "remove"; id: string } | { kind: "withdraw" } | null
  >(null);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const updates = [...published.updates].sort((a, b) => b.at - a.at);
  const locale = getLocale();

  const run = (correction: Correction) => {
    setState("busy");
    void onCorrect(correction).then((ok) => {
      if (!ok) return setState("failed");
      setState("idle");
      setMode(null);
      onDone(correction.kind === "withdraw" ? "withdrawn" : "corrected");
    });
  };
  const cancel = () => {
    setMode(null);
    setState("idle");
  };
  const busy = state === "busy";
  const failed = state === "failed" ? <FormError>{say("correct_failed")}</FormError> : null;

  return (
    <div className="mt-2 flex min-w-0 flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">{say("published_updates")}</p>
      <ul className="flex min-w-0 flex-col divide-y rounded-md border">
        {updates.map((update) => {
          const time = formatDateTime(update.at, locale, TIME_ZONE);
          if (mode?.kind === "edit" && mode.id === update.id) {
            return (
              <li key={update.id} className="px-3 py-3">
                <form
                  noValidate
                  className="flex min-w-0 flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const body = draft.trim();
                    if (body === "" || body.length > UPDATE_BODY_MAX) return setInvalid(true);
                    run({ kind: "edit", updateId: update.id, body });
                  }}
                >
                  <textarea
                    aria-label={say("update_edit_label", { name: time })}
                    value={draft}
                    rows={3}
                    aria-invalid={invalid || undefined}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setInvalid(false);
                    }}
                    // 16px: iOS zooms into smaller inputs.
                    className="field-sizing-content max-h-80 min-h-24 w-full min-w-0 resize-y rounded-md border border-input bg-card px-3 py-2.5 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring aria-invalid:border-destructive"
                  />
                  {invalid ? <FormError>{say("public_body_required")}</FormError> : null}
                  <p className="text-xs text-muted-foreground">{say("cache_window")}</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="submit" disabled={busy}>
                      {busy ? (
                        <LoaderCircleIcon
                          aria-hidden
                          className="animate-spin motion-reduce:animate-none"
                        />
                      ) : null}
                      {say(busy ? "saving" : "save")}
                    </Button>
                    <Button type="button" variant="outline" onClick={cancel}>
                      {say("cancel")}
                    </Button>
                  </div>
                  {failed}
                </form>
              </li>
            );
          }
          if (mode?.kind === "remove" && mode.id === update.id) {
            return (
              <li key={update.id} className="flex flex-col gap-3 px-3 py-3">
                <p className="text-sm">{say("update_remove_confirm")}</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() => run({ kind: "remove", updateId: update.id })}
                  >
                    {say("remove")}
                  </Button>
                  <Button variant="outline" onClick={cancel}>
                    {say("keep")}
                  </Button>
                </div>
                {failed}
              </li>
            );
          }
          return (
            <li key={update.id} className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <PublicStatusBadge status={update.status} />
                <time
                  className="text-xs text-muted-foreground tabular-nums"
                  dateTime={new Date(update.at).toISOString()}
                >
                  {time}
                </time>
              </div>
              <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{update.body}</p>
              {allowed && mode === null ? (
                <div className="flex flex-wrap gap-1">
                  <Button
                    variant="ghost"
                    aria-label={say("update_edit_label", { name: time })}
                    onClick={() => {
                      setDraft(update.body);
                      setInvalid(false);
                      setState("idle");
                      setMode({ kind: "edit", id: update.id });
                    }}
                  >
                    {say("edit")}
                  </Button>
                  {updates.length > 1 ? (
                    <Button
                      variant="ghost"
                      aria-label={say("update_remove_label", { name: time })}
                      onClick={() => {
                        setState("idle");
                        setMode({ kind: "remove", id: update.id });
                      }}
                    >
                      {say("remove")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {allowed && mode?.kind === "withdraw" ? (
        <div className="flex flex-col gap-3 rounded-md border border-destructive/40 px-3 py-3">
          <p className="text-sm">{say("withdraw_confirm")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="destructive" disabled={busy} onClick={() => run({ kind: "withdraw" })}>
              {say("withdraw")}
            </Button>
            <Button variant="outline" onClick={cancel}>
              {say("keep")}
            </Button>
          </div>
          {failed}
        </div>
      ) : allowed && mode === null ? (
        <div>
          <Button
            variant="ghost"
            className="text-destructive"
            onClick={() => {
              setState("idle");
              setMode({ kind: "withdraw" });
            }}
          >
            {say("withdraw")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PublishForm({
  incidentId,
  serviceIds = [],
  components,
  published,
  onPublish,
  onDone,
  onCancel,
}: PanelProps & { onDone: () => void; onCancel: () => void }) {
  // The public title starts from what the public was told, never from the incident's internal title.
  const [title, setTitle] = useState(published?.title ?? "");
  const [status, setStatus] = useState<PublicStatus>(published?.status ?? "investigating");
  const [impact, setImpact] = useState<ComponentStatus>(published?.impact ?? "degraded");
  // A first publish starts with the components the incident's services stand for: a suggestion, ticked and shown as
  // such, never published without the person pressing Publish. Later ones start from what the page says.
  const [suggested] = useState(() =>
    published ? [] : componentsForServices(components, serviceIds),
  );
  const [chosen, setChosen] = useState<string[]>(published?.componentIds ?? suggested);
  const [body, setBody] = useState("");
  const [invalid, setInvalid] = useState<{ title?: boolean; body?: boolean }>({});
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const statusId = useId();
  const impactId = useId();
  const bodyId = useId();
  const hintId = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const args: PublishArgs = {
      id: incidentId,
      title: title.trim(),
      status,
      impact,
      componentIds: components.filter((row) => chosen.includes(row.id)).map((row) => row.id),
      body: body.trim(),
    };
    const problems = {
      title: args.title === "" || args.title.length > PUBLIC_TITLE_MAX,
      body: args.body === "" || args.body.length > UPDATE_BODY_MAX,
    };
    setInvalid(problems);
    if (problems.title || problems.body) return;
    setState("busy");
    void onPublish(args).then((ok) => {
      if (!ok) return setState("failed");
      setState("idle");
      onDone();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4 border-t pt-4">
      <p id={hintId} className="text-sm text-muted-foreground">
        {say("publish_hint")}
      </p>
      <Field
        label={say("public_title")}
        value={title}
        maxLength={PUBLIC_TITLE_MAX}
        error={invalid.title ? say("public_title_required") : undefined}
        onChange={(event) => {
          setTitle(event.target.value);
          setInvalid((current) => ({ ...current, title: false }));
        }}
      />
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 md:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={statusId} className="text-sm font-medium">
            {say("public_status")}
          </label>
          <select
            id={statusId}
            className={SELECT}
            value={status}
            onChange={(event) => setStatus(event.target.value as PublicStatus)}
          >
            {PUBLIC_STATUSES.map((value) => (
              <option key={value} value={value}>
                {statusText(`public_${value}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={impactId} className="text-sm font-medium">
            {say("public_impact")}
          </label>
          <select
            id={impactId}
            className={SELECT}
            value={impact}
            onChange={(event) => setImpact(event.target.value as ComponentStatus)}
          >
            {COMPONENT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value === "operational"
                  ? say("impact_operational")
                  : statusText(`component_${value}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {components.length > 0 ? (
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1.5 text-sm font-medium">{say("public_components")}</legend>
          {suggested.length > 0 ? (
            <p className="mb-1 text-sm text-muted-foreground">{say("preselected")}</p>
          ) : null}
          {components.map((row) => (
            <label key={row.id} className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-primary"
                checked={chosen.includes(row.id)}
                onChange={(event) =>
                  setChosen((current) =>
                    event.target.checked
                      ? [...current, row.id]
                      : current.filter((id) => id !== row.id),
                  )
                }
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {row.group ? `${row.group} · ${row.name}` : row.name}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={bodyId} className="text-sm font-medium">
          {say("public_body")}
        </label>
        <textarea
          id={bodyId}
          value={body}
          rows={4}
          aria-invalid={invalid.body || undefined}
          aria-describedby={hintId}
          onChange={(event) => {
            setBody(event.target.value);
            setInvalid((current) => ({ ...current, body: false }));
          }}
          // 16px: iOS zooms into smaller inputs.
          className="field-sizing-content max-h-80 min-h-28 w-full min-w-0 resize-y rounded-md border border-input bg-card px-3 py-2.5 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring aria-invalid:border-destructive"
        />
        {invalid.body ? <FormError>{say("public_body_required")}</FormError> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={state === "busy"}>
          {state === "busy" ? (
            <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
          ) : null}
          {say(state === "busy" ? "publishing" : "publish")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {say("cancel")}
        </Button>
      </div>
      {state === "failed" ? <FormError>{say("publish_failed")}</FormError> : null}
    </form>
  );
}
