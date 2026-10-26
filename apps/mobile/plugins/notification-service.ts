import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ConfigPlugin,
  IOSConfig,
  withDangerousMod,
  withEntitlementsPlist,
  withXcodeProject,
  type XcodeProject,
} from "expo/config-plugins";

// The iOS Notification Service Extension that decrypts Brigade pushes (spike S1, RFC 0006). It adds:
// - the push, App Group and time-sensitive entitlements to the app;
// - a `BrigadeNotificationService` app extension target, embedded in the app, compiling
//   modules/brigade-push/extension/NotificationService.swift and the app module's BrigadePushCrypto.swift and
//   BrigadePage.swift (the Acknowledge action's category, set on decrypted pages);
// - `Localizable.strings` in `en` and `pt-BR` for both targets, generated from packages/i18n: the fallback
//   title and body (`push_fallback_*`) that the payload's `loc-key`s and the extension use when a push cannot be
//   decrypted.
// See docs/spikes/s1-apns-encryption.md.

export const NSE_TARGET = "BrigadeNotificationService";
export const APP_GROUP = "group.app.freecorps.brigade";
/**
 * The strings both targets need, in every locale packages/i18n has. `call_caller` is the app's: CallKit's
 * handle for a page ringing as a call (modules/brigade-call, spike S6).
 */
export const NATIVE_STRING_KEYS = [
  "push_fallback_title",
  "push_fallback_body",
  "call_caller",
] as const;
export const NATIVE_LOCALES = ["en", "pt-BR"] as const;

const here = dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = join(here, "../../../packages/i18n/messages");
const MODULE_DIR = join(here, "../modules/brigade-push");
/** The extension's Swift sources, copied into its folder and compiled by its target. */
export const NSE_SOURCES = [
  "extension/NotificationService.swift",
  "ios/BrigadePushCrypto.swift",
  "ios/BrigadePage.swift",
] as const;
const SOURCES = NSE_SOURCES.map((source) => join(MODULE_DIR, source));

export interface NotificationServiceOptions {
  /** `aps-environment`: `development` for debug and ad hoc builds signed for the sandbox, else `production`. */
  apsEnvironment: "development" | "production";
}

/** `Localizable.strings` text for the keys the native side needs. Throws if a locale lacks one. */
export function localizableStrings(messages: Record<string, unknown>): string {
  const lines = NATIVE_STRING_KEYS.map((key) => {
    const value = messages[key];
    if (typeof value !== "string") throw new Error(`packages/i18n has no plain string ${key}`);
    return `"${key}" = "${escapeStrings(value)}";`;
  });
  return `/* Generated from packages/i18n by plugins/notification-service.ts. */\n${lines.join("\n")}\n`;
}

