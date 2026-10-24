import { DurableObject } from "cloudflare:workers";

export interface WorkspaceInfo {
  /** Durable Object id (hex). The workspace name is not known to the object itself. */
  id: string;
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
    // Local Miniflare adds a `__miniflare_do_name` table; skip `__*` so every runtime reports the same.
    const { tables } = sql
      .exec<{ tables: number }>(
        "select count(*) as tables from sqlite_master where type = 'table' and substr(name, 1, 2) != '__'",
      )
      .one();
    return { id: this.ctx.id.toString(), tables, databaseSize: sql.databaseSize };
  }
}
