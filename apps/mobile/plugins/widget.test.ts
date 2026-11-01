import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { APP_GROUP_PLIST_KEY, appGroup, DEFAULT_APP_ID } from "./app-id.ts";
import { NATIVE_LOCALES } from "./notification-service.ts";
import {
  WIDGET_SOURCES,
  WIDGET_STRING_KEYS,
  WIDGET_TARGET,
  widgetInfoPlist,
  widgetStrings,
  withAppExtension,
} from "./widget.ts";

const messages = (locale: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../packages/i18n/messages/${locale}.json`, import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>;

describe("widgetStrings", () => {
  test("every widget key in every locale, from packages/i18n, with {time} as %@", () => {
    for (const locale of NATIVE_LOCALES) {
      const strings = widgetStrings(messages(locale));
      for (const key of WIDGET_STRING_KEYS) expect(strings).toContain(`"${key}" = "`);
      expect(strings).not.toContain("{time}");
      expect(strings).not.toContain("{name}");
    }
    expect(widgetStrings(messages("en"))).toContain('"widget_until" = "Until %@";');
    expect(widgetStrings(messages("pt-BR"))).toContain('"widget_until" = "Até %@";');
    expect(widgetStrings(messages("pt-BR"))).toContain('"widget_on_call" = "De plantão";');
  });

  test("escapes quotes and a literal %, and refuses other parameters or a missing key", () => {
    const all = Object.fromEntries(WIDGET_STRING_KEYS.map((key) => [key, "x"]));
    const strings = widgetStrings({ ...all, widget_name: 'Say "100%"', widget_next: "At {time}" });
    expect(strings).toContain('"widget_name" = "Say \\"100%%\\"";');
    expect(strings).toContain('"widget_next" = "At %@";');
    expect(strings).not.toContain("{name}");
    expect(() => widgetStrings({ ...all, widget_until: "Until {when}" })).toThrow(/one \{time\}/);
    expect(() => widgetStrings({ ...all, widget_until: "{name} until {time}" })).toThrow(
      /one \{time\}/,
    );
    expect(widgetStrings({ ...all, widget_on_call_in: "On call in {name}" })).toContain(
      '"widget_on_call_in" = "On call in %@";',
    );
    const { widget_stale: _, ...missing } = all;
    expect(() => widgetStrings(missing)).toThrow(/widget_stale/);
  });
});

describe("the widget extension", () => {
  test("Info.plist declares a WidgetKit extension with the app's versions and locales", () => {
    const plist = widgetInfoPlist("0.1.0", "7", "group.com.acme.brigade");
    expect(plist).toContain("<string>com.apple.widgetkit-extension</string>");
    // The App Group WidgetState.swift reads.
    expect(plist).toMatch(/BrigadeAppGroup<\/key>\s*<string>group\.com\.acme\.brigade</);
    expect(plist).not.toContain("NSExtensionPrincipalClass");
    expect(plist).toMatch(/CFBundleShortVersionString<\/key>\s*<string>0\.1\.0</);
    expect(plist).toMatch(/CFBundleVersion<\/key>\s*<string>7</);
    for (const locale of NATIVE_LOCALES) expect(plist).toContain(`<string>${locale}</string>`);
  });

  test("its sources exist", () => {
    for (const source of WIDGET_SOURCES) {
      expect(existsSync(new URL(`../modules/brigade-widget/${source}`, import.meta.url))).toBe(
        true,
      );
    }
  });

  test("EAS signs it next to the Notification Service Extension, once", () => {
    const extension = {
      targetName: WIDGET_TARGET,
      bundleIdentifier: "app.example.Widget",
      entitlements: { "com.apple.security.application-groups": ["group.app.example"] },
    };
    const nse = {
      targetName: "BrigadeNotificationService",
      bundleIdentifier: "x",
      entitlements: {},
    };
    const config = {
      extra: {
        eas: { projectId: "p", build: { experimental: { ios: { appExtensions: [nse] } } } },
      },
    };
    const once = withAppExtension(config, extension);
    const twice = withAppExtension(once, extension);
    const ios = (c: typeof config) =>
      (c.extra.eas.build.experimental.ios as { appExtensions: unknown[] }).appExtensions;
    expect(ios(twice)).toEqual([nse, extension]);
    expect(twice.extra.eas.projectId).toBe("p");
    expect(ios(withAppExtension({}, extension) as typeof config)).toEqual([extension]);
  });
});

test("the Swift copy of the widget's decisions keeps the keys and staleness the app writes", () => {
  const swift = readFileSync(
    new URL("../modules/brigade-widget/widget/WidgetState.swift", import.meta.url),
    "utf8",
  );
  const app = readFileSync(
    new URL("../modules/brigade-widget/ios/BrigadeWidgetModule.swift", import.meta.url),
    "utf8",
  );
  for (const key of ['"widget.snapshot"', '"widget.locale"', `"${APP_GROUP_PLIST_KEY}"`]) {
    expect(swift).toContain(key);
    expect(app).toContain(key);
  }
  // The App Group comes from Info.plist; the literal is only the store app's fallback, with a warning in the log.
  for (const source of [swift, app]) {
    expect(source).toContain(`forInfoDictionaryKey: "${APP_GROUP_PLIST_KEY}") as? String`);
    expect(source).toMatch(
      /Logger\(subsystem: "app\.freecorps\.brigade", category: "app-group"\)\.warning\(/,
    );
    expect(source).toContain(`return "${appGroup(DEFAULT_APP_ID)}"`);
  }
  // Every key the views look up is generated.
  const views = readFileSync(
    new URL("../modules/brigade-widget/widget/BrigadeWidget.swift", import.meta.url),
    "utf8",
  );
  const used = [...views.matchAll(/"(widget_\w+)"/g)].map((match) => match[1]);
  expect(used.length).toBeGreaterThan(0);
  for (const key of used) expect(WIDGET_STRING_KEYS).toContain(key);
});
