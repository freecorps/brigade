import { createBrowserSyncClient } from "@/lib/sync";

/** The tab's one sync client: every query and mutation shares its socket to the shard. */
export const syncClient = createBrowserSyncClient();
