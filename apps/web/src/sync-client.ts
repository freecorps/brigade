import { createBrowserEmberClient, createBrowserSyncClient } from "@/lib/sync";

/** The tab's one Brigade Sync client: every query and mutation shares its socket to the shard. */
export const syncClient = createBrowserSyncClient();

/** The tab's one client for workspaces on Ember (RFC 0016): one socket per workspace's shard. */
export const emberClient = createBrowserEmberClient();
