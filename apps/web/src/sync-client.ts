import { createBrowserEmberClient } from "@/lib/sync";

/** The tab's one sync client (Ember's, RFC 0016): one socket per workspace's shard. */
export const syncClient = createBrowserEmberClient();
