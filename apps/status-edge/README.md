# @freecorps/brigade-status-edge

The status page edge (RFC 0012 "Custom domains"): the Worker that serves a workspace's status page at its own domain
(`status.example.com`) through Cloudflare for SaaS custom hostnames. It holds the SaaS zone's `*/*` route, so every
custom hostname reaches it and nothing else does; the API Worker never serves a custom hostname itself.

For each request it reads `host:<hostname>` from the API's `STATUS` KV namespace (read only, written by the API's
queue consumer):

| Lookup                        | Answer                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `{ workspaceId, slug }`       | The API's `StatusPages` entrypoint answers, with the visitor's own request                 |
| none, or unreadable           | A static 404 page, counted against the caller (`STATUS_MISS_LIMIT`, 30 a minute, then 429) |
| KV fails                      | The 503 page, never cached                                                                 |
| `/favicon.ico`, `/robots.txt` | A 404 that never counts and reads nothing                                                  |

The entrypoint (apps/api `src/status-pages.ts`) answers only that page: `/` is the page, `/status/<slug>` and its
feeds and subscription routes are themselves, anything else is the 404 page. It renders and caches as `/status/<slug>`
does, and serves the snapshot only while the workspace in the lookup is still the one that pushed it.

## Deploying

The API first, then this Worker: its one service binding is the API's `StatusPages` entrypoint, and a binding to a
Worker or entrypoint that does not exist fails the deploy. The top-level config is production
(`brigade-status-edge`, bound to `brigade-api`); `dev` is `brigade-status-edge-dev`, bound to `brigade-api-dev` and
dev's `STATUS` namespace.

```bash
vp run build:dev     # or `vp run build` for production
wrangler deploy      # the built config names the Worker and environment
```

A self-hosted instance gives the top-level `STATUS` binding the id of the API's own namespace before the first deploy,
or `wrangler deploy` provisions an empty one of its own and every hostname is a 404.

Then add the route by hand: a Workers route `*/*` on the Cloudflare for SaaS zone to this Worker (the zone's Workers
Routes in the dashboard). It is not in `wrangler.jsonc`, so no zone or hostname is in the repository, and `wrangler
deploy` leaves it alone. The zone must be one of its own, never the dashboard's or the operator's main zone, since
the route takes every hostname on it. The rest of the setup (the zone, the fallback origin, the token and the API's
settings) is in apps/api README "Custom domains". Turning custom domains off means removing this route too.

## Tests

`vp test` runs in Node with a fake KV, limiter and API (`test/edge.test.ts`): a hit, a miss and its limit, the
uncounted paths, KV failing and the API failing.
