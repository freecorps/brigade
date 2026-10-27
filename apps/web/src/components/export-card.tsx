import { formatDateTime, formatNumber, m } from "@freecorps/brigade-i18n";
import { mutationErrorReason } from "@freecorps/brigade-i18n/incident";
import {
  can,
  MAX_EXPORT_RANGE_DAYS,
  type ExportRow,
  type ExportScope,
  type IncidentRow,
} from "@freecorps/brigade-schema";
import { useQuery } from "@freecorps/brigade-sync/react";
import { DownloadIcon, LoaderCircleIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNow } from "@/components/incidents-card";
import { usePreferences } from "@/components/preferences";
import { FORM, Refusal } from "@/components/services-card";
import { useMember } from "@/components/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { createExport, exportText, exportUrl, formatDueDate, useFeatures } from "@/lib/follow-ups";

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Why an export was refused, worded. */
function failure(code: string): string {
  const known = ["too_large", "limit_reached", "invalid_args", "exports_unavailable"];
  return known.includes(code)
    ? exportText(`failed_${code}`)
    : exportText("failed_other", { reason: mutationErrorReason(code) });
}

/** Starts the browser's download of an export: the API streams it as the signed-in member. */
function download(workspaceId: string, id: string) {
  const link = document.createElement("a");
  link.href = exportUrl(workspaceId, id);
  link.download = "";
  link.click();
}

/**
 * Exporting one incident from its page (RFC 0013): owners and admins, when the server has an exports bucket. The file
 * downloads as soon as it is written.
 */
export function IncidentExportButton({ incident }: { incident: IncidentRow }) {
  const { role, workspaceId } = useMember();
  const features = useFeatures();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  if (!features.exports || !can(role, "data:export")) return null;
  const onExport = () => {
    setRefused(null);
    setBusy(true);
    void createExport(workspaceId, { kind: "incident", incidentId: incident.id }).then((result) => {
      setBusy(false);
      if (result.ok) download(workspaceId, result.id);
      else setRefused(failure(result.error));
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" className="self-start" onClick={onExport} disabled={busy}>
        {busy ? (
          <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
        ) : (
          <DownloadIcon aria-hidden />
        )}
        {exportText(busy ? "creating" : "incident_action")}
      </Button>
      {refused ? <Refusal text={refused} onDismiss={() => setRefused(null)} /> : null}
    </div>
  );
}

/**
 * The overview's export card (RFC 0013): the incidents declared in a range of UTC days as one JSON file, and the
 * exports still downloadable. Owners and admins only, and only when the server has an exports bucket.
 */
export function ExportCard() {
  const { role } = useMember();
  const features = useFeatures();
  if (!features.exports || !can(role, "data:export")) return null;
  return <Exports />;
}

function Exports() {
  const { workspaceId } = useMember();
  const { locale } = usePreferences();
  const recent = useQuery("exports.recent", {});
  const now = useNow(60_000);
  const today = new Date(now).toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(now - 29 * DAY_MS).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [ready, setReady] = useState<string | null>(null);
  const days = (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;
  const rangeError =
    !from || !to || !(days >= 1 && days <= MAX_EXPORT_RANGE_DAYS)
      ? exportText("failed_invalid_args")
      : undefined;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (rangeError) return;
    setRefused(null);
    setReady(null);
    setBusy(true);
    const scope: ExportScope = { kind: "range", from, to };
    void createExport(workspaceId, scope).then((result) => {
      setBusy(false);
      if (!result.ok) return setRefused(failure(result.error));
      setReady(result.id);
      download(workspaceId, result.id);
    });
  };
  const live = recent.rows.filter((row) => row.expiresAt > now);
  return (
    <Card aria-labelledby="exports-title">
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <CardTitle id="exports-title">{exportText("card_title")}</CardTitle>
        <p className="max-w-prose text-sm text-muted-foreground">
          {exportText("card_description")}
        </p>
      </div>
      <CardContent className="flex flex-col gap-5 text-sm">
        <form className={FORM} onSubmit={submit} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              type="date"
              label={exportText("from")}
              value={from}
              max={to || today}
              onChange={(event) => setFrom(event.target.value)}
            />
            <Field
              type="date"
              label={exportText("to")}
              value={to}
              min={from}
              error={rangeError}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          <Button type="submit" className="self-start" disabled={busy || !!rangeError}>
            {busy ? (
              <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
            ) : (
              <DownloadIcon aria-hidden />
            )}
            {exportText(busy ? "creating" : "create")}
          </Button>
          {ready ? (
            <p role="status" className="text-sm font-medium">
              {exportText("ready")}
            </p>
          ) : null}
          {refused ? <Refusal text={refused} onDismiss={() => setRefused(null)} /> : null}
        </form>
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {exportText("recent")}
          </h3>
          {live.length === 0 ? (
            <p className="text-muted-foreground">{exportText("none")}</p>
          ) : (
            <ul className="-mx-4 flex flex-col divide-y border-y sm:-mx-6">
              {live.map((row) => (
                <ExportItem key={row.id} row={row} locale={locale} workspaceId={workspaceId} />
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ExportItem({
  row,
  locale,
  workspaceId,
}: {
  row: ExportRow;
  locale: ReturnType<typeof usePreferences>["locale"];
  workspaceId: string;
}) {
  const scope =
    row.scope.kind === "range"
      ? exportText("scope_range", {
          name: `${formatDueDate(row.scope.from, locale)} – ${formatDueDate(row.scope.to, locale)}`,
        })
      : exportText("scope_incident");
  const size = `${formatNumber(Math.max(1, Math.round(row.bytes / 1024)), locale)} KB`;
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-6">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="font-medium [overflow-wrap:anywhere]">{scope}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {`${m.export_incidents({ count: row.incidents })} · ${size} · `}
          {exportText("expires", { time: formatDateTime(row.expiresAt, locale, TIME_ZONE) })}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={exportText("download")}
        onClick={() => download(workspaceId, row.id)}
      >
        <DownloadIcon aria-hidden />
      </Button>
    </li>
  );
}
