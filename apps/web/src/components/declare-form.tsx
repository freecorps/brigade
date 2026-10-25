import { m } from "@freecorps/brigade-i18n";
import { severityLabels } from "@freecorps/brigade-i18n/labels";
import { INCIDENT_TITLE_MAX, SEVERITIES, type Severity } from "@freecorps/brigade-schema";
import { useSyncClient } from "@freecorps/brigade-sync/react";
import { cn } from "cn";
import { CheckIcon, CircleAlertIcon, PlusIcon } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { checkDeclare, titleRefused, type Notice } from "@/lib/incidents";

/** The selected segment takes its severity's badge colours, plus a ring and a check so colour is not alone. */
const SEGMENT_TONES: Record<Severity, string> = {
  sev1: "bg-sev1 text-sev1-foreground",
  sev2: "bg-sev2 text-sev2-foreground",
  sev3: "bg-sev3 text-sev3-foreground",
  sev4: "bg-sev4 text-sev4-foreground",
};

/** Matches Tailwind's `md`: from here the form is always open. */
const WIDE = "(min-width: 48rem)";

/**
 * Title and severity, then Declare. Below `md` it starts as one "Declare incident" button that opens the form in
 * place, and closes again after a declare or Cancel. It works in every connection state: a declare made offline
 * waits in the client and is sent on reconnect.
 */
export function DeclareForm({
  onDeclare,
}: {
  /** Resolves with the notice the outcome left, if it was refused. */
  onDeclare: (args: {
    id: string;
    title: string;
    severity: Severity;
  }) => Promise<Notice | undefined>;
}) {
  const client = useSyncClient();
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<Severity>("sev3");
  const [invalid, setInvalid] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const errorId = useId();
  const severityId = useId();
  const groupName = useId();

  const open = () => {
    flushSync(() => setExpanded(true));
    titleRef.current?.focus();
  };
  /** Phones only: fold the form back behind its button and keep focus there. */
  const close = () => {
    if (window.matchMedia(WIDE).matches) return;
    flushSync(() => setExpanded(false));
    openerRef.current?.focus();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const checked = checkDeclare(client.newId("inc"), title, severity);
    if (!checked.ok) {
      setInvalid(true);
      titleRef.current?.focus();
      return;
    }
    setInvalid(false);
    const typed = title;
    setTitle("");
    close();
    void onDeclare(checked.args).then((notice) => {
      // The shard found the title invalid after all: give the text back, unless something new was typed. Not
      // for a clock refusal: the title was fine, and the notice says to fix the clock.
      if (titleRefused(notice)) setTitle((current) => (current === "" ? typed : current));
    });
  };

  return (
    <>
      {expanded ? null : (
        <Button ref={openerRef} variant="outline" className="w-full md:hidden" onClick={open}>
          <PlusIcon aria-hidden />
          {m.declare_open()}
        </Button>
      )}
      <form
        onSubmit={submit}
        aria-label={m.declare_heading()}
        noValidate
        // From md: labels on the first row, controls on the second, the title's error under it.
        className={cn(
          "grid gap-x-3 gap-y-1.5 md:grid-cols-[minmax(0,1fr)_auto_auto]",
          !expanded && "max-md:hidden",
        )}
      >
        <label
          htmlFor={titleId}
          className="text-xs font-medium text-muted-foreground md:col-start-1 md:row-start-1"
        >
          {m.declare_title_label()}
        </label>
        <input
          ref={titleRef}
          id={titleId}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            if (invalid) setInvalid(false);
          }}
          maxLength={INCIDENT_TITLE_MAX}
          placeholder={m.declare_title_placeholder()}
          autoComplete="off"
          enterKeyHint="send"
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          // 16px: iOS zooms into smaller inputs.
          className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/40 md:col-start-1 md:row-start-2"
        />
        {invalid ? (
          <p
            id={errorId}
            role="alert"
            className="flex items-start gap-1.5 text-sm text-destructive md:col-start-1 md:row-start-3"
          >
            <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {m.declare_title_invalid()}
          </p>
        ) : null}
        <span
          id={severityId}
          className="mt-3 text-xs font-medium text-muted-foreground md:col-start-2 md:row-start-1 md:mt-0"
        >
          {m.declare_severity_label()}
        </span>
        {/* Native radios (arrow keys, form semantics) drawn as a segmented control of 44px targets: the code over
            its name. The edge is an outline, so it adds no height; the segments are not positioned, so it paints
            over them. Four equal columns fit 320px. */}
        <div
          role="radiogroup"
          aria-labelledby={severityId}
          className="grid grid-cols-4 divide-x divide-border overflow-hidden rounded-md bg-card outline-1 -outline-offset-1 outline-input md:col-start-2 md:row-start-2"
        >
          {SEVERITIES.map((option) => {
            const selected = option === severity;
            return (
              <label
                key={option}
                className={cn(
                  "flex h-11 cursor-pointer flex-col items-center justify-center px-1.5 text-xs leading-tight select-none has-focus-visible:ring-3 has-focus-visible:ring-ring has-focus-visible:ring-inset md:px-2.5",
                  selected
                    ? cn(SEGMENT_TONES[option], "ring-2 ring-current ring-inset")
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={option}
                  checked={selected}
                  onChange={() => setSeverity(option)}
                  className="sr-only"
                />
                <span className="flex items-center gap-0.5 font-bold">
                  {selected ? <CheckIcon aria-hidden className="size-3 shrink-0" /> : null}
                  {option.toUpperCase()}
                </span>
                <span className="whitespace-nowrap">{severityLabels[option]()}</span>
              </label>
            );
          })}
        </div>
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2 md:contents">
          <Button type="submit" className="md:col-start-3 md:row-start-2 md:mt-0">
            {m.declare_submit()}
          </Button>
          <Button type="button" variant="ghost" className="md:hidden" onClick={close}>
            {m.declare_cancel()}
          </Button>
        </div>
      </form>
    </>
  );
}
