// Locale-explicit formatting with standard Intl only. Hermes support for PluralRules, RelativeTimeFormat
// and dateStyle/timeStyle is validated in spike S4, with @formatjs/intl-* polyfills as the fallback.
// Every helper takes the locale as an argument so the server can format per recipient.
//
// These run while rendering pages, pushes and emails, so they never throw: an unknown locale becomes
// `en`, an unknown time zone "UTC", and an invalid date an empty string.
import { resolveLocale } from "./locale.ts";
import type { Locale } from "./paraglide/runtime.js";

/** Returns `value` if the runtime knows it as an IANA time zone, otherwise "UTC". */
export function toTimeZone(value: string | undefined): string {
  if (!value) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

const time = (value: Date | number) => (value instanceof Date ? value.getTime() : value);

/**
 * `timeZone` is the recipient's IANA zone (e.g. "America/Sao_Paulo"). It is required because the
 * runtime default differs per platform (UTC in Workers, the device zone on phones). An unknown zone
 * falls back to "UTC"; an invalid date returns "".
 */
export function formatDateTime(
  value: Date | number,
  locale: Locale,
  timeZone: string,
  options: Omit<Intl.DateTimeFormatOptions, "timeZone"> = {
    dateStyle: "medium",
    timeStyle: "short",
  },
): string {
  // Outside ±8.64e15 ms a number is not a valid date, and Intl.DateTimeFormat#format throws.
  if (Number.isNaN(new Date(time(value)).getTime())) return "";
  return new Intl.DateTimeFormat(resolveLocale(locale), {
    ...options,
    timeZone: toTimeZone(timeZone),
  }).format(value);
}

export function formatNumber(
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(resolveLocale(locale), options).format(value);
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
];

/**
 * "3 minutes ago" / "em 2 horas", using the largest whole unit between `value` and `now`.
 * Buckets are fixed lengths, not calendar units: a day is 24 h (so "yesterday" means 24–48 h ago,
 * not the previous calendar day), a month 30 days and a year 365. Invalid dates return "".
 */
export function formatRelativeTime(
  value: Date | number,
  locale: Locale,
  now: Date | number = Date.now(),
): string {
  const delta = time(value) - time(now);
  if (!Number.isFinite(delta)) return "";
  const seconds = Math.round(delta / 1000);
  const [unit, size] = UNITS.find(([, size]) => Math.abs(seconds) >= size) ?? ["second", 1];
  return new Intl.RelativeTimeFormat(resolveLocale(locale), { numeric: "auto" }).format(
    Math.trunc(seconds / size),
    unit,
  );
}
