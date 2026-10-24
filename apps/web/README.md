# @freecorps/brigade-web

The Brigade web dashboard: a React SPA (TanStack Router, Tailwind v4, shadcn/ui on Base UI) served by a small
Worker with static assets. See [RFC 0002](../../docs/rfcs/0002-architecture.md) for the runtime map.

So far it has one route, `/`: the dashboard shell with a "Local stack" check (the API Worker and a
`WorkspaceDO` round trip) and the severity and status legend.

## Run it

```bash
vp run dev    # from the repository root (or `vp dev` in apps/web)
```

One command serves the SPA, this Worker, the API Worker and its `WorkspaceDO` on http://localhost:5173. The
Cloudflare Vite plugin runs `apps/api` as an auxiliary worker in dev, and the `API` service binding resolves to
it by name.

```bash
vp run --filter @freecorps/brigade-web test   # Worker routing, theme and locale logic (Node, no browser)
vp run --filter @freecorps/brigade-web build  # dist/client (assets) + dist/brigade_web (Worker, wrangler.json)
```

## How requests are served

| Request        | Served by                                                                         |
| -------------- | --------------------------------------------------------------------------------- |
| `/api/*`       | This Worker (`run_worker_first`), forwarded to the API Worker with `/api` removed |
| a built asset  | Static assets                                                                     |
| any other path | `index.html` (`not_found_handling: "single-page-application"`)                    |

If the API Worker binding throws, the Worker answers `502 {"error":"api_unreachable"}`. There is no auth yet:
`workers_dev` and `preview_urls` are off, so a deployed Worker has no public URL. Keep it dev-only.

## Environments

Like `apps/api`: production is the top-level config (`brigade-web`), plus `dev` and `staging`
(`brigade-web-dev`, `brigade-web-staging`), each binding `API` to the matching `brigade-api-*` Worker. Service
bindings are not inherited, so each environment repeats them. Pick the environment at build time:

```bash
vp run build:dev            # CLOUDFLARE_ENV=dev vp build (also build:staging)
wrangler deploy --dry-run   # validates dist/brigade_web/wrangler.json (drop --dry-run to deploy)
```

The build bundles only this Worker; `apps/api` builds and deploys on its own.

## Theme and language

- **Theme:** light, dark or system, stored in `localStorage` (`brigade-theme`) and applied as the `dark` class on
  `<html>`. An inline script in `index.html` applies it before first paint, so nothing flashes;
  `test/theme.test.ts` runs that script against `src/lib/theme.ts` so the two cannot drift.
- **Language:** `en` or `pt-BR`, stored in `localStorage` (`brigade-locale`), else the browser's language. Changing
  it calls `setLocale` from `@freecorps/brigade-i18n`, updates `<html lang>` and re-renders the page content (keyed
  on the locale). Every user-facing string lives in `packages/i18n`.

## UI rules

Colours, type, radius and motion come from `@freecorps/brigade-ui` (`tokens.css` and `theme.css` replace shadcn's
default theme). The shadcn components in `src/components/ui` were added with the CLI (`components.json`) and
restyled per [packages/ui](../../packages/ui/README.md): opaque `ring-ring` focus, the destructive restyle, and
44px touch targets. Add new ones with `bunx shadcn@latest add <name>` from this folder, then restyle them the same
way.

## Generated files

- `src/routeTree.gen.ts`: written by the TanStack Router Vite plugin on `vp dev` and `vp build`; committed and
  excluded from formatting and linting.
- `worker/worker-configuration.d.ts`: written by `wrangler types` (`vp run cf-typegen`); committed. `vp run test`
  fails if it is stale. The Worker has its own `worker/tsconfig.json`, because the Workers runtime types conflict
  with the DOM types the SPA uses.

License: AGPL-3.0-only.
