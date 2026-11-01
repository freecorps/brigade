// The files of src/lib/pending.ts, in the app's document directory (kept until the app deletes them, unlike the
// cache directory, which the system may empty when storage runs low). Not secure storage: a queue holds up to 500
// changes, past what the keychain and Android's keystore are for, and changes are not secrets. They are left out of
// device backups all the same (RFC 0004 "Clients"): on Android by the backup rules of plugins/pending-backup.ts,
// on iOS by marking the folder excluded from backup (modules/brigade-call). One set per instance (RFC 0015 section
// 5): the build's default instance keeps the folder from before several instances, every other a folder inside it,
// so opening or dropping one instance's queues never touches another's.
import { Directory, File, Paths } from "expo-file-system";
import { BrigadeCall } from "../../modules/brigade-call";
import { DEFAULT_INSTANCE } from "@/lib/instances";
import { savedText, serialFiles, type PendingFiles } from "@/lib/pending";

/** The folder's name; plugins/pending-backup.ts excludes it from Android backups by this name. */
export const PENDING_FOLDER = "brigade-pending";

const root = () => new Directory(Paths.document, PENDING_FOLDER);

/** Whether this launch has marked the folder: once is enough, and a folder made by an older build gets it too. */
let excluded = false;

const text = (file: File) => (file.exists ? file.text() : Promise.resolve(null));

const made = new Map<string, PendingFiles>();

/** Instance `instanceId`'s pending-change files, one operation at a time. */
export function pendingFilesFor(instanceId: string): PendingFiles {
  let files = made.get(instanceId);
  if (!files) {
    files = folderFiles(() =>
      instanceId === DEFAULT_INSTANCE ? root() : new Directory(root(), instanceId),
    );
    made.set(instanceId, files);
  }
  return files;
}

function folderFiles(directory: () => Directory): PendingFiles {
  return serialFiles({
    read: async (name) => {
      const dir = directory();
      const file = await text(new File(dir, name));
      return savedText(file, file === null ? await text(new File(dir, `${name}.next`)) : null);
    },
    write: async (name, raw) => {
      const dir = directory();
      dir.create({ intermediates: true, idempotent: true });
      if (!excluded && process.env.EXPO_OS === "ios") {
        excluded = true;
        // The flag is the root folder's and covers what is in it. A build without the function backs it up.
        try {
          const top = root();
          top.create({ intermediates: true, idempotent: true });
          BrigadeCall?.excludeFromBackup?.(top.uri);
        } catch {
          excluded = false;
        }
      }
      // Written aside, then moved over the old one. The move deletes the old file before moving the new one in, so a
      // kill between the two leaves only `.next`, which `read` falls back to: never half a queue, nor none.
      const next = new File(dir, `${name}.next`);
      await next.write(raw);
      await next.move(new File(dir, name), { overwrite: true });
    },
    remove: async (name) => {
      const dir = directory();
      for (const file of [new File(dir, name), new File(dir, `${name}.next`)]) {
        if (file.exists) file.delete();
      }
    },
    // Files only: another instance's folder inside this one is not a queue of this one's.
    list: async () => {
      const dir = directory();
      if (!dir.exists) return [];
      return dir
        .list()
        .filter((entry) => entry instanceof File)
        .map((entry) => entry.name);
    },
  });
}
