import { describe, expect, test } from "vite-plus/test";
import { localeAction, pickLocale, sentLocaleKey } from "./locale.ts";

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

describe("localeAction", () => {
  test("sends the app's language when the user has none", () => {
    expect(localeAction("pt-BR", null, null)).toBe("send");
    expect(localeAction("en", undefined, "en")).toBe("send");
    expect(localeAction("en", "fr", "en")).toBe("send");
  });

  test("the first run on a phone only remembers it, never overwriting the dashboard's choice", () => {
    expect(localeAction("en", "pt-BR", null)).toBe("remember");
  });

  test("sends when the phone's language changed since the app last sent it", () => {
    expect(localeAction("pt-BR", "en", "en")).toBe("send");
    expect(localeAction("pt-BR", "pt-BR", "en")).toBe("remember");
    expect(localeAction("en", "pt-BR", "en")).toBe("nothing");
  });
});

describe("sentLocaleKey", () => {
  test("one per user, so a second account on the phone never inherits the first one's", () => {
    expect(sentLocaleKey("usr_ana")).not.toBe(sentLocaleKey("usr_bia"));
    // The second account has nothing remembered yet: its first run only remembers, never overwrites its choice.
    expect(localeAction("en", "pt-BR", null)).toBe("remember");
  });

  test("only characters secure storage takes", () => {
    expect(sentLocaleKey("a b/c:d@e")).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});
