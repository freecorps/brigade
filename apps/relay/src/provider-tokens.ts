import {
  apnsProviderToken,
  clearApnsTokenCache,
  clearFcmTokenCache,
  fcmAccessToken,
} from "@freecorps/ember-push";
import { APNS_TOKEN_TTL_MS, ApnsTokenCache, type ApnsCredentials } from "./apns.ts";
import { sendWithin } from "./deadline.ts";
import { GoogleAuthError, GoogleTokenCache, TOKEN_TIMEOUT_MS, type ServiceAccount } from "./fcm.ts";

/**
 * The relay's credentials towards APNs and FCM (RFC 0016 "Push", step 1): the APNs provider token and Google's access
 * token come from Ember's push transport (`@freecorps/ember-push`), which reuses an APNs token for 40 minutes and an
 * access token until 5 minutes before it expires, each shared by concurrent sends, per isolate. Brigade's payloads,
 * envelopes and answers do not change.
 *
 * **Fallback (paging path).** The relay's own signers (`ApnsTokenCache`, `GoogleTokenCache`) stay. When APNs refuses
 * a provider token Ember signed as invalid, when Ember cannot sign with the key, or when Google refuses Ember's
 * assertion (or Ember's exchange fails in any way but Google being out of reach), the send is tried again at once
 * with the relay's own signer, and if that one works the isolate keeps to it for at least `FALLBACK_MS`. The switch
 * is sticky, and the way back waits for the relay's APNs token to be due anyway, so the two signers never alternate on
 * one key (APNs answers that with `TooManyProviderTokenUpdates`). When the relay's own signer fails too (a key that is
 * simply wrong), nothing switches and the answer is as before.
 */

/** Who signed a token: Ember's transport, or the relay's own signer (the fallback). */
export type Signer = "ember" | "relay";

/** How long an isolate keeps to the relay's own signer, at least, after Ember's was refused. */
export const FALLBACK_MS = 60 * 60 * 1000;

/** How many access tokens FCM refused are remembered, so none is used again (they are unique and short-lived). */
const REFUSED_GOOGLE_KEPT = 16;

export type ApnsToken = { jwt: string; signer: Signer };

/** Thrown by the fetch Ember's exchange is given, so a token endpoint out of reach is told apart from a bug. */
class Unreachable extends Error {}

export class ProviderTokens {
  #apns = new ApnsTokenCache();
  #google = new GoogleTokenCache();
  /** Until when this isolate signs with the relay's own signer instead of Ember's (0: Ember's). */
  #apnsFallbackUntil = 0;
  #googleFallbackUntil = 0;
  /** Access tokens FCM answered 401 to (`googleRefused`), newest last. */
  #refusedGoogle: string[] = [];

