import { formatDateTime, getLocale, m } from "@freecorps/brigade-i18n";
import { can, type StatusDomainRow, type StatusDomainState } from "@freecorps/brigade-schema";
import { useQuery } from "@freecorps/brigade-sync/react";
import { RotateCwIcon } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { CONFIRM_DESTRUCTIVE } from "@/components/monitor-form";
import { useMember } from "@/components/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Field, FormError } from "@/components/ui/field";
import {
  addDomain,
  checkDomain,
  loadDomainConfig,
  removeDomain,
  type DomainConfig,
  type DomainError,
} from "@/lib/status-domain";

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The card's text for `part` (packages/i18n `status_domain_card`). */
const say = (part: string, args: { name?: string; time?: string } = {}) =>
  m.status_domain_card({ part, name: args.name ?? "", time: args.time ?? "" });

const STATE_BADGE = {
  pending: "outline",
  active: "resolved",
  failed: "destructive",
} as const satisfies Record<StatusDomainState, string>;

/**
 * The status page's own domain (RFC 0012 "Custom domains"): shown only where the instance has Cloudflare for SaaS set
 * up. Owners and admins add one, see the DNS records to create and whether Cloudflare verified it, and remove it;
 * everyone else reads it.
 */
export function StatusDomainCard() {
  const { role, workspaceId } = useMember();
  const page = useQuery("statusPage.config", {});
  const domain = useQuery("statusDomain.get", {});
  const [config, setConfig] = useState<DomainConfig | null>(null);
  useEffect(() => {
    let live = true;
    void loadDomainConfig(workspaceId).then((value) => live && setConfig(value));
    return () => {
      live = false;
    };
  }, [workspaceId]);
  if (!config?.configured) return null;
  return (
    <StatusDomainPanel
      target={config.target}
      ready={page.rows.length > 0}
      loading={domain.status === "loading"}
      domain={domain.rows[0] ?? null}
      manage={can(role, "status:manage")}
      onAdd={(hostname) => addDomain(workspaceId, hostname)}
      onCheck={() => checkDomain(workspaceId)}
      onRemove={() => removeDomain(workspaceId)}
    />
  );
}

type Outcome = Promise<{ ok: true } | { ok: false; error: DomainError }>;

type PanelProps = {
  /** What owners point their CNAME at (the instance's fallback origin). */
  target: string;
  ready: boolean;
  loading: boolean;
  domain: StatusDomainRow | null;
  manage: boolean;
  onAdd: (hostname: string) => Outcome;
  onCheck: () => Outcome;
  onRemove: () => Outcome;
};

/** The card without the hooks (tested and screenshotted with made-up data). */
export function StatusDomainPanel(props: PanelProps) {
  const { ready, loading, domain, manage } = props;
  return (
    <Card aria-labelledby="status-domain-title">
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <CardTitle id="status-domain-title">{say("title")}</CardTitle>
        <p className="max-w-prose text-sm text-muted-foreground">{say("description")}</p>
      </div>
      <CardContent className="flex flex-col gap-4">
        {loading ? null : !ready ? (
          <p className="text-sm text-muted-foreground">{say("not_set_up")}</p>
        ) : domain ? (
          <Domain {...props} domain={domain} />
        ) : manage ? (
          <AddDomain {...props} />
        ) : (
          <p className="text-sm text-muted-foreground">{say("none")}</p>
        )}
        {!manage && ready ? <p className="text-sm text-muted-foreground">{say("viewer")}</p> : null}
      </CardContent>
    </Card>
  );
}

function AddDomain({ target, onAdd }: PanelProps) {
  const [hostname, setHostname] = useState("");
  const [state, setState] = useState<"idle" | "busy">("idle");
  const [error, setError] = useState<DomainError | "required" | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const typed = hostname.trim();
    if (!typed) {
      setError("required");
      return;
    }
    setState("busy");
    setError(null);
    void onAdd(typed).then((outcome) => {
      setState("idle");
      if (!outcome.ok) setError(outcome.error);
    });
  };
  return (
    <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-3">
      <Field
        label={say("hostname_label")}
        hint={say("hostname_hint", { name: target })}
        value={hostname}
        maxLength={253}
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        placeholder="status.example.com"
        error={error ? say(`error_${error}`) : undefined}
        onChange={(event) => setHostname(event.target.value)}
        className="[&_input]:font-mono"
      />
      <div>
        <Button type="submit" disabled={state === "busy"}>
          {say(state === "busy" ? "adding" : "add")}
        </Button>
      </div>
    </form>
  );
}

function Domain({ domain, manage, onCheck, onRemove }: PanelProps & { domain: StatusDomainRow }) {
  const [busy, setBusy] = useState<"check" | "remove" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<DomainError | null>(null);
  const titleId = useId();
  const act = (which: "check" | "remove", work: () => Outcome) => {
    setBusy(which);
    setError(null);
    void work().then((outcome) => {
      setBusy(null);
      setConfirming(false);
      if (!outcome.ok) setError(outcome.error);
    });
  };
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <span
          id={titleId}
          className="min-w-0 font-mono text-sm font-medium [overflow-wrap:anywhere]"
        >
          {domain.hostname}
        </span>
        <Badge variant={STATE_BADGE[domain.state]}>{say(`state_${domain.state}`)}</Badge>
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">{say(`explain_${domain.state}`)}</p>
      {domain.error && domain.state !== "active" ? (
        <p className="text-sm [overflow-wrap:anywhere]">{domain.error}</p>
      ) : null}
      {domain.state !== "active" && domain.records.length > 0 ? (
        <section aria-labelledby={`${titleId}-records`} className="flex min-w-0 flex-col gap-2">
          <h3 id={`${titleId}-records`} className="text-sm font-semibold">
            {say("records_title")}
          </h3>
          <ul className="flex flex-col divide-y rounded-md border">
            {domain.records.map((record) => (
              <li key={`${record.type}:${record.name}`} className="flex flex-col gap-1.5 px-3 py-3">
                <Badge variant="secondary">{record.type}</Badge>
                <dl className="grid min-w-0 gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
                  <dt className="text-muted-foreground">{say("record_name")}</dt>
                  <dd className="min-w-0 font-mono select-all [overflow-wrap:anywhere]">
                    {record.name}
                  </dd>
                  <dt className="text-muted-foreground">{say("record_value")}</dt>
                  <dd className="min-w-0 font-mono select-all [overflow-wrap:anywhere]">
                    {record.value}
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="text-sm text-muted-foreground tabular-nums">
        {say("checked", { time: formatDateTime(domain.checkedAt, getLocale(), TIME_ZONE) })}
      </p>
      {manage ? (
        confirming ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm [overflow-wrap:anywhere]">
              {say("remove_confirm", { name: domain.hostname })}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="destructive"
                className={CONFIRM_DESTRUCTIVE}
                disabled={busy !== null}
                onClick={() => act("remove", onRemove)}
              >
                {say(busy === "remove" ? "removing" : "remove")}
              </Button>
              <Button variant="outline" onClick={() => setConfirming(false)}>
                {say("keep")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {domain.state !== "active" ? (
              <Button
                variant="outline"
                disabled={busy !== null}
                aria-describedby={titleId}
                onClick={() => act("check", onCheck)}
              >
                <RotateCwIcon aria-hidden />
                {say(busy === "check" ? "checking" : "check")}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              className="text-destructive"
              aria-describedby={titleId}
              onClick={() => setConfirming(true)}
            >
              {say("remove")}
            </Button>
          </div>
        )
      ) : null}
      {error ? <FormError>{say(`error_${error}`)}</FormError> : null}
    </div>
  );
}
