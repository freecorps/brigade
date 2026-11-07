// The ledgers `WorkspaceDO`'s orchestrators keep in SQL (page deliveries, holds, replays, stored mutation results),
// as Ember's app-private SQL tables (G9): declared by ember/schema.ts, used through ember/shard-facade.ts. A module of
// its own, so the schema can import it without the functions.

import { PAGING_SCHEMA } from "../src/paging.ts";

const RESULTS_SCHEMA = `
  create table if not exists mutation_results (
    actor_id text not null,
    client_id text not null,
    mutation_id text not null,
    at integer not null,
    result text not null,
    primary key (actor_id, client_id, mutation_id)
  ) without rowid;
  create index if not exists mutation_results_at on mutation_results (at);
`;

/** One DDL text (`create … ; create …`) as single statements. */
const statements = (ddl: string) =>
  ddl
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

/** The ledgers' tables, as `defineSchema({ privateSql })` takes them (ember/schema.ts). */
/** The next tick each area scheduled (ember/paging.ts), so a burst of calls leaves one job. */
const TICKS_SCHEMA = `create table if not exists ember_ticks (key text primary key, at integer not null) without rowid`;

export const LEDGER_DDL: string[] = [
  ...statements(RESULTS_SCHEMA),
  ...statements(PAGING_SCHEMA),
  TICKS_SCHEMA,
];
export const LEDGER_TABLES: string[] = [
  ...new Set(
    LEDGER_DDL.flatMap((statement) => {
      const m = /^create\s+table\s+if\s+not\s+exists\s+([a-z_]+)/i.exec(statement);
      return m ? [m[1]!] : [];
    }),
  ),
];
