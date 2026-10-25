# @freecorps/brigade-web

The Brigade web dashboard: a React SPA (TanStack Router, Tailwind v4, shadcn/ui on Base UI) served by a small
Worker with static assets. See [RFC 0002](../../docs/rfcs/0002-architecture.md) for the runtime map.

Routes: `/sign-up` (an account and its first workspace), `/sign-in`, and `/`, the dashboard, for signed-in
members only: `components/session.tsx` sends everyone else to `/sign-in`, asks a user without a workspace to
create one, and opens the workspace's shard as the member (their role is the optimistic actor's). The header shows
the workspace and an account menu with Sign out. Better Auth's client (`src/lib/auth.ts`) talks to `/api/auth/*`
on the same origin. The dashboard has the incidents card, a "Local stack" check (the API Worker and a
`WorkspaceDO` round trip) and the severity and status legend.

## Run it

```bash
vp run dev    # from the repository root (or `vp dev` in apps/web)
```

Before the first run, give the API a local Better Auth secret and create the local D1 tables (again after a new
migration):

```bash
printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -base64 32)" > apps/api/.dev.vars   # gitignored
vp run --filter @freecorps/brigade-web db:migrate
```

One command serves the SPA, this Worker, the API Worker and its `WorkspaceDO` on http://localhost:5173. The
Cloudflare Vite plugin runs `apps/api` as an auxiliary worker in dev, and the `API` service binding resolves to
it by name.

```bash
vp run --filter @freecorps/brigade-web test   # Worker routing, theme, locale and stack-check logic
vp run --filter @freecorps/brigade-web build  # dist/client (assets) + dist/brigade_web (Worker, wrangler.json)
```

`test/worker-config.test.ts` runs this Worker from the real `wrangler.jsonc` in front of the real API Worker
(`apps/api`) and its `WorkspaceDO`, through the `API` service binding, with wrangler's local test harness: it
checks that `/api` and `/api/*` reach the Worker (and the DO), and that a deep SPA path like `/incidents/42` gets
`index.html`. The only change to the config is the assets directory, a two-file fixture in `test/fixtures/assets`,
because the real one is the client build output that the Cloudflare Vite plugin fills in. The other tests run the
fetch handler with stub bindings.

The `build` task is defined in `vite.config.ts` (not `package.json`) so it can exclude the two files the build
rewrites, `src/routeTree.gen.ts` and `.wrangler/deploy/`, from its cache inputs; otherwise Vite Task never
caches it.

## How requests are served

| Request          | Served by                                                                         |
| ---------------- | --------------------------------------------------------------------------------- |
| `/api`, `/api/*` | This Worker (`run_worker_first`), forwarded to the API Worker with `/api` removed |
| a built asset    | Static assets                                                                     |
| any other path   | `index.html` (`not_found_handling: "single-page-application"`)                    |

Method, headers and body are forwarded unchanged, so WebSocket upgrades pass through too. If the API Worker
binding throws, the Worker answers `502 {"error":"api_unreachable"}`. Auth exists, but the API still has an open
dev route (`/workspaces/:id`), so `workers_dev` and `preview_urls` stay off and a deployed Worker has no public URL.

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
  `test/theme.test.ts` runs that script against `src/lib/theme.ts` so the two cannot drift. **A future
  Content-Security-Policy must allow this inline script by its hash** (`script-src 'sha256-…'`, computed from the
  built `dist/client/index.html`, since the build fills the token colours into it), not with `'unsafe-inline'`.
- **Browser chrome:** two `theme-color` tags (light and dark media queries) carry the page ground from
  `packages/ui`, filled in at build time by the `themeColor` plugin in `vite.config.ts`; the inline script and
  React point both at the chosen theme.
- **Language:** `en` or `pt-BR`, stored in `localStorage` (`brigade-locale`), else the browser's language. Changing
  it calls `setLocale` from `@freecorps/brigade-i18n`, updates `<html lang>` and re-renders the page content (keyed
  on the locale). Every user-facing string lives in `packages/i18n`. Other tabs follow both choices through the
  `storage` event.

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
