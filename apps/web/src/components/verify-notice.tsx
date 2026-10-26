import { m } from "@freecorps/brigade-i18n";
import { MailCheckIcon, SendIcon } from "lucide-react";
import { useState } from "react";
import { usePreferences } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import { resendVerification, type ResendError } from "@/lib/invitations";

const text = (part: string, email = "") => m.verify_notice({ part, email });

/**
 * Asks someone who has not verified their address to open the link Brigade sent, with a way to get another one
 * (RFC 0002 "Auth": until then they get no email, and cannot invite or accept invitations). `next`: the page the
 * new link comes back to (an invitation). Nothing when the address is verified.
 */
export function VerifyNotice({
  email,
  verified,
  next,
  resend = resendVerification,
}: {
  email: string;
  verified: boolean;
  next?: string;
  resend?: (
    email: string,
    next?: string,
  ) => Promise<{ ok: true } | { ok: false; error: ResendError }>;
}) {
  usePreferences();
  const [state, setState] = useState<"idle" | "sending" | "sent" | ResendError>("idle");
  if (verified) return null;
  const send = async () => {
    if (state === "sending") return;
    setState("sending");
    const result = await resend(email, next);
    setState(result.ok ? "sent" : result.error);
  };
  const outcome =
    state === "sent"
      ? text("sent")
      : state === "rate_limited" || state === "not_configured" || state === "failed"
        ? text(state)
        : state === "network"
          ? text("failed")
          : null;
  return (
    // Laid out by its own width (a container query), not the page's: it sits in the wide overview and in the narrow
    // invitation page alike.
    <section
      aria-labelledby="verify-title"
      className="@container rounded-md border border-amber-600/40 bg-card p-4"
    >
      <div className="flex flex-col gap-3 @lg:flex-row @lg:items-start @lg:gap-4">
        <MailCheckIcon
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id="verify-title" className="font-medium">
            {text("title")}
          </h2>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground [overflow-wrap:anywhere]">
            {text("body", email)}
          </p>
          {outcome ? (
            <p role="status" className="text-sm">
              {outcome}
            </p>
          ) : null}
        </div>
        <Button
          variant="outline"
          disabled={state === "sending"}
          focusableWhenDisabled
          onClick={() => void send()}
          className="self-start"
        >
          <SendIcon aria-hidden />
          {state === "sending" ? text("sending") : text("resend")}
        </Button>
      </div>
    </section>
  );
}
