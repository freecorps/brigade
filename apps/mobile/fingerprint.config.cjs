// The native fingerprint (the runtime version, app.config.ts) is Expo's "balanced" preset, except that the app's
// version counts: a new version must be a new build, never an EAS Update. `GET /config`'s `minApp` compares the
// version a phone's build reports, and an update cannot change that (RFC 0015 section 5, RFC 0016 step 8).
const { SourceSkips } = require("expo/fingerprint");

/** @type {import("expo/fingerprint").Config} */
module.exports = {
  sourceSkips:
    SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun |
    SourceSkips.ExpoConfigRuntimeVersionIfString |
    SourceSkips.EasJson |
    SourceSkips.Easignore |
    SourceSkips.AutolinkingConfigPaths,
};
