import { m } from "@freecorps/brigade-i18n";
import { MailCheckIcon, SendIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { usePreferences } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import { resendVerification, type ResendError } from "@/lib/invitations";

const text = (part: string, email = "") => m.verify_notice({ part, email });

type Resend = (
  email: string,
  next?: string,
) => Promise<{ ok: true } | { ok: false; error: ResendError }>;

/**
 * Asking Brigade for another verification link: `send` asks (once at a time, and never before `email` is known),
 * `outcome` is what to tell the person after, `sending` while it runs. Shared by the notice and the Invite form.
 */
export function useResendVerification(
  email: string,
  next?: string,
  resend: Resend = resendVerification,
) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | ResendError>("idle");
  // A ref, not `state`: two clicks before the re-render both read the old state.
  const sendingRef = useRef(false);
  const send = async () => {
    if (sendingRef.current || !email) return;
    sendingRef.current = true;
    setState("sending");
    const result = await resend(email, next);
    sendingRef.current = false;
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
  return { send, outcome, sending: state === "sending" };
}

/**
 * Asks someone who has not verified their address to open the link Brigade sent, with a way to get another one
 * (RFC 0002 "Auth": until then they get no email, and cannot invite or accept invitations). `next`: the page the
 * new link comes back to (an invitation). `title` and `body` replace the general wording where the page has its own
 * (the invitation's). Nothing when the address is verified.
 */
export function VerifyNotice({
  email,
  verified,
  next,
  title,
  body,
  resend = resendVerification,
}: {
  email: string;
  verified: boolean;
  next?: string;
  title?: string;
  body?: string;
  resend?: Resend;
}) {
  usePreferences();
  const titleId = useId();
  const { send, outcome, sending } = useResendVerification(email, next, resend);
  if (verified) return null;
  return (
    // Laid out by its own width (a container query), not the page's: it sits in the wide overview and in the narrow
    // invitation page alike.
    <section
      aria-labelledby={titleId}
      className="@container rounded-md border border-amber-600/40 bg-card p-4"
    >
      <div className="flex flex-col gap-3 @lg:flex-row @lg:items-start @lg:gap-4">
        <MailCheckIcon
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id={titleId} className="font-medium">
            {title ?? text("title")}
          </h2>
          <p className="max-w-prose text-sm text-pretty text-muted-foreground [overflow-wrap:anywhere]">
            {body ?? text("body", email)}
          </p>
          {outcome ? (
            <p role="status" className="text-sm">
              {outcome}
            </p>
          ) : null}
        </div>
        <Button
          variant="outline"
          disabled={sending}
          focusableWhenDisabled
          onClick={() => void send()}
          className="self-start"
        >
          <SendIcon aria-hidden />
          {sending ? text("sending") : text("resend")}
        </Button>
      </div>
    </section>
  );
}
