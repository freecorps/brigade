import { m } from "@freecorps/brigade-i18n";
import { CircleCheckIcon, QrCodeIcon, ShieldAlertIcon, SmartphoneIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { QrCode } from "@/components/qr-code";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, FormError } from "@/components/ui/field";
import {
  answerSignIn,
  connectUrl,
  countdown,
  createSignIn,
  ENDED,
  NUMBER,
  POLL_MS,
  readSignIn,
  typedNumber,
  type SignInStatus,
  type SignInView,
} from "@/lib/app-sign-in";

export const signInText = (part: string, args: { device?: string; time?: string } = {}) =>
  m.app_sign_in({ part, device: args.device ?? "", time: args.time ?? "" });

type Phase =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "failed"; reason: "rate_limited" | "failed" | "unauthenticated" }
  | { kind: "live"; view: SignInView; url: string };

/**
 * "Sign in with a QR code" (RFC 0015 section 6): a code only once the member asks for one (a credential on screen is
 * never shown by just opening the page), then the QR with its countdown, the claim with "<device> wants to sign in as
 * you" and the number to type, and how it ended. `fetcher` and `pollMs` are for the tests.
 */
export function AppSignInCard({
  fetcher = fetch,
  pollMs = POLL_MS,
}: {
  fetcher?: typeof fetch;
  pollMs?: number;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const live = phase.kind === "live" ? phase.view : undefined;
  const active = live !== undefined && !ENDED.includes(live.status);
  const now = useNow(active);

  // Follows the request while a phone may still act on it. A poll that fails is tried again on the next tick.
  useEffect(() => {
    if (!live || !active) return;
    let stopped = false;
    const timer = setInterval(() => {
      void readSignIn(live.id, fetcher).then((view) => {
        if (stopped || !view) return;
        setPhase((current) =>
          current.kind === "live" && current.view.id === view.id
            ? // Never back from an answer the member just gave (a poll sent before it may land after).
              { ...current, view: ENDED.includes(current.view.status) ? current.view : view }
            : current,
        );
      });
    }, pollMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [live?.id, active, fetcher, pollMs]);

  const start = async () => {
    setPhase({ kind: "creating" });
    const created = await createSignIn(fetcher);
    setPhase(
      created.ok
        ? { kind: "live", view: created.value, url: created.value.url }
        : { kind: "failed", reason: created.reason },
    );
  };

  const settle = (id: string, status: SignInStatus) =>
    setPhase((current) =>
      current.kind === "live" && current.view.id === id
        ? { ...current, view: { ...current.view, status } }
        : current,
    );

  // Past its time on this clock: shown as expired at once, without waiting for the next poll.
  const status: SignInStatus | undefined =
    live && active && live.expiresAt <= now ? "expired" : live?.status;

  return (
    <Card aria-labelledby="app-sign-in-title">
      <CardHeader
        id="app-sign-in-title"
        icon={QrCodeIcon}
        title={signInText("title")}
        description={signInText("description")}
      />
      <CardContent className="flex flex-col gap-4">
        {phase.kind === "idle" || phase.kind === "creating" ? (
          <div>
            <Button onClick={() => void start()} disabled={phase.kind === "creating"}>
              <QrCodeIcon aria-hidden />
              {signInText(phase.kind === "creating" ? "creating" : "start")}
            </Button>
          </div>
        ) : phase.kind === "failed" ? (
          <Ended
            tone="error"
            text={signInText(phase.reason === "rate_limited" ? "rate_limited" : "failed")}
            onAgain={() => void start()}
          />
        ) : status === "waiting" ? (
          <Waiting
            url={phase.url}
            left={phase.view.expiresAt - now}
            onCancel={() =>
              void answerSignIn(phase.view.id, "deny", fetcher).then(() =>
                setPhase({ kind: "idle" }),
              )
            }
          />
        ) : status === "claimed" ? (
          <Claimed
            key={phase.view.id}
            device={phase.view.deviceName ?? ""}
            left={phase.view.expiresAt - now}
            onAnswer={async (answer) => {
              const result = await answerSignIn(phase.view.id, answer, fetcher);
              if (result !== "failed") settle(phase.view.id, result);
              return result !== "failed";
            }}
          />
        ) : status === "approved" ? (
          <p role="status" className="enter flex items-center gap-2 text-muted-foreground">
            <SmartphoneIcon aria-hidden className="size-4 shrink-0" />
            {signInText("approved")}
          </p>
        ) : status === "signed_in" ? (
          <Ended
            tone="ok"
            text={signInText("signed_in", { device: phase.view.deviceName ?? "" })}
            again={signInText("another")}
            onAgain={() => void start()}
          />
        ) : (
          <Ended
            tone="neutral"
            text={signInText(
              status === "denied"
                ? "denied"
                : status === "wrong_number"
                  ? "wrong_number"
                  : "expired",
            )}
            onAgain={() => void start()}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** The QR, its countdown and the warning; Cancel drops the code. */
function Waiting({ url, left, onCancel }: { url: string; left: number; onCancel: () => void }) {
  return (
    <div className="enter flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
      <QrCode
        value={url}
        label={signInText("qr_label")}
        className="w-full max-w-60 self-center border sm:self-start"
      />
      <div className="flex min-w-0 flex-col gap-3">
        <p className="max-w-prose">{signInText("scan")}</p>
        <Warning />
        {/* Read out once a minute is plenty: a live region ticking every second would drown the page. */}
        <p className="text-muted-foreground tabular-nums">
          {signInText("expires_in", { time: countdown(left) })}
        </p>
        <p role="status" className="sr-only">
          {signInText("waiting")}
        </p>
        <div>
          <Button variant="outline" onClick={onCancel}>
            {signInText("cancel")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Warning() {
  return (
    <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2.5 font-medium">
      <ShieldAlertIcon
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400"
      />
      <span className="min-w-0">{signInText("never_share")}</span>
    </p>
  );
}

/**
 * "<device> wants to sign in as you": the member types the number their phone shows, or denies. The dashboard never
 * has the number, so there is nothing to approve without the phone in hand.
 */
function Claimed({
  device,
  left,
  onAnswer,
}: {
  device: string;
  left: number;
  onAnswer: (answer: { approve: string } | "deny") => Promise<boolean>;
}) {
  const [number, setNumber] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useEffect(() => input.current?.focus(), []);

  const send = async (answer: { approve: string } | "deny") => {
    setSending(true);
    setFailed(false);
    const ok = await onAnswer(answer);
    setSending(false);
    if (!ok) setFailed(true);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!NUMBER.test(number)) {
      setInvalid(true);
      input.current?.focus();
      return;
    }
    void send({ approve: number });
  };

  return (
    <form
      aria-labelledby={titleId}
      onSubmit={submit}
      noValidate
      className="enter flex max-w-md flex-col gap-4"
    >
      <div className="flex flex-col gap-1" role="alert">
        <p id={titleId} className="text-base font-semibold [overflow-wrap:anywhere]">
          {signInText("claimed_title", { device })}
        </p>
        <p className="text-muted-foreground">{signInText("claimed_hint")}</p>
      </div>
      <Field
        ref={input}
        label={signInText("number_label")}
        value={number}
        onChange={(event) => {
          setNumber(typedNumber(event.target.value));
          setInvalid(false);
        }}
        inputMode="numeric"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        maxLength={4}
        className="max-w-40 [&_input]:text-center [&_input]:text-2xl [&_input]:font-semibold [&_input]:tracking-[0.3em] [&_input]:tabular-nums"
        error={invalid ? signInText("number_invalid") : undefined}
      />
      <Warning />
      {failed ? <FormError>{signInText("answer_failed")}</FormError> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={sending}>
          {signInText(sending ? "approving" : "approve")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={sending}
          onClick={() => void send("deny")}
        >
          {signInText("deny")}
        </Button>
        <span className="text-muted-foreground tabular-nums">
          {signInText("expires_in", { time: countdown(left) })}
        </span>
      </div>
    </form>
  );
}

/** How it ended, and a new code. */
function Ended({
  tone,
  text,
  again = signInText("again"),
  onAgain,
}: {
  tone: "ok" | "neutral" | "error";
  text: string;
  again?: string;
  onAgain: () => void;
}) {
  return (
    <div className="enter flex flex-col items-start gap-3">
      <p
        role={tone === "error" ? "alert" : "status"}
        className={
          tone === "ok"
            ? "flex items-start gap-2 [overflow-wrap:anywhere]"
            : tone === "error"
              ? "max-w-prose text-destructive"
              : "max-w-prose"
        }
      >
        {tone === "ok" ? (
          <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        ) : null}
        <span className="min-w-0">{text}</span>
      </p>
      <Button variant="outline" onClick={onAgain}>
        {again}
      </Button>
    </div>
  );
}

/**
 * "Only the address": a QR that adds this Brigade to the app without signing in, for a phone that signs in another
 * way (its password, or a company sign-in later). `origin` is the dashboard's own.
 */
export function AddressQrCard({ origin = location.origin }: { origin?: string }) {
  return (
    <Card aria-labelledby="address-qr-title">
      <CardHeader
        id="address-qr-title"
        title={signInText("address_title")}
        description={signInText("address_description")}
      />
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <QrCode
          value={connectUrl(origin)}
          label={signInText("address_label")}
          className="w-full max-w-44 self-center border sm:self-auto"
        />
        <p className="min-w-0 font-mono text-sm [overflow-wrap:anywhere]">{origin}</p>
      </CardContent>
    </Card>
  );
}

/** The time, ticking every second while `running` (the countdown), still otherwise. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}
