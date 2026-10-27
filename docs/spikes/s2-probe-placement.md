# Spike S2 — Probe placement

- Status: Done. Sampled every hint from 2026-10-25 14:51 to 2026-10-27 14:51 UTC; result and decision below
- Roadmap: Phase 0, S2
- Settles: RFC 0007 "Placement" (one `ProbeDO` per workspace and region, created with
  a `locationHint`, reporting the colo it really ran from)

## Question

RFC 0007 plans one `ProbeDO` per workspace and region, created with a Durable Object `locationHint`, running its
checks on `alarm()` and reporting where they really ran. Hints are best-effort. The pass criterion: the colo
observed per `locationHint` over 48 hours. In detail:

1. For each hint, which colo does the object land in? Does it stay there, and do its alarms keep firing from the
   same place?
2. Where do its outbound `fetch` calls egress, and what latency does that give to a few fixed public targets?
3. Is that good enough for RFC 0007's design, or what has to change?

## What was built

`spikes/s2-probe-placement` (`@freecorps/brigade-spike-s2`, private, AGPL-3.0-only; removed with this result, see
the history of this file for the code): one Worker, deployed as
`brigade-probe-dev`, with one SQLite-backed `ProbeDO`. It is spike code, outside `apps/` and `packages/`, and is
not meant to become product code; it sits in the workspace (`spikes/*`) only so CI checks and tests it.

- **One object per hint**, named `s2:<hint>` and created with `getByName(name, { locationHint: hint })`. All
  eleven hints the installed types accept are probed: RFC 0007's nine plus `apac-ne` and `apac-se`, which
  Cloudflare added later as narrower parts of `apac`.
- **One sample a minute** on `alarm()`. The handler sets the next alarm first (now + 60 s), so a failed sample
  cannot end the chain, then:
  - fetches `https://www.cloudflare.com/cdn-cgi/trace`, whose `colo=` line names the Cloudflare colo the
    subrequest entered from (the trick where.durableobjects.live uses; Cloudflare offers no API that tells an
    object where it runs);
  - times `HEAD` requests to three AWS S3 regional endpoints (us-east-1, eu-central-1, ap-southeast-1), one
    after another, up to the response headers, with `cache: "no-store"`, no redirects and a 5 s timeout;
  - writes one row: start time, the time the alarm was set for, its retry count, a random id per object
    instance, colo, the trace's `loc`, and the timings. The egress address in the trace is not stored. Rows
    older than 8 days are pruned.
- **Routes.** `GET /summary[?hours=N]`: per hint, the colo histogram with first and last seen, the
  number of colo changes and the runs between them, instances, the gaps between samples, alarm lateness, retries
  and latency percentiles (nearest rank). Also `POST /probes/{start,stop,reset}` and `GET /probes/samples` (raw
  rows). Every route needs `Authorization: Bearer <PROBE_ADMIN_TOKEN>`, a Wrangler secret compared by SHA-256
  digest with `crypto.subtle.timingSafeEqual`; `/summary` too, since each call wakes all eleven objects and
  reads days of rows.
- **Report.** `PROBE_ADMIN_TOKEN=<token> vpx scripts/report.ts <worker url> [--hours 48]` prints the summary as
  three tables (placement, alarms, latency), plus the colo runs of any probe that moved. `hours` is at most 192,
  the retention window.
- **Tests** (`@cloudflare/vitest-plugin`, as in apps/api): the summary logic (percentiles, colo runs and moves,
  instances, failures, retries), trace parsing, every route refusing a missing or wrong token, an alarm
  storing a sample from a stubbed fetch and scheduling the next one, stop, reset, and `/summary` listing every
  hint without the egress address.

Cost: 11 objects, 4 subrequests each a minute, about 63,000 subrequests and 16,000 alarm invocations a day.

## How it was run

```bash
vp run --filter @freecorps/brigade-spike-s2 build
cd spikes/s2-probe-placement
bunx wrangler deploy --secrets-file <file outside the repo with PROBE_ADMIN_TOKEN=<random>>
curl -X POST -H "Authorization: Bearer <token>" https://brigade-probe-dev.<subdomain>.workers.dev/probes/start
PROBE_ADMIN_TOKEN=<token> vpx scripts/report.ts https://brigade-probe-dev.<subdomain>.workers.dev
```

