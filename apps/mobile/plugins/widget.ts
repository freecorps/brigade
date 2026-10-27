import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ConfigPlugin,
  withDangerousMod,
  withXcodeProject,
  type XcodeProject,
} from "expo/config-plugins";
import {
  addBuildFile,
  addFileReference,
  addToMainGroup,
  APP_GROUP,
  escapeStrings,
  EXTENSION_ENTITLEMENTS,
  NATIVE_LOCALES,
  readMessages,
} from "./notification-service.ts";

// The iOS "I'm on call" widget (roadmap Phase 2). It adds a `BrigadeWidget` WidgetKit extension target, embedded in
// the app, compiling modules/brigade-widget/widget/*.swift, with the App Group entitlement (where the app keeps the
// widget's snapshot: src/lib/widget.ts, modules/brigade-widget) and `Localizable.strings` in `en` and `pt-BR`
// generated from packages/i18n (`widget_*`). The widget cannot run Paraglide, so it bundles its strings, and the app
// tells it which language to use (the snapshot's `locale`), so the widget speaks the app's language rather than only
// the system's. Run after withNotificationService (app.config.ts), whose App Group entitlement the app shares.

export const WIDGET_TARGET = "BrigadeWidget";
/** The widget's strings; `{time}` or `{name}` (one per string) becomes `%@`, filled in by the widget. */
export const WIDGET_STRING_KEYS = [
  "widget_name",
  "widget_description",
  "widget_on_call",
  "widget_on_call_in",
  "widget_off_call",
  "widget_until",
  "widget_next",
  "widget_no_shift",
  "widget_no_schedules",
  "widget_open_incidents",
  "widget_stale",
  "widget_signed_out",
] as const;

const here = dirname(fileURLToPath(import.meta.url));
const MODULE_DIR = join(here, "../modules/brigade-widget");
export const WIDGET_SOURCES = ["widget/BrigadeWidget.swift", "widget/WidgetState.swift"] as const;

/**
 * `Localizable.strings` text for the widget. Throws if a locale lacks a key, or a message has a parameter other
 * than `{time}` or `{name}`, or more than one (the widget fills one).
 */
export function widgetStrings(messages: Record<string, unknown>): string {
  const lines = WIDGET_STRING_KEYS.map((key) => {
    const value = messages[key];
    if (typeof value !== "string") throw new Error(`packages/i18n has no plain string ${key}`);
    const params = [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
    if (params.length > 1 || params.some((param) => param !== "time" && param !== "name")) {
      throw new Error(`${key}: the widget fills one {time} or {name}`);
    }
    // `%` is literal in a format string only doubled.
    const text = escapeStrings(value)
      .replace(/%/g, "%%")
      .replace(/\{(time|name)\}/g, "%@");
    return `"${key}" = "${text}";`;
  });
  return `/* Generated from packages/i18n by plugins/widget.ts. */\n${lines.join("\n")}\n`;
}

/** The widget extension's Info.plist, with the app's versions (App Store Connect rejects a mismatch). */
export function widgetInfoPlist(version: string, buildNumber: string): string {
  const locales = NATIVE_LOCALES.map((locale) => `\t\t<string>${locale}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleDevelopmentRegion</key>
\t<string>en</string>
\t<key>CFBundleDisplayName</key>
\t<string>Brigade</string>
\t<key>CFBundleExecutable</key>
\t<string>$(EXECUTABLE_NAME)</string>
\t<key>CFBundleIdentifier</key>
\t<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
\t<key>CFBundleInfoDictionaryVersion</key>
\t<string>6.0</string>
\t<key>CFBundleLocalizations</key>
\t<array>
${locales}
\t</array>
\t<key>CFBundleName</key>
\t<string>$(PRODUCT_NAME)</string>
\t<key>CFBundlePackageType</key>
\t<string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
\t<key>CFBundleShortVersionString</key>
\t<string>${version}</string>
\t<key>CFBundleVersion</key>
\t<string>${buildNumber}</string>
\t<key>NSExtension</key>
\t<dict>
\t\t<key>NSExtensionPointIdentifier</key>
\t\t<string>com.apple.widgetkit-extension</string>
\t</dict>
</dict>
</plist>
`;
}

interface Objects {
  [section: string]: Record<string, unknown> | undefined;
}

/** Adds the widget target to the Xcode project, embedded in the app. Does nothing if it exists. */
export function applyWidget(
  project: XcodeProject,
  options: { bundleIdentifier: string; teamId: string | undefined },
): XcodeProject {
  if (project.pbxTargetByName(WIDGET_TARGET)) return project;
  const objects = project.hash.project.objects as Objects;
  objects.PBXTargetDependency ??= {};
  objects.PBXContainerItemProxy ??= {};

  const target = project.addTarget(
    WIDGET_TARGET,
    "app_extension",
    WIDGET_TARGET,
    `${options.bundleIdentifier}.Widget`,
  );
  const group = project.addPbxGroup([], WIDGET_TARGET, WIDGET_TARGET);
  addToMainGroup(project, group.uuid, WIDGET_TARGET);
  const sources = project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid);
  const resources = project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
  project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);

  for (const file of WIDGET_SOURCES.map((source) => source.split("/").pop()!)) {
    const ref = addFileReference(project, group.pbxGroup, file, "sourcecode.swift");
    addBuildFile(project, sources.buildPhase, ref, file, "Sources");
  }
  for (const file of ["Info.plist", `${WIDGET_TARGET}.entitlements`]) {
    addFileReference(
      project,
      group.pbxGroup,
      file,
      file.endsWith(".plist") ? "text.plist.xml" : "text.plist.entitlements",
    );
  }
  for (const locale of NATIVE_LOCALES) {
    const folder = `${locale}.lproj`;
    const ref = addFileReference(project, group.pbxGroup, folder, "folder");
    addBuildFile(project, resources.buildPhase, ref, folder, "Resources");
  }

  const configurations = project.pbxXCConfigurationList()[
    target.pbxNativeTarget.buildConfigurationList
  ] as { buildConfigurations: { value: string }[] };
  const section = project.pbxXCBuildConfigurationSection();
  for (const { value } of configurations.buildConfigurations) {
    const settings = section[value].buildSettings as Record<string, unknown>;
    Object.assign(settings, {
      INFOPLIST_FILE: `"${WIDGET_TARGET}/Info.plist"`,
      CODE_SIGN_ENTITLEMENTS: `"${WIDGET_TARGET}/${WIDGET_TARGET}.entitlements"`,
      CODE_SIGN_STYLE: "Automatic",
      // The app's target; lock screen widgets need iOS 16.
      IPHONEOS_DEPLOYMENT_TARGET: "16.4",
      SWIFT_VERSION: "5.0",
      TARGETED_DEVICE_FAMILY: '"1"',
      CLANG_ENABLE_MODULES: "YES",
      LD_RUNPATH_SEARCH_PATHS:
        '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
      ...(options.teamId ? { DEVELOPMENT_TEAM: options.teamId } : {}),
    });
  }
  return project;
}

