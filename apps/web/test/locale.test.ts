import { describe, expect, test } from "vite-plus/test";
import { LOCALE_STORAGE_KEY, readLocale, writeLocale } from "../src/lib/locale.ts";
import { memoryStorage, throwingStorage } from "./storage.ts";

describe("locale persistence", () => {
  test("a stored locale wins over the browser's languages", () => {
    expect(readLocale(memoryStorage({ [LOCALE_STORAGE_KEY]: "pt-BR" }), ["en-US"])).toBe("pt-BR");
    expect(readLocale(memoryStorage({ [LOCALE_STORAGE_KEY]: "en" }), ["pt-BR"])).toBe("en");
  });

  test("without a stored locale, the first supported browser language is used", () => {
    expect(readLocale(memoryStorage(), ["pt-PT", "en"])).toBe("pt-BR");
    expect(readLocale(memoryStorage(), ["fr-FR", "pt"])).toBe("pt-BR");
    expect(readLocale(memoryStorage(), ["en-GB", "pt-BR"])).toBe("en");
  });

  test("invalid stored values, unknown languages and broken storage fall back sensibly", () => {
    expect(readLocale(memoryStorage({ [LOCALE_STORAGE_KEY]: "klingon" }), [])).toBe("en");
    expect(readLocale(memoryStorage(), ["fr-FR", "de"])).toBe("en");
    expect(readLocale(throwingStorage, [])).toBe("en");
    expect(readLocale(throwingStorage, ["pt-BR"])).toBe("pt-BR");
    expect(readLocale(undefined)).toBe("en");
  });

  test("writes the locale under its key, and reports storage that refuses", () => {
    const storage = memoryStorage();
    expect(writeLocale(storage, "pt-BR")).toBe(true);
    expect(storage.data.get(LOCALE_STORAGE_KEY)).toBe("pt-BR");
    expect(readLocale(storage, ["en"])).toBe("pt-BR");
    expect(writeLocale(throwingStorage, "en")).toBe(false);
    expect(writeLocale(undefined, "en")).toBe(false);
  });
});
