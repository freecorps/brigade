import { m } from "@freecorps/brigade-i18n";
import { can, formatIncidentNumber, type ServiceRow } from "@freecorps/brigade-schema";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { cn } from "cn";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  CalendarClockIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  PencilIcon,
  TriangleAlertIcon,
  UserRoundIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Page } from "@/components/app-shell";
import { SeverityBadge, StatusBadge } from "@/components/incident-badges";
import { usePreferences } from "@/components/preferences";
import { naming, Refusal, ServiceForm, TierBadge } from "@/components/services-card";
import { useMember } from "@/components/session";
import { Button } from "@/components/ui/button";
import { Card, CARD_X, CardContent, CardHeader, CardList } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import {
  catalogRefusal,
  catalogText,
  checkService,
  draftFromService,
  ownerLabel,
} from "@/lib/catalog";
import { escalationText, onCallNow } from "@/lib/escalation";
import { queryErrorReason } from "@/lib/incidents";
import { memberLabel } from "@/lib/oncall";
import { usePageTitle } from "@/lib/page-title";

/** `svc_<ULID>` from the path, or nothing. */
export function parseServiceId(raw: string): string | null {
  return /^svc_[0-9A-HJKMNP-TV-Z]{26}$/.test(raw) ? raw : null;
}

/**
 * One service (RFC 0003 "Service catalog"): what it is, how critical, who owns it (and who of them is on call now),
 * its escalation policy, and the active incidents that name it. Owners and admins edit and delete it here.
 */
export function ServicePage({ id }: { id: string | null }) {
  usePreferences();
  const services = useQuery("services.all", {});
  const navigate = useNavigate();
  // Kept here, not in `Service`: a delete takes the row out at once, and a refusal brings it back to say why.
  const [refused, setRefused] = useState<string | null>(null);
  const row = id ? services.rows.find((one) => one.id === id) : undefined;
  if (row) {
    return (
      <Service
        row={row}
        refused={refused}
        onRefused={setRefused}
        onDeleted={() => void navigate({ to: "/" })}
      />
    );
  }
  if (services.status === "error") {
    return (
      <Problem
        title={catalogText("not_found_title")}
        text={queryErrorReason(services.error?.code)}
      />
    );
  }
  if (services.status === "ready" || id === null) {
    return <Problem title={catalogText("not_found_title")} text={catalogText("not_found")} />;
  }
  return (
    <Shell>
      <p role="status" className="flex items-center gap-3 text-sm text-muted-foreground">
        <LoaderCircleIcon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
        {catalogText("loading")}
      </p>
    </Shell>
  );
}

/** The page at every section's width; the top bar's section name is the way back to the list. */
function Shell({ children }: { children: React.ReactNode }) {
  return <Page>{children}</Page>;
}

function Problem({ title, text }: { title: string; text: string }) {
  usePageTitle(title);
  return (
    <Shell>
      <h1 className="text-2xl font-semibold text-balance">{title}</h1>
      <p className="flex items-start gap-3 rounded-md bg-muted p-4 text-sm font-medium">
        <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        {text}
      </p>
    </Shell>
  );
}

