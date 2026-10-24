import fs from "node:fs";
import path from "node:path";
import { INCIDENT_STATUSES, SEVERITIES } from "@freecorps/brigade-schema";
import { expect, test } from "vite-plus/test";
import { compileMessages } from "../scripts/compile.ts";
import { baseLocale, getLocale, locales, m, setLocale, type Locale } from "../src/index.ts";
import { incidentStatusLabels, severityLabels } from "../src/labels.ts";

const dir = path.join(import.meta.dirname, "..");
const outdir = path.join(dir, "src/paraglide");

type Variant = { declarations: string[]; selectors: string[]; match: Record<string, string> };
const catalog = (locale: string): Record<string, string | Variant[]> => {
  const { $schema: _, ...messages } = JSON.parse(
    fs.readFileSync(path.join(dir, "messages", `${locale}.json`), "utf8"),
  );
  return messages;
};
const params = (pattern: string) => [...pattern.matchAll(/\{(\w+)\}/g)].map((p) => p[1]).sort();
const unique = (names: string[]) => [...new Set(names)].sort();
// Everything but the translated text and the match keys, which depend on the locale's plural rules.
const shape = (message: string | Variant[]) =>
  typeof message === "string"
    ? { params: params(message) }
    : message.map((variant) => ({
        declarations: variant.declarations,
        selectors: variant.selectors,
        params: unique(Object.values(variant.match).flatMap(params)),
      }));

test("every locale has the source keys, with the same declarations, selectors and params", () => {
  const source = catalog(baseLocale);
  for (const locale of locales) {
    const messages = catalog(locale);
    expect(Object.keys(messages).sort()).toEqual(Object.keys(source).sort());
    for (const [key, message] of Object.entries(source)) {
      const translated = messages[key] ?? "";
      expect(shape(translated), `${locale}: ${key}`).toEqual(shape(message));
      const texts =
        typeof translated === "string"
          ? [translated]
          : translated.flatMap((v) => Object.values(v.match));
      for (const text of texts)
        expect(text.trim(), `${locale}: ${key} has an empty text`).not.toBe("");
    }
  }
});

test("match keys use the locale's plural categories and end in a catch-all", () => {
  for (const locale of locales) {
    // en: one/other; pt-BR: one/many/other.
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    for (const [key, message] of Object.entries(catalog(locale))) {
      if (typeof message === "string") continue;
      for (const { declarations, selectors, match } of message) {
        const plural = new Set(
          declarations.flatMap((d) => d.match(/^local (\w+) = \w+: plural/)?.[1] ?? []),
        );
        const conditions = Object.keys(match).map((k) =>
          k.split(",").map((part) => part.trim().split("=") as [string, string]),
        );
        for (const condition of conditions) {
          expect(
            condition.map(([name]) => name),
            `${locale}: ${key}`,
          ).toEqual(selectors);
          for (const [name, value] of condition) {
            if (!plural.has(name) || value === "*") continue;
            expect(categories, `${locale}: ${key} ${name}=${value}`).toContain(value);
          }
        }
        const catchAll = conditions.some((c) => c.every(([, value]) => value === "*"));
        expect(catchAll, `${locale}: ${key} needs an all-* variant`).toBe(true);
      }
    }
  }
});

test("committed src/paraglide matches the message sources", async () => {
  const output = await compileMessages();
  const stale = "src/paraglide is stale, run: vp run --filter @freecorps/brigade-i18n compile";
  const onDisk = fs
    .readdirSync(outdir, { recursive: true, encoding: "utf8" })
    .filter((file) => fs.statSync(path.join(outdir, file)).isFile())
    .map((file) => file.replaceAll("\\", "/"));
  expect(onDisk.sort(), stale).toEqual(Object.keys(output).sort());
  for (const [file, content] of Object.entries(output)) {
    // Ignore CRLF from Windows checkouts with core.autocrlf.
    const text = fs.readFileSync(path.join(outdir, file), "utf8").replaceAll("\r\n", "\n");
    expect(text, `${stale} (${file})`).toBe(content);
  }
});

test("explicit locale wins over the current locale", () => {
  expect(m.incident_status_investigating()).toBe("Investigating");
  expect(m.incident_status_investigating({}, { locale: "pt-BR" })).toBe("Investigando");
  expect(m.incident_status_investigating()).toBe("Investigating");
});

test("setLocale changes the current locale", async () => {
  expect(getLocale()).toBe("en");
  await setLocale("pt-BR");
  try {
    expect(m.theme_dark()).toBe("Escuro");
    expect(m.theme_dark({}, { locale: "en" })).toBe("Dark");
  } finally {
    await setLocale("en");
  }
});

test("plurals in both locales, with the count formatted", () => {
  const count = (n: number, locale: Locale) => m.incidents_active_count({ count: n }, { locale });
  expect([0, 1, 2, 1_000_000].map((n) => count(n, "en"))).toEqual([
    "No active incidents",
    "1 active incident",
    "2 active incidents",
    "1,000,000 active incidents",
  ]);
  expect([0, 1, 2, 1_000_000].map((n) => count(n, "pt-BR"))).toEqual([
    "Nenhum incidente ativo",
    "1 incidente ativo",
    "2 incidentes ativos",
    "1.000.000 incidentes ativos",
  ]);
});

test("every severity and incident status from the schema has a label", () => {
  expect(Object.keys(severityLabels)).toEqual([...SEVERITIES]);
  expect(Object.keys(incidentStatusLabels)).toEqual([...INCIDENT_STATUSES]);
  expect(severityLabels.sev1({}, { locale: "pt-BR" })).toBe("Crítica");
  expect(incidentStatusLabels.declined({}, { locale: "pt-BR" })).toBe("Descartado");
});