Deployed 2026-10-25 from a developer machine with wrangler 4.152.0 (compatibility date 2026-10-19). Every object was
first reached by that `start` call, so its hint, not the caller's location, decided where it was created.

## First results

From the first deployment (sampling from 14:41 UTC), read at 2026-10-25 14:42 UTC, one to two samples
per hint. At 14:51 the reviewed version (the code in this folder) was deployed and every probe reset and restarted; its first
samples landed in the same colo for all eleven hints, but the 48-hour window counts only from 14:51. Timings are milliseconds to response headers, for the
first samples only.

| Hint      | Colo | Trace | us-east-1 | eu-central-1 | ap-southeast-1 |
| --------- | ---- | ----- | --------- | ------------ | -------------- |
| `wnam`    | SEA  | 42    | 395       | 1397         | 741            |
| `enam`    | MIA  | 31    | 116       | 450          | 930            |
| `sam`     | MIA  | 30    | 115       | 456          | 982            |
| `weur`    | CDG  | 13    | 328       | 46           | 619            |
| `eeur`    | FRA  | 15    | 380       | 14           | 670            |
| `apac`    | NRT  | 14    | 728       | 943          | 313            |
| `apac-ne` | KIX  | 9     | 680       | 1025         | 1654           |
| `apac-se` | SIN  | 4     | 1038      | 735          | 20             |
| `oc`      | SYD  | 13    | 870       | 1361         | 995            |
| `afr`     | LHR  | 16    | 339       | 60           | 656            |
| `me`      | WAW  | 23    | 451       | 91           | 724            |

What these first samples already show:

- **Eight hints landed in their region**: `wnam` (Seattle), `enam` (Miami), `weur` (Paris), `eeur` (Frankfurt),
  `apac` (Tokyo), `apac-ne` (Osaka), `apac-se` (Singapore), `oc` (Sydney).
- **Three did not**, as Cloudflare's data location page says (Durable Objects do not spawn in South America,
  Africa or the Middle East yet; they go to a nearby supported region): `sam` landed in Miami, `afr` in London,
  `me` in Warsaw. A "São Paulo" probe would really check from Miami.
- **Egress follows the colo.** Each probe is fastest to the AWS region nearest its colo (Frankfurt 14 ms from
  FRA, Singapore 20 ms from SIN), so the outbound calls leave from where the object runs, not from somewhere
  central.
- **The trace's `loc` is no use**: it said `US` for every probe, Frankfurt and Sydney included. It geolocates the
  internal address a Worker subrequest arrives from. Only `colo` (or the `cf-ray` suffix) says where a probe is.
- **The timings are cold connections.** Each one includes DNS, TCP and TLS setup, roughly three to four round
  trips (Miami to us-east-1: 116 ms), and the very first sample of each probe is slower still (`apac-ne` to
  Singapore: 1654 ms). Product checks will report the same cold-connection time unless they separate connect
  from response time, which a Worker `fetch` does not expose.
- **The alarms ran on time**: within 0 to 150 ms of the time they were set for, 60 s apart, no retries.
- **In the first samples, each one ran in a new instance**: the runtime seems to evict the idle object between
  alarms a minute apart and construct it again in the same colo. If that holds over 48 hours, a new instance is
  not a migration signal (only a colo change is), and a probe pays the object's cold start on every run.

## Result (48 hours)

Read at 2026-10-27 14:51 UTC with `scripts/report.ts --hours 48`: about 2,880 samples per hint (one a minute).

