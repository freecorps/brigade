import { m } from "@freecorps/brigade-i18n";
import {
  HTTP_METHODS,
  MAX_GRACE_SECONDS,
  MAX_INTERVAL_SECONDS,
  MAX_TIMEOUT_SECONDS,
  MIN_INTERVAL_SECONDS,
  MONITOR_KEYWORD_MAX,
  MONITOR_KINDS,
  MONITOR_NAME_MAX,
  MONITOR_URL_MAX,
  monitorAlerting,
  PROBE_REGIONS,
  type HttpMethod,
  type MonitorRow,
} from "@freecorps/brigade-schema";
import { useSyncClient } from "@freecorps/brigade-sync/react";
import { cn } from "cn";
import { CheckIcon, CircleAlertIcon, Trash2Icon } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  checkDraft,
  checkEdit,
  draftFromRow,
  editRestarts,
  EMPTY_DRAFT,
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

/** The `monitor_field_invalid` / `monitor_field_hint` key for a draft field. */
const FIELD_KEYS: Record<DraftField, string> = {
  name: "name",
  url: "url",
  expectedStatus: "expected_status",
  keyword: "keyword",
  intervalSeconds: "interval",
  timeoutSeconds: "timeout",
  graceSeconds: "grace",
  regions: "regions",
};

/** What the form is for: a new monitor, or changes to `row` (whose kind stays), which can also delete it. */
export type MonitorFormMode =
  | {
      kind: "create";
      onCreate: (checked: Extract<CheckedDraft, { ok: true }>) => Promise<boolean>;
    }
  | {
      kind: "edit";
      row: MonitorRow;
      /** Called only when something changed; the form is closed by its owner. */
      onSave: (checked: Extract<CheckedEdit, { ok: true }>) => void;
      onDelete: () => void;
    };

/**
 * A new HTTP check or heartbeat, or an existing one's settings. Checked on submit with the mutation's own validator,
 * so a value the shard would refuse is marked in its field, with what to fix, and the draft stays. Creating:
 * `onCreate` sends it, and the form closes when it resolves true. Editing: the values are the monitor's, an edit
 * that changes nothing just closes, saving says when it starts the checks over, and Delete asks first, saying what
 * happens to its alert and incidents. The name field takes focus when the form opens; Escape cancels.
 */
export function MonitorForm({ mode, onCancel }: { mode: MonitorFormMode; onCancel: () => void }) {
  const client = useSyncClient();
  const editing = mode.kind === "edit" ? mode.row : null;
  const [draft, setDraft] = useState<MonitorDraft>(() =>
    editing ? draftFromRow(editing) : EMPTY_DRAFT,
  );
  const [invalid, setInvalid] = useState<ReadonlySet<DraftField>>(new Set());
  const [sending, setSending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const kindId = useId();
  const regionsId = useId();
  const methodId = useId();
  const regionsErrorId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const set = <K extends keyof MonitorDraft>(key: K, value: MonitorDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (invalid.has(key as DraftField)) {
      setInvalid((current) => new Set([...current].filter((field) => field !== key)));
    }
  };
  const error = (field: DraftField) =>
    invalid.has(field) ? m.monitor_field_invalid({ field: FIELD_KEYS[field] }) : undefined;
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
    if (mode.kind === "edit") {
      const checked = checkEdit(draft, mode.row);
      if (!checked.ok) return refuse(checked.fields);
      // The shard refuses an edit that changes nothing: there is nothing to send.
      if (checked.changed) mode.onSave(checked);
      else onCancel();
      return;
    }
    const checked = checkDraft(draft, client.newId("mon"));
    if (!checked.ok) return refuse(checked.fields);
    setSending(true);
    // `onCreate` can throw (no WebCrypto outside a secure context): the form must not stay busy.
    void mode
      .onCreate(checked)
      .catch(() => false)
      .then((done) => {
        setSending(false);
        if (done) setDraft(EMPTY_DRAFT);
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
  const restarts = editing ? editRestarts(draft, editing) : false;
  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onKeyDown={onKeyDown}
      noValidate
      aria-label={editing ? m.monitor_edit({ part: "form", name: editing.name }) : m.monitor_add()}
      className="flex min-w-0 flex-col gap-4 rounded-md border bg-muted/40 p-4"
    >
      {editing ? (
        // The kind is fixed once a monitor exists: said, not offered.
        <p className="text-sm font-medium text-muted-foreground">
          {m.monitor_kind({ kind: editing.kind })}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span id={kindId} className="sr-only">
            {m.monitor_field_label({ field: "kind" })}
          </span>
          <div
            role="radiogroup"
            aria-labelledby={kindId}
            className="grid w-full grid-cols-2 divide-x divide-border overflow-hidden rounded-md bg-card outline-1 -outline-offset-1 outline-input sm:w-fit"
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
                {m.monitor_kind({ kind })}
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
                className="h-11 rounded-md border border-input bg-card px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring"
              >
                {HTTP_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Field
              label={m.monitor_field_label({ field: "expected_status" })}
              hint={m.monitor_field_hint({ field: "expected_status" })}
              inputMode="numeric"
              maxLength={3}
              {...text("expectedStatus")}
            />
            {draft.method === "GET" ? (
              <Field
                label={m.monitor_field_label({ field: "keyword" })}
                maxLength={MONITOR_KEYWORD_MAX}
                autoComplete="off"
                {...text("keyword")}
              />
            ) : null}
          </div>
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
        {http ? (
          <Field
            label={m.monitor_field_label({ field: "timeout" })}
            hint={m.monitor_field_hint({ field: "timeout" })}
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

      {restarts ? (
        <p className="rounded-md bg-card px-3 py-2 text-sm text-muted-foreground">
          {m.monitor_edit({ part: "restart", name: "" })}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={sending}>
          {editing ? m.monitor_edit({ part: "save", name: "" }) : m.monitor_create()}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {m.declare_cancel()}
        </Button>
        {mode.kind === "edit" ? <DeleteMonitor row={mode.row} onDelete={mode.onDelete} /> : null}
      </div>
    </form>
  );
}

/**
 * Delete, at the end of the edit form and away from Save, asking first in place: what goes (the checks and their
 * results, a heartbeat's URL) and what stays (a firing alert resolves, its incident stays open for people to close,
 * as `monitor.delete` does). Escape in the prompt closes only the prompt.
 */
function DeleteMonitor({ row, onDelete }: { row: MonitorRow; onDelete: () => void }) {
  const promptId = useId();
  const [asking, setAsking] = useState(false);
  const askRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);
  const cancel = () => {
    setAsking(false);
    requestAnimationFrame(() => askRef.current?.focus());
  };
  const alerting = monitorAlerting(row);
  return (
    <>
      <Button
        ref={askRef}
        type="button"
        variant="ghost"
        aria-expanded={asking}
        className="text-destructive sm:ml-auto"
        onClick={() => setAsking(true)}
      >
        <Trash2Icon aria-hidden />
        {m.monitor_delete({ part: "action", name: "" })}
      </Button>
      {asking ? (
        <div
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
            <Button type="button" variant="destructive" onClick={onDelete}>
              <Trash2Icon aria-hidden />
              {m.monitor_delete({ part: "confirm", name: "" })}
            </Button>
            <Button ref={keepRef} type="button" variant="ghost" onClick={cancel}>
              {m.declare_cancel()}
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
