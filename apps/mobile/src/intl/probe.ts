// Checks the Intl features packages/i18n relies on, by using them, not by looking for constructors:
// Hermes has shipped constructors that ignore options (dateStyle) or lack locale data. Pure, so it
// runs in Node tests and before and after the polyfills on a device (src/intl/setup.ts).

export const INTL_FEATURES = [
  "pluralRules",
  "relativeTimeFormat",
  "dateTimeStyle",
  "timeZone",
  "numberFormat",
  "locale",
] as const;
export type IntlFeature = (typeof INTL_FEATURES)[number];

export interface FeatureResult {
  readonly works: boolean;
  /** What the feature produced, or the error, for the diagnostics screen. */
  readonly detail: string;
}

export type IntlReport = Readonly<Record<IntlFeature, FeatureResult>>;

// 2026-03-05 14:30 UTC, a fixed instant so the expected output is known.
const SAMPLE = Date.UTC(2026, 2, 5, 14, 30);

function check(run: () => string, works: (output: string) => boolean): FeatureResult {
  try {
    const output = run();
    return { works: works(output), detail: output };
  } catch (error) {
    return { works: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Collapses the narrow and regular no-break spaces newer CLDR data puts before AM/PM. */
const spaces = (value: string) => value.replace(/[  ]/g, " ");

export function probeIntl(intl: typeof Intl = Intl): IntlReport {
  return {
    // Paraglide's plural messages (incidents_active_count) select with Intl.PluralRules.
    pluralRules: check(
      () => {
        const en = new intl.PluralRules("en");
        const pt = new intl.PluralRules("pt-BR");
        return `en 1=${en.select(1)} 2=${en.select(2)}; pt-BR 0=${pt.select(0)} 2=${pt.select(2)}`;
      },
      (output) => output === "en 1=one 2=other; pt-BR 0=one 2=other",
    ),
    relativeTimeFormat: check(
      () =>
        [
          new intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-1, "day"),
          new intl.RelativeTimeFormat("pt-BR", { numeric: "auto" }).format(-3, "hour"),
        ].join("; "),
      (output) => output === "yesterday; há 3 horas",
    ),
    // formatDateTime's default. An engine that ignores dateStyle prints "3/5/2026".
    dateTimeStyle: check(
      () =>
        spaces(
          new intl.DateTimeFormat("en", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "UTC",
          }).format(SAMPLE),
        ),
      (output) => output === "Mar 5, 2026, 2:30 PM",
    ),
    // formatDateTime always passes the recipient's IANA zone.
    timeZone: check(
      () =>
        new intl.DateTimeFormat("en", {
          hour: "numeric",
          hourCycle: "h23",
          timeZone: "America/Sao_Paulo",
        }).format(SAMPLE),
      (output) => output === "11",
    ),
    numberFormat: check(
      () =>
        [
          new intl.NumberFormat("en").format(1284.5),
          new intl.NumberFormat("pt-BR").format(1284.5),
        ].join("; "),
      (output) => output === "1,284.5; 1.284,5",
    ),
    // Not used by packages/i18n directly; the @formatjs polyfills need it.
    locale: check(
      () => new intl.Locale("pt-BR").language,
      (output) => output === "pt",
    ),
  };
}
