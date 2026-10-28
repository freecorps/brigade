// migrations/ must create exactly the tables and columns Better Auth needs for src/auth.ts. When an upgrade or a
// new plugin needs more, this fails and prints the SQL to put in the next migration.
import { env } from "cloudflare:workers";
import { getMigrations } from "better-auth/db/migration";
import { expect, test } from "vite-plus/test";
import { authOptions } from "../src/auth.ts";

test("the checked-in migrations apply and leave Better Auth nothing to create", async () => {
  const { toBeCreated, toBeAdded, compileMigrations } = await getMigrations(
    authOptions({ database: env.DB, secret: env.BETTER_AUTH_SECRET }),
  );
  const missing = [...toBeCreated, ...toBeAdded].map((table) => table.table);
  if (missing.length > 0) console.error(await compileMigrations());
  expect(missing).toEqual([]);
});

test("every Brigade table is there, with the indexes the actor lookup uses", async () => {
  const { results } = await env.DB.prepare(
    "select type, name from sqlite_master where name not like 'sqlite_%' and name not like '_cf_%' order by type, name",
  ).all<{ type: string; name: string }>();
  expect(results.filter((row) => row.type === "table").map((row) => row.name)).toEqual([
    "account",
    // migrations/0011_api_token.sql (RFC 0014).
    "api_token",
    "d1_migrations",
    "invitation",
    "invitation_send",
    "member",
    "organization",
    "rateLimit",
    "session",
    // migrations/0012_session_end.sql (RFC 0004 "Session revocation").
    "session_end",
    // migrations/0006_slack_team.sql (RFC 0011).
    "slack_team",
    // migrations/0009_status_subscriber.sql (RFC 0012 "Email subscriptions").
    "status_confirmation_domain",
    // migrations/0010_status_confirmation_caps.sql.
    "status_confirmation_page_domain",
    "status_confirmation_send",
    // migrations/0014_status_custom_host.sql (RFC 0012 "Custom domains").
    "status_custom_host",
    // migrations/0008_status_slug.sql (RFC 0012).
    "status_slug",
    "status_subscriber",
    "takeover_notice",
    "user",
    "verification",
  ]);
  expect(results.map((row) => row.name)).toContain("member_organizationId_idx");
  expect(results.map((row) => row.name)).toContain("rateLimit_lastRequest_idx");
  expect(results.map((row) => row.name)).toContain("api_token_workspace_id_idx");
  expect(results.map((row) => row.name)).toContain("status_subscriber_inbox_idx");
});
