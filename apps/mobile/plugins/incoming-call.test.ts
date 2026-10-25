import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  ANDROID_LOCALES,
  ANDROID_STRING_KEYS,
  androidStrings,
  applyBackgroundModes,
  escapeAndroid,
} from "./incoming-call.ts";

const messages = (locale: string) =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "../../../packages/i18n/messages", `${locale}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;

describe("androidStrings", () => {
  test("every native key in every locale, from packages/i18n", () => {
    for (const locale of Object.keys(ANDROID_LOCALES)) {
      const xml = androidStrings(messages(locale));
      for (const key of ANDROID_STRING_KEYS) {
        expect(xml).toContain(
          `<string name="${key}">${escapeAndroid(String(messages(locale)[key]))}</string>`,
        );
      }
    }
    expect(androidStrings(messages("pt-BR"))).toContain(
      '<string name="call_answer">Atender</string>',
    );
  });

  test("escapes what Android and XML would misread", () => {
    expect(escapeAndroid(`Don't "say" <b> & \\ ${"\n"}x`)).toBe(
      'Don\\\'t \\"say\\" &lt;b&gt; &amp; \\\\ \\nx',
    );
    expect(escapeAndroid("@string/x")).toBe("\\@string/x");
    expect(escapeAndroid("?attr")).toBe("\\?attr");
  });

  test("a missing key fails the build instead of shipping a blank button", () => {
    expect(() => androidStrings({ call_ringing: "x" })).toThrow(/call_answer/);
  });
});

describe("applyBackgroundModes", () => {
  test("adds voip once and keeps the other modes", () => {
    expect(applyBackgroundModes({})).toEqual({ UIBackgroundModes: ["voip"] });
    const plist = applyBackgroundModes({ UIBackgroundModes: ["remote-notification"], Other: 1 });
    expect(plist).toEqual({ UIBackgroundModes: ["remote-notification", "voip"], Other: 1 });
    expect(applyBackgroundModes(plist)).toEqual(plist);
  });
});