| Hint      | Colo (samples)     | Moves | Gap s p50/p95/max | Late ms p50/p95/max | Nearest AWS p50/p95 ms   |
| --------- | ------------------ | ----- | ----------------- | ------------------- | ------------------------ |
| `wnam`    | SEA (2878)         | 0     | 60 / 60 / 120     | 2 / 24 / 4409       | us-east-1 353 / 428      |
| `enam`    | MIA (2878)         | 0     | 60 / 60 / 120     | 1 / 21 / 3152       | us-east-1 114 / 129      |
| `sam`     | MIA (2879)         | 0     | 60 / 60 / 71      | 1 / 19 / 11489      | us-east-1 117 / 131      |
| `weur`    | CDG (2880)         | 0     | 60 / 60 / 60      | 1 / 18 / 303        | eu-central-1 49 / 53     |
| `eeur`    | FRA (2879)         | 0     | 60 / 60 / 69      | 11 / 52 / 8785      | eu-central-1 13 / 21     |
| `apac`    | NRT (2877), none 1 | 0     | 60 / 60 / 65      | 2 / 24 / 4940       | ap-southeast-1 316 / 354 |
| `apac-ne` | KIX (2880)         | 0     | 60 / 60 / 60      | 1 / 13 / 386        | ap-southeast-1 342 / 392 |
| `apac-se` | SIN (2879)         | 0     | 60 / 60 / 63      | 12 / 47 / 2877      | ap-southeast-1 16 / 21   |
| `oc`      | SYD (2880)         | 0     | 60 / 60 / 61      | 1 / 14 / 1000       | ap-southeast-1 726 / 760 |
| `afr`     | LHR (2878)         | 0     | 60 / 60 / 70      | 12 / 32 / 10304     | eu-central-1 65 / 77     |
| `me`      | WAW (2880)         | 0     | 60 / 60 / 60      | 2 / 23 / 455        | eu-central-1 91 / 106    |

- **Placement is stable.** No probe moved in 48 hours: every hint ran every sample from the colo its first sample
  named. The one `none` on `apac` is a single trace request that failed, not a move.
- **`sam`, `afr` and `me` stayed out of region** for the whole window (Miami, London, Warsaw), as Cloudflare's data
  location docs say.
- **`apac-ne` and `apac-se` are real, distinct placements** (Osaka and Singapore), narrower than `apac` (Tokyo).
- **Every sample was a new instance** (instances = samples for every hint): with alarms a minute apart the runtime
  evicts the idle object and builds it again in the same colo. A new instance is not a migration; only a colo change
  is, and none happened. Each run pays the object's cold start.
- **Alarms are reliable.** No retries anywhere. The largest gap was 120 s on `wnam` and `enam` (one missed minute in
  48 hours); everywhere else at most 71 s. Lateness is a few milliseconds at p95 (13 to 52 ms), with rare outliers
  up to 11.5 s.
- **Egress follows the colo**, confirming the first samples: each probe is fastest to the AWS region nearest it
  (Frankfurt 13 ms, Singapore 16 ms, Paris to Frankfurt 49 ms), and the trace's `loc` said `US` for every probe, so
  it is useless for location.
- **Timings are cold connections** (DNS, TCP and TLS each run) and stable: in the table, p95 is at most about 20%
  above p50 for every target over 50 ms, and a few milliseconds above it for the nearest ones (13 / 21 ms from
  Frankfurt). Failures (5 s timeout) cluster on far, cross-ocean targets (up to 32 of about 2,880 for `apac-ne` to
  Frankfurt, about 1%) and are near zero for near ones.

## Decision

RFC 0007 "Placement" stands as built, now settled by the full window:

- Keep one `ProbeDO` per workspace and region created with `locationHint`, and keep offering only the six regions
  where objects spawn in-region (`wnam`, `enam`, `weur`, `eeur`, `apac`, `oc`). Do not offer `sam`, `afr` or `me`
  until Cloudflare places objects there; a check "from São Paulo" would really run from Miami.
- Keep reporting the colo each run really used and show it next to the region; never trust the trace's `loc`.
- `apac-ne` and `apac-se` are candidates for later regions (a Singapore probe is 20x closer to South-East Asian
  targets than Tokyo's); adding them is a product choice, not a placement risk.
- Treat a colo change, not a new instance, as the signal that a probe moved; expect a cold start every run.
- A check's timeout should stay well above cross-ocean cold-connection times (p95 up to about 1.4 s here); the
  product's limits (up to 30 s) already are.

## Resources created

On the Freecorps Cloudflare account, all deleted once this result was recorded:

- Worker `brigade-probe-dev`, on its workers.dev URL (no routes, no custom domain, no preview URLs)
- Durable Object namespace for `ProbeDO` (SQLite), class of `brigade-probe-dev`, with eleven objects `s2:<hint>`
- Secret `PROBE_ADMIN_TOKEN` on `brigade-probe-dev`
