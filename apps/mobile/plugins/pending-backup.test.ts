import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import {
  applyBackupRules,
  backupRules,
  extractionRules,
  PENDING_FOLDER,
} from "./pending-backup.ts";

test("the rules leave out the folder src/lib/pending-files.ts keeps the queue in, and only it", () => {
  const source = readFileSync(join(import.meta.dirname, "../src/lib/pending-files.ts"), "utf8");
  expect(source).toContain(`export const PENDING_FOLDER = "${PENDING_FOLDER}";`);
  expect(source).toContain("new Directory(Paths.document, PENDING_FOLDER)");

  const exclusion = `<exclude domain="file" path="${PENDING_FOLDER}/" />`;
  const full = backupRules(PENDING_FOLDER);
  expect(full).toContain(`<full-backup-content>\n  ${exclusion}\n</full-backup-content>`);
  expect(full).not.toContain("<include");
  const extraction = extractionRules(PENDING_FOLDER);
  expect(extraction).toContain(`<cloud-backup>\n    ${exclusion}\n  </cloud-backup>`);
  expect(extraction).toContain(`<device-transfer>\n    ${exclusion}\n  </device-transfer>`);
  expect(extraction).not.toContain("<include");
});

test("the application points at the rules, and refuses to drop another plugin's", () => {
  const application = { $: { "android:name": ".MainApplication", "android:allowBackup": "true" } };
  applyBackupRules(application);
  expect(application.$).toEqual({
    "android:name": ".MainApplication",
    "android:allowBackup": "true",
    "android:fullBackupContent": "@xml/brigade_backup_rules",
    "android:dataExtractionRules": "@xml/brigade_data_extraction_rules",
  });
  // Running twice (a second prebuild) is fine.
  applyBackupRules(application);

  expect(() =>
    applyBackupRules({
      $: { "android:dataExtractionRules": "@xml/secure_store_data_extraction_rules" },
    }),
  ).toThrow(/merge/);
});
