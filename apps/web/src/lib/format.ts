import { formatDateTime, formatNumber, type Locale } from "@freecorps/brigade-i18n";

const BYTE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;

/** "8 kB", "1,5 MB" (Intl units, so no unit strings to translate). Decimal units, like the dashboard. */
export function formatBytes(bytes: number, locale: Locale): string {
  const digits = (unit: number) => (unit === 0 ? 0 : 1);
  const rounded = (value: number, unit: number) => {
    const factor = 10 ** digits(unit);
    return Math.round(value * factor) / factor;
  };
  let value = bytes;
  let unit = 0;
  // Pick the unit after rounding to the digits shown, so 999,960 bytes is "1 MB", not "1,000 kB".
  while (rounded(value, unit) >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return formatNumber(value, locale, {
    style: "unit",
    unit: BYTE_UNITS[unit],
    unitDisplay: "short",
    maximumFractionDigits: digits(unit),
  });
}

/** Wall-clock time in the viewer's zone, with seconds, since checks run seconds apart. */
export function formatClock(date: Date, locale: Locale): string {
  return formatDateTime(date, locale, Intl.DateTimeFormat().resolvedOptions().timeZone, {
    timeStyle: "medium",
  });
}
