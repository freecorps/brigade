import { m } from "@freecorps/brigade-i18n";
import { OLDER_DAYS, PAST_DAYS, pastSince } from "@freecorps/brigade-schema";
import { nextFailed, syncView } from "@freecorps/brigade-sync";
import { useConnectionState, useQuery } from "@freecorps/brigade-sync/react";
import { useState } from "react";
import { INCIDENT_COLUMNS, IncidentItem, IncidentItemSkeleton } from "@/components/incident-item";
import { ConnectionPill, StatePanel, useNow } from "@/components/incidents-card";
import { usePreferences } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "cn";

const NONE = { any: false, status: false, severity: false };
const nothing = () => {};

/**
 * Incidents that are over (`incidents.past`): resolved or declined, declared in the last `PAST_DAYS` days, newest
 * first, each linking to its page. Read only: a past incident is reopened from its own page. "Show older" goes
 * `OLDER_DAYS` further back.
 */
export function PastIncidentsCard() {
  const { locale } = usePreferences();
  const now = useNow(60_000);
  const [days, setDays] = useState(PAST_DAYS);
  // Fixed per day, not per tick: a new `since` would ask the shard again.
  const [today] = useState(() => Date.now());
  const { rows, status, error } = useQuery("incidents.past", { since: pastSince(days, today) });
  // As the open incidents: connecting, live, reconnecting, unavailable (never answered) or refused.
  const connection = useConnectionState();
  const [failed, setFailed] = useState(false);
  const latched = nextFailed(failed, status, connection);
  if (latched !== failed) setFailed(latched);
  const view = syncView(status, connection, latched);
  return (
    <Card aria-labelledby="past-incidents-title">
      <CardHeader
        id="past-incidents-title"
        title={m.incidents_past_title()}
        description={m.incidents_past_window({ days })}
        action={<ConnectionPill view={view} />}
      />
      <CardContent className="flex flex-col gap-4">
        {rows.length > 0 ? (
          <div className="-mx-4 -mt-2 sm:-mx-6">
            <div
              aria-hidden
              className={cn(
                "hidden gap-x-3 border-b px-6 py-2 text-xs font-medium text-muted-foreground md:grid",
                INCIDENT_COLUMNS,
              )}
            >
              <span className="col-span-2">{m.incidents_title()}</span>
              <span className="border border-transparent px-3">{m.incident_severity_label()}</span>
              <span className="border border-transparent px-3">{m.incident_status_label()}</span>
            </div>
            <ul aria-labelledby="past-incidents-title" className="divide-y border-b">
              {rows.map((row) => (
                <IncidentItem
                  key={row.id}
                  row={row}
                  pending={NONE}
                  online
                  locale={locale}
                  now={now}
                  notices={null}
                  editable={false}
                  onStatus={nothing}
                  onSeverity={nothing}
                />
              ))}
            </ul>
          </div>
        ) : status === "ready" ? (
          <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
            {m.incidents_past_empty({ days })}
          </p>
        ) : view === "connecting" ? (
          <ul aria-hidden className="-mx-4 divide-y border-y sm:-mx-6">
            {[0, 1].map((index) => (
              <IncidentItemSkeleton key={index} />
            ))}
          </ul>
        ) : null}
        <StatePanel view={view} errorCode={error?.code} sent={null} />
        {status === "ready" ? (
          <Button
            variant="outline"
            className="self-start"
            onClick={() => setDays((current) => current + OLDER_DAYS)}
          >
            {m.incidents_past_older()}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
