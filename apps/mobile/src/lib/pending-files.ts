// The files of src/lib/pending.ts, in the app's document directory (kept until the app deletes them, unlike the
// cache directory). Not secure storage: a queue holds up to 500 changes, past what the keychain and Android's
// keystore are for, and changes are not secrets. expo-file-system ships with `expo`, so no new native build.
import { Directory, File, Paths } from "expo-file-system";
import { serialFiles, type PendingFiles } from "@/lib/pending";

const directory = () => new Directory(Paths.document, "brigade-pending");

/** The phone's pending-change files, one operation at a time. */
export const pendingFiles: PendingFiles = serialFiles({
  read: async (name) => {
    const file = new File(directory(), name);
    return file.exists ? file.text() : null;
  },
  write: async (name, raw) => {
    const dir = directory();
    dir.create({ intermediates: true, idempotent: true });
    // Written aside, then moved over the old one: a kill mid-write leaves the previous queue, never half of one.
    const next = new File(dir, `${name}.next`);
    await next.write(raw);
    await next.move(new File(dir, name), { overwrite: true });
  },
  remove: async (name) => {
    const file = new File(directory(), name);
    if (file.exists) file.delete();
  },
  list: async () => {
    const dir = directory();
    if (!dir.exists) return [];
    return dir
      .list()
      .filter((entry) => entry instanceof File)
      .map((entry) => entry.name);
  },
});
