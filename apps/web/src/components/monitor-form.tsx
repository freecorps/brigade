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
  PROBE_REGIONS,
  type HttpMethod,
} from "@freecorps/brigade-schema";
import { useSyncClient } from "@freecorps/brigade-sync/react";
import { cn } from "cn";
import { CheckIcon, CircleAlertIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  checkDraft,
  EMPTY_DRAFT,
  type CheckedDraft,
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

/**
 * A new HTTP check or heartbeat. Checked on submit with the mutation's own validator, so a value the shard would
 * refuse is marked in its field, with what to fix, and the draft stays. `onCreate` sends it; the form closes when
 * it resolves true. The name field takes focus when the form opens; Escape cancels.
 */
export function MonitorForm({
  onCreate,
  onCancel,
}: {
  onCreate: (checked: Extract<CheckedDraft, { ok: true }>) => Promise<boolean>;
  onCancel: () => void;
}) {
  const client = useSyncClient();
  const [draft, setDraft] = useState<MonitorDraft>(EMPTY_DRAFT);
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    const checked = checkDraft(draft, client.newId("mon"));
    if (!checked.ok) {
      setInvalid(new Set(checked.fields));
      // The first refused field, in form order.
      requestAnimationFrame(() =>
        formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus(),
      );
      return;
    }
    setSending(true);
    void onCreate(checked).then((done) => {
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
  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onKeyDown={onKeyDown}
      noValidate
      aria-label={m.monitor_add()}
      className="flex flex-col gap-4 rounded-md border bg-muted/40 p-4"
    >
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
            <label key={kind} className={cn(SEGMENT, draft.kind === kind ? SELECTED : UNSELECTED)}>
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

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={sending}>
          {m.monitor_create()}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {m.declare_cancel()}
        </Button>
      </div>
    </form>
  );
}
