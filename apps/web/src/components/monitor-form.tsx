import { m } from "@freecorps/brigade-i18n";
import { severityName } from "@freecorps/brigade-i18n/incident";
import {
  HTTP_METHODS,
  KEYWORD_MODES,
  MAX_CONSECUTIVE_CHECKS,
  MAX_MONITOR_HEADERS,
  MAX_GRACE_SECONDS,
  MAX_INTERVAL_SECONDS,
  MAX_TIMEOUT_SECONDS,
  MIN_INTERVAL_SECONDS,
  MONITOR_HEADER_NAME_MAX,
  MONITOR_HEADER_VALUE_MAX,
  MONITOR_HOST_MAX,
  MONITOR_KEYWORD_MAX,
  MONITOR_KINDS,
  MONITOR_NAME_MAX,
  MONITOR_URL_MAX,
  monitorAlerting,
  PROBE_REGIONS,
  SEVERITIES,
  type EscalationPolicyRow,
  type HttpMethod,
  type KeywordMode,
  type MonitorRow,
  type Severity,
} from "@freecorps/brigade-schema";
import { useSyncClient } from "@freecorps/brigade-sync/react";
import { cn } from "cn";
import {
  CheckIcon,
  CircleAlertIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { usePreferences } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import {
  checkDraft,
  checkEdit,
  draftChanged,
  rebaseDraft,
  draftFromRow,
  editRestarts,
  EMPTY_DRAFT,
  formatSeconds,
  listsServerError,
  monitorLimitReached,
  patternFieldReason,
  quorumIsEveryRegion,
  refusedHeaderRows,
  secondsToDown,
  splitHostPort,
  stalePolicy,
  tcpFieldReason,
  type CheckedDraft,
  type CheckedEdit,
  type DraftField,
  type MonitorDraft,
} from "@/lib/monitors";

/** The same chrome as the declare form's segments: native radios and checkboxes drawn as 44px targets. */
const SEGMENT =
  "flex min-h-11 cursor-pointer items-center justify-center gap-1.5 px-3 py-2 text-sm leading-tight select-none has-focus-visible:ring-3 has-focus-visible:ring-ring has-focus-visible:ring-inset";
const SELECTED = "bg-primary text-primary-foreground";
const UNSELECTED = "text-muted-foreground hover:bg-muted";

/**
 * A confirming destructive button. The variant is a red tint on dark, which reads lighter than the trigger that
 * opened the prompt: the last step gets a solid fill in both themes.
 */
export const CONFIRM_DESTRUCTIVE =
  "dark:bg-destructive dark:text-destructive-foreground dark:hover:bg-destructive/90";

/** The `monitor_field_invalid` / `monitor_field_hint` key for a draft field. */
const FIELD_KEYS: Record<DraftField, string> = {
  name: "name",
  url: "url",
  host: "host",
  port: "port",
  expectedStatus: "expected_status",
  keyword: "keyword",
  headers: "headers",
  intervalSeconds: "interval",
  timeoutSeconds: "timeout",
  graceSeconds: "grace",
  regions: "regions",
  quorum: "quorum",
  consecutiveChecks: "consecutive",
  policyId: "policy",
};

/** A header row's inputs: the Field input's look, without its label (each has an aria-label). */
const HEADER_INPUT =
  "field w-full min-w-0 px-3 font-mono text-sm placeholder:font-sans focus-visible:ring-3 focus-visible:ring-ring aria-invalid:border-destructive sm:text-sm max-sm:text-base";

/** The native selects' look, as the method and policy pickers had it. */
const SELECT =
  "field w-full min-w-0 truncate px-3 focus-visible:ring-3 focus-visible:ring-ring aria-invalid:border-destructive";

/** What the form is for: a new monitor, or changes to `row` (whose kind stays), which can also delete it. */
export type MonitorFormMode =
  | {
      kind: "create";
      /** The workspace has as many monitors as it may (`monitorsFull`): the form says so from the start, and sends nothing. */
      full: boolean;
      /** The most monitors the workspace may have, for what the form says when it is full. */
      cap: number;
      onCreate: (checked: Extract<CheckedDraft, { ok: true }>) => Promise<boolean>;
    }
  | {
      kind: "edit";
      row: MonitorRow;
      /** Called only when something changed; the form is closed by its owner. */
      onSave: (checked: Extract<CheckedEdit, { ok: true }>) => void;
      onDelete: () => void;
      /** A heartbeat's new URL (`monitor.rotateHeartbeat`), once confirmed; the form is closed by its owner. */
      onRotate?: () => void;
    };

/**
 * Set while another form was asked for and this one has changes: it asks whether to drop them. `asked` counts the
 * asks, so asking again while the prompt is up brings focus back to it.
 */
export type DiscardPrompt = { onDiscard: () => void; onKeep: () => void; asked: number };

/**
 * A new HTTP check, TCP port or heartbeat, or an existing one's settings. Checked on submit with the mutation's own validator,
 * so a value the shard would refuse is marked in its field, with what to fix, and the draft stays. Creating:
 * `onCreate` sends it, and the form closes when it resolves true. Editing: the values are the monitor's, an edit
 * that changes nothing just closes, saving says when it starts the checks over, and Delete asks first, saying what
 * happens to its alert and incidents. The name field takes focus when the form opens; Escape and Cancel close it,
 * changes and all, without asking: they are the explicit way out, unlike opening another form. `onChanged`
 * hears whether the draft differs from what it opened with, and `discard` asks, at the top, before it is dropped.
 * `policies` are the workspace's escalation policies, for the picker of the one its incidents page through.
 */
export function MonitorForm({
  mode,
  policies,
  onCancel,
  onChanged,
  discard,
}: {
  mode: MonitorFormMode;
  policies: readonly EscalationPolicyRow[];
  onCancel: () => void;
  onChanged?: (changed: boolean) => void;
  discard?: DiscardPrompt | null;
}) {
  const client = useSyncClient();
  const { locale } = usePreferences();
  const editing = mode.kind === "edit" ? mode.row : null;
  const [initial] = useState<MonitorDraft>(() => (editing ? draftFromRow(editing) : EMPTY_DRAFT));
  const [draft, setDraft] = useState<MonitorDraft>(initial);
  const [invalid, setInvalid] = useState<ReadonlySet<DraftField>>(new Set());
  const [sending, setSending] = useState(false);
  /** A new monitor cannot be added at all: said at the top as the form opens, not after it is filled in. */
  const full = mode.kind === "create" && mode.full;
  const formRef = useRef<HTMLFormElement>(null);
  const kindId = useId();
  const regionsId = useId();
  const methodId = useId();
  const policyId = useId();
  const policyHintId = useId();
  const policyErrorId = useId();
  const keywordModeId = useId();
  const headersId = useId();
  const headersHintId = useId();
  const headersErrorId = useId();
  const severityId = useId();
  const quorumId = useId();
  const quorumHintId = useId();
  const quorumErrorId = useId();
  const failureId = useId();
  const regionsErrorId = useId();
  const hostErrorId = useId();
  const portErrorId = useId();
  const targetHintId = useId();
  const headingId = useId();
  const restartId = useId();
  const fullId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);
  const changed = draftChanged(draft, initial);
  useEffect(() => onChanged?.(changed), [changed, onChanged]);

  const set = <K extends keyof MonitorDraft>(key: K, value: MonitorDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (invalid.has(key as DraftField)) {
      setInvalid((current) => new Set([...current].filter((field) => field !== key)));
    }
  };
  const error = (field: DraftField) =>
    invalid.has(field)
      ? m.monitor_field_invalid({
          field:
            field === "keyword" && draft.keywordMode === "regex"
              ? patternFieldReason(draft.keyword)
              : (tcpFieldReason(field, draft) ?? FIELD_KEYS[field]),
        })
      : undefined;
  /** The header rows to mark, once the list was refused. */
  const badHeaders = invalid.has("headers") ? refusedHeaderRows(draft) : [];
  const setHeader = (index: number, part: "name" | "value", value: string) =>
    set(
      "headers",
      draft.headers.map((header, at) => (at === index ? { ...header, [part]: value } : header)),
    );
  const headerRefs = useRef<(HTMLInputElement | null)[]>([]);
  /** Focus moves to this header row's name once it is drawn (a new row), or to Add header (-1, a removed last row). */
  const [focusHeader, setFocusHeader] = useState<number | null>(null);
  const addHeaderRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusHeader === null) return;
    if (focusHeader < 0) addHeaderRef.current?.focus();
    else headerRefs.current[focusHeader]?.focus();
    setFocusHeader(null);
  }, [focusHeader]);
  const text = (field: DraftField & keyof MonitorDraft) => ({
    value: draft[field] as string,
    error: error(field),
    onChange: (event: { target: { value: string } }) => set(field, event.target.value),
  });

  const refuse = (fields: DraftField[]) => {
    setInvalid(new Set(fields));
    // The first refused field, in form order.
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus(),
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    // What is sent: an edit goes out rebased on the live row (fields left alone take its values).
    const sent = mode.kind === "edit" ? rebaseDraft(draft, initial, mode.row) : draft;
    // A policy picked here and deleted while the form was open: the shard would refuse it.
    if (stalePolicy(sent, mode.kind === "edit" ? mode.row : null, policies)) {
      return refuse(["policyId"]);
    }
    if (mode.kind === "edit") {
      const checked = checkEdit(sent, mode.row);
      if (!checked.ok) return refuse(checked.fields);
      // The shard refuses an edit that changes nothing: there is nothing to send.
      if (checked.changed) mode.onSave(checked);
      else onCancel();
      return;
    }
    const checked = checkDraft(draft, client.newId("mon"));
    if (!checked.ok) return refuse(checked.fields);
    // The shard would refuse it (`limit_reached`); the draft stays, in case one is deleted.
    if (mode.full) {
      return document.getElementById(fullId)?.scrollIntoView({ block: "nearest" });
    }
    setSending(true);
    // `onCreate` can throw (no WebCrypto outside a secure context): the form must not stay busy.
    void mode
      .onCreate(checked)
      .catch(() => false)
      .then((done) => {
        setSending(false);
        if (done) setDraft(initial);
      });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // A native <select> handles its own Escape while open.
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      onCancel();
    }
  };

  const http = draft.kind === "http";
  const tcp = draft.kind === "tcp";
  /** Checked from the probe regions, with a timeout: HTTP and TCP. */
  const probed = http || tcp;
  const restarts = editing ? editRestarts(rebaseDraft(draft, initial, editing), editing) : false;
  const toDown = probed ? secondsToDown(draft) : undefined;
  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onKeyDown={onKeyDown}
      noValidate
      aria-label={editing ? undefined : m.monitor_add()}
      aria-labelledby={editing ? headingId : undefined}
      className="flex min-w-0 flex-col gap-4 rounded-md border bg-muted/40 p-4"
    >
      {full && mode.kind === "create" ? (
        <FormError id={fullId}>{monitorLimitReached(mode.cap, locale)}</FormError>
      ) : null}
      {discard ? (
        <DiscardChanges
          name={editing?.name ?? null}
          {...discard}
          onKeep={() => {
            nameRef.current?.focus();
            discard.onKeep();
          }}
        />
      ) : null}
      {editing ? (
        // The kind is fixed once a monitor exists: said, not offered.
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3
            id={headingId}
            className="line-clamp-2 font-medium [overflow-wrap:anywhere]"
            title={editing.name}
          >
            {m.monitor_edit({ part: "form", name: editing.name })}
          </h3>
          <p className="text-sm text-muted-foreground">{m.monitor_kind({ kind: editing.kind })}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span id={kindId} className="sr-only">
            {m.monitor_field_label({ field: "kind" })}
          </span>
          <div
            role="radiogroup"
            aria-labelledby={kindId}
            className="grid w-full grid-cols-[repeat(3,minmax(max-content,1fr))] divide-x divide-border overflow-hidden rounded-md bg-card outline-1 -outline-offset-1 outline-input sm:w-fit"
          >
            {MONITOR_KINDS.map((kind) => (
              <label
                key={kind}
                className={cn(SEGMENT, draft.kind === kind ? SELECTED : UNSELECTED)}
              >
                <input
                  type="radio"
                  name={kindId}
                  value={kind}
                  checked={draft.kind === kind}
                  onChange={() => set("kind", kind)}
                  className="sr-only"
                />
                {/* Short, so three fit on a 320px phone in every language; the edit header has the long name. */}
                {m.monitor_kind_short({ kind })}
              </label>
            ))}
          </div>
        </div>
      )}

      <Field
        ref={nameRef}
        label={m.monitor_field_label({ field: "name" })}
        maxLength={MONITOR_NAME_MAX}
        autoComplete="off"
        {...text("name")}
      />

      {http ? (
        <>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field
              label={m.monitor_field_label({ field: "url" })}
              hint={m.monitor_field_hint({ field: "url" })}
              type="url"
              inputMode="url"
              placeholder="https://example.com/health"
              maxLength={MONITOR_URL_MAX}
              autoComplete="off"
              spellCheck={false}
              {...text("url")}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor={methodId} className="text-sm font-medium">
                {m.monitor_field_label({ field: "method" })}
              </label>
              <select
                id={methodId}
                value={draft.method}
                onChange={(event) => set("method", event.target.value as HttpMethod)}
                className="field px-3 focus-visible:ring-3 focus-visible:ring-ring"
              >
                {HTTP_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 sm:max-w-md">
            <Field
              label={m.monitor_field_label({ field: "expected_status" })}
              hint={m.monitor_field_hint({ field: "expected_status" })}
              inputMode="numeric"
              placeholder="200, 204, 301-302"
              maxLength={80}
              autoComplete="off"
              spellCheck={false}
              {...text("expectedStatus")}
            />
            <Warning>
              {listsServerError(draft.expectedStatus)
                ? m.monitor_form_note({ kind: "status_5xx", time: "" })
                : null}
            </Warning>
          </div>
          {draft.method === "GET" ? (
            // The text or pattern, and how it is matched next to it, as the URL has its method.
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Field
                label={m.monitor_field_label({
                  field: draft.keywordMode === "regex" ? "keyword_regex" : "keyword",
                })}
                hint={
                  draft.keywordMode === "regex"
                    ? m.monitor_field_hint({ field: "keyword_regex" })
                    : undefined
                }
                maxLength={MONITOR_KEYWORD_MAX}
                autoComplete="off"
                spellCheck={false}
                className={draft.keywordMode === "regex" ? "[&_input]:font-mono" : undefined}
                {...text("keyword")}
              />
              <div className="flex flex-col gap-1.5">
                <label htmlFor={keywordModeId} className="text-sm font-medium">
                  {m.monitor_field_label({ field: "keyword_mode" })}
                </label>
                <select
                  id={keywordModeId}
                  value={draft.keywordMode}
                  onChange={(event) => set("keywordMode", event.target.value as KeywordMode)}
                  className={cn(SELECT, "sm:w-auto")}
                >
                  {KEYWORD_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {m.monitor_keyword_mode({ mode })}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
          <fieldset
            className="flex min-w-0 flex-col gap-2"
            aria-describedby={describe(
              invalid.has("headers") && headersErrorId,
              draft.headers.length > 0 && headersHintId,
            )}
          >
            <legend id={headersId} className="mb-1.5 text-sm font-medium">
              {m.monitor_field_label({ field: "headers" })}
            </legend>
            {draft.headers.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {draft.headers.map((header, index) => {
                  const bad = badHeaders.includes(index);
                  return (
                    // Rows have no id of their own; the index is stable while a row is edited.
                    <li
                      key={index}
                      // A phone stacks the value under the name, so both stay readable; the remove button
                      // spans both. From `sm`, one row.
                      className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]"
                    >
                      <input
                        ref={(element) => {
                          headerRefs.current[index] = element;
                        }}
                        aria-label={m.monitor_field_label({ field: "header_name" })}
                        aria-invalid={bad || undefined}
                        placeholder="Accept"
                        value={header.name}
                        maxLength={MONITOR_HEADER_NAME_MAX}
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        onChange={(event) => setHeader(index, "name", event.target.value)}
                        className={HEADER_INPUT}
                      />
                      <input
                        aria-label={m.monitor_field_label({ field: "header_value" })}
                        aria-invalid={bad || undefined}
                        placeholder="application/json"
                        value={header.value}
                        maxLength={MONITOR_HEADER_VALUE_MAX}
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        onChange={(event) => setHeader(index, "value", event.target.value)}
                        className={HEADER_INPUT}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="col-start-2 row-span-2 row-start-1 size-11 self-center pointer-fine:size-9 sm:col-start-3 sm:row-span-1"
                        aria-label={
                          header.name.trim()
                            ? m.monitor_header({ part: "remove", name: header.name.trim() })
                            : m.monitor_header({ part: "remove_unnamed", name: "" })
                        }
                        onClick={() => {
                          set(
                            "headers",
                            draft.headers.filter((_, at) => at !== index),
                          );
                          // The row under it takes its place, or the one above, or Add header.
                          const left = draft.headers.length - 1;
                          setFocusHeader(left === 0 ? -1 : Math.min(index, left - 1));
                        }}
                      >
                        <XIcon aria-hidden />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {invalid.has("headers") ? (
              <p id={headersErrorId} className="flex items-start gap-1.5 text-sm text-destructive">
                <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0">{error("headers")}</span>
              </p>
            ) : null}
            {draft.headers.length > 0 ? (
              <p id={headersHintId} className="text-sm text-muted-foreground">
                {m.monitor_field_hint({ field: "headers" })}
              </p>
            ) : null}
            {draft.headers.length < MAX_MONITOR_HEADERS ? (
              <Button
                ref={addHeaderRef}
                type="button"
                variant="outline"
                className="self-start"
                aria-describedby={headersId}
                onClick={() => {
                  set("headers", [...draft.headers, { name: "", value: "" }]);
                  setFocusHeader(draft.headers.length);
                }}
              >
                <PlusIcon aria-hidden />
                {m.monitor_header({ part: "add", name: "" })}
              </Button>
            ) : null}
          </fieldset>
        </>
      ) : null}

      {tcp ? (
        // Host and port on one row at every width, the port narrower on a phone so the host keeps the room; their
        // errors and the hint run under both, full width.
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-[minmax(0,1fr)_4.75rem] gap-3 sm:grid-cols-[minmax(0,1fr)_6.5rem]">
            <Field
              label={m.monitor_field_label({ field: "host" })}
              placeholder="db.example.com"
              maxLength={MONITOR_HOST_MAX}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              {...text("host")}
              error={undefined}
              aria-invalid={invalid.has("host") || undefined}
              aria-describedby={describe(invalid.has("host") && hostErrorId, targetHintId)}
              onPaste={(event) => {
                // `db.example.com:5432` or `postgres://db.example.com:5432/app` into both fields, when it
                // replaces the whole host; pasted into the middle of one, it goes in as typed.
                const input = event.currentTarget;
                const whole =
                  input.selectionStart === 0 && input.selectionEnd === input.value.length;
                const split = whole ? splitHostPort(event.clipboardData.getData("text")) : null;
                if (!split) return;
                event.preventDefault();
                set("host", split.host);
                if (split.port !== null) set("port", split.port);
              }}
            />
            <Field
              label={m.monitor_field_label({ field: "port" })}
              inputMode="numeric"
              placeholder="5432"
              maxLength={5}
              {...text("port")}
              error={undefined}
              aria-invalid={invalid.has("port") || undefined}
              aria-describedby={describe(invalid.has("port") && portErrorId, targetHintId)}
            />
          </div>
          {(["host", "port"] as const).map((field) =>
            invalid.has(field) ? (
              <p
                key={field}
                id={field === "host" ? hostErrorId : portErrorId}
                className="flex items-start gap-1.5 text-sm text-destructive"
              >
                <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{error(field)}</span>
              </p>
            ) : null,
          )}
          <p id={targetHintId} className="text-sm text-muted-foreground">
            {m.monitor_field_hint({ field: "host" })} {m.monitor_field_hint({ field: "port" })}
          </p>
        </div>
      ) : null}

      {probed ? (
        <>
          <fieldset
            className="flex flex-col gap-1.5"
            aria-describedby={invalid.has("regions") ? regionsErrorId : undefined}
          >
            <legend id={regionsId} className="mb-1.5 text-sm font-medium">
              {m.monitor_field_label({ field: "regions" })}
            </legend>
            <div
              className={cn(
                "grid grid-cols-2 gap-px overflow-hidden rounded-md bg-border outline-1 -outline-offset-1 sm:grid-cols-3",
                invalid.has("regions") ? "outline-destructive" : "outline-input",
              )}
            >
              {PROBE_REGIONS.map((region) => {
                const checked = draft.regions.includes(region);
                return (
                  <label
                    key={region}
                    className={cn(
                      SEGMENT,
                      "justify-start bg-card",
                      checked ? "font-medium text-foreground" : UNSELECTED,
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      aria-invalid={invalid.has("regions") || undefined}
                      aria-describedby={invalid.has("regions") ? regionsErrorId : undefined}
                      onChange={() =>
                        set(
                          "regions",
                          checked
                            ? draft.regions.filter((r) => r !== region)
                            : [...draft.regions, region],
                        )
                      }
                      className="sr-only"
                    />
                    {/* Always there, so checking a region never moves its label. */}
                    <span
                      aria-hidden
                      className={cn(
                        "grid size-4 shrink-0 place-items-center rounded-sm border",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input",
                      )}
                    >
                      <CheckIcon className={cn("size-3", !checked && "invisible")} />
                    </span>
                    <span className="min-w-0">{m.monitor_region({ region })}</span>
                  </label>
                );
              })}
            </div>
            {invalid.has("regions") ? (
              <p id={regionsErrorId} className="flex items-start gap-1.5 text-sm text-destructive">
                <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0">{m.monitor_field_invalid({ field: "regions" })}</span>
              </p>
            ) : null}
          </fieldset>
        </>
      ) : null}

      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field
          label={m.monitor_field_label({ field: "interval" })}
          inputMode="numeric"
          maxLength={String(MAX_INTERVAL_SECONDS).length}
          placeholder={String(MIN_INTERVAL_SECONDS)}
          {...text("intervalSeconds")}
        />
        {probed ? (
          <Field
            label={m.monitor_field_label({ field: "timeout" })}
            hint={m.monitor_field_hint({ field: tcp ? "timeout_tcp" : "timeout" })}
            inputMode="numeric"
            maxLength={String(MAX_TIMEOUT_SECONDS).length}
            {...text("timeoutSeconds")}
          />
        ) : (
          <Field
            label={m.monitor_field_label({ field: "grace" })}
            hint={m.monitor_field_hint({ field: "grace" })}
            inputMode="numeric"
            maxLength={String(MAX_GRACE_SECONDS).length}
            {...text("graceSeconds")}
          />
        )}
      </div>

      {/* What happens when it fails: what the incident is, who it pages, and for checks from regions, when it counts. */}
      <fieldset
        aria-labelledby={failureId}
        className="flex min-w-0 flex-col gap-4 border-t border-border pt-4"
      >
        <h4 id={failureId} className="text-sm font-semibold">
          {m.monitor_failure_title()}
        </h4>
        <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={severityId} className="text-sm font-medium">
              {m.monitor_field_label({ field: "severity" })}
            </label>
            <select
              id={severityId}
              value={draft.severity}
              onChange={(event) => set("severity", event.target.value as Severity)}
              className={SELECT}
            >
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {severityName(severity)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={policyId} className="text-sm font-medium">
              {m.monitor_field_label({ field: "policy" })}
            </label>
            <select
              id={policyId}
              value={draft.policyId}
              onChange={(event) => set("policyId", event.target.value)}
              aria-invalid={invalid.has("policyId") ? true : undefined}
              aria-describedby={describe(invalid.has("policyId") && policyErrorId, policyHintId)}
              className={SELECT}
            >
              <option value="">{defaultOption(policies)}</option>
              {policies
                .filter((policy) => !policy.isDefault || policy.id === initial.policyId)
                .map((policy) => (
                  <option key={policy.id} value={policy.id}>
                    {policy.name}
                  </option>
                ))}
              {/* The policy it names, until this client has it (or after it went): still shown, not silently swapped. */}
              {draft.policyId !== "" && !policies.some((policy) => policy.id === draft.policyId) ? (
                <option value={draft.policyId}>{m.escalation_text(GONE)}</option>
              ) : null}
            </select>
            {invalid.has("policyId") ? (
              <p id={policyErrorId} className="flex items-start gap-1.5 text-sm text-destructive">
                <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0">{m.monitor_field_invalid({ field: "policy" })}</span>
              </p>
            ) : null}
            <p id={policyHintId} className="text-sm text-muted-foreground">
              {m.monitor_field_hint({ field: "policy" })}
            </p>
          </div>
        </div>
        {probed ? (
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={quorumId} className="text-sm font-medium">
                {m.monitor_field_label({ field: "quorum" })}
              </label>
              <select
                id={quorumId}
                value={draft.quorum}
                onChange={(event) => set("quorum", event.target.value)}
                aria-invalid={invalid.has("quorum") || undefined}
                aria-describedby={describe(invalid.has("quorum") && quorumErrorId, quorumHintId)}
                className={SELECT}
              >
                <option value="">
                  {m.monitor_quorum_option({ kind: "majority", count: "", total: "" })}
                </option>
                {quorumChoices(draft).map((count) => (
                  <option key={count} value={String(count)}>
                    {m.monitor_quorum_option({
                      kind: "count",
                      count: String(count),
                      total: String(draft.regions.length),
                    })}
                  </option>
                ))}
              </select>
              {invalid.has("quorum") ? (
                <p id={quorumErrorId} className="flex items-start gap-1.5 text-sm text-destructive">
                  <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0">{error("quorum")}</span>
                </p>
              ) : null}
              <p id={quorumHintId} className="text-sm text-muted-foreground">
                {m.monitor_field_hint({ field: "quorum" })}
              </p>
              <Warning>
                {quorumIsEveryRegion(draft)
                  ? m.monitor_form_note({ kind: "quorum_all", time: "" })
                  : null}
              </Warning>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Field
                label={m.monitor_field_label({ field: "consecutive" })}
                hint={m.monitor_field_hint({ field: "consecutive" })}
                inputMode="numeric"
                placeholder="2"
                maxLength={String(MAX_CONSECUTIVE_CHECKS).length}
                {...text("consecutiveChecks")}
              />
              {toDown === undefined ? null : (
                <p className="text-sm text-muted-foreground">
                  {m.monitor_form_note({ kind: "time", time: formatSeconds(toDown, locale) })}
                </p>
              )}
            </div>
          </div>
        ) : null}
      </fieldset>

      {mode.kind === "edit" && mode.row.kind === "heartbeat" && mode.onRotate ? (
        <RotateHeartbeat row={mode.row} changed={changed} onRotate={mode.onRotate} />
      ) : null}

      <div>
        {/* Always there, so the note is announced when an edit starts to restart the checks. */}
        <div aria-live="polite">
          {restarts ? (
            <p
              id={restartId}
              className="mb-4 rounded-md bg-card px-3 py-2 text-sm text-muted-foreground"
            >
              {m.monitor_edit({ part: "restart", name: "" })}
              {/* `monitor.updateHttp` and `updateTcp` start it over from Waiting but keeps its alert and incident. */}
              {editing && monitorAlerting(editing)
                ? ` ${m.monitor_edit({ part: "restart_alert", name: "" })}`
                : null}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            disabled={sending}
            aria-describedby={restarts ? restartId : full ? fullId : undefined}
          >
            {editing ? m.monitor_edit({ part: "save", name: "" }) : m.monitor_create()}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {m.declare_cancel()}
          </Button>
          {mode.kind === "edit" ? <DeleteMonitor row={mode.row} onDelete={mode.onDelete} /> : null}
        </div>
      </div>
    </form>
  );
}

/** A choice the form allows but that can keep a monitor from paging; announced as it appears. */
function Warning({ children }: { children: string | null }) {
  return (
    <div aria-live="polite">
      {children === null ? null : (
        <p className="flex items-start gap-1.5 text-sm text-amber-800 dark:text-amber-300">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{children}</span>
        </p>
      )}
    </div>
  );
}

const GONE = { text: "gone", name: "", time: "", level: "", reason: "", who: "" } as const;

/**
 * The quorums the picker offers: 1 to the number of regions ticked, and the draft's own if it is more (regions were
 * unticked since), so it stays shown until it is changed, and the form says to.
 */
function quorumChoices(draft: Pick<MonitorDraft, "regions" | "quorum">): number[] {
  const regions = Math.max(1, draft.regions.length);
  const own = Number(draft.quorum);
  const top = Number.isInteger(own) && own > regions ? own : regions;
  return Array.from({ length: top }, (_, index) => index + 1);
}

/**
 * The picker's first choice: the workspace's default, by name, or that there is none (the interim rule pages). The
 * default itself is not listed again (unless the monitor already names it): picking it by name would pin the monitor
 * to it after the default changes.
 */
function defaultOption(policies: readonly EscalationPolicyRow[]): string {
  const fallback = policies.find((policy) => policy.isDefault);
  return fallback
    ? m.monitor_policy({ kind: "option_default", name: fallback.name })
    : m.monitor_policy({ kind: "option_none", name: "" });
}

/** The ids an input is described by, skipping the ones not shown. */
const describe = (...ids: (string | false)[]) => ids.filter(Boolean).join(" ") || undefined;

/**
 * Asked when another monitor's form was opened while this one has changes: Keep editing (focused, and Escape)
 * stays here, Discard changes opens the other one.
 */
function DiscardChanges({
  name,
  onDiscard,
  onKeep,
  asked,
}: { name: string | null } & DiscardPrompt) {
  const promptId = useId();
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => keepRef.current?.focus(), [asked]);
  return (
    <div
      role="group"
      aria-labelledby={promptId}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === "Escape") {
          // The form's own Escape would close it, changes and all.
          event.preventDefault();
          event.stopPropagation();
          onKeep();
        }
      }}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-card px-3 py-2 text-sm"
    >
      <p id={promptId} className="min-w-0 flex-1 basis-48 font-medium [overflow-wrap:anywhere]">
        {name === null
          ? m.monitor_discard({ part: "prompt_new", name: "" })
          : m.monitor_discard({ part: "prompt", name })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button ref={keepRef} type="button" variant="outline" onClick={onKeep}>
          {m.monitor_discard({ part: "keep", name: "" })}
        </Button>
        <Button type="button" variant="ghost" onClick={onDiscard}>
          {m.monitor_discard({ part: name === null ? "discard_new" : "discard", name: "" })}
        </Button>
      </div>
    </div>
  );
}

/**
 * A heartbeat's URL: only its hash is kept, so it cannot be shown again, only replaced. New URL asks first in place:
 * the current URL stops working at once, and the monitor starts over (`monitor.rotateHeartbeat`). Unsaved edits in
 * the form are said to be dropped, since confirming closes it. Escape in the prompt closes only the prompt.
 */
function RotateHeartbeat({
  row,
  changed,
  onRotate,
}: {
  row: MonitorRow;
  changed: boolean;
  onRotate: () => void;
}) {
  const labelId = useId();
  const hintId = useId();
  const promptId = useId();
  const groupId = useId();
  const [asking, setAsking] = useState(false);
  const askRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);
  const cancel = () => {
    askRef.current?.focus();
    setAsking(false);
  };
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
          <p id={labelId} className="text-sm font-medium">
            {m.monitor_rotate({ part: "label", name: "" })}
          </p>
          <p id={hintId} className="text-sm text-muted-foreground">
            {m.monitor_rotate({ part: "hint", name: "" })}
          </p>
        </div>
        <Button
          ref={askRef}
          type="button"
          variant="outline"
          aria-describedby={hintId}
          aria-expanded={asking}
          aria-controls={asking ? groupId : undefined}
          onClick={() => setAsking(true)}
        >
          <RefreshCwIcon aria-hidden />
          {m.monitor_rotate({ part: "action", name: "" })}
        </Button>
      </div>
      {asking ? (
        <div
          id={groupId}
          role="group"
          aria-labelledby={promptId}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === "Escape") {
              // The form's own Escape would close the whole editor.
              event.preventDefault();
              event.stopPropagation();
              cancel();
            }
          }}
          className="flex flex-col gap-3 rounded-md border bg-card p-3 text-sm"
        >
          <div id={promptId} className="flex flex-col gap-1">
            <p className="font-medium [overflow-wrap:anywhere]">
              {m.monitor_rotate({ part: "prompt", name: row.name })}
            </p>
            <p>{m.monitor_rotate({ part: "stops", name: "" })}</p>
            <p className="text-muted-foreground">
              {m.monitor_rotate({ part: "restart", name: "" })}
              {monitorAlerting(row)
                ? ` ${m.monitor_rotate({ part: "restart_alert", name: "" })}`
                : null}
            </p>
            {changed ? (
              <p className="text-muted-foreground">
                {m.monitor_rotate({ part: "unsaved", name: "" })}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onRotate}>
              <RefreshCwIcon aria-hidden />
              {m.monitor_rotate({ part: "confirm", name: "" })}
            </Button>
            <Button ref={keepRef} type="button" variant="ghost" onClick={cancel}>
              {m.monitor_rotate({ part: "keep", name: "" })}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Delete, at the end of the edit form and away from Save, asking first in place: what goes (the checks and their
 * results, a heartbeat's URL) and what stays (a firing alert resolves, its incident is left for people to close,
 * as `monitor.delete` does). Escape in the prompt closes only the prompt.
 */
function DeleteMonitor({ row, onDelete }: { row: MonitorRow; onDelete: () => void }) {
  const promptId = useId();
  const groupId = useId();
  const [asking, setAsking] = useState(false);
  const askRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);
  const cancel = () => {
    // Delete stays mounted while the prompt is open: focus moves before the prompt goes, never to the page.
    askRef.current?.focus();
    setAsking(false);
  };
  const alerting = monitorAlerting(row);
  return (
    <>
      <Button
        ref={askRef}
        type="button"
        variant="ghost"
        aria-expanded={asking}
        aria-controls={asking ? groupId : undefined}
        // Away from Save, and still at the end when it wraps under it on a phone.
        className="ml-auto text-destructive"
        onClick={() => setAsking(true)}
      >
        <Trash2Icon aria-hidden />
        {m.monitor_delete({ part: "action", name: "" })}
      </Button>
      {asking ? (
        <div
          id={groupId}
          role="group"
          aria-labelledby={promptId}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === "Escape") {
              // The form's own Escape would close the whole editor.
              event.preventDefault();
              event.stopPropagation();
              cancel();
            }
          }}
          className="flex w-full flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <div id={promptId} className="flex flex-col gap-1">
            <p className="font-medium [overflow-wrap:anywhere]">
              {m.monitor_delete({ part: "prompt", name: row.name })}
            </p>
            <p>{m.monitor_delete({ part: alerting ? "alert" : "incidents", name: "" })}</p>
            {row.kind === "heartbeat" ? (
              <p>{m.monitor_delete({ part: "heartbeat", name: "" })}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              className={CONFIRM_DESTRUCTIVE}
              onClick={onDelete}
            >
              <Trash2Icon aria-hidden />
              {m.monitor_delete({ part: "confirm", name: "" })}
            </Button>
            <Button ref={keepRef} type="button" variant="ghost" onClick={cancel}>
              {m.monitor_delete({ part: "keep", name: "" })}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
