import { m } from "@freecorps/brigade-i18n";
import { severityLabels } from "@freecorps/brigade-i18n/labels";
import { INCIDENT_TITLE_MAX, SEVERITIES, type Severity } from "@freecorps/brigade-schema";
import type { MutationOutcome } from "@freecorps/brigade-sync";
import { useSyncClient } from "@freecorps/brigade-sync/react";
import { cn } from "cn";
import { CheckIcon, PlusIcon } from "lucide-react";
import { useId, useState, type FormEvent, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { checkDeclare } from "@/lib/incidents";

/** The selected segment takes its severity's badge colours, plus a ring and a check so colour is not alone. */
const SEGMENT_TONES: Record<Severity, string> = {
  sev1: "bg-sev1 text-sev1-foreground",
  sev2: "bg-sev2 text-sev2-foreground",
  sev3: "bg-sev3 text-sev3-foreground",
  sev4: "bg-sev4 text-sev4-foreground",
};

/**
 * Title and severity, then Declare. Below `md` it starts as one "Declare incident" button that opens the form in
 * place. It works in every connection state: a declare made offline waits in the client and is sent on reconnect.
 */
export function DeclareForm({
  onDeclare,
  titleRef,
  expanded,
  onExpand,
}: {
  onDeclare: (args: { id: string; title: string; severity: Severity }) => Promise<MutationOutcome>;
  titleRef: RefObject<HTMLInputElement | null>;
  expanded: boolean;
  onExpand: () => void;
}) {
  const client = useSyncClient();
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<Severity>("sev3");
  const [invalid, setInvalid] = useState(false);
  const titleId = useId();
  const errorId = useId();
  const severityId = useId();
  const groupName = useId();

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
    void onDeclare(checked.args).then((outcome) => {
      // The shard found the title invalid after all: give the text back, unless something new was typed.
      if (!outcome.ok && outcome.error.code === "invalid_args") {
        setTitle((current) => (current === "" ? typed : current));
      }
    });
  };

  return (
    <>
      {expanded ? null : (
        <Button className="w-full md:hidden" onClick={onExpand}>
          <PlusIcon aria-hidden />
          {m.declare_open()}
        </Button>
      )}
      <form
        onSubmit={submit}
        aria-label={m.declare_heading()}
        noValidate
        className={cn(
          "grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-start",
          !expanded && "max-md:hidden",
        )}
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={titleId} className="text-xs font-medium text-muted-foreground">
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
            className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring aria-invalid:border-destructive"
          />
          {invalid ? (
            <p id={errorId} className="text-sm text-destructive">
              {m.declare_title_invalid()}
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span id={severityId} className="text-xs font-medium text-muted-foreground">
            {m.declare_severity_label()}
          </span>
          {/* Native radios (arrow keys, form semantics) drawn as a segmented control of 44px targets. The edge is
              an outline, so it adds no height; the segments are not positioned, so it paints over them. */}
          <div
            role="radiogroup"
            aria-labelledby={severityId}
            className="grid grid-cols-4 divide-x divide-border overflow-hidden rounded-md bg-card outline-1 -outline-offset-1 outline-input"
          >
            {SEVERITIES.map((option) => {
              const selected = option === severity;
              return (
                <label
                  key={option}
                  className={cn(
                    "flex h-11 min-w-18 cursor-pointer items-center justify-center gap-1 px-2 text-xs select-none has-focus-visible:ring-3 has-focus-visible:ring-ring has-focus-visible:ring-inset",
                    selected
                      ? cn(SEGMENT_TONES[option], "font-bold ring-2 ring-current ring-inset")
                      : "font-medium text-muted-foreground hover:bg-muted",
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
                  {selected ? <CheckIcon aria-hidden className="size-3.5 shrink-0" /> : null}
                  {option.toUpperCase()}
                  <span className="sr-only"> {severityLabels[option]()}</span>
                </label>
              );
            })}
          </div>
        </div>
        <Button type="submit" className="md:mt-5.5" disabled={!title.trim()} focusableWhenDisabled>
          {m.declare_submit()}
        </Button>
      </form>
    </>
  );
}
