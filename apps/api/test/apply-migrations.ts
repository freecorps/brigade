// Applies migrations/ to the test D1 before any test, as `wrangler d1 migrations apply` does for real databases.
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";

const migrations = Reflect.get(env, "TEST_MIGRATIONS") as D1Migration[];
await applyD1Migrations(env.DB, migrations);