export const withWidget: ConfigPlugin = (config) => {
  const bundleIdentifier = config.ios?.bundleIdentifier;
  if (!bundleIdentifier) throw new Error("withWidget needs ios.bundleIdentifier");

  config = withXcodeProject(config, (mod) => {
    mod.modResults = applyWidget(mod.modResults, {
      bundleIdentifier,
      teamId: mod.ios?.appleTeamId,
    });
    return mod;
  });

  config = withDangerousMod(config, [
    "ios",
    (mod) => {
      const dir = join(mod.modRequest.platformProjectRoot, WIDGET_TARGET);
      mkdirSync(dir, { recursive: true });
      for (const source of WIDGET_SOURCES) {
        copyFileSync(join(MODULE_DIR, source), join(dir, source.split("/").pop()!));
      }
      writeFileSync(
        join(dir, "Info.plist"),
        widgetInfoPlist(mod.version ?? "1.0.0", mod.ios?.buildNumber ?? "1"),
      );
      writeFileSync(join(dir, `${WIDGET_TARGET}.entitlements`), EXTENSION_ENTITLEMENTS);
      for (const locale of NATIVE_LOCALES) {
        mkdirSync(join(dir, `${locale}.lproj`), { recursive: true });
        writeFileSync(
          join(dir, `${locale}.lproj`, "Localizable.strings"),
          widgetStrings(readMessages(locale)),
        );
      }
      return mod;
    },
  ]);

  // EAS Build signs every target it is told about: the widget needs its own App ID (with the App Group) and profile.
  return withAppExtension(config, {
    targetName: WIDGET_TARGET,
    bundleIdentifier: `${bundleIdentifier}.Widget`,
    entitlements: { "com.apple.security.application-groups": [APP_GROUP] },
  });
};

/** Adds one extension to `extra.eas.build.experimental.ios.appExtensions`, keeping the others. */
export function withAppExtension<C extends { extra?: Record<string, unknown> }>(
  config: C,
  extension: {
    targetName: string;
    bundleIdentifier: string;
    entitlements: Record<string, unknown>;
  },
): C {
  const eas = (config.extra?.eas ?? {}) as Record<string, unknown>;
  const build = (eas.build ?? {}) as Record<string, unknown>;
  const experimental = (build.experimental ?? {}) as Record<string, unknown>;
  const ios = (experimental.ios ?? {}) as Record<string, unknown>;
  const others = (Array.isArray(ios.appExtensions) ? ios.appExtensions : []).filter(
    (other: { targetName?: unknown }) => other.targetName !== extension.targetName,
  );
  return {
    ...config,
    extra: {
      ...config.extra,
      eas: {
        ...eas,
        build: {
          ...build,
          experimental: {
            ...experimental,
            ios: { ...ios, appExtensions: [...others, extension] },
          },
        },
      },
    },
  };
}
