import { m, type Locale } from "@freecorps/brigade-i18n";
import {
  can,
  MAX_WEBHOOKS_PER_WORKSPACE,
  type WebhookAttempt,
  type WebhookEventType,
  type WebhookRow,
} from "@freecorps/brigade-schema";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { cn } from "cn";
import {
  CheckIcon,
  CircleCheckIcon,
  CircleOffIcon,
  CopyIcon,
  OctagonAlertIcon,
  PencilIcon,
  PlusIcon,
  RotateCwIcon,
  SendIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CONFIRM_DESTRUCTIVE } from "@/components/monitor-form";
import { usePreferences } from "@/components/preferences";
import { useMember } from "@/components/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Field, FormError } from "@/components/ui/field";
import { formatAge } from "@/lib/incidents";
import {
  attemptResult,
  checkDraft,
  draftOf,
  emptyDraft,
  EVENT_GROUPS,
  eventLabel,
  hostOf,
  newWebhookId,
  requestSecret,
  sameDraft,
  secretErrorPart,
  shownUrl,
  webhookName,
  webhookState,
  webhookText,
  type DraftIssues,
  type SecretResult,
  type WebhookDraft,
  type WebhookState,
} from "@/lib/webhooks";

const STATES: Record<
  WebhookState,
  { variant: "resolved" | "declined" | "sev1"; icon: LucideIcon; part: string }
> = {
  on: { variant: "resolved", icon: CircleCheckIcon, part: "status_on" },
  off: { variant: "declined", icon: CircleOffIcon, part: "status_off" },
  // Off because it kept failing: the one state that needs someone, so the one solid fill.
  failing: { variant: "sev1", icon: OctagonAlertIcon, part: "status_failing" },
};

/**
 * The workspace's outbound webhooks (RFC 0005 "Outbound webhooks"), live from its shard (`webhook.all`, owners and
 * admins only: a URL may carry the receiver's token). Add an endpoint (its signing secret shown once), edit it, turn it
 * on or off, send a test event, give it a new secret, delete it, and read its last deliveries.
 */
export function WebhooksCard() {
  const { role } = useMember();
  if (!can(role, "webhook:manage")) return <WebhooksManageOnly />;
  return <ManagedWebhooks />;
}

function ManagedWebhooks() {
  const { workspaceId } = useMember();
  const { locale } = usePreferences();
  const [attempt, setAttempt] = useState(0);
  const { rows, status } = useQuery("webhook.all", {});
  const update = useMutation("webhook.update");
  const setEnabled = useMutation("webhook.setEnabled");
  const remove = useMutation("webhook.delete");
  const sendTest = useMutation("webhook.sendTest");
  const now = useNow(20_000);
  return (
    <WebhooksPanel
      key={attempt}
      rows={rows}
      loading={status === "loading"}
      failed={status === "error"}
      locale={locale}
      now={now}
      onCreate={(draft) => requestSecret(workspaceId, newWebhookId(), draft)}
      onRotate={(id) => requestSecret(workspaceId, id, null)}
      onUpdate={async (id, draft) => (await update({ id, ...draft })).ok}
      onSetEnabled={async (id, enabled) => (await setEnabled({ id, enabled })).ok}
      onDelete={async (id) => (await remove({ id })).ok}
      onTest={async (id) => {
        const outcome = await sendTest({ id });
        if (outcome.ok) return "sent";
        return outcome.error.code === "limit_reached" ? "too_soon" : "failed";
      }}
      onRetry={() => setAttempt((count) => count + 1)}
    />
  );
}

type PanelProps = {
  rows: readonly WebhookRow[];
  loading: boolean;
  failed: boolean;
  locale: Locale;
  now: number;
  onCreate: (draft: WebhookDraft) => Promise<SecretResult>;
  onRotate: (id: string) => Promise<SecretResult>;
  onUpdate: (id: string, draft: WebhookDraft) => Promise<boolean>;
  onSetEnabled: (id: string, enabled: boolean) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onTest: (id: string) => Promise<"sent" | "too_soon" | "failed">;
  onRetry: () => void;
};

/** A secret just made: shown once, above the list. */
type Shown = { secret: string; host: string; rotated: boolean };