  /** The APNs provider token for these credentials, and who signed it. Rejects only if no signer can sign. */
  async apns(credentials: ApnsCredentials, now: number): Promise<ApnsToken> {
    if (!this.#onRelayApns(now)) {
      try {
        return { jwt: await apnsProviderToken(credentials, now), signer: "ember" };
      } catch (error) {
        // A key Ember cannot import: the relay's own signer decides, and is kept only if it can sign.
        const jwt = await this.#apns.get(credentials, now);
        this.#fallBack("apns", now, { error: String(error) });
        return { jwt, signer: "relay" };
      }
    }
    return { jwt: await this.#apns.get(credentials, now), signer: "relay" };
  }

  /**
   * APNs refused `token` with `reason`. Returns true when the send should be tried again at once with the token
   * `apns()` gives now: an `InvalidProviderToken` for a token Ember signed, when the relay's own signer can sign
   * (it then takes over). An `ExpiredProviderToken` re-signs once for every send that saw the same token, and the
   * instance retries the page. A refused token of the relay's own is forgotten, as it always was; refused as invalid
   * while it stood in for Ember's, the key is wrong for both and Ember's signer is the default again.
   */
  async apnsRefused(
    credentials: ApnsCredentials,
    token: ApnsToken,
    reason: string | undefined,
    now: number,
  ): Promise<boolean> {
    if (reason !== "InvalidProviderToken" && reason !== "ExpiredProviderToken") return false;
    if (token.signer === "relay") {
      this.#apns.clear();
      if (reason === "InvalidProviderToken") this.#apnsFallbackUntil = 0;
      return false;
    }
    if (reason === "ExpiredProviderToken") {
      // Signs again only if the cache still holds the token APNs refused: sends that saw it refresh once.
      await apnsProviderToken(credentials, now, token.jwt).catch(() => undefined);
      return false;
    }
    try {
      await this.#apns.get(credentials, now);
    } catch {
      // The relay's own signer cannot read this key at all: switching would turn a refusal into no page.
      return false;
    }
    clearApnsTokenCache();
    this.#fallBack("apns", now, { reason });
    return true;
  }

  /**
   * FCM answered 401 to `token`: the token was revoked or the key rotated. The next `google()` fetches a new one
   * unless one already replaced it, so sends refused together fetch one new token between them, not one each, and a
   * token refused once is never sent again.
   */
  async googleRefused(token: string): Promise<void> {
    if (!this.#refusedGoogle.includes(token)) {
      this.#refusedGoogle = [...this.#refusedGoogle, token].slice(-REFUSED_GOOGLE_KEPT);
    }
    await this.#google.clear(token);
  }

  /**
   * A Google access token for FCM's sends. Rejects with `GoogleAuthError`. The deep health check does not use it: it
   * asks Google with a cache of its own (`freshGoogle`), so it never shares an exchange, or its shorter deadline,
   * with a page.
   */
  async google(
    account: ServiceAccount,
    send: (request: Request) => Promise<Response>,
    now: number,
  ): Promise<string> {
    if (now < this.#googleFallbackUntil) return this.#google.get(account, now, send);
    const ember = {
      serviceAccount: {
        project_id: account.projectId,
        client_email: account.clientEmail,
        private_key: account.privateKey,
        private_key_id: account.privateKeyId,
        token_uri: account.tokenUri,
      },
      // The relay's own budget: one exchange at a time per isolate, none retried, none past `TOKEN_TIMEOUT_MS`.
      retries: 0,
      fetch: (async (input: string, init?: RequestInit) => {
        try {
          return await sendWithin(send, new Request(input, init), TOKEN_TIMEOUT_MS);
        } catch (error) {
          throw new Unreachable(String(error));
        }
      }) as typeof fetch,
      now: () => now,
    };
    let failure: GoogleAuthError;
    try {
      let token = await fcmAccessToken(ember);
      // At most twice: a token a forced exchange gave cannot have been refused already. Forced with the refused token,
      // so sends that saw it refused exchange once between them, and one another send already replaced is used as is.
      if (this.#refusedGoogle.includes(token)) token = await fcmAccessToken(ember, token);
      return token;
    } catch (error) {
      failure = googleError(error);
      if (failure.kind === "unreachable") throw failure;
    }
    // Google refused Ember's assertion, or Ember's exchange failed for any reason but Google being out of reach: the
    // relay's own signer takes it, and is kept only if it gets a token.
    const token = await this.#google.get(account, now, send);
    this.#fallBack("google", now, { error: failure.message });
    return token;
  }

  /** A fresh access token, never cached for the pages: the deep health check's (a revoked key must show at once). */
  freshGoogle(
    account: ServiceAccount,
    send: (request: Request) => Promise<Response>,
    now: number,
  ): Promise<string> {
    return new GoogleTokenCache().get(account, now, send);
  }

  /** Forgets every cached token and goes back to Ember's signers (tests; a rotated key). */
  reset(): void {
    clearApnsTokenCache();
    clearFcmTokenCache();
    this.#apns = new ApnsTokenCache();
    this.#google = new GoogleTokenCache();
    this.#apnsFallbackUntil = 0;
    this.#googleFallbackUntil = 0;
    this.#refusedGoogle = [];
  }

  /**
   * Whether APNs tokens come from the relay's own signer now: during the fallback, and after it until the relay's
   * cached token is due for renewal anyway (40 minutes after it was signed), so going back to Ember's never makes two
   * token updates on one key within APNs' 20-minute floor.
   */
  #onRelayApns(now: number): boolean {
    if (this.#apnsFallbackUntil === 0) return false;
    if (now < this.#apnsFallbackUntil) return true;
    const issuedAt = this.#apns.issuedAt();
    if (issuedAt !== undefined && now - issuedAt < APNS_TOKEN_TTL_MS) return true;
    this.#apnsFallbackUntil = 0;
    return false;
  }

  #fallBack(provider: "apns" | "google", now: number, detail: Record<string, string>): void {
    const until = provider === "apns" ? this.#apnsFallbackUntil : this.#googleFallbackUntil;
    // Sends refused together switch once.
    if (now < until) return;
    if (provider === "apns") this.#apnsFallbackUntil = now + FALLBACK_MS;
    else this.#googleFallbackUntil = now + FALLBACK_MS;
    // Never a token or a key.
    console.error(
      JSON.stringify({
        message: "Ember's push transport was refused, signing with the relay's own",
        provider,
        ...detail,
      }),
    );
  }
}

/**
 * What Ember's access-token exchange threw, as the relay tells it apart: `unreachable` for what may pass by itself
 * (the token endpoint out of reach or past its deadline, a 5xx or a 429), `refused` for anything else (a key that does
 * not sign, an assertion Google refuses, an exchange that failed in a way Ember did not expect).
 */
export function googleError(error: unknown): GoogleAuthError {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Unreachable) return new GoogleAuthError("unreachable", message);
  const status = /^Google token endpoint: (\d{3})\b/.exec(message)?.[1];
  const passes = status !== undefined && (status.startsWith("5") || status === "429");
  return new GoogleAuthError(passes ? "unreachable" : "refused", message);
}

/** One per isolate, like the caches it holds. */
export const providerTokens = new ProviderTokens();
