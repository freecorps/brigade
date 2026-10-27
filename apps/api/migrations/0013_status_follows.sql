-- What each status page subscriber follows (RFC 0012 "Following components", src/status-subscribers.ts): a JSON array
-- of the page's follow keys (`statusFollowKey` in packages/schema: `c-…` for a component, `g-…` for a group), or null
-- for everything. Every row from before this migration is null, so every existing subscriber keeps getting everything.
-- Keys never name a component or a group by id, and a key whose component or group is gone simply never matches.
alter table "status_subscriber" add column "follows" text;
