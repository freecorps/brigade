import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { appGroup, appId, DEFAULT_APP_ID } from "./app-id.ts";
import {
  applyAppEntitlements,
  CRITICAL_ALERTS_ENTITLEMENT,
  extensionEntitlements,
  extensionInfoPlist,
  localizableStrings,
  NATIVE_LOCALES,
  NATIVE_STRING_KEYS,
  NSE_SOURCES,
} from "./notification-service.ts";

const GROUP = "group.com.acme.brigade";

const messages = (locale: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../packages/i18n/messages/${locale}.json`, import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>;

describe("localizableStrings", () => {
  test("every native key in every locale, from packages/i18n", () => {
    for (const locale of NATIVE_LOCALES) {
      const strings = localizableStrings(messages(locale));
      for (const key of NATIVE_STRING_KEYS) {
        expect(strings).toContain(`"${key}" = "${String(messages(locale)[key])}";`);
      }
    }
    expect(localizableStrings(messages("pt-BR"))).toContain(
      '"push_fallback_title" = "Novo alerta";',
    );
  });

  test("escapes quotes, backslashes and newlines", () => {
    const strings = localizableStrings({
      push_fallback_title: 'Say "hi"\\',
      push_fallback_body: "two\nlines",
      call_caller: "Brigade",
    });
    expect(strings).toContain('"push_fallback_title" = "Say \\"hi\\"\\\\";');
    expect(strings).toContain('"push_fallback_body" = "two\\nlines";');
  });

  test("throws when a key is missing or not a plain string", () => {
    expect(() => localizableStrings({ push_fallback_title: "x" })).toThrow(/push_fallback_body/);
    expect(() =>
      localizableStrings({ push_fallback_title: "x", push_fallback_body: [{}] }),
    ).toThrow();
  });
});

describe("applyAppEntitlements", () => {
  test("adds push, the App Group and time-sensitive, keeping what is there", () => {
    expect(
      applyAppEntitlements(
        { "com.apple.security.application-groups": ["group.other"], other: true },
        { apsEnvironment: "production" },
        GROUP,
      ),
    ).toEqual({
      other: true,
      "aps-environment": "production",
      "com.apple.security.application-groups": ["group.other", GROUP],
      "com.apple.developer.usernotifications.time-sensitive": true,
    });
  });

  test("Critical Alerts only when the build asks for them (Apple grants the entitlement)", () => {
    expect(applyAppEntitlements({}, { apsEnvironment: "production" }, GROUP)).not.toHaveProperty(
      CRITICAL_ALERTS_ENTITLEMENT,
    );
    expect(
      applyAppEntitlements({}, { apsEnvironment: "production", criticalAlerts: false }, GROUP),
    ).not.toHaveProperty(CRITICAL_ALERTS_ENTITLEMENT);
    expect(
      applyAppEntitlements({}, { apsEnvironment: "production", criticalAlerts: true }, GROUP),
    ).toMatchObject({
      [CRITICAL_ALERTS_ENTITLEMENT]: true,
      "com.apple.developer.usernotifications.time-sensitive": true,
    });
    // A prebuild without `--clean` after a flagged one: the flag off takes it away again.
    expect(
      applyAppEntitlements(
        { [CRITICAL_ALERTS_ENTITLEMENT]: true },
        { apsEnvironment: "production" },
        GROUP,
      ),
    ).not.toHaveProperty(CRITICAL_ALERTS_ENTITLEMENT);
    expect(CRITICAL_ALERTS_ENTITLEMENT).toBe(
      "com.apple.developer.usernotifications.critical-alerts",
    );
  });

  test("does not add the App Group twice", () => {
    const once = applyAppEntitlements({}, { apsEnvironment: "development" }, GROUP);
    expect(applyAppEntitlements(once, { apsEnvironment: "development" }, GROUP)).toEqual(once);
  });
});

describe("extension plists", () => {
  test("Info.plist declares a notification service with the app's versions and locales", () => {
    const plist = extensionInfoPlist("0.1.0", "7", GROUP);
    // The App Group BrigadePushCrypto.swift reads.
    expect(plist).toMatch(/BrigadeAppGroup<\/key>\s*<string>group\.com\.acme\.brigade</);
    expect(plist).toContain("<string>com.apple.usernotifications.service</string>");
    expect(plist).toContain("<string>$(PRODUCT_MODULE_NAME).NotificationService</string>");
    expect(plist).toMatch(/CFBundleShortVersionString<\/key>\s*<string>0\.1\.0</);
    expect(plist).toMatch(/CFBundleVersion<\/key>\s*<string>7</);
    for (const locale of NATIVE_LOCALES) expect(plist).toContain(`<string>${locale}</string>`);
  });

  test("the extension is in the App Group, and only that", () => {
    expect(extensionEntitlements(GROUP)).toContain(`<string>${GROUP}</string>`);
    expect(extensionEntitlements(GROUP)).not.toContain("aps-environment");
  });
});

describe("the app's identifiers", () => {
  test("BRIGADE_APP_ID is the bundle id, the store app's when unset; the App Group follows it", () => {
    expect(appId({})).toBe("app.freecorps.brigade");
    expect(appId({ BRIGADE_APP_ID: " " })).toBe(DEFAULT_APP_ID);
    expect(appId({ BRIGADE_APP_ID: "com.acme.brigade" })).toBe("com.acme.brigade");
    expect(appGroup(DEFAULT_APP_ID)).toBe("group.app.freecorps.brigade");
    expect(appGroup("com.acme.brigade")).toBe(GROUP);
  });

  test("an id iOS or Android would refuse stops the build", () => {
    for (const id of ["brigade", "com.acme-corp.brigade", "com.1acme.brigade", "com..brigade"]) {
      expect(() => appId({ BRIGADE_APP_ID: id })).toThrow(/BRIGADE_APP_ID/);
    }
  });

  test("the Swift code reads the App Group from Info.plist", () => {
    const crypto = readFileSync(
      new URL("../modules/brigade-push/ios/BrigadePushCrypto.swift", import.meta.url),
      "utf8",
    );
    expect(crypto).toContain(
      `forInfoDictionaryKey: "BrigadeAppGroup") as? String ?? "${appGroup(DEFAULT_APP_ID)}"`,
    );
  });
});

describe("extension sources", () => {
  test("every file the extension compiles exists, the Acknowledge action's category among them", () => {
    for (const source of NSE_SOURCES) {
      expect(existsSync(new URL(`../modules/brigade-push/${source}`, import.meta.url))).toBe(true);
    }
    expect(NSE_SOURCES).toContain("ios/BrigadePage.swift");
    // The pod's other files need the app (ExpoModulesCore, expo-notifications) and stay out of the extension.
    expect(NSE_SOURCES).not.toContain("ios/PageActions.swift");
  });
});