function escapeStrings(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/** The extension's Info.plist. Versions must match the app's, or App Store Connect rejects the build. */
export function extensionInfoPlist(version: string, buildNumber: string): string {
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
\t\t<string>com.apple.usernotifications.service</string>
\t\t<key>NSExtensionPrincipalClass</key>
\t\t<string>$(PRODUCT_MODULE_NAME).NotificationService</string>
\t</dict>
</dict>
</plist>
`;
}

export const EXTENSION_ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.security.application-groups</key>
\t<array>
\t\t<string>${APP_GROUP}</string>
\t</array>
</dict>
</plist>
`;

/** The app's entitlements: APNs, the App Group shared with the extension (and its Keychain), Time Sensitive. */
export function applyAppEntitlements(
  entitlements: Record<string, unknown>,
  { apsEnvironment }: NotificationServiceOptions,
): Record<string, unknown> {
  const groups = Array.isArray(entitlements["com.apple.security.application-groups"])
    ? (entitlements["com.apple.security.application-groups"] as unknown[])
    : [];
  return {
    ...entitlements,
    "aps-environment": apsEnvironment,
    "com.apple.security.application-groups": groups.includes(APP_GROUP)
      ? groups
      : [...groups, APP_GROUP],
    "com.apple.developer.usernotifications.time-sensitive": true,
  };
}

interface Objects {
  [section: string]: Record<string, unknown> | undefined;
}

/**
 * Adds the extension target to the Xcode project, embedded in the app, and the `.lproj` folders to both
 * targets. Does nothing if the target exists (prebuild without `--clean`).
 */
export function applyNotificationService(
  project: XcodeProject,
  options: { appGroupPath: string; bundleIdentifier: string; teamId: string | undefined },
): XcodeProject {
  if (project.pbxTargetByName(NSE_TARGET)) return project;
  const objects = project.hash.project.objects as Objects;
  // node-xcode assumes these sections exist; the bare template has none.
  objects.PBXTargetDependency ??= {};
  objects.PBXContainerItemProxy ??= {};

  const appTarget = project.getFirstTarget();
  // An app extension target, embedded through a "Copy Files" phase to PlugIns on the app target.
  const target = project.addTarget(
    NSE_TARGET,
    "app_extension",
    NSE_TARGET,
    `${options.bundleIdentifier}.NotificationService`,
  );
  const group = project.addPbxGroup([], NSE_TARGET, NSE_TARGET);
  addToMainGroup(project, group.uuid);
  const sources = project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid);
  const resources = project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
  project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);

  for (const file of NSE_SOURCES.map((source) => source.split("/").pop()!)) {
    const ref = addFileReference(project, group.pbxGroup, file, "sourcecode.swift");
    addBuildFile(project, sources.buildPhase, ref, file, "Sources");
  }
  for (const file of ["Info.plist", `${NSE_TARGET}.entitlements`]) {
    addFileReference(
      project,
      group.pbxGroup,
      file,
      file.endsWith(".plist") ? "text.plist.xml" : "text.plist.entitlements",
    );
  }
  // Folder references: Xcode copies each `<locale>.lproj` directory as is, where Bundle looks up strings.
  const appGroup = IOSConfig.XcodeUtils.ensureGroupRecursively(project, options.appGroupPath);
  const appResources = project.pbxResourcesBuildPhaseObj(appTarget.uuid);
  for (const locale of NATIVE_LOCALES) {
    const folder = `${locale}.lproj`;
    const extRef = addFileReference(project, group.pbxGroup, folder, "folder");
    addBuildFile(project, resources.buildPhase, extRef, folder, "Resources");
    if (!appGroup) throw new Error(`no ${options.appGroupPath} group in the Xcode project`);
    // The template's app group has no path of its own; its files carry `<project>/` in theirs.
    const appRef = addFileReference(
      project,
      appGroup,
      `${options.appGroupPath}/${folder}`,
      "folder",
      folder,
    );
    addBuildFile(project, appResources, appRef, folder, "Resources");
  }

  const configurations = project.pbxXCConfigurationList()[
    target.pbxNativeTarget.buildConfigurationList
  ] as {
    buildConfigurations: { value: string }[];
  };
  const section = project.pbxXCBuildConfigurationSection();
  for (const { value } of configurations.buildConfigurations) {
    const settings = section[value].buildSettings as Record<string, unknown>;
    Object.assign(settings, {
      INFOPLIST_FILE: `"${NSE_TARGET}/Info.plist"`,
      CODE_SIGN_ENTITLEMENTS: `"${NSE_TARGET}/${NSE_TARGET}.entitlements"`,
      CODE_SIGN_STYLE: "Automatic",
      // The app's target: 16.4 runs the extension too, which shows the fallback (HPKE needs iOS 17).
      IPHONEOS_DEPLOYMENT_TARGET: "16.4",
      SWIFT_VERSION: "5.0",
      TARGETED_DEVICE_FAMILY: '"1"',
      CLANG_ENABLE_MODULES: "YES",
      ...(options.teamId ? { DEVELOPMENT_TEAM: options.teamId } : {}),
    });
  }
  return project;
}

function addToMainGroup(project: XcodeProject, groupUuid: string): void {
  const mainGroup = project.getFirstProject().firstProject.mainGroup as string;
  const groups = project.hash.project.objects.PBXGroup as Record<string, { children: unknown[] }>;
  groups[mainGroup]!.children.push({ value: groupUuid, comment: NSE_TARGET });
}

