import { expect, test } from "vite-plus/test";
import {
  formatDateTime,
  formatNumber,
  formatRelativeTime,
  resolveLocale,
  toTimeZone,
  type Locale,
} from "../src/index.ts";

const at = Date.UTC(2026, 2, 5, 14, 30);

test("formatDateTime uses the given locale and the recipient's time zone", () => {
  const options = { dateStyle: "short", timeStyle: "short" } as const;
  expect(formatDateTime(at, "en", "UTC", options)).toBe("3/5/26, 2:30 PM");
  expect(formatDateTime(at, "en", "Asia/Tokyo", options)).toBe("3/5/26, 11:30 PM");
  expect(formatDateTime(at, "pt-BR", "America/Sao_Paulo", options)).toBe("05/03/2026, 11:30");
  expect(formatDateTime(at, "pt-BR", "Asia/Tokyo", options)).toBe("05/03/2026, 23:30");
});

test("formatNumber uses the given locale", () => {
  expect(formatNumber(1234567.5, "en")).toBe("1,234,567.5");
  expect(formatNumber(1234567.5, "pt-BR")).toBe("1.234.567,5");
});

test("formatRelativeTime picks the largest whole unit", () => {
  expect(formatRelativeTime(at - 3 * 60_000, "en", at)).toBe("3 minutes ago");
  expect(formatRelativeTime(at - 3 * 60_000, "pt-BR", at)).toBe("há 3 minutos");
  expect(formatRelativeTime(at + 2 * 3_600_000, "pt-BR", at)).toBe("em 2 horas");
  expect(formatRelativeTime(at - 86_400_000, "pt-BR", at)).toBe("ontem");
  expect(formatRelativeTime(at, "en", at)).toBe("now");
  // Months are 30 days and years 365 days.
  expect(formatRelativeTime(at - 45 * 86_400_000, "en", at)).toBe("last month");
  expect(formatRelativeTime(at - 70 * 86_400_000, "pt-BR", at)).toBe("há 2 meses");
  expect(formatRelativeTime(at + 400 * 86_400_000, "en", at)).toBe("next year");
  expect(formatRelativeTime(at - 800 * 86_400_000, "pt-BR", at)).toBe("há 2 anos");
});

test("formatters never throw on bad input", () => {
  expect(toTimeZone("America/Sao_Paulo")).toBe("America/Sao_Paulo");
  expect(toTimeZone("Mars/Olympus_Mons")).toBe("UTC");
  expect(toTimeZone(undefined)).toBe("UTC");
  const options = { dateStyle: "short", timeStyle: "short" } as const;
  expect(formatDateTime(at, "en", "Not/AZone", options)).toBe("3/5/26, 2:30 PM");
  expect(formatDateTime(new Date("not a date"), "en", "UTC")).toBe("");
  expect(formatDateTime(Number.NaN, "pt-BR", "UTC")).toBe("");
  // Nanoseconds passed by mistake are past the valid date range.
  expect(formatDateTime(1.7e18, "en", "UTC")).toBe("");
  expect(formatDateTime(8.64e15 + 1, "en", "UTC")).toBe("");
  expect(formatRelativeTime(new Date("not a date"), "en", at)).toBe("");
  expect(formatRelativeTime(at, "en", Number.NaN)).toBe("");
  // A locale that slipped past the types (e.g. read from storage) falls back instead of throwing.
  expect(formatNumber(1.5, "!!" as Locale)).toBe("1.5");
});

test("resolveLocale matches exactly, then by language, then falls back to en", () => {
  expect(resolveLocale("pt-BR")).toBe("pt-BR");
  expect(resolveLocale("PT-br")).toBe("pt-BR");
  expect(resolveLocale("pt_BR")).toBe("pt-BR");
  expect(resolveLocale("pt")).toBe("pt-BR");
  expect(resolveLocale("pt-PT")).toBe("pt-BR");
  expect(resolveLocale("en-GB")).toBe("en");
  expect(resolveLocale("fr")).toBe("en");
  expect(resolveLocale("")).toBe("en");
  expect(resolveLocale(undefined)).toBe("en");
});
