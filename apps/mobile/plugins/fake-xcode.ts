// For the plugin tests only: no Xcode project file needed.
import type { XcodeProject } from "expo/config-plugins";

/**
 * An Xcode project with one target and its two build configurations, as node-xcode reads one back from disk: the
 * target's name quoted, and its comment quoted too (what `addTarget` writes), so `pbxTargetByName` cannot find it.
 */
export function fakeProject(target: string, bundleId: string) {
  const section: Record<string, { buildSettings: Record<string, unknown> }> = {
    debug: { buildSettings: { PRODUCT_BUNDLE_IDENTIFIER: `"${bundleId}"`, OTHER: "kept" } },
    release: { buildSettings: { PRODUCT_BUNDLE_IDENTIFIER: `"${bundleId}"` } },
  };
  const project = {
    pbxNativeTargetSection: () => ({
      T1: { isa: "PBXNativeTarget", name: `"${target}"`, buildConfigurationList: "list" },
      T1_comment: `"${target}"`,
    }),
    pbxTargetByName: () => null,
    pbxXCConfigurationList: () => ({
      list: { buildConfigurations: [{ value: "debug" }, { value: "release" }] },
    }),
    pbxXCBuildConfigurationSection: () => section,
    addTarget: () => {
      throw new Error("added a target that exists");
    },
  };
  return { project: project as unknown as XcodeProject, section };
}
