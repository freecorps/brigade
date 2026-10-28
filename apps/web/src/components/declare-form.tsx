import { m } from "@freecorps/brigade-i18n";
import { severityLabels } from "@freecorps/brigade-i18n/labels";
import {
  INCIDENT_TITLE_MAX,
  SEVERITIES,
  type EscalationPolicyRow,
  type IncidentTypeRow,
  type Severity,
} from "@freecorps/brigade-schema";
import { useSyncClient } from "@freecorps/brigade-sync/react";
import { cn } from "cn";
import { CheckIcon, CircleAlertIcon, PlusIcon } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { catalogText } from "@/lib/catalog";
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
 * Title, the incident type (once the workspace has types: picking one takes its default severity) and severity,
 * then Declare; under them, once the workspace has escalation policies, the policy that pages it (first in the
 * order, RFC 0006 "Who is paged"; left on "Usual", the type's, a service's or the default). Below `md` it starts as one "Declare incident" button that opens the form in
 * place, and closes again after a declare or Cancel. It works in every connection state: a declare made offline
 * waits in the client and is sent on reconnect.
 */
export function DeclareForm({
  types,
  policies = [],
  onDeclare,
}: {
  /** The workspace's incident types (`incidentTypes.all`), read by the card so its own list subscribes first. */
  types: readonly IncidentTypeRow[];
  /** The workspace's escalation policies (`escalationPolicies.all`). */
  policies?: readonly EscalationPolicyRow[];
  /** Resolves with the notice the outcome left, if it was refused. */
  onDeclare: (args: {
    id: string;
    title: string;
    severity: Severity;
    typeId?: string;
    escalationPolicyId?: string;
  }) => Promise<Notice | undefined>;
}) {
  const client = useSyncClient();
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<Severity>("sev3");
  /** The severity picked by hand (else the base default), which a type without a default gives back. */
  const [ownSeverity, setOwnSeverity] = useState<Severity>("sev3");
  const [typeId, setTypeId] = useState("");
  const typed = types.length > 0;
  const typeSelectId = useId();
  const [policyId, setPolicyId] = useState("");
  const policySelectId = useId();
  /** Why the title was refused locally, and on which submit (a repeat re-mounts the alert so it is read again). */
  const [invalid, setInvalid] = useState<{ empty: boolean; attempt: number } | null>(null);
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
      setInvalid((current) => ({
        empty: title.trim() === "",
        attempt: (current?.attempt ?? 0) + 1,
      }));
      titleRef.current?.focus();
      return;
    }
    setInvalid(null);
    const typedTitle = title;
    setTitle("");
    // Back to the default each time, so a SEV1 chosen once cannot page people again by accident.
    setSeverity("sev3");
    setOwnSeverity("sev3");
    setTypeId("");
    setPolicyId("");
    close();
    // A type or policy deleted meanwhile is left out by the shard: the declare still goes through.
    const type = types.find((one) => one.id === typeId);
    const policy = policies.find((one) => one.id === policyId);
    void onDeclare({
      ...checked.args,
      ...(type && { typeId: type.id }),
      ...(policy && { escalationPolicyId: policy.id }),
    }).then((notice) => {
      // The shard found the title invalid after all: give the text back (opening the form again on a phone),
      // unless something new was typed. Not for a clock refusal: the title was fine, and the notice says why.
      if (titleRefused(notice)) {
        // Still on the opener, which is about to leave the page: focus goes to the title. Not from <body>: the
        // user may have tapped elsewhere since.
        const lost =
          document.activeElement !== null && document.activeElement === openerRef.current;
        flushSync(() => {
          setExpanded(true);
          setTitle((current) => (current === "" ? typedTitle : current));
        });
        if (lost) titleRef.current?.focus({ preventScroll: true });
      }
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
          "grid gap-x-3 gap-y-1.5",
          typed
            ? "md:grid-cols-[minmax(0,1fr)_minmax(0,11rem)_auto_auto]"
            : "md:grid-cols-[minmax(0,1fr)_auto_auto]",
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
            if (invalid) setInvalid(null);
          }}
          maxLength={INCIDENT_TITLE_MAX}
          placeholder={m.declare_title_placeholder()}
          autoComplete="off"
          enterKeyHint="send"
          aria-invalid={invalid !== null}
          aria-describedby={invalid ? errorId : undefined}
          // 16px: iOS zooms into smaller inputs.
          className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive md:col-start-1 md:row-start-2"
        />
        {invalid ? (
          <p
            key={invalid.attempt}
            id={errorId}
            role="alert"
            className="flex items-start gap-1.5 text-sm text-destructive md:col-start-1 md:row-start-3"
          >
            <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {invalid.empty ? m.declare_title_empty() : m.declare_title_invalid()}
          </p>
        ) : null}
        {typed ? (
          <>
            <label
              htmlFor={typeSelectId}
              className="mt-3 text-xs font-medium text-muted-foreground md:col-start-2 md:row-start-1 md:mt-0"
            >
              {catalogText("type_label")}
            </label>
            <select
              id={typeSelectId}
              value={typeId}
              onChange={(event) => {
                setTypeId(event.target.value);
                const type = types.find((one) => one.id === event.target.value);
                setSeverity(type?.defaultSeverity ?? ownSeverity);
              }}
              className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring md:col-start-2 md:row-start-2"
            >
              <option value="">{catalogText("no_type")}</option>
              {types.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <span
          id={severityId}
          className={cn(
            "mt-3 text-xs font-medium text-muted-foreground md:row-start-1 md:mt-0",
            typed ? "md:col-start-3" : "md:col-start-2",
          )}
        >
          {m.declare_severity_label()}
        </span>
        {/* Native radios (arrow keys, form semantics) drawn as a segmented control of 44px targets: the code over
            its name. The edge is an outline, so it adds no height; the segments are not positioned, so it paints
            over them. Four equal columns fit 320px. */}
        <div
          role="radiogroup"
          aria-labelledby={severityId}
          className={cn(
            "grid grid-cols-4 divide-x divide-border overflow-hidden rounded-md bg-card outline-1 -outline-offset-1 outline-input md:row-start-2",
            typed ? "md:col-start-3" : "md:col-start-2",
          )}
        >
          {SEVERITIES.map((option) => {
            const selected = option === severity;
            return (
              <label
                key={option}
                className={cn(
                  "flex h-11 cursor-pointer flex-col items-center justify-center px-1.5 text-xs leading-tight select-none md:px-2.5",
                  // Focus: the ring at the edge, then a card-coloured gap before the fill, so it holds 3:1 on
                  // every severity colour (the inset ring paints over the inset shadow).
                  "has-focus-visible:shadow-[inset_0_0_0_5px_var(--color-card)] has-focus-visible:ring-3 has-focus-visible:ring-ring has-focus-visible:ring-inset",
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
                  onChange={() => {
                    setSeverity(option);
                    setOwnSeverity(option);
                  }}
                  className="sr-only"
                />
                <span className="flex items-center gap-0.5 font-bold">
                  {/* Always there, so choosing a segment never changes its width. */}
                  <CheckIcon
                    aria-hidden
                    className={cn("size-3 shrink-0", !selected && "invisible")}
                  />
                  {option.toUpperCase()}
                </span>
                <span className="whitespace-nowrap">{severityLabels[option]()}</span>
              </label>
            );
          })}
        </div>
        {policies.length > 0 ? (
          <div className="mt-3 flex min-w-0 flex-col gap-1.5 md:col-span-full md:row-start-4 md:mt-1.5 md:flex-row md:items-center md:gap-3">
            <label
              htmlFor={policySelectId}
              className="shrink-0 text-xs font-medium text-muted-foreground"
            >
              {m.declare_policy_label()}
            </label>
            <select
              id={policySelectId}
              value={policyId}
              onChange={(event) => setPolicyId(event.target.value)}
              className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring md:max-w-xs"
            >
              <option value="">{m.declare_policy_usual()}</option>
              {policies.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2 md:contents">
          <Button
            type="submit"
            className={cn(
              "tabular-nums md:row-start-2 md:mt-0",
              typed ? "md:col-start-4" : "md:col-start-3",
            )}
          >
            {/* Names what is about to page people. */}
            {m.declare_submit_severity({ severity: severity.toUpperCase() })}
          </Button>
          <Button type="button" variant="ghost" className="md:hidden" onClick={close}>
            {m.declare_cancel()}
          </Button>
        </div>
      </form>
    </>
  );
}
