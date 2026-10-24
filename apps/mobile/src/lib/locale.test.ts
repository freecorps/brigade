import { describe, expect, test } from "vite-plus/test";
import { pickLocale } from "./locale.ts";

describe("pickLocale", () => {
  test("maps Portuguese variants to pt-BR", () => {
    expect(pickLocale(["pt-BR"])).toBe("pt-BR");
    expect(pickLocale(["pt-PT"])).toBe("pt-BR");
    expect(pickLocale(["pt_BR"])).toBe("pt-BR");
  });

  test("maps English variants to en", () => {
    expect(pickLocale(["en-GB"])).toBe("en");
  });

  test("takes the first supported language in the device's order", () => {
    expect(pickLocale(["fr-FR", "pt-BR", "en-US"])).toBe("pt-BR");
    expect(pickLocale(["de-DE", "en-US", "pt-BR"])).toBe("en");
  });

  test("falls back to en when nothing is supported or known", () => {
    expect(pickLocale([])).toBe("en");
    expect(pickLocale(["ja-JP", null, undefined, ""])).toBe("en");
  });
});
