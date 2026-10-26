// Who a Slack user is (RFC 0011 "Who a Slack user is"): their email as Slack confirmed it and their language, from
// `users.info`, kept per isolate for a few minutes so a burst of commands is not a burst of Web API calls. Which
// member that email is, and their role, is the API's to answer on every request (never cached).

import { locales } from "@freecorps/brigade-i18n";
import type { SlackLocale } from "@freecorps/brigade-schema";
import { callSlack, type Fetch } from "./web-api.ts";

export const PERSON_CACHE_MS = 5 * 60 * 1000;
export const PERSON_CACHE_MAX = 2000;

export type SlackPersonInfo =
  /** `email` lowercased; `locale` when Slack's maps to one Brigade speaks. */
  | { ok: true; email: string; locale: SlackLocale | null }
  /** Deleted, a bot, no email, or Slack has not confirmed it: they map to nobody. */
  | { ok: false; reason: "unconfirmed"; locale: SlackLocale | null }
  /** Slack could not be asked (not cached). */
  | { ok: false; reason: "failed"; locale: null };

const cache = new Map<string, { info: SlackPersonInfo; until: number }>();

/** Forgets every cached user: for tests. */
export function clearPeople(): void {
  cache.clear();
}

/** Slack's locale (`pt-BR`, `en-US`) as one Brigade speaks, matched by language; null for any other. */
export function slackLocale(value: unknown): SlackLocale | null {
  if (typeof value !== "string") return null;
  const language = value.replaceAll("_", "-").toLowerCase().split("-")[0];
  const match = locales.find((locale) => locale.toLowerCase().split("-")[0] === language);
  return (match as SlackLocale | undefined) ?? null;
}

export async function lookUpPerson(
  teamId: string,
  userId: string,
  token: string,
  fetch: Fetch,
  now: number,
): Promise<SlackPersonInfo> {
  const key = `${teamId}:${userId}`;
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit.info;
  const call = await callSlack(
    "users.info",
    { user: userId, include_locale: true },
    { token, fetch },
  );
  if (!call.ok) return { ok: false, reason: "failed", locale: null };
  const user = call.data.user as Record<string, unknown> | undefined;
  const profile = (user?.profile ?? {}) as Record<string, unknown>;
  const email = typeof profile.email === "string" ? profile.email.trim().toLowerCase() : "";
  const locale = slackLocale(user?.locale);
  const info: SlackPersonInfo =
    user &&
    user.deleted !== true &&
    user.is_bot !== true &&
    user.is_email_confirmed === true &&
    email
      ? { ok: true, email, locale }
      : { ok: false, reason: "unconfirmed", locale };
  // Oldest first: a Map iterates in insertion order.
  if (cache.size >= PERSON_CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.delete(key);
  cache.set(key, { info, until: now + PERSON_CACHE_MS });
  return info;
}
