// Which language a visitor reads the status page in (RFC 0012 "Language", src/status-locale.ts).
import { describe, expect, test } from "vite-plus/test";
import {
  ACCEPT_LANGUAGE_MAX_ENTRIES,
  ACCEPT_LANGUAGE_MAX_LENGTH,
  acceptedLocale,
  countryLocale,
  requestLocale,
  statusLocale,
  visitorLocale,
} from "../src/status-locale.ts";

describe("?lang", () => {
  test("names a locale exactly, any case; anything else is ignored", () => {
    expect(statusLocale("pt-BR")).toBe("pt-BR");
    expect(statusLocale("pt-br")).toBe("pt-BR");
    expect(statusLocale("EN")).toBe("en");
    for (const value of ["pt", "fr", "", null, undefined, "en-US", "pt-BR;q=1", "x".repeat(5000)]) {
      expect(statusLocale(value), String(value).slice(0, 20)).toBeUndefined();
    }
  });
});

describe("Accept-Language", () => {
  test("the best match by q, the header's order among equals", () => {
    expect(acceptedLocale("pt-BR")).toBe("pt-BR");
    expect(acceptedLocale("en-US,en;q=0.9,pt-BR;q=0.8")).toBe("en");
    expect(acceptedLocale("en;q=0.5, pt-BR;q=0.8")).toBe("pt-BR");
    expect(acceptedLocale("fr-FR, pt;q=0.7, en;q=0.3")).toBe("pt-BR");
    expect(acceptedLocale("pt-PT, en")).toBe("pt-BR");
    expect(acceptedLocale("en, pt-BR")).toBe("en");
    expect(acceptedLocale("en;q=1.000, pt-BR;q=1")).toBe("en");
  });

  test("matches by primary language too, any case", () => {
    expect(acceptedLocale("pt")).toBe("pt-BR");
    expect(acceptedLocale("pt-PT")).toBe("pt-BR");
    expect(acceptedLocale("pt-br")).toBe("pt-BR");
    expect(acceptedLocale("PT-BR")).toBe("pt-BR");
    expect(acceptedLocale("en-GB")).toBe("en");
    expect(acceptedLocale("zh-Hant-TW, en-AU;q=0.4")).toBe("en");
  });

  test("q=0 refuses a language, and a language Brigade lacks is no match", () => {
    expect(acceptedLocale("pt-BR;q=0, en;q=0.1")).toBe("en");
    expect(acceptedLocale("pt;q=0, pt-PT")).toBeUndefined();
    expect(acceptedLocale("pt-BR;q=0, pt-PT, en;q=0.5")).toBe("en");
    // Asked for by name, it stands over its language refused.
    expect(acceptedLocale("pt;q=0, pt-BR")).toBe("pt-BR");
    expect(acceptedLocale("en;q=0")).toBeUndefined();
    expect(acceptedLocale("fr, de;q=0.9, ja;q=0.8")).toBeUndefined();
    expect(acceptedLocale("*")).toBeUndefined();
    expect(acceptedLocale("fr, *;q=0.5")).toBeUndefined();
  });

  test("a malformed entry is skipped, never an error", () => {
    for (const header of [
      "",
      ",,,",
      ";q=1",
      "en;q=2",
      "en;q=-1",
      "en;q=abc",
      "en;q=0.1234",
      "en;q=1;q=1",
      "en;foo=bar",
      "<script>",
      "en_US",
      "123",
      "toolonglanguage",
    ]) {
      expect(acceptedLocale(header), header).toBeUndefined();
    }
    expect(acceptedLocale("en;q=2, pt-BR;q=0.1")).toBe("pt-BR");
    expect(acceptedLocale(" pt-BR ; q=0.5 ")).toBe("pt-BR");
    expect(acceptedLocale(null)).toBeUndefined();
  });

  test("only the start of a huge header is read", () => {
    // Past the entry limit: never reached.
    const many = `${Array.from({ length: ACCEPT_LANGUAGE_MAX_ENTRIES }, () => "fr").join(",")},pt-BR`;
    expect(acceptedLocale(many)).toBeUndefined();
    expect(acceptedLocale(`${"fr,".repeat(ACCEPT_LANGUAGE_MAX_ENTRIES - 1)}pt-BR`)).toBe("pt-BR");
    // Past the length limit: never reached, and fast.
    const long = `${"x".repeat(ACCEPT_LANGUAGE_MAX_LENGTH)},pt-BR`;
    expect(acceptedLocale(long)).toBeUndefined();
    const started = performance.now();
    expect(acceptedLocale(`pt-BR,${"en;q=0.1,".repeat(1_000_000)}`)).toBe("pt-BR");
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("country", () => {
  test("Portuguese-speaking countries read Portuguese; others have no say", () => {
    for (const country of ["BR", "PT", "AO", "MZ", "CV", "GW", "ST", "TL", "br"]) {
      expect(countryLocale(country), country).toBe("pt-BR");
    }
    for (const country of ["US", "FR", "T1", "XX", "", undefined, null, 42, "constructor"]) {
      expect(countryLocale(country), String(country)).toBeUndefined();
    }
  });
});

describe("the order", () => {
  test("?lang, then Accept-Language, then the country, else the page's own", () => {
    const visit = { lang: "en", acceptLanguage: "pt-BR", country: "BR" };
    expect(visitorLocale(visit)).toBe("en");
    expect(visitorLocale({ ...visit, lang: "fr" })).toBe("pt-BR");
    expect(visitorLocale({ ...visit, lang: null, acceptLanguage: "en-GB" })).toBe("en");
    expect(visitorLocale({ lang: "xx", acceptLanguage: "de", country: "BR" })).toBe("pt-BR");
    expect(visitorLocale({ lang: null, acceptLanguage: "de", country: "DE" })).toBeUndefined();
    expect(visitorLocale({ lang: null, acceptLanguage: null, country: undefined })).toBeUndefined();
  });

  test("from a request", () => {
    expect(
      requestLocale(
        new Request("https://x.test/status/a?lang=pt-BR", {
          headers: { "Accept-Language": "en" },
        }),
      ),
    ).toBe("pt-BR");
    expect(
      requestLocale(new Request("https://x.test/", { headers: { "Accept-Language": "pt" } })),
    ).toBe("pt-BR");
    expect(requestLocale(new Request("https://x.test/"))).toBeUndefined();
  });
});
