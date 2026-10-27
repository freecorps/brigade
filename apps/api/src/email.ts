// Sending email (RFC 0005 "Email"): a provider-agnostic `EmailSender`, Cloudflare Email Sending behind the `EMAIL`
// binding (`send_email` in wrangler.jsonc), and a double that only logs what it would send, for local runs. Which
// one a Worker uses is `emailSender(env)`: none at all when nothing is configured, and then no email is sent.

/** One email to one person. Every field is final: the sender adds only the `From`. */
export type OutgoingEmail = {
  to: { email: string; name?: string };
  subject: string;
  text: string;
  html: string;
  /**
   * Extra headers, only ones Email Sending allows (`List-Unsubscribe`, `List-Unsubscribe-Post`, `Auto-Submitted`,
   * `Content-Language`, ...): it refuses the whole email for any other.
   */
  headers?: Record<string, string>;
};

/**
 * What a send did: accepted (the service took it; whether the inbox did is not known), or refused, with whether
 * trying again later may help (`retry`) and the provider's error code for the log.
 */
export type EmailResult = { ok: true } | { ok: false; retry: boolean; code: string };

/** Something that sends email. Must not throw: a failure is an `EmailResult`. */
export interface EmailSender {
  /** For logs: "cloudflare", "log", a test's own. */
  readonly id: string;
  send(email: OutgoingEmail): Promise<EmailResult>;
}

/** How long one send may take before it counts as failed (and is retried). */
export const EMAIL_TIMEOUT_MS = 10_000;

/** The parts of the Worker's env that pick a sender. */
export type EmailEnv = {
  /** The `send_email` binding (wrangler.jsonc). Locally it is simulated: Miniflare logs instead of sending. */
  EMAIL?: SendEmail;
  /**
   * The sender, `Brigade <brigade@example.com>` or a bare address, on a domain onboarded to Cloudflare Email Sending.
   * A secret like `RELAY_URL`, so no domain is in the repo; without it no email is sent (apps/api/README.md "Email").
   */
  EMAIL_FROM?: string;
  /** DEV ONLY: "1" logs each email instead of sending it, when `EMAIL_FROM` is not set (`vp run dev`). */
  EMAIL_LOG?: string;
};

/**
 * Error codes of the `send_email` binding that may pass on their own: rate and daily limits, the service failing, the
 * receiving server refusing for now. Anything else (an unverified sender, a suppressed recipient, a bad message) will
 * fail the same way again. An error with no code (the binding unreachable) is retried too.
 */
const TRANSIENT_CODES = new Set([
  "E_RATE_LIMIT_EXCEEDED",
  "E_DAILY_LIMIT_EXCEEDED",
  "E_INTERNAL_SERVER_ERROR",
  "E_DELIVERY_FAILED",
]);

/** Cloudflare Email Sending through the Workers binding. */
export class CloudflareEmailSender implements EmailSender {
  readonly id = "cloudflare";

  constructor(
    private readonly binding: SendEmail,
    private readonly from: { email: string; name?: string },
  ) {}

  async send(email: OutgoingEmail): Promise<EmailResult> {
    try {
      await withTimeout(
        this.binding.send({
          from: address(this.from),
          to: address(email.to),
          subject: email.subject,
          text: email.text,
          html: email.html,
          ...(email.headers ? { headers: email.headers } : {}),
        }),
        EMAIL_TIMEOUT_MS,
      );
      return { ok: true };
    } catch (error) {
      const code = Reflect.get(Object(error), "code");
      if (typeof code === "string" && code.startsWith("E_")) {
        return { ok: false, retry: TRANSIENT_CODES.has(code), code };
      }
      return {
        ok: false,
        retry: true,
        code: error instanceof TimeoutError ? "timeout" : "unknown",
      };
    }
  }
}

/**
 * DEV ONLY: writes each email to the console (one JSON line with the text body) instead of sending it, so `vp run
 * dev` shows what would go out. Never picked when a deployed Worker has `EMAIL_FROM`.
 */
export const logEmailSender: EmailSender = {
  id: "log",
  async send(email) {
    console.log(
      JSON.stringify({
        message: "email not sent (EMAIL_LOG): this is what would go out",
        notifier: "email",
        to: email.to,
        subject: email.subject,
        text: email.text,
        htmlBytes: email.html.length,
      }),
    );
    return { ok: true };
  },
};

/**
 * The origin an email's dashboard link may fall back on when `DASHBOARD_URL` is not set: the request's (or the
 * invitation's) origin, only for the dev log sender. A sender that delivers gets none, so a deployed Worker without
 * `DASHBOARD_URL` sends no link built from whatever host a request came through (apps/api/README.md "Email").
 */
export function linkFallback(
  sender: EmailSender,
  origin: string | null | undefined,
): string | undefined {
  return sender === logEmailSender ? (origin ?? undefined) : undefined;
}

/** The sender the env configures, or undefined when email is not set up. */
export function emailSender(env: EmailEnv): EmailSender | undefined {
  if (env.EMAIL && env.EMAIL_FROM) {
    const from = parseSender(env.EMAIL_FROM);
    if (from) return new CloudflareEmailSender(env.EMAIL, from);
    console.error(
      JSON.stringify({ message: "EMAIL_FROM is not an email address", notifier: "email" }),
    );
  }
  if (env.EMAIL_LOG === "1") return logEmailSender;
  return undefined;
}

/** `Name <address>` or a bare address; undefined when it is neither. */
export function parseSender(value: string): { email: string; name?: string } | undefined {
  const named = /^\s*([^<>]*?)\s*<([^<>\s@]+@[^<>\s@]+)>\s*$/.exec(value);
  if (named) {
    const name = singleLine(named[1] ?? "");
    return name ? { email: named[2]!, name } : { email: named[2]! };
  }
  const bare = value.trim();
  return /^[^<>\s@]+@[^<>\s@]+$/.test(bare) ? { email: bare } : undefined;
}

/** Text safe for a header (subject, display name): control characters and line breaks become spaces. */
export function singleLine(text: string): string {
  let line = "";
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const breaks =
      code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
    line += breaks ? " " : char;
  }
  return line.replace(/ {2,}/g, " ").trim();
}

/** The binding's address: `{ email, name }` with a name, the bare address without one. */
function address({ email, name }: { email: string; name?: string }): string | EmailAddress {
  return name ? { email, name } : email;
}

class TimeoutError extends Error {}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError("timed out")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