function Header({ action }: { action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-4 sm:px-6">
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <CardTitle id="webhooks-title" className="truncate">
          {webhookText("title")}
        </CardTitle>
        {action}
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">{webhookText("description")}</p>
    </div>
  );
}

/** The card itself, without the hooks: what each state looks like (tested and screenshotted with made-up data). */
export function WebhooksPanel({
  rows,
  loading,
  failed,
  locale,
  now,
  onCreate,
  onRotate,
  onUpdate,
  onSetEnabled,
  onDelete,
  onTest,
  onRetry,
}: PanelProps) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const full = rows.length >= MAX_WEBHOOKS_PER_WORKSPACE;
  return (
    <Card aria-labelledby="webhooks-title">
      <Header
        action={
          !adding && !loading && !failed ? (
            <Button
              variant="outline"
              disabled={full}
              onClick={() => {
                setAdding(true);
                setEditing(null);
              }}
            >
              <PlusIcon aria-hidden />
              {webhookText("add")}
            </Button>
          ) : null
        }
      />
      <CardContent className="flex flex-col gap-4">
        {shown ? <SecretOnce shown={shown} onDismiss={() => setShown(null)} /> : null}
        {full && !adding ? (
          <p className="text-sm text-muted-foreground">{webhookText("limit")}</p>
        ) : null}
        {adding ? (
          <EndpointForm
            initial={emptyDraft()}
            submitPart="create"
            busyPart="creating"
            onCancel={() => setAdding(false)}
            onSubmit={async (draft) => {
              const result = await onCreate(draft);
              if (result.ok) {
                setAdding(false);
                setShown({ secret: result.secret, host: hostOf(draft.url), rotated: false });
                return null;
              }
              return result.field === "url"
                ? { url: webhookText("url_invalid") }
                : { form: webhookText(secretErrorPart(result.error)) };
            }}
          />
        ) : null}
        {loading ? null : failed ? (
          <div className="flex flex-col items-start gap-2">
            <FormError>{webhookText("load_failed")}</FormError>
            <Button variant="outline" onClick={onRetry}>
              <RotateCwIcon aria-hidden />
              {webhookText("retry")}
            </Button>
          </div>
        ) : rows.length ? (
          <ul className="-mx-4 divide-y border-t sm:-mx-6">
            {rows.map((row) =>
              editing === row.id ? (
                <li key={row.id} className="px-4 py-4 sm:px-6">
                  <EndpointEditor
                    row={row}
                    locale={locale}
                    now={now}
                    onClose={() => setEditing(null)}
                    onUpdate={onUpdate}
                    onSetEnabled={onSetEnabled}
                    onTest={onTest}
                    onDelete={async (id) => {
                      const ok = await onDelete(id);
                      if (ok) setEditing(null);
                      return ok;
                    }}
                    onRotate={async (id) => {
                      const result = await onRotate(id);
                      if (result.ok)
                        setShown({ secret: result.secret, host: hostOf(row.url), rotated: true });
                      return result.ok;
                    }}
                  />
                </li>
              ) : (
                <EndpointItem
                  key={row.id}
                  row={row}
                  locale={locale}
                  now={now}
                  onEdit={() => {
                    setEditing(row.id);
                    setAdding(false);
                  }}
                />
              ),
            )}
          </ul>
        ) : !adding ? (
          <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
            {webhookText("empty")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Responders and viewers: the card says who manages webhooks, and shows none (their URLs are not theirs to see). */
export function WebhooksManageOnly() {
  return (
    <Card aria-labelledby="webhooks-title">
      <Header />
      <CardContent>
        <p className="text-sm text-muted-foreground">{webhookText("manage_only")}</p>
      </CardContent>
    </Card>
  );
}

function StateBadge({ row }: { row: WebhookRow }) {
  const { variant, icon: Icon, part } = STATES[webhookState(row)];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden />
      {webhookText(part)}
    </Badge>
  );
}

/** What the last attempt did, in one line. */
function lastLine(row: WebhookRow, now: number, locale: Locale): string {
  const last = row.recent[0];
  if (!last) return webhookText("never");
  const when = formatAge(Math.min(last.at, now), now, locale);
  return `${webhookText(last.ok ? "last_ok" : "last_failed", { when })} · ${attemptResult(last)}`;
}

function EndpointItem({
  row,
  locale,
  now,
  onEdit,
}: {
  row: WebhookRow;
  locale: Locale;
  now: number;
  onEdit: () => void;
}) {
  const nameId = useId();
  const state = webhookState(row);
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:px-6">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <StateBadge row={row} />
            <span id={nameId} className="min-w-0 font-medium [overflow-wrap:anywhere]">
              {webhookName(row)}
            </span>
          </div>
          <p className="min-w-0 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {shownUrl(row.url)}
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">
            {m.webhook_events_count({ count: row.events.length })} · {lastLine(row, now, locale)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={webhookText("edit")}
          aria-describedby={nameId}
          onClick={onEdit}
        >
          <PencilIcon aria-hidden />
        </Button>
      </div>
      {state === "failing" && row.disabledAt !== null ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          {webhookText("disabled_failing", {
            when: formatAge(Math.min(row.disabledAt, now), now, locale),
          })}
        </p>
      ) : state === "on" && row.failingSince !== null ? (
        <p className="text-sm text-destructive">
          {webhookText("failing_since", {
            when: formatAge(Math.min(row.failingSince, now), now, locale),
          })}
        </p>
      ) : null}
    </li>
  );
}

/** A form-level refusal, or the field the shard refused. */
type SubmitProblem = { form?: string; url?: string } | null;

function EndpointForm({
  initial,
  submitPart,
  busyPart,
  onSubmit,
  onCancel,
  unchanged,
}: {
  initial: WebhookDraft;
  submitPart: string;
  busyPart: string;
  onSubmit: (draft: WebhookDraft) => Promise<SubmitProblem>;
  onCancel: () => void;
  /** For an edit: whether the draft says what the endpoint already does (nothing to send). */
  unchanged?: (draft: WebhookDraft) => boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const [issues, setIssues] = useState<DraftIssues>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle");
  const urlRef = useRef<HTMLInputElement>(null);
  const eventsId = useId();
  const eventsErrorId = useId();
  useEffect(() => urlRef.current?.focus(), []);
  const change = (next: Partial<WebhookDraft>) => {
    setDraft((current) => ({ ...current, ...next }));
    setIssues({});
    setProblem(null);
    setState("idle");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const checked = checkDraft(draft);
    if (!checked.ok) {
      setIssues(checked.issues);
      if (checked.issues.url) urlRef.current?.focus();
      return;
    }
    if (unchanged?.(checked.value)) {
      setState("saved");
      return;
    }
    setState("busy");
    void onSubmit(checked.value).then((result) => {
      if (!result) {
        setState("saved");
        return;
      }
      setState("idle");
      if (result.url) setIssues({ url: result.url });
      setProblem(result.form ?? null);
    });
  };
  const toggle = (type: WebhookEventType, on: boolean) =>
    change({ events: on ? [...draft.events, type] : draft.events.filter((one) => one !== type) });
  return (
    <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Field
          ref={urlRef}
          label={webhookText("url_label")}
          hint={webhookText("url_hint")}
          error={issues.url}
          value={draft.url}
          onChange={(event) => change({ url: event.target.value })}
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://hooks.example.com/brigade"
          maxLength={2048}
        />
        <Field
          label={webhookText("description_label")}
          hint={webhookText("description_hint")}
          error={issues.description}
          value={draft.description}
          onChange={(event) => change({ description: event.target.value })}
          autoComplete="off"
          maxLength={400}
        />
      </div>
      <fieldset
        className="flex min-w-0 flex-col gap-3"
        aria-describedby={issues.events ? eventsErrorId : undefined}
      >
        <legend id={eventsId} className="mb-1 text-sm font-medium">
          {webhookText("events_label")}
        </legend>
        <div className="grid min-w-0 gap-4 sm:grid-cols-3">
          {EVENT_GROUPS.map((group) => (
            <div key={group.part} className="flex min-w-0 flex-col gap-1">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {webhookText(group.part)}
              </p>
              {group.types.map((type) => (
                <label key={type} className="flex min-h-9 items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-primary"
                    checked={draft.events.includes(type)}
                    onChange={(event) => toggle(type, event.target.checked)}
                  />
                  <span className="min-w-0">{eventLabel(type)}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
        {issues.events ? (
          <p id={eventsErrorId} className="text-sm text-destructive">
            {issues.events}
          </p>
        ) : null}
      </fieldset>
      {problem ? <FormError>{problem}</FormError> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={state === "busy"}>
          {webhookText(state === "busy" ? busyPart : submitPart)}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {webhookText(unchanged ? "close_edit" : "cancel")}
        </Button>
        <span role="status" className="text-sm text-muted-foreground">
          {state === "saved" && unchanged ? webhookText("saved") : ""}
        </span>
      </div>
    </form>
  );
}

type Confirm = "rotate" | "delete" | null;

function EndpointEditor({
  row,
  locale,
  now,
  onClose,
  onUpdate,
  onSetEnabled,
  onTest,
  onDelete,
  onRotate,
}: {
  row: WebhookRow;
  locale: Locale;
  now: number;
  onClose: () => void;
  onUpdate: PanelProps["onUpdate"];
  onSetEnabled: PanelProps["onSetEnabled"];
  onTest: PanelProps["onTest"];
  onDelete: PanelProps["onDelete"];
  onRotate: (id: string) => Promise<boolean>;
}) {
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState<"toggle" | "test" | "rotate" | "delete" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; part: string } | null>(null);
  const host = hostOf(row.url);
  const act = async (
    what: NonNullable<typeof busy>,
    work: () => Promise<{ ok: boolean; part?: string }>,
  ) => {
    setBusy(what);
    setNote(null);
    const result = await work();
    setBusy(null);
    if (result.part) setNote({ ok: result.ok, part: result.part });
  };
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <StateBadge row={row} />
        <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{webhookName(row)}</span>
      </div>
      <EndpointForm
        initial={draftOf(row)}
        submitPart="save"
        busyPart="saving"
        unchanged={(draft) => sameDraft(draft, row)}
        onCancel={onClose}
        onSubmit={async (draft) =>
          (await onUpdate(row.id, draft)) ? null : { form: webhookText("save_failed") }
        }
      />
      <div className="flex flex-col gap-3 border-t pt-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              void act("toggle", async () => {
                const ok = await onSetEnabled(row.id, !row.enabled);
                return ok ? { ok } : { ok, part: "toggle_failed" };
              })
            }
          >
            {webhookText(row.enabled ? "turn_off" : "turn_on")}
          </Button>
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              void act("test", async () => {
                const outcome = await onTest(row.id);
                return outcome === "sent"
                  ? { ok: true, part: "test_sent" }
                  : { ok: false, part: outcome === "too_soon" ? "test_too_soon" : "test_failed" };
              })
            }
          >
            <SendIcon aria-hidden />
            {webhookText(busy === "test" ? "testing" : "test")}
          </Button>
          <Button variant="outline" disabled={busy !== null} onClick={() => setConfirm("rotate")}>
            {webhookText("rotate")}
          </Button>
          <Button variant="outline" disabled={busy !== null} onClick={() => setConfirm("delete")}>
            {webhookText("delete")}
          </Button>
        </div>
        {note ? (
          note.ok ? (
            <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
              <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0">{webhookText(note.part)}</span>
            </p>
          ) : (
            <FormError>{webhookText(note.part)}</FormError>
          )
        ) : null}
        {confirm ? (
          <div className="flex flex-col gap-3 rounded-md bg-muted p-3">
            <p className="max-w-prose text-sm [overflow-wrap:anywhere]">
              {webhookText(confirm === "rotate" ? "rotate_confirm" : "delete_confirm", { host })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={confirm === "delete" ? "destructive" : "default"}
                className={confirm === "delete" ? CONFIRM_DESTRUCTIVE : undefined}
                disabled={busy !== null}
                onClick={() =>
                  void act(confirm, async () => {
                    const ok =
                      confirm === "rotate" ? await onRotate(row.id) : await onDelete(row.id);
                    if (ok) setConfirm(null);
                    return ok
                      ? { ok }
                      : { ok, part: confirm === "rotate" ? "rotate_failed" : "delete_failed" };
                  })
                }
              >
                {webhookText(
                  busy === confirm
                    ? confirm === "rotate"
                      ? "rotating"
                      : "deleting"
                    : confirm === "rotate"
                      ? "rotate_go"
                      : "delete_go",
                )}
              </Button>
              <Button variant="outline" onClick={() => setConfirm(null)}>
                {webhookText(confirm === "rotate" ? "keep" : "cancel")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      <Deliveries attempts={row.recent} locale={locale} now={now} />
    </div>
  );
}

function Deliveries({
  attempts,
  locale,
  now,
}: {
  attempts: WebhookAttempt[];
  locale: Locale;
  now: number;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-2 border-t pt-4">
      <h3 id={titleId} className="text-sm font-medium">
        {webhookText("recent_title")}
      </h3>
      {attempts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{webhookText("recent_empty")}</p>
      ) : (
        <ol className="flex min-w-0 flex-col divide-y rounded-md border">
          {attempts.map((attempt) => (
            <li
              key={`${attempt.eventId}:${attempt.attempt}:${attempt.at}`}
              className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-3 py-2 text-sm"
            >
              <span
                className={cn(
                  "mt-0.5 inline-flex h-5 min-w-10 items-center justify-center rounded-sm px-1.5 font-mono text-xs tabular-nums",
                  attempt.ok
                    ? "bg-status-resolved text-status-resolved-foreground"
                    : "bg-destructive/10 text-destructive",
                )}
              >
                {attempt.status ?? "—"}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="flex min-w-0 flex-wrap gap-x-2">
                  <span className="font-medium">{eventLabel(attempt.type)}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatAge(Math.min(attempt.at, now), now, locale)}
                    {attempt.ms !== null ? ` · ${attempt.ms} ms` : ""}
                    {attempt.attempt > 1
                      ? ` · ${webhookText("attempt", { when: String(attempt.attempt) })}`
                      : ""}
                  </span>
                </p>
                {!attempt.ok ? (
                  <p className="min-w-0 text-destructive [overflow-wrap:anywhere]">
                    {attemptResult(attempt)}
                  </p>
                ) : null}
                {attempt.snippet ? (
                  <p className="min-w-0 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {attempt.snippet}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The signing secret, once: the shard keeps it sealed and never shows it again. Copy takes focus. */
function SecretOnce({ shown, onDismiss }: { shown: Shown; onDismiss: () => void }) {
  const textId = useId();
  const hintId = useId();
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const [asking, setAsking] = useState(false);
  const copyRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => copyRef.current?.focus(), [shown.secret]);
  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown.secret);
      setCopied(true);
      setManual(false);
      setAsking(false);
    } catch {
      setManual(true);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
      <div className="flex items-start gap-3">
        <div id={textId} className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-semibold [overflow-wrap:anywhere]">
            {webhookText(shown.rotated ? "secret_rotated" : "secret_created", { host: shown.host })}
          </p>
          <p>{webhookText("secret_verify")}</p>
        </div>
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
          value={shown.secret}
          aria-label={webhookText("secret_label")}
          aria-describedby={manual ? hintId : textId}
          onFocus={(event) => event.currentTarget.select()}
          className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 font-mono text-base outline-none focus-visible:ring-3 focus-visible:ring-ring sm:text-sm"
        />
        <Button ref={copyRef} onClick={() => void copy()}>
          {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          {webhookText(copied ? "copied" : "copy")}
        </Button>
      </div>
      <span role="status" className="sr-only">
        {copied ? webhookText("copied") : ""}
      </span>
      {manual ? (
        <p id={hintId} className="-mt-1 text-muted-foreground">
          {webhookText(isApple() ? "copy_key_apple" : "copy_key")}
        </p>
      ) : null}
      {asking ? (
        <div className="flex flex-col gap-2 rounded-md bg-card p-3">
          <p className="font-medium">{webhookText("close_prompt")}</p>
          <div className="flex flex-wrap gap-2">
            <Button ref={keepRef} variant="outline" onClick={() => setAsking(false)}>
              {webhookText("keep_open")}
            </Button>
            <Button variant="ghost" onClick={onDismiss}>
              {webhookText("close")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function isApple(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
  );
}

/** Epoch ms, refreshed every `ms`, so relative times move on their own. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
