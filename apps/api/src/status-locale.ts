// Which language a visitor reads the public status page in (RFC 0012 "Language"). The page's own `locale` is its
// default; a visitor whose language Brigade has reads the page's wording in it instead. What the team wrote is never
// translated. Pure, so every rule is unit-tested (test/status-locale.test.ts).

import { STATUS_LOCALES, type StatusLocale } from "@freecorps/brigade-schema";

/** The longest `Accept-Language` read: the header is the visitor's to send, so only its start counts. */
export const ACCEPT_LANGUAGE_MAX_LENGTH = 256;
/** The most `Accept-Language` entries weighed; browsers send a handful. */
export const ACCEPT_LANGUAGE_MAX_ENTRIES = 16;

/**
 * Where the visitor is (`request.cf.country`, ISO 3166-1 alpha-2) and the language most people there read. Only
 * countries whose language Brigade has: Portuguese is official in all of these. A new locale adds its countries here.
 */
const COUNTRY_LOCALES: Readonly<Record<string, StatusLocale>> = {
  BR: "pt-BR",
  PT: "pt-BR",
  AO: "pt-BR",
  MZ: "pt-BR",
  CV: "pt-BR",
  GW: "pt-BR",
  ST: "pt-BR",
  TL: "pt-BR",
};

const TAG = /^[a-z]{1,8}(?:-[a-z0-9]{1,8})*$/i;
const QUALITY = /^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i;

/** A locale named exactly (any case), as `?lang=` and `Accept-Language` write it. */
export function statusLocale(value: string | null | undefined): StatusLocale | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  return STATUS_LOCALES.find((locale) => locale.toLowerCase() === lower);
}

/** The locale a language tag reads as: itself, else the first locale of its primary language (`pt-PT` → `pt-BR`). */
function matchTag(tag: string): StatusLocale | undefined {
  const exact = statusLocale(tag);
  if (exact) return exact;
  const primary = tag.split("-")[0]!.toLowerCase();
  return STATUS_LOCALES.find((locale) => locale.split("-")[0]!.toLowerCase() === primary);
}

/**
 * The visitor's best language Brigade has, from `Accept-Language`: the highest `q` first (the header's order among
 * equals), `q=0` meaning "not this one". Bounded (`ACCEPT_LANGUAGE_MAX_LENGTH`, `ACCEPT_LANGUAGE_MAX_ENTRIES`); an
 * entry that does not parse is skipped, never an error. `*` names no language and is skipped too.
 */
export function acceptedLocale(header: string | null | undefined): StatusLocale | undefined {
  if (!header) return undefined;
  const entries: { locale: StatusLocale; q: number; exact: boolean }[] = [];
  const refused = new Set<string>();
  // Cut at the bound, then drop the entry the cut went through: `en;q=0.9` cut to `en;q=0` would refuse English.
  const read =
    header.length > ACCEPT_LANGUAGE_MAX_LENGTH
      ? header.slice(0, Math.max(0, header.lastIndexOf(",", ACCEPT_LANGUAGE_MAX_LENGTH)))
      : header;
  for (const raw of read.split(",", ACCEPT_LANGUAGE_MAX_ENTRIES)) {
    const [tag = "", ...params] = raw.split(";").map((part) => part.trim());
    if (!TAG.test(tag)) continue;
    let q = 1;
    if (params.length > 0) {
      const quality = params.length === 1 ? QUALITY.exec(params[0]!.replace(/\s+/g, "")) : null;
      if (!quality) continue;
      q = Number(quality[1]);
    }
    if (q === 0) {
      refused.add(tag.toLowerCase());
      continue;
    }
    const locale = matchTag(tag);
    if (locale) entries.push({ locale, q, exact: statusLocale(tag) !== undefined });
  }
  // Stable: among equal weights the header's own order stands.
  entries.sort((a, b) => b.q - a.q);
  // A refused tag refuses its locale; a refused language (`pt;q=0`) also every tag only matched through it (`pt-PT`),
  // but not a locale asked for by name (`pt-BR`).
  return entries.find(
    ({ locale, exact }) =>
      !refused.has(locale.toLowerCase()) &&
      (exact || !refused.has(locale.split("-")[0]!.toLowerCase())),
  )?.locale;
}

/** The language most visitors from `country` read, when Brigade has it. */
export function countryLocale(country: unknown): StatusLocale | undefined {
  if (typeof country !== "string") return undefined;
  return Object.hasOwn(COUNTRY_LOCALES, country.toUpperCase())
    ? COUNTRY_LOCALES[country.toUpperCase()]
    : undefined;
}

/**
 * The visitor's language, before the page is read: `?lang=` when it names a locale (the page's switcher), else the
 * best of `Accept-Language`, else the visitor's country; `undefined` means the page's own (its default), which only
 * the snapshot knows.
 */
export function visitorLocale(visit: {
  lang: string | null;
  acceptLanguage: string | null;
  country: unknown;
}): StatusLocale | undefined {
  return (
    statusLocale(visit.lang) ?? acceptedLocale(visit.acceptLanguage) ?? countryLocale(visit.country)
  );
}

/** `visitorLocale` for a request: its `?lang=`, `Accept-Language` and `cf.country`. */
export function requestLocale(request: Request): StatusLocale | undefined {
  return visitorLocale({
    lang: new URL(request.url).searchParams.get("lang"),
    acceptLanguage: request.headers.get("Accept-Language"),
    country: (request.cf as { country?: unknown } | undefined)?.country,
  });
}