function addFileReference(
  project: XcodeProject,
  group: { children: unknown[] },
  path: string,
  lastKnownFileType: string,
  name = path,
): string {
  const uuid = project.generateUuid();
  const refs = project.hash.project.objects.PBXFileReference as Record<string, unknown>;
  refs[uuid] = {
    isa: "PBXFileReference",
    lastKnownFileType,
    name: `"${name}"`,
    path: `"${path}"`,
    sourceTree: '"<group>"',
  };
  refs[`${uuid}_comment`] = name;
  group.children.push({ value: uuid, comment: name });
  return uuid;
}

function addBuildFile(
  project: XcodeProject,
  phase: { files: unknown[] },
  fileRef: string,
  name: string,
  phaseName: string,
): void {
  const uuid = project.generateUuid();
  const files = project.hash.project.objects.PBXBuildFile as Record<string, unknown>;
  files[uuid] = { isa: "PBXBuildFile", fileRef, fileRef_comment: name };
  files[`${uuid}_comment`] = `${name} in ${phaseName}`;
  phase.files.push({ value: uuid, comment: `${name} in ${phaseName}` });
}

function readMessages(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), "utf8")) as Record<
    string,
    unknown
  >;
}

export const withNotificationService: ConfigPlugin<NotificationServiceOptions> = (
  config,
  options,
) => {
  const bundleIdentifier = config.ios?.bundleIdentifier;
  if (!bundleIdentifier) throw new Error("withNotificationService needs ios.bundleIdentifier");

  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults = applyAppEntitlements(mod.modResults, options) as typeof mod.modResults;
    return mod;
  });

  config = withXcodeProject(config, (mod) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(mod.modRequest.projectRoot);
    mod.modResults = applyNotificationService(mod.modResults, {
      appGroupPath: projectName,
      bundleIdentifier,
      teamId: mod.ios?.appleTeamId,
    });
    return mod;
  });

  config = withDangerousMod(config, [
    "ios",
    (mod) => {
      const ios = mod.modRequest.platformProjectRoot;
      const projectName = IOSConfig.XcodeUtils.getProjectName(mod.modRequest.projectRoot);
      const extensionDir = join(ios, NSE_TARGET);
      mkdirSync(extensionDir, { recursive: true });
      for (const source of SOURCES)
        copyFileSync(source, join(extensionDir, source.split("/").pop()!));
      writeFileSync(
        join(extensionDir, "Info.plist"),
        extensionInfoPlist(mod.version ?? "1.0.0", mod.ios?.buildNumber ?? "1"),
      );
      writeFileSync(join(extensionDir, `${NSE_TARGET}.entitlements`), EXTENSION_ENTITLEMENTS);
      for (const locale of NATIVE_LOCALES) {
        const strings = localizableStrings(readMessages(locale));
        for (const dir of [extensionDir, join(ios, projectName)]) {
          mkdirSync(join(dir, `${locale}.lproj`), { recursive: true });
          writeFileSync(join(dir, `${locale}.lproj`, "Localizable.strings"), strings);
        }
      }
      return mod;
    },
  ]);

  // EAS Build signs every target it is told about: the extension needs its own App ID and profile.
  const eas = (config.extra?.eas ?? {}) as Record<string, unknown>;
  const build = (eas.build ?? {}) as Record<string, unknown>;
  const experimental = (build.experimental ?? {}) as Record<string, unknown>;
  const ios = (experimental.ios ?? {}) as Record<string, unknown>;
  config.extra = {
    ...config.extra,
    eas: {
      ...eas,
      build: {
        ...build,
        experimental: {
          ...experimental,
          ios: {
            ...ios,
            appExtensions: [
              {
                targetName: NSE_TARGET,
                bundleIdentifier: `${bundleIdentifier}.NotificationService`,
                entitlements: { "com.apple.security.application-groups": [APP_GROUP] },
              },
            ],
          },
        },
      },
    },
  };
  return config;
};
