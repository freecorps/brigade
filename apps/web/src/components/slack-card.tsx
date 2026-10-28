import { m } from "@freecorps/brigade-i18n";
import {
  can,
  SLACK_INCIDENT_CHANNELS,
  workspaceLocale,
  type SlackIncidentChannels,
  type SlackRow,
  type WorkspaceLocale,
} from "@freecorps/brigade-schema";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  HashIcon,
  LoaderCircleIcon,
  RotateCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { CONFIRM_DESTRUCTIVE } from "@/components/monitor-form";
import { useMember } from "@/components/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Field, FormError } from "@/components/ui/field";
import {
  ARCHIVE_CHOICES,
  channelLabel,
  checkChannel,
  installErrorPart,
  listSlackChannels,
  slackResult,
  slackText,
  startSlackInstall,
  type SlackChannels,
} from "@/lib/slack";

const SELECT = "field w-full min-w-0 px-3 focus-visible:ring-3 focus-visible:ring-ring";

const LANGUAGE_NAMES: Record<WorkspaceLocale, () => string> = {
  en: () => m.language_name_en(),
  "pt-BR": () => m.language_name_pt_br(),
};

/**
 * The workspace's Slack connection (RFC 0011), live from its shard (`slack.connection`, never the token): Add to Slack,
 * the connected Slack workspace, the channel incidents are posted in, the language their messages are in (the
 * workspace's, RFC 0008), and Disconnect. Owners and
 * admins change it; everyone else reads it.
 */
export function SlackCard() {
  // Try again mounts the query anew: a refused subscription that gets a new listener asks the shard again.
  const [attempt, setAttempt] = useState(0);
  // How an install that just came back ended (`?slack=…`), read once and taken off the URL.
  const [result, setResult] = useState<ReturnType<typeof slackResult>>(null);
  useEffect(() => {
    const found = slackResult(window.location.search);
    if (!found) return;
    setResult(found);
    const url = new URL(window.location.href);
    url.searchParams.delete("slack");
    window.history.replaceState(window.history.state, "", url);
  }, []);
  return (
    <SlackConnection
      key={attempt}
      result={result}
      setResult={setResult}
      onRetry={() => setAttempt((count) => count + 1)}
    />
  );
}

function SlackConnection({
  result,
  setResult,
  onRetry,
}: Pick<PanelProps, "result" | "onRetry"> & { setResult: (result: PanelProps["result"]) => void }) {
  const { role, workspaceId } = useMember();
  const connection = useQuery("slack.connection", {});
  const workspace = useQuery("workspace.current", {});
  const configure = useMutation("slack.configure");
  const disconnect = useMutation("slack.disconnect");
  const manage = can(role, "workspace:manage");
  const row = connection.rows[0] ?? null;
  // The channels come from Slack through the API, for owners and admins of a live connection only.
  const team = row && row.revokedAt == null ? row.teamId : null;
  const [channels, setChannels] = useState<SlackChannels>({ status: "loading" });
  const loadChannels = useCallback(() => {
    if (!manage || !team) return;
    setChannels({ status: "loading" });
    void listSlackChannels(workspaceId).then(setChannels);
  }, [manage, team, workspaceId]);
  useEffect(loadChannels, [loadChannels]);
  return (
    <SlackPanel
      connection={row}
      // Unknown until the workspace row loads: never assert English for a workspace that failed to load.
      workspaceLocale={workspace.rows[0] ? workspaceLocale(workspace.rows[0]) : undefined}
      channels={channels}
      onReloadChannels={loadChannels}
      loading={connection.status === "loading"}
      failed={connection.status === "error"}
      manage={manage}
      result={result}
      onAdd={async () => {
        const started = await startSlackInstall(workspaceId);
        if (started.ok) window.location.assign(started.url);
        else setResult({ ok: false, part: installErrorPart(started.error) });
      }}
      onSave={async (settings) => (await configure(settings)).ok}
      onDisconnect={async () => (await disconnect({})).ok}
      onRetry={onRetry}
    />
  );
}

/** What the card saves with `slack.configure`. */
export type SlackSettings = {
  channelId: string | null;
  channelName: string | null;
  incidentChannels: SlackIncidentChannels;
  privateChannels: boolean;
  archiveAfterHours: number | null;
};

