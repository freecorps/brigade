import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ConfigPlugin, withAndroidManifest, withDangerousMod } from "expo/config-plugins";

// Android Auto Backup copies the app's files to the member's Google Drive, and to a new phone. The queue of changes
// not sent yet (src/lib/pending-files.ts, in the files directory) holds what members wrote about incidents, so it
// stays out: the rest of the app's backup is unchanged. Two files, because Android 12 reads `dataExtractionRules`
// and ignores `fullBackupContent`, which older versions read. iOS does the same with a flag on the folder
// (modules/brigade-call). RFC 0004, "Clients".

/** The folder of src/lib/pending-files.ts (`PENDING_FOLDER`), under `Paths.document`: the `file` domain. */
export const PENDING_FOLDER = "brigade-pending";
export const BACKUP_RULES = "brigade_backup_rules";
export const EXTRACTION_RULES = "brigade_data_extraction_rules";

const exclude = (folder: string) => `<exclude domain="file" path="${folder}/" />`;

/** Android 11 and older: `android:fullBackupContent`. Only excludes, so everything else is backed up as before. */
export function backupRules(folder: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<full-backup-content>",
    `  ${exclude(folder)}`,
    "</full-backup-content>",
    "",
  ].join("\n");
}

/** Android 12 and newer: `android:dataExtractionRules`, for cloud backups and device-to-device transfers. */
export function extractionRules(folder: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<data-extraction-rules>",
    "  <cloud-backup>",
    `    ${exclude(folder)}`,
    "  </cloud-backup>",
    "  <device-transfer>",
    `    ${exclude(folder)}`,
    "  </device-transfer>",
    "</data-extraction-rules>",
    "",
  ].join("\n");
}

/**
 * Points the `<application>` at the rules. Throws if it already has others (another plugin's, such as
 * expo-secure-store's): one set of rules has to say both, and silently keeping either would back up the queue or
 * lose the other's exclusions.
 */
export function applyBackupRules(application: { $: Record<string, string | undefined> }): void {
  const wanted = {
    "android:fullBackupContent": `@xml/${BACKUP_RULES}`,
    "android:dataExtractionRules": `@xml/${EXTRACTION_RULES}`,
  };
  for (const [key, value] of Object.entries(wanted)) {
    const current = application.$[key];
    if (current !== undefined && current !== value) {
      throw new Error(`${key} is already ${current}; merge its rules with ${value}`);
    }
    application.$[key] = value;
  }
}

export const withPendingBackup: ConfigPlugin = (config) => {
  config = withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (!application) throw new Error("AndroidManifest.xml has no <application>");
    applyBackupRules(application as { $: Record<string, string | undefined> });
    return mod;
  });
  return withDangerousMod(config, [
    "android",
    (mod) => {
      const xml = join(mod.modRequest.platformProjectRoot, "app/src/main/res/xml");
      mkdirSync(xml, { recursive: true });
      writeFileSync(join(xml, `${BACKUP_RULES}.xml`), backupRules(PENDING_FOLDER));
      writeFileSync(join(xml, `${EXTRACTION_RULES}.xml`), extractionRules(PENDING_FOLDER));
      return mod;
    },
  ]);
};
