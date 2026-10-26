import { m } from "@freecorps/brigade-i18n";
import { can, SLACK_LOCALES, type SlackLocale, type SlackRow } from "@freecorps/brigade-schema";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { CircleCheckIcon, HashIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { CONFIRM_DESTRUCTIVE } from "@/components/monitor-form";
import { useMember } from "@/components/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Field, FormError } from "@/components/ui/field";
import {
  checkChannel,
  installErrorPart,
  slackResult,
  slackText,
  startSlackInstall,
} from "@/lib/slack";

const SELECT =
  "h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring";

const LANGUAGE_NAMES: Record<SlackLocale, () => string> = {
  en: () => m.language_name_en(),
  "pt-BR": () => m.language_name_pt_br(),
};

/**
 * The workspace's Slack connection (RFC 0011), live from its shard (`slack.connection`, never the token): Add to Slack,
 * the connected Slack workspace, the channel incidents are posted in and their language, and Disconnect. Owners and
 * admins change it; everyone else reads it.
 */
export function SlackCard() {
  const { role, workspaceId } = useMember();
  const connection = useQuery("slack.connection", {});
  const configure = useMutation("slack.configure");
  const disconnect = useMutation("slack.disconnect");
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
    <SlackPanel
      connection={connection.rows[0] ?? null}
      loading={connection.status !== "ready" && connection.status !== "error"}
      manage={can(role, "workspace:manage")}
      result={result}
      onAdd={async () => {
        const started = await startSlackInstall(workspaceId);
        if (started.ok) window.location.assign(started.url);
        else setResult({ ok: false, part: installErrorPart(started.error) });
      }}
      onSave={async (channelId, locale) => (await configure({ channelId, locale })).ok}
      onDisconnect={async () => (await disconnect({})).ok}
    />
  );
}

type PanelProps = {
  connection: SlackRow | null;
  loading: boolean;
  manage: boolean;
  result: { ok: boolean; part: string } | null;
  onAdd: () => Promise<void>;
  /** Resolves true once the shard saved it. */
  onSave: (channelId: string | null, locale: SlackLocale) => Promise<boolean>;
  onDisconnect: () => Promise<boolean>;
};

/** The card itself, without the hooks: what each state looks like (tested and screenshotted with made-up data). */
export function SlackPanel({
  connection,
  loading,
  manage,
  result,
  onAdd,
  onSave,
  onDisconnect,
}: PanelProps) {
  const [adding, setAdding] = useState(false);
  return (
    <Card aria-labelledby="slack-title">
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <CardTitle id="slack-title" className="truncate">
            {slackText("title")}
          </CardTitle>
          {manage && !connection && !loading ? (
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
        {loading ? null : connection ? (
          <Connected
            connection={connection}
            manage={manage}
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

function Connected({
  connection,
  manage,
  onSave,
  onDisconnect,
}: Pick<PanelProps, "manage" | "onSave" | "onDisconnect"> & { connection: SlackRow }) {
  const [channel, setChannel] = useState(connection.channelId ?? "");
  const [locale, setLocale] = useState<SlackLocale>(connection.locale);
  const [invalid, setInvalid] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState<"idle" | "busy" | "failed">("idle");
  const languageId = useId();
  // A change saved elsewhere (another member, another tab) arrives live: the form follows it.
  useEffect(() => {
    setChannel(connection.channelId ?? "");
    setLocale(connection.locale);
  }, [connection.channelId, connection.locale]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const checked = checkChannel(channel);
    setInvalid(!checked.ok);
    if (!checked.ok) return;
    if (checked.value === connection.channelId && locale === connection.locale) {
      setState("saved");
      return;
    }
    setState("saving");
    void onSave(checked.value, locale).then((ok) => setState(ok ? "saved" : "failed"));
  };

  const team = connection.teamName;
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
              ? slackText("channel_current", { channel: connection.channelId })
              : slackText("channel_none")}
          </span>
        </p>
      </div>
      {manage ? (
        <>
          <form
            onSubmit={submit}
            noValidate
            className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]"
          >
            <Field
              label={slackText("channel_label")}
              hint={slackText("channel_hint")}
              error={invalid ? slackText("channel_invalid") : undefined}
              value={channel}
              onChange={(event) => {
                setChannel(event.target.value);
                setInvalid(false);
                setState("idle");
              }}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={40}
            />
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={languageId} className="text-sm font-medium">
                {slackText("language_label")}
              </label>
              <select
                id={languageId}
                className={SELECT}
                value={locale}
                onChange={(event) => {
                  setLocale(event.target.value as SlackLocale);
                  setState("idle");
                }}
              >
                {SLACK_LOCALES.map((value) => (
                  <option key={value} value={value}>
                    {LANGUAGE_NAMES[value]()}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <Button type="submit" disabled={state === "saving"}>
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
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{slackText("manage_only")}</p>
      )}
    </div>
  );
}
