import {
  can,
  COMPONENT_STATUSES,
  PUBLIC_STATUSES,
  PUBLIC_TITLE_MAX,
  UPDATE_BODY_MAX,
  type ComponentStatus,
  type PublicStatus,
  type StatusComponentRow,
  type StatusIncidentRow,
} from "@freecorps/brigade-schema";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { GlobeIcon, LoaderCircleIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { useMember } from "@/components/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Field, FormError } from "@/components/ui/field";
import { statusCardText as say, statusText } from "@/lib/status-page";

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

/**
 * What the status page says about this incident, and a form to publish an update to it (RFC 0012 "Publishing").
 * Only what is written here reaches the public; the incident's title and timeline never do.
 */
export function StatusPublishCard({ incidentId }: { incidentId: string }) {
  const { role } = useMember();
  const page = useQuery("statusPage.config", {});
  const components = useQuery("statusComponents.all", {});
  const published = useQuery("statusIncident.byId", { id: incidentId });
  const publish = useMutation("incident.publishUpdate");
  if (page.status !== "ready") return null;
  return (
    <StatusPublishPanel
      incidentId={incidentId}
      configured={page.rows.length > 0}
      components={components.rows}
      published={published.rows[0] ?? null}
      allowed={can(role, "status:publish")}
      onPublish={async (args) => (await publish(args)).ok}
    />
  );
}

type PanelProps = {
  incidentId: string;
  configured: boolean;
  components: readonly StatusComponentRow[];
  published: StatusIncidentRow | null;
  allowed: boolean;
  /** Resolves true once the shard took it (optimistic until then). */
  onPublish: (args: PublishArgs) => Promise<boolean>;
};

/** The card without the hooks (tested and screenshotted with made-up data). */
export function StatusPublishPanel(props: PanelProps) {
  const { configured, published, allowed } = props;
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
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
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{say("publish_none")}</p>
            )}
            <span role="status" className="text-sm text-muted-foreground">
              {done && !open ? say("published") : ""}
            </span>
            {!allowed ? (
              <p className="text-sm text-muted-foreground">{say("publish_viewer")}</p>
            ) : open ? (
              <PublishForm
                {...props}
                onDone={() => {
                  setDone(true);
                  setOpen(false);
                }}
                onCancel={() => setOpen(false)}
              />
            ) : (
              <div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDone(false);
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

function PublishForm({
  incidentId,
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
  const [chosen, setChosen] = useState<string[]>(published?.componentIds ?? []);
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
