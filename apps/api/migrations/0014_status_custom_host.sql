-- A status page's own domain (RFC 0012 "Custom domains"): which workspace holds each custom hostname, so one hostname
-- is one page across the instance. Claimed before Cloudflare is asked; released when the domain is removed.
create table if not exists status_custom_host (
  hostname text primary key,
  workspace_id text not null,
  created_at integer not null
);
create index if not exists status_custom_host_by_workspace on status_custom_host (workspace_id);