type PanelProps = {
  connection: SlackRow | null;
  /** The workspace's language (`workspace.setLocale`), which channel messages are written in. */
  workspaceLocale?: WorkspaceLocale;
  /** The channels to pick from (owners and admins); a failed list falls back to a typed id. */
  channels: SlackChannels;
  onReloadChannels: () => void;
  loading: boolean;
  /** The shard refused or could not answer `slack.connection`: whether Slack is connected is unknown. */
  failed: boolean;
  manage: boolean;
  result: { ok: boolean; part: string } | null;
  onAdd: () => Promise<void>;
  /** Resolves true once the shard saved it. */
  onSave: (settings: SlackSettings) => Promise<boolean>;
  onDisconnect: () => Promise<boolean>;
  onRetry: () => void;
};

/** The card itself, without the hooks: what each state looks like (tested and screenshotted with made-up data). */
export function SlackPanel({
  connection,
  workspaceLocale,
  channels,
  onReloadChannels,
  loading,
  failed,
  manage,
  result,
  onAdd,
  onSave,
  onDisconnect,
  onRetry,
}: PanelProps) {
  const [adding, setAdding] = useState(false);
  return (
    <Card aria-labelledby="slack-title">
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <CardTitle id="slack-title" className="truncate">
            {slackText("title")}
          </CardTitle>
          {manage && !connection && !loading && !failed ? (
            <Button
              variant="outline"
              disabled={adding}
              onClick={() => {
                setAdding(true);
                // On success the page leaves for Slack; otherwise the card says why and the button is back.
                void onAdd().finally(() => setAdding(false));
              }}
            >
              {adding ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
              {slackText(adding ? "adding" : "add")}
            </Button>
          ) : null}
        </div>
        <p className="max-w-prose text-sm text-muted-foreground">{slackText("description")}</p>
      </div>
      <CardContent className="flex flex-col gap-4">
        {result ? (
          result.ok ? (
            <p
              role="status"
              className="flex items-start gap-2 rounded-md bg-muted px-3 py-2.5 text-sm"
            >
              <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0">{slackText(result.part)}</span>
            </p>
          ) : (
            <FormError>{slackText(result.part)}</FormError>
          )
        ) : null}
        {loading ? null : failed ? (
          <div className="flex flex-col items-start gap-2">
            <FormError>{slackText("load_failed")}</FormError>
            <Button variant="outline" onClick={onRetry}>
              <RotateCwIcon aria-hidden />
              {slackText("retry")}
            </Button>
          </div>
        ) : connection ? (
          <Connected
            connection={connection}
            workspaceLocale={workspaceLocale}
            channels={channels}
            onReloadChannels={onReloadChannels}
            manage={manage}
            onAdd={onAdd}
            onSave={onSave}
            onDisconnect={onDisconnect}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {slackText(manage ? "not_connected" : "manage_only")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const archivePart = (hours: number | null) =>
  hours === null ? "archive_keep" : `archive_${hours}`;

function Connected({
  connection,
  workspaceLocale,
  channels,
  onReloadChannels,
  manage,
  onAdd,
  onSave,
  onDisconnect,
}: Pick<
  PanelProps,
  "channels" | "onReloadChannels" | "manage" | "onAdd" | "onSave" | "onDisconnect"
> & { connection: SlackRow; workspaceLocale: WorkspaceLocale | undefined }) {
  const saved = (): SlackSettings => ({
    channelId: connection.channelId,
    channelName: connection.channelName ?? null,
    incidentChannels: connection.incidentChannels ?? "off",
    privateChannels: connection.privateChannels ?? false,
    archiveAfterHours: connection.archiveAfterHours ?? null,
  });
  const [form, setForm] = useState<SlackSettings>(saved);
  // A typed id, when Slack's list could not be read.
  const [typed, setTyped] = useState(connection.channelId ?? "");
  const [invalid, setInvalid] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState<"idle" | "busy" | "failed">("idle");
  const [reconnecting, setReconnecting] = useState(false);
  const channelId = useId();
  const perIncidentId = useId();
  const privateId = useId();
  const archiveId = useId();
  // A change saved elsewhere (another member, another tab) arrives live: the form follows it.
  useEffect(() => {
    setForm(saved());
    setTyped(connection.channelId ?? "");
    // `saved` reads only these fields.
  }, [
    connection.channelId,
    connection.channelName,
    connection.incidentChannels,
    connection.privateChannels,
    connection.archiveAfterHours,
  ]);
  const change = (patch: Partial<SlackSettings>) => {
    setForm((current) => ({ ...current, ...patch }));
    setState("idle");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    let next = form;
    if (channels.status === "failed") {
      const checked = checkChannel(typed);
      setInvalid(!checked.ok);
      if (!checked.ok) return;
      next = {
        ...form,
        channelId: checked.value,
        channelName:
          checked.value === connection.channelId ? (connection.channelName ?? null) : null,
      };
    }
    const before = saved();
    if ((Object.keys(next) as (keyof SlackSettings)[]).every((key) => next[key] === before[key])) {
      setState("saved");
      return;
    }
    setState("saving");
    void onSave(next).then((ok) => setState(ok ? "saved" : "failed"));
  };

  const team = connection.teamName;
  const listed = channels.status === "ready" ? channels.channels : [];
  // The channel saved now, kept as a choice even when Slack's list no longer has it (archived, Brigade removed).
  const unlisted =
    form.channelId !== null && !listed.some((one) => one.id === form.channelId)
      ? form.channelId
      : null;
  const perIncident = form.incidentChannels !== "off";
  const revoked = connection.revokedAt != null;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium [overflow-wrap:anywhere]">
          {slackText("connected", { team })}
        </p>
        <p className="flex min-w-0 items-start gap-1.5 text-sm text-muted-foreground">
          <HashIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {connection.channelId
              ? slackText("channel_current", {
                  channel: channelLabel(connection.channelId, connection.channelName),
                })
              : slackText("channel_none")}
          </span>
        </p>
      </div>
      {revoked ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5"
        >
          <p className="flex min-w-0 items-start gap-2 text-sm">
            <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {slackText(`revoked_${connection.revokedReason ?? "uninstalled"}`, { team })}
            </span>
          </p>
          {manage ? (
            <Button
              variant="outline"
              disabled={reconnecting}
              onClick={() => {
                setReconnecting(true);
                void onAdd().finally(() => setReconnecting(false));
              }}
            >
              {reconnecting ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : null}
              {slackText(reconnecting ? "adding" : "reconnect")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {manage && !revoked ? (
        <>
          <form
            onSubmit={submit}
            noValidate
            className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]"
          >
            {channels.status === "failed" ? (
              <div className="flex min-w-0 flex-col gap-2">
                <Field
                  label={slackText("channel_id_label")}
                  hint={slackText("channel_id_hint")}
                  error={invalid ? slackText("channel_invalid") : undefined}
                  value={typed}
                  onChange={(event) => {
                    setTyped(event.target.value);
                    setInvalid(false);
                    setState("idle");
                  }}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={40}
                />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="text-sm text-muted-foreground">
                    {slackText("channel_list_failed")}
                  </p>
                  <Button type="button" variant="ghost" onClick={onReloadChannels}>
                    <RotateCwIcon aria-hidden />
                    {slackText("channel_reload")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor={channelId} className="text-sm font-medium">
                  {slackText("channel_label")}
                </label>
                <select
                  id={channelId}
                  className={SELECT}
                  disabled={channels.status === "loading"}
                  aria-busy={channels.status === "loading"}
                  value={channels.status === "loading" ? "" : (form.channelId ?? "")}
                  onChange={(event) => {
                    const id = event.target.value || null;
                    const picked = listed.find((one) => one.id === id);
                    change({
                      channelId: id,
                      channelName:
                        picked?.name ??
                        (id === connection.channelId ? (connection.channelName ?? null) : null),
                    });
                  }}
                >
                  {channels.status === "loading" ? (
                    <option value="">{slackText("channel_loading")}</option>
                  ) : (
                    <>
                      <option value="">{slackText("channel_none_option")}</option>
                      {unlisted ? (
                        <option value={unlisted}>
                          {slackText("channel_unlisted", {
                            channel: channelLabel(
                              unlisted,
                              unlisted === connection.channelId ? connection.channelName : null,
                            ),
                          })}
                        </option>
                      ) : null}
                      {listed.map((one) => (
                        <option key={one.id} value={one.id}>
                          {one.private
                            ? slackText("channel_private", { channel: `#${one.name}` })
                            : `#${one.name}`}
                        </option>
                      ))}
                    </>
                  )}
                </select>
                <p className="text-sm text-muted-foreground">{slackText("channel_hint")}</p>
              </div>
            )}
            {workspaceLocale ? (
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-sm font-medium">{slackText("language_label")}</span>
                <p className="text-sm text-pretty text-muted-foreground">
                  {m.slack_language_workspace({ language: LANGUAGE_NAMES[workspaceLocale]() })}
                </p>
              </div>
            ) : null}
            <fieldset className="grid min-w-0 gap-4 border-t pt-4 sm:col-span-2 sm:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
                <label htmlFor={perIncidentId} className="text-sm font-medium">
                  {slackText("incident_channels_label")}
                </label>
                <select
                  id={perIncidentId}
                  className={`${SELECT} sm:max-w-sm`}
                  value={form.incidentChannels}
                  onChange={(event) =>
                    change({ incidentChannels: event.target.value as SlackIncidentChannels })
                  }
                >
                  {SLACK_INCIDENT_CHANNELS.map((value) => (
                    <option key={value} value={value}>
                      {slackText(`incident_channels_${value}`)}
                    </option>
                  ))}
                </select>
                <p className="max-w-prose text-sm text-muted-foreground">
                  {slackText("incident_channels_hint")}
                </p>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor={archiveId} className="text-sm font-medium">
                  {slackText("archive_label")}
                </label>
                <select
                  id={archiveId}
                  className={SELECT}
                  disabled={!perIncident}
                  value={String(form.archiveAfterHours)}
                  onChange={(event) =>
                    change({
                      archiveAfterHours:
                        event.target.value === "null" ? null : Number(event.target.value),
                    })
                  }
                >
                  {ARCHIVE_CHOICES.map((hours) => (
                    <option key={String(hours)} value={String(hours)}>
                      {slackText(archivePart(hours))}
                    </option>
                  ))}
                </select>
              </div>
              <label
                htmlFor={privateId}
                className="flex min-h-11 items-center gap-3 self-end text-sm font-medium has-[:disabled]:text-muted-foreground"
              >
                <input
                  id={privateId}
                  type="checkbox"
                  className="size-4 shrink-0 accent-primary"
                  disabled={!perIncident}
                  checked={form.privateChannels}
                  onChange={(event) => change({ privateChannels: event.target.checked })}
                />
                {slackText("private_label")}
              </label>
            </fieldset>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <Button type="submit" disabled={state === "saving" || channels.status === "loading"}>
                {slackText(state === "saving" ? "saving" : "save")}
              </Button>
              <span role="status" className="text-sm text-muted-foreground">
                {state === "saved" ? slackText("saved") : ""}
              </span>
            </div>
            {state === "failed" ? (
              <div className="sm:col-span-2">
                <FormError>{slackText("save_failed")}</FormError>
              </div>
            ) : null}
          </form>
        </>
      ) : null}
      {manage ? (
        <div className="flex flex-col gap-3 border-t pt-4">
          {confirming ? (
            <>
              <p className="max-w-prose text-sm [overflow-wrap:anywhere]">
                {slackText("disconnect_confirm", { team })}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="destructive"
                  className={CONFIRM_DESTRUCTIVE}
                  disabled={leaving === "busy"}
                  onClick={() => {
                    setLeaving("busy");
                    void onDisconnect().then((ok) => setLeaving(ok ? "idle" : "failed"));
                  }}
                >
                  {slackText(leaving === "busy" ? "disconnecting" : "disconnect")}
                </Button>
                <Button variant="outline" onClick={() => setConfirming(false)}>
                  {slackText("disconnect_cancel")}
                </Button>
              </div>
              {leaving === "failed" ? (
                <FormError>{slackText("disconnect_failed")}</FormError>
              ) : null}
            </>
          ) : (
            <div>
              <Button variant="outline" onClick={() => setConfirming(true)}>
                {slackText("disconnect")}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{slackText("manage_only")}</p>
      )}
    </div>
  );
}
