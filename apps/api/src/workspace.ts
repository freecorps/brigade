import { DurableObject } from "cloudflare:workers";

export interface WorkspaceInfo {
  /** User tables in the object's SQLite database, read with SQL (none until spike S3 adds the schema). */
  tables: number;
  /** Size of the object's SQLite database in bytes. */
  databaseSize: number;
}

/**
 * Shard for one workspace (RFC 0002, RFC 0004). Read-only for now: writes arrive as named
 * mutations with the sync engine (spike S3).
 */
export class WorkspaceDO extends DurableObject<Env> {
  info(): WorkspaceInfo {
    const { sql } = this.ctx.storage;
    // `sqlite_version()` is not authorized in Durable Object SQLite, so read the catalog instead.
    // Skip internal tables so every runtime reports the same: Cloudflare's `_cf_*`, SQLite's
    // `sqlite_sequence` and the `__miniflare_do_name` table that local Miniflare adds.
    const { tables } = sql
      .exec<{ tables: number }>(
        `select count(*) as tables from sqlite_master
         where type = 'table'
           and name not like '!_cf!_%' escape '!'
           and name not like '!_!_%' escape '!'
           and name != 'sqlite_sequence'`,
      )
      .one();
    return { tables, databaseSize: sql.databaseSize };
  }
}
