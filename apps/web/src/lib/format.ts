import { formatDateTime, formatNumber, type Locale } from "@freecorps/brigade-i18n";

const BYTE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;

/** "8 kB", "1,5 MB" (Intl units, so no unit strings to translate). Decimal units, like the dashboard. */
export function formatBytes(bytes: number, locale: Locale): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return formatNumber(value, locale, {
    style: "unit",
    unit: BYTE_UNITS[unit],
    unitDisplay: "short",
    maximumFractionDigits: unit === 0 ? 0 : 1,
  });
}

/** Wall-clock time in the viewer's zone, with seconds, since checks run seconds apart. */
export function formatClock(date: Date, locale: Locale): string {
  return formatDateTime(date, locale, Intl.DateTimeFormat().resolvedOptions().timeZone, {
    timeStyle: "medium",
  });
}
