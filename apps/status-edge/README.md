# @freecorps/brigade-status-edge

The status page edge (RFC 0012 "Custom domains"): the Worker that serves a workspace's status page at its own domain
(`status.example.com`), through Cloudflare for SaaS custom hostnames, dedicated hostnames attached to it as Workers
Custom Domains, or both. It holds the SaaS zone's `*/*` route and the dedicated hostnames, so every custom hostname
reaches it and nothing else does; the API Worker never serves a custom hostname itself.

For each request it reads `host:<hostname>` from the API's `STATUS` KV namespace (read only, written by the API's
queue consumer):

| Lookup                        | Answer                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `{ workspaceId, slug }`       | The API's `StatusPages` entrypoint answers, with the visitor's own request                 |
| none, or unreadable           | A static 404 page, counted against the caller (`STATUS_MISS_LIMIT`, 30 a minute, then 429) |
| KV fails                      | The 503 page, never cached                                                                 |
| `/favicon.ico`, `/robots.txt` | A 404 that never counts and reads nothing                                                  |

Every answer it makes itself carries `X-Brigade-Status-Edge: 1`: the API reaches `/robots.txt` at a dedicated
hostname and reads that header to tell the hostname is attached here (apps/api `src/status-domain-edge.ts`).

The entrypoint (apps/api `src/status-pages.ts`) answers only that page: `/` is the page, `/status/<slug>` and its
feeds and subscription routes are themselves, anything else is the 404 page. It renders and caches as `/status/<slug>`
does, and serves the snapshot only while the workspace in the lookup is still the one that pushed it.

## Deploying

The API first, then this Worker: its one service binding is the API's `StatusPages` entrypoint, and a binding to a
Worker or entrypoint that does not exist fails the deploy. The top-level config is production
(`brigade-status-edge`, bound to `brigade-api`); `dev` is `brigade-status-edge-dev`, bound to `brigade-api-dev` and
dev's `STATUS` namespace.

There is no `staging` environment, unlike the API: staging has no `STATUS` namespace yet (apps/api `wrangler.jsonc`), so
an edge there would have nothing to read, and it would need a Cloudflare for SaaS zone, fallback origin and token of its
own. Bindings to a namespace or Worker that does not exist fail the deploy, so it is added with those.

```bash
vp run build:dev     # or `vp run build` for production
wrangler deploy      # the built config names the Worker and environment
```

The top-level `STATUS` binding is production's namespace, the API's own. A self-hosted instance puts the id of its
API's namespace there before the first deploy: a binding with no `id` makes `wrangler deploy` provision an empty one
of its own, and every hostname is a 404.

Then attach the hostnames by hand, in the dashboard, so no zone or hostname is in the repository:

- **Cloudflare for SaaS**: a Workers route `*/*` on the SaaS zone to this Worker (the zone's Workers Routes). The zone
  must be one of its own, never the dashboard's or the operator's main zone, since the route takes every hostname on
  it. Turning Cloudflare for SaaS off means removing this route too.
- **Dedicated hostnames**: each as a Custom Domain of this Worker (Settings → Domains & Routes), then listed in the
  API's `STATUS_HOSTNAMES`.

`wrangler.jsonc` has no `routes`, so `wrangler deploy` publishes none and leaves both alone; a `custom_domain` route
added there would replace the dashboard's Custom Domains with the file's. The rest of the setup is in apps/api README
"Custom domains".

## Tests

`vp test` runs in Node with a fake KV, limiter and API (`test/edge.test.ts`): a hit, a miss and its limit, the
uncounted paths and their `X-Brigade-Status-Edge` header, KV failing and the API failing.