function Service({
  row,
  refused,
  onRefused: setRefused,
  onDeleted,
}: {
  row: ServiceRow;
  /** Why the last change was refused, if it was. */
  refused: string | null;
  onRefused: (text: string | null) => void;
  /** The shard deleted it: leave the page. */
  onDeleted: () => void;
}) {
  usePageTitle(row.name);
  const { role } = useMember();
  const manage = can(role, "catalog:manage");
  const incidents = useQuery("incidents.active", {});
  const schedules = useQuery("schedules.all", {});
  const overrides = useQuery("overrides.all", {});
  const members = useQuery("members.all", {});
  const policies = useQuery("escalationPolicies.all", {});
  const update = useMutation("service.update");
  const remove = useMutation("service.delete");
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const now = useNow(30_000);
  const policy = row.escalationPolicyId
    ? policies.rows.find((one) => one.id === row.escalationPolicyId)
    : undefined;
  const active = naming(incidents.rows, row.id);
  const stopEditing = () => {
    setEditing(false);
    requestAnimationFrame(() => editRef.current?.focus());
  };

  return (
    <Shell>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-2">
          <h1 className="text-2xl font-semibold text-balance [overflow-wrap:anywhere]">
            {row.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <TierBadge tier={row.tier} />
          </div>
        </div>
        {manage && !editing ? (
          <Button
            ref={editRef}
            variant="outline"
            aria-label={m.catalog_action_on({ action: "edit", name: row.name })}
            onClick={() => {
              setRefused(null);
              setEditing(true);
            }}
          >
            <PencilIcon aria-hidden />
            {m.catalog_action({ action: "edit" })}
          </Button>
        ) : null}
      </header>
      {refused ? <Refusal text={refused} onDismiss={() => setRefused(null)} /> : null}

      {editing ? (
        <ServiceForm
          initial={draftFromService(row)}
          editing={row}
          schedules={schedules.rows}
          members={members.rows}
          policies={policies.rows}
          loaded={schedules.status === "ready" && members.status === "ready"}
          onCancel={stopEditing}
          onDelete={() => {
            setRefused(null);
            // Leaves only once the shard has deleted it; a refusal brings the row back and says why.
            void remove({ id: row.id }).then((outcome) => {
              if (outcome.ok) onDeleted();
              else setRefused(catalogRefusal(row.name, outcome.error.code));
            });
          }}
          onSubmit={(draft) => {
            const checked = checkService(row.id, draft);
            if (!checked.ok) return checked;
            setRefused(null);
            void update(checked.args).then((outcome) => {
              if (!outcome.ok) setRefused(catalogRefusal(checked.args.name, outcome.error.code));
            });
            stopEditing();
            return checked;
          }}
        />
      ) : (
        <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_--spacing(80)]">
          <Card aria-labelledby="service-incidents">
            <CardHeader id="service-incidents" title={catalogText("active_incidents")} />
            {active.length === 0 ? (
              incidents.status === "ready" ? (
                <CardContent>
                  <Empty>{catalogText("active_none")}</Empty>
                </CardContent>
              ) : null
            ) : (
              <CardList>
                {active.map((incident) => (
                  <li key={incident.id} className={cn("flex flex-col gap-1.5 py-3", CARD_X)}>
                    {incident.number === null ? (
                      <span className="font-medium [overflow-wrap:anywhere]">{incident.title}</span>
                    ) : (
                      <Link
                        to="/incidents/$number"
                        params={{ number: String(incident.number) }}
                        className="font-medium [overflow-wrap:anywhere] hover:underline focus-visible:underline focus-visible:outline-none"
                      >
                        <span className="text-muted-foreground tabular-nums">
                          {formatIncidentNumber(incident.number)}
                        </span>{" "}
                        {incident.title}
                      </Link>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      <SeverityBadge severity={incident.severity} />
                      <StatusBadge status={incident.status} />
                    </div>
                  </li>
                ))}
              </CardList>
            )}
          </Card>

          <div className="flex min-w-0 flex-col gap-6 max-md:order-first">
            <Card aria-labelledby="service-about">
              <h2 id="service-about" className="sr-only">
                {catalogText("description")}
              </h2>
              <CardContent className="flex flex-col gap-5 text-sm">
                <section className="flex flex-col gap-1.5">
                  <h2 className="font-medium">{catalogText("description")}</h2>
                  <p className="whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
                    {row.description || catalogText("no_description")}
                  </p>
                </section>
                <section className="flex flex-col gap-1.5">
                  <h2 className="font-medium">{catalogText("owners")}</h2>
                  {row.owners.length === 0 ? (
                    <p className="flex items-center gap-1.5 text-muted-foreground">
                      <TriangleAlertIcon
                        aria-hidden
                        className="size-3.5 shrink-0 text-amber-700 dark:text-amber-400"
                      />
                      {catalogText("unowned")}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {row.owners.map((owner) => {
                        const Icon = owner.kind === "schedule" ? CalendarClockIcon : UserRoundIcon;
                        const onCall = onCallNow(owner, schedules.rows, overrides.rows, now);
                        return (
                          <li key={`${owner.kind}:${owner.id}`} className="flex gap-2">
                            <Icon
                              aria-hidden
                              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                            />
                            <span className="flex min-w-0 flex-col">
                              <span className="[overflow-wrap:anywhere]">
                                {ownerLabel(owner, schedules.rows, members.rows)}
                              </span>
                              {onCall !== null ? (
                                <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                                  {escalationText("on_call", {
                                    name: memberLabel(members.rows, onCall),
                                  })}
                                </span>
                              ) : owner.kind === "schedule" &&
                                schedules.rows.some((one) => one.id === owner.id) ? (
                                <span className="text-xs text-amber-700 dark:text-amber-400">
                                  {m.oncall_nobody()}
                                </span>
                              ) : null}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
                <section className="flex flex-col gap-1.5">
                  <h2 className="font-medium">
                    {m.catalog_field({ field: "policy", form: "label" })}
                  </h2>
                  <p className="text-muted-foreground [overflow-wrap:anywhere]">
                    {policy ? policy.name : catalogText("no_policy")}
                  </p>
                </section>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </Shell>
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
