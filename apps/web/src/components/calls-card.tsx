import { m } from "@freecorps/brigade-i18n";
import { CALL_CHOICES, callChoiceOf, type CallChoice } from "@freecorps/brigade-schema";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { cn } from "cn";
import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useMember } from "@/components/session";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/ui/field";

const text = (part: string) => m.call_settings({ part });

/**
 * The signed-in member's own choice of which pages ring their iPhones as a call (RFC 0010), saved as soon as it is
 * picked (`member.setCalls`). The alert push comes either way, which the card says.
 */
export function CallsCard() {
  const { userId } = useMember();
  const settings = useQuery("members.settings", {});
  const setCalls = useMutation("member.setCalls");
  return (
    <CallsPanel
      value={callChoiceOf(settings.rows, userId)}
      loading={settings.status === "loading"}
      failed={settings.status === "error"}
      onChange={async (calls) => {
        const outcome = await setCalls({ calls });
        // The same choice again is a `conflict`: nothing to save is not a failure.
        return outcome.ok || outcome.error.code === "conflict";
      }}
    />
  );
}

type PanelProps = {
  value: CallChoice;
  loading: boolean;
  /** The shard refused or could not answer `members.settings`: the choice shown may not be theirs. */
  failed: boolean;
  /** Resolves true once the shard saved it. */
  onChange: (calls: CallChoice) => Promise<boolean>;
};

/** The card itself, without the hooks: what each state looks like (tested with made-up data). */
export function CallsPanel({ value, loading, failed, onChange }: PanelProps) {
  const titleId = useId();
  const name = useId();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  // What the member just picked, shown until the synced row agrees (or the save fails).
  const [picked, setPicked] = useState<CallChoice | null>(null);
  const shown = picked ?? value;
  // The synced row caught up: show it from here on.
  useEffect(() => {
    if (picked !== null && value === picked) setPicked(null);
  }, [picked, value]);
  const pick = (calls: CallChoice) => {
    if (calls === shown) return;
    setPicked(calls);
    setState("saving");
    void onChange(calls).then((ok) => {
      setState(ok ? "saved" : "failed");
      if (!ok) setPicked(null);
    });
  };
  return (
    <Card aria-labelledby={titleId}>
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <CardTitle id={titleId}>{text("title")}</CardTitle>
        <p className="max-w-prose text-sm text-muted-foreground">{text("description")}</p>
      </div>
      <CardContent className="flex flex-col gap-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">{text("loading")}</p>
        ) : (
          <fieldset className="flex min-w-0 flex-col gap-2" disabled={state === "saving"}>
            <legend className="mb-2 text-sm font-medium">{text("legend")}</legend>
            {CALL_CHOICES.map((choice) => {
              const selected = choice === shown;
              return (
                <label
                  key={choice}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm",
                    "has-focus-visible:ring-3 has-focus-visible:ring-ring",
                    selected ? "border-primary bg-primary/5" : "border-input hover:bg-muted",
                  )}
                >
                  <input
                    type="radio"
                    name={name}
                    value={choice}
                    checked={selected}
                    onChange={() => pick(choice)}
                    className="sr-only"
                  />
                  {/* Always there, so picking one never shifts the text. */}
                  <CheckIcon
                    aria-hidden
                    className={cn("mt-0.5 size-4 shrink-0 text-primary", !selected && "invisible")}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5 [overflow-wrap:anywhere]">
                    <span className="font-medium">{text(choice)}</span>
                    <span className="text-muted-foreground">{text(`${choice}_hint`)}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        {failed ? <FormError>{text("load_failed")}</FormError> : null}
        {state === "failed" ? <FormError>{text("failed")}</FormError> : null}
        <p
          role="status"
          className="flex min-h-5 items-center gap-1.5 text-sm text-muted-foreground"
        >
          {state === "saving" ? (
            <>
              <LoaderCircleIcon aria-hidden className="size-4 animate-spin" />
              {text("saving")}
            </>
          ) : state === "saved" ? (
            text("saved")
          ) : null}
        </p>
      </CardContent>
    </Card>
  );
}
